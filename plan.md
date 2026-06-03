proompt-police

 ▎ A Claude Code plugin that gets in the way of expensive habits in real time, instead of
 ▎ relying on the user to remember best practices. Hooks intercept costly tool calls and ask for
 ▎ a cheaper path; a statusline + TUI dashboard show live spend.

 ---
 Context

 Why this exists. Usage analysis of BedrockUser_smullan (claude-cli/2.1.161) showed 4.38M output
 tokens vs 1.6M input — output volume, on an Opus default, is the entire bill. Prompt caching is
 already optimal (huge cache-hit rate); nothing to fix there. The real cost drivers are behavioral:

 1. Raw log dumps — gh run view --log pulling 80KB, pasted 50KB Jenkins logs, cat of huge files.
 2. Sub-agent bloat — Explore/Agent told to "be very thorough," returning 40k+ char essays the
 user pays output tokens for and never reads in full.
 3. Write-over-Edit — regenerating whole files (Write of a 62k-char .tex) instead of Edit diffs.
 4. Opus on routine — Opus default running trivial grep/find/Bash; ~5x Sonnet's output price.

 The user will not remember to fix these per-session (the existing "Caveman Mode" only trims
 conversational prose — a small slice — and gives a false sense of savings). So put the discipline in
 the harness. A plugin that intercepts the bad call and offers the cheap one is durable where memory
 is not.

 Intended outcome. Substantial output-token reduction with near-zero user effort: friction lands
 exactly on the expensive action, plus always-on visibility of cost/tokens/cache/model.

 Hard constraints discovered during research (these shape the whole design):

 - A PreToolUse hook can return allow / ask / deny but CANNOT modify tool_input. The
 mechanic must therefore be intercept → ask with a reason + the cheaper alternative → user/Claude
 retries correctly. This matches the chosen Ask enforcement mode.
 - No hook can change the model. Opus-on-routine can only be surfaced (statusline) and nudged
 (injected advisory context), never auto-downgraded. Honest framing required — no silent cap claims.
 - Cost is not persisted by Claude Code. It is handed live to the statusLine command on stdin
 (cost.total_cost_usd, context_window.current_usage with cache split). Historical data lives in
 the transcript .jsonl (message.usage). The dashboard derives everything from those two sources.

 ---
 Decisions (confirmed with user)

 ┌─────────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │  Dimension  │                                                    Choice                                                     │
 ├─────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Enforcement │ Ask — PreToolUse returns permissionDecision: "ask" with reason + cheaper alt. Never hard-blocks.              │
 ├─────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Guards      │ All four: raw-log, sub-agent bloat, write-over-edit, opus-on-routine. Plus: rules are pluggable —             │
 │             │ add/remove/toggle on the fly via config.                                                                      │
 ├─────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Monitor     │ Statusline + standalone TUI dashboard.                                                                        │
 └─────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 The pluggable-rules requirement is the architectural backbone: guards are data-driven rules in a
 config file, not hardcoded if branches. One generic PreToolUse dispatcher evaluates all enabled
 rules. Adding a guard = adding a rule object; disabling = flipping enabled: false or /thrift off <id>.

 ---
 Architecture

 claude-thrift/
 ├── .claude-plugin/
 │   ├── plugin.json            # manifest: hooks + statusLine + skills wiring
 │   └── marketplace.json       # github source for `claude plugin marketplace add`
 ├── hooks/
 │   ├── pretooluse-guard.js    # generic rule dispatcher (the core)
 │   ├── session-start.js       # loads/merges config, injects advisory context, resets session log
 │   ├── statusline.js          # reads statusLine stdin JSON → renders live badge
 │   └── lib/
 │       ├── config.js          # load + merge + safe read/write (symlink-safe, size-capped)
 │       ├── rules.js           # built-in rule definitions (the 4 guards) + registry
 │       ├── eventlog.js        # append JSONL events to session log
 │       └── pricing.js         # model → $/token table for derived cost
 ├── rules/
 │   └── builtin.json           # the 4 guards as data; user config overlays/extends this
 ├── bin/
 │   └── thrift-dashboard.js    # standalone TUI: tails transcript .jsonl + event log
 ├── skills/
 │   ├── thrift/SKILL.md        # /thrift — toggle rules, show status, set budget
 │   └── thrift-dashboard/SKILL.md  # /thrift-dashboard — launch the TUI
 ├── package.json               # "type": "commonjs", bin entry for dashboard
 └── README.md

 Language: Node.js (CommonJS), matching the caveman reference plugin. No external deps for hooks
 (keep them fast — timeout: 5). Dashboard may use a tiny TUI lib (blessed/ink) declared in
 package.json, run via npx/node — it is NOT a hook, so startup cost doesn't matter.

 ---
 Component 1 — Pluggable rule engine (hooks/lib/rules.js + rules/builtin.json)

 A rule is a data object. The dispatcher matches tool_name, runs the rule's predicate against
 tool_input, and if it fires returns an ask decision with the rule's message.

 // rules/builtin.json  — each entry is independently toggleable
 [
   {
     "id": "raw-log-dump",
     "enabled": true,
     "tools": ["Bash"],
     "when": {                              // declarative predicate, evaluated by rules.js
       "field": "command",
       "matchesAny": ["gh run view .*--log", "\\bcat\\b .*\\.log", "journalctl", "docker logs"],
       "andNot": ["\\| *(grep|tail|head|awk|sed|rg)", "-n \\d", "--tail"]
     },
     "ask": "Raw log pull with no filter → tens of KB into context. Re-run piped, e.g. `… | grep -C 50 -iE 'error|fail|fatal'` or
 `| tail -n 200`."
   },
   {
     "id": "subagent-bloat",
     "enabled": true,
     "tools": ["Agent", "Task"],
     "when": {
       "field": "prompt",
       "matchesAny": ["thorough", "everything", "comprehensive", "detailed report", "full summary"]
     },
     "ask": "Explore/Agent prompted for an exhaustive prose report → big hidden output-token bill. Ask it for: bulleted file paths
 + components, no narrative, cap ~150 lines. Re-dispatch with a concise-output instruction."
   },
   {
     "id": "write-over-edit",
     "enabled": true,
     "tools": ["Write"],
     "when": {
       "field": "content",
       "minLength": 4000,                   // big content...
       "fileExists": true                   // ...onto a file that already exists (lib stats file_path)
     },
     "ask": "Large Write over an existing file = regenerating the whole thing in output tokens. Prefer targeted Edit(s) for the
 changed regions. Use Write only for new files or full rewrites."
   },
   {
     "id": "opus-on-routine",
     "enabled": true,
     "tools": ["Bash"],
     "advisoryOnly": true,                  // never asks; only flags statusline + logs (model can't be switched by a hook)
     "when": { "field": "command", "matchesAny": ["^\\s*(grep|find|ls|cat|rg|wc|head|tail)\\b"] },
     "note": "Trivial command on Opus. Consider /model sonnet for routine work; escalate to Opus when stuck."
   }
 ]

 Predicate vocabulary supported by rules.js (kept small, extensible): matchesAny / matchesAll
 (regex on a tool_input field), andNot (negative regex — the key to "log dump without a filter"),
 minLength / maxLength (string length of a field, e.g. content), fileExists (stat file_path).
 New predicate kinds are added in one place. This is what makes guards pluggable without code edits for
 the common cases; a power-user rule can also point at a JS module for arbitrary logic.

 Config merge & on-the-fly toggling (hooks/lib/config.js):
 - Effective rules = rules/builtin.json ⊕ user overlay at ~/.claude/thrift/rules.json
 (overlay can disable a builtin by id, tweak its message/thresholds, or add brand-new rules).
 - Live toggle state in ~/.claude/thrift/state.json (e.g. { "disabled": ["write-over-edit"], "budgetUsd": 5 }),
 written by the /thrift skill — so /thrift off write-over-edit takes effect on the very next tool call
 with no restart.
 - All file I/O reuses caveman's proven safe pattern: refuse symlinks (target + parent), O_NOFOLLOW,
 size-cap reads, whitelist/parse-validate before use, atomic temp-write+rename, silent best-effort fail.

 ---
 Component 2 — PreToolUse dispatcher (hooks/pretooluse-guard.js)

 The single hook all guards run through. Pseudocode:

 input = JSON.parse(stdin)                          // {tool_name, tool_input, cwd, session_id, ...}
 rules = config.loadEffectiveRules()                // builtin ⊕ overlay, minus state.disabled
 fired = rules.filter(r => r.tools.includes(input.tool_name) && rules.matches(r.when, input.tool_input, input.cwd))

 for (r of fired) eventlog.append(session_id, {type:'rule_fire', id:r.id, tool:r.tool_name, advisory:!!r.advisoryOnly})

 blocking = fired.find(r => !r.advisoryOnly)
 if (blocking) {
   print JSON: { hookSpecificOutput: {
     hookEventName: "PreToolUse",
     permissionDecision: "ask",
     permissionDecisionReason: blocking.ask          // shown in the permission prompt
   }}
 }
 exit 0                                              // advisory-only rules: logged, no decision emitted

 - Ask, not deny (per decision): permissionDecision: "ask" surfaces the reason and lets the user
 approve or have Claude retry the cheap way. Nothing is hard-blocked.
 - Advisory rules (opus-on-routine) emit no decision — they only append an event the statusline and
 dashboard read. Honest about the "can't switch model from a hook" constraint.
 - Fast and dependency-free; timeout: 5 in the manifest. Any parse error → exit 0 (fail open, never
 wedge the user's tools).

 Manifest wiring (.claude-plugin/plugin.json):

 {
   "name": "claude-thrift",
   "version": "0.1.0",
   "description": "Real-time cost guardrails: intercept expensive Claude Code habits, show live spend.",
   "hooks": {
     "SessionStart": [{ "hooks": [{ "type": "command",
       "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js\"", "timeout": 5 }]}],
     "PreToolUse": [{ "matcher": "Bash|Write|Edit|Agent|Task", "hooks": [{ "type": "command",
       "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse-guard.js\"", "timeout": 5 }]}]
   },
   "statusLine": { "type": "command",
     "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/statusline.js\"", "refreshInterval": 10 }
 }

 ▎ Note: caveman currently owns the statusLine in ~/.claude/settings.json. Plugin statuslines and the
 ▎ user statusline can collide — the README must document composing them (thrift can detect an existing
 ▎ statusLine and emit its segment for the user to chain, mirroring caveman's "nudge" approach rather
 ▎ than clobbering).

 ---
 Component 3 — Live statusline (hooks/statusline.js)

 Reads the rich statusLine stdin JSON (confirmed schema) and renders one line:

 $0.42 ⬆12.3k ⬇48.1k  cache 91%  Opus⚠  guards:4  ⚑raw-log,opus×3

 Source fields (all from stdin, no derivation needed for the live number):
 - cost.total_cost_usd → $0.42
 - context_window.current_usage.{input_tokens, output_tokens} → ⬆/⬇
 - cache % = cache_read / (cache_read + input) from current_usage
 - model.display_name → Opus; append ⚠ when model id contains opus (advisory nudge)
 - guards:N = count of enabled rules (from config)
 - trailing flags = recent rule fires this session, read from the event log (⚑raw-log, opus×3)

 ANSI color: green under budget, amber/red as cost.total_cost_usd approaches state.budgetUsd.

 ---
 Component 4 — TUI dashboard (bin/thrift-dashboard.js, launched by /thrift-dashboard)

 Standalone (not a hook → no time limit). Two data sources, both already mapped:
 1. Transcript .jsonl at the project path — historical per-turn message.usage
 (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, model).
 2. Thrift event log ~/.claude/thrift/events/<session_id>.jsonl — rule fires written by the hook.

 Renders (tail/refresh loop):
 - Spend over session — cumulative $ (derived via lib/pricing.js: tokens × model rate, cache-read at
 the reduced rate), output-token sparkline.
 - Cost by model — Opus vs Sonnet split (the headline lever — makes "Opus on routine" visible).
 - Cache efficiency — read vs creation vs fresh input %.
 - Habit scoreboard — count per rule id from the event log; biggest offenders ranked. The feedback
 loop that tells the user which guard is earning its keep.
 - Top output-token turns — which tool calls / sub-agent returns cost the most (surfaces the 40k-char
 Explore essays directly).

 lib/pricing.js holds a model→rate table (Opus vs Sonnet vs Haiku, input/output/cache-read). Documented
 as user-editable; values are estimates — dashboard labels cost "est."

 ---
 Component 5 — /thrift skill (skills/thrift/SKILL.md)

 The on-the-fly control surface. Subcommands write ~/.claude/thrift/state.json (picked up next tool call):

 - /thrift — show enabled/disabled rules, today's spend, budget.
 - /thrift off <id> / /thrift on <id> — toggle a guard live.
 - /thrift add — scaffold a new rule object into the user overlay (~/.claude/thrift/rules.json).
 - /thrift budget <usd> — set the statusline amber/red threshold.
 - /thrift-dashboard — launch the TUI.

 ---
 Files to create (representative)

 ┌──────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────┐
 │                           Path                           │                             Role                              │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ .claude-plugin/plugin.json                               │ hooks + statusLine + skills manifest                          │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ .claude-plugin/marketplace.json                          │ {source:{source:"github", repo:"<owner>/claude-thrift"}}      │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ hooks/pretooluse-guard.js                                │ generic rule dispatcher → ask decisions                       │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ hooks/session-start.js                                   │ merge config, inject advisory context, init session event log │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ hooks/statusline.js                                      │ live badge from statusLine stdin                              │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ hooks/lib/{config,rules,eventlog,pricing}.js             │ shared engine + safe I/O                                      │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ rules/builtin.json                                       │ the 4 guards as data                                          │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ bin/thrift-dashboard.js                                  │ TUI over transcript + event log                               │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ skills/thrift/SKILL.md, skills/thrift-dashboard/SKILL.md │ control + launch                                              │
 ├──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
 │ README.md                                                │ install, statusline-composition caveat, rule-authoring guide  │
 └──────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────┘

 Reference implementation to mirror (already on this box): the caveman plugin at
 /root/.claude/plugins/cache/caveman/caveman/84cc3c14fa1e/ — copy its plugin.json hook shape,
 caveman-config.js symlink-safe atomic file I/O, the ${CLAUDE_PLUGIN_ROOT} command pattern, and the
 SessionStart-injects-context / statusline-reads-flag-file split.

 ---
 Build order

 1. Skeleton + manifest — plugin.json, package.json, dirs. Install locally
 (claude plugin marketplace add <path> / enable) and confirm the SessionStart hook fires.
 2. Config + rules engine — lib/config.js, lib/rules.js, rules/builtin.json. Unit-test the
 predicate matcher (regex, andNot, minLength, fileExists) against sample tool_input objects.
 3. PreToolUse dispatcher — wire pretooluse-guard.js; verify each of the 4 guards returns ask
 (or advisory-logs) on a crafted call and allows a clean call.
 4. Event log + statusline — lib/eventlog.js, statusline.js; see live cost/tokens/flags render.
 5. /thrift skill — live toggle via state.json; confirm disabling a rule takes effect next call.
 6. TUI dashboard — bin/thrift-dashboard.js + lib/pricing.js over transcript + event log.
 7. README + marketplace.json — install docs, statusline-composition caveat, rule-authoring guide.

 ---
 Verification (end-to-end)

 - Guard fires (ask): Run gh run view --log with no pipe → expect a permission prompt quoting the
 raw-log reason. Re-run … | grep -C 50 error → no prompt. Repeat for: Agent prompt containing
 "thorough" (asks), Write of >4000 chars onto an existing file (asks), Write of a new file (allows).
 - Advisory: Run grep foo while model=Opus → no prompt, but statusline shows Opus⚠ and the
 dashboard habit-scoreboard increments opus-on-routine.
 - On-the-fly toggle: /thrift off raw-log-dump, immediately re-run the unpiped log pull → no prompt.
 /thrift on raw-log-dump → prompt returns. (Proves state.json is read per-call, no restart.)
 - Add a rule: drop a new object into ~/.claude/thrift/rules.json, trigger it → fires without
 touching plugin code.
 - Monitor accuracy: cross-check statusline $/tokens against the transcript .jsonl
 message.usage for the same turn; confirm cache % matches cache_read / (cache_read+input).
 - Fail-open safety: feed the hook malformed stdin → exits 0, tool proceeds (never wedges the CLI).
 - Self-test on this very session: the analysis traffic (raw gh run --log, "be very thorough"
 Explore dispatches, 62k-char .tex Write) should each light up a guard — the original cost drivers
 are exactly the test fixtures.
