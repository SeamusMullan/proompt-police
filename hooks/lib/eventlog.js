'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

function sessionLogPath(sessionId) {
  return path.join(DATA_DIR, 'events', `${sessionId}.jsonl`);
}

function initSession(sessionId) {
  try {
    const dir = path.join(DATA_DIR, 'events');
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}

function append(sessionId, event) {
  try {
    const logPath = sessionLogPath(sessionId);
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });

    // refuse symlinks
    try {
      if (fs.lstatSync(logPath).isSymbolicLink()) return;
    } catch (_) {}

    const line = JSON.stringify({ ts: Date.now(), ...event }) + '\n';
    fs.appendFileSync(logPath, line, { mode: 0o600 });
  } catch (_) {}
}

function recentFires(sessionId, maxAgeMs = 300000) {
  try {
    const logPath = sessionLogPath(sessionId);
    const st = fs.lstatSync(logPath);
    if (st.isSymbolicLink() || !st.isFile()) return [];
    if (st.size > 1024 * 1024) return []; // 1MB cap

    const content = fs.readFileSync(logPath, 'utf8');
    const now = Date.now();
    const lines = content.trim().split('\n').filter(Boolean);
    const fires = [];
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'rule_fire' && (now - ev.ts) <= maxAgeMs) {
          fires.push(ev);
        }
      } catch (_) {}
    }
    return fires;
  } catch (_) {
    return [];
  }
}

module.exports = { initSession, append, recentFires };
