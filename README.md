# proompt police

Stop expensive Claude Code habits before they hit your bill.

Guards intercept the four biggest output-token cost drivers in real time and ask for the cheap path. A live statusline badge shows cost, tokens, cache hit rate, and recent guard fires.

## What it catches

| Guard | Trigger | What it asks |
|-------|---------|--------------|
| `raw-log-dump` | `gh run view --log`, `cat *.log`, `journalctl`, `docker logs` with no filter pipe | Re-run piped to `grep`/`tail` |
| `subagent-bloat` | Agent/Task prompt containing "thorough", "comprehensive", "everything", etc. | Rewrite for bullet-point output, cap 150 lines |
| `write-over-edit` | `Write` of >4000 chars onto an existing file | Use `Edit` for the changed regions instead |
| `opus-on-routine` | Trivial `grep`/`find`/`ls`/`cat` while on Opus | Advisory only — statusline shows `Opus⚠`, no block |

All guards use **ask** mode — you can approve or have Claude retry the cheap way. Nothing is hard-blocked.

## Install

### One-line (recommended)

```bash
claude plugin marketplace add SeamusMullan/proompt-police
claude plugin install proompt-police@proompt-police
```

### Local / dev

```bash
claude --plugin-dir /path/to/proompt-police
```

## Statusline

proompt-police adds a statusline segment:

```
$0.42  ⬆12.3k ⬇48.1k  cache 91%  Sonnet 4.6  guards:4
```

### Composing with caveman

If you have the [caveman](https://github.com/JuliusBrussee/caveman) plugin, wire the compositor into `~/.claude/settings.json` once to show both segments:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/path/to/proompt-police/bin/statusline-compositor.js\""
  }
}
```

The compositor auto-discovers caveman's statusline script — no hardcoded paths.

Without caveman, point directly at the proompt-police statusline:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/statusline.js\""
  }
}
```

> **Note:** Claude Code supports one `statusLine` command. If your global `~/.claude/settings.json` already defines one, it takes precedence over the plugin's `settings.json`. Use the compositor to combine them.

## Controls

```
/proompt-police:thrift               — show guard status, spend, budget
/proompt-police:thrift off <id>      — disable a guard (live, no restart)
/proompt-police:thrift on <id>       — re-enable
/proompt-police:thrift budget <usd>  — set statusline amber/red threshold
/proompt-police:thrift add           — scaffold a custom rule
```

## Dashboard

```bash
thrift-dashboard <path/to/transcript.jsonl>
```

Shows: cumulative spend, output-token sparkline, cost by model, cache efficiency, habit scoreboard (which guards fire most), top output-token turns.

The transcript path is available via `CLAUDE_TRANSCRIPT_PATH` env, or printed by the SessionStart hook on init.

## Custom rules

Drop a `~/.claude/proompt-police/rules.json` file. Rules here overlay the builtins — same id overrides, new id appends. Takes effect on the next tool call, no restart needed.

```json
[
  {
    "id": "my-rule",
    "enabled": true,
    "tools": ["Bash"],
    "when": {
      "field": "command",
      "matchesAny": ["my-expensive-command"]
    },
    "ask": "Reason shown in the permission prompt."
  }
]
```

Predicate vocabulary: `matchesAny`, `matchesAll`, `andNot` (regex on a field), `minLength`, `maxLength`, `fileExists`.

Disable a builtin without touching the file:

```
/proompt-police:thrift off raw-log-dump
```

## State file

`~/.claude/proompt-police/state.json` — written by the `/thrift` skill:

```json
{ "disabled": ["raw-log-dump"], "budgetUsd": 5 }
```
