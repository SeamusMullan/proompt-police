---
description: Control proompt-police cost guards. Show status, toggle rules on/off, set budget. Usage: /proompt-police:thrift [status|on <id>|off <id>|budget <usd>|add]
---

# proompt-police:thrift

Manage the proompt-police cost guards for this session.

## Subcommands

- `/proompt-police:thrift` or `/proompt-police:thrift status` — show all rules (enabled/disabled), current session spend, budget
- `/proompt-police:thrift off <id>` — disable a guard (takes effect on next tool call, no restart)
- `/proompt-police:thrift on <id>` — re-enable a guard
- `/proompt-police:thrift budget <usd>` — set the statusline amber/red threshold (e.g. `budget 5`)
- `/proompt-police:thrift add` — scaffold a new rule into `~/.claude/proompt-police/rules.json`

## How to execute

Parse `$ARGUMENTS` to identify the subcommand and arguments. Then:

**status (default):** Read `~/.claude/proompt-police/state.json` for disabled list and budget. Read builtin rules from the plugin's `rules/builtin.json`. Read user rules from `~/.claude/proompt-police/rules.json` if it exists. Print a table of all rules with enabled/disabled status. Show current `budgetUsd` if set.

**off <id> / on <id>:** Read state.json (or start with `{}`). Add/remove the id from the `disabled` array. Write back with atomic safe-write (temp + rename). Confirm the change to the user.

**budget <usd>:** Parse the number. Read state.json, set `budgetUsd: <number>`, write back. Confirm.

**add:** Print a template rule object the user can paste into `~/.claude/proompt-police/rules.json`:
```json
{
  "id": "my-rule",
  "enabled": true,
  "tools": ["Bash"],
  "when": {
    "field": "command",
    "matchesAny": ["pattern-here"]
  },
  "ask": "Reason shown in permission prompt."
}
```

## State file location

`~/.claude/proompt-police/state.json` — format: `{ "disabled": ["rule-id"], "budgetUsd": 5 }`

Write this file safely: read first, modify in memory, write to a temp file, rename atomically. Never truncate with a direct write if the read fails.
