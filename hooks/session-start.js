#!/usr/bin/env node
'use strict';

process.on('uncaughtException', () => process.exit(0));

const path = require('path');
const eventlog = require('./lib/eventlog');
const { DATA_DIR, safeWriteJson } = require('./lib/config');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const { session_id, model, transcript_path } = input;

    eventlog.initSession(session_id);
    eventlog.append(session_id, { type: 'session_start', model });

    if (transcript_path) {
      safeWriteJson(path.join(DATA_DIR, 'current-session.json'), { session_id, transcript_path });
    }

    const isOpus = model && model.toLowerCase().includes('opus');
    if (isOpus) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext:
            'proompt-police: Opus model active. Output tokens cost ~5x Sonnet. ' +
            'Consider /model sonnet for routine grep/find/ls tasks; escalate to Opus when stuck.',
        },
      }));
    }
  } catch (_) {}
  process.exit(0);
});
