#!/usr/bin/env node
'use strict';

// Fail-open: any error → exit 0 so the tool proceeds normally
process.on('uncaughtException', () => process.exit(0));

const { loadEffectiveRules } = require('./lib/config');
const { matchesRule } = require('./lib/rules');
const eventlog = require('./lib/eventlog');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const { tool_name, tool_input, session_id, cwd } = input;

    const rules = loadEffectiveRules();
    const fired = rules.filter(r => matchesRule(r, tool_name, tool_input || {}, cwd));

    for (const r of fired) {
      eventlog.append(session_id, {
        type: 'rule_fire',
        id: r.id,
        tool: tool_name,
        advisory: !!r.advisoryOnly,
      });
    }

    const blocking = fired.find(r => !r.advisoryOnly);
    if (blocking) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: blocking.ask,
        },
      }));
    }
  } catch (_) {}
  process.exit(0);
});
