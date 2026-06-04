---
description: Launch the proompt-police TUI dashboard — live spend, cache efficiency, habit scoreboard, top cost turns.
---

# proompt-police:thrift-dashboard

Launch the interactive TUI dashboard that shows:

- Cumulative session spend ($) and output-token sparkline
- Cost split by model (Opus vs Sonnet vs other)
- Cache efficiency (read % vs creation % vs fresh input %)
- Habit scoreboard: rule fire counts ranked by frequency
- Top output-token turns: which tool calls cost the most

## How to run

Run the dashboard binary:

```bash
thrift-dashboard
```

If the binary is not in PATH, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/thrift-dashboard.js"
```

The dashboard reads:
1. The current session's transcript `.jsonl` (from `CLAUDE_TRANSCRIPT_PATH` env or the session's transcript path)
2. The event log at `~/.claude/proompt-police/events/<session_id>.jsonl`

It refreshes every 2 seconds. Press `q` or `Ctrl+C` to exit.
