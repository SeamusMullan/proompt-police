#!/usr/bin/env node
'use strict';

process.on('uncaughtException', () => process.exit(0));

const path = require('path');
const os = require('os');
const eventlog = require('./lib/eventlog');
const { loadEffectiveRules, loadState } = require('./lib/config');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const AMBER = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function fmt(n) {
  if (n === undefined || n === null) return '?';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw);
    const cost = data.cost || {};
    const cw = data.context_window || {};
    const cu = cw.current_usage || null;
    const model = (data.model || {});
    const modelName = model.display_name || model.id || '?';
    const modelId = (model.id || '').toLowerCase();
    const isOpus = modelId.includes('opus');

    const totalCost = cost.total_cost_usd || 0;
    const state = loadState();
    const budget = state.budgetUsd || 0;

    // cost color
    let costColor = GREEN;
    if (budget > 0) {
      const pct = totalCost / budget;
      if (pct >= 0.9) costColor = RED;
      else if (pct >= 0.5) costColor = AMBER;
    }

    const costStr = `$${totalCost.toFixed(2)}`;

    // tokens
    let tokenStr = '';
    if (cu) {
      tokenStr = ` ⬆${fmt(cu.input_tokens)} ⬇${fmt(cu.output_tokens)}`;
      const cacheTotal = (cu.cache_read_input_tokens || 0) + (cu.input_tokens || 0);
      if (cacheTotal > 0) {
        const cachePct = Math.round((cu.cache_read_input_tokens || 0) / cacheTotal * 100);
        tokenStr += ` ${DIM}cache ${cachePct}%${RESET}`;
      }
    }

    // model badge
    const modelBadge = isOpus
      ? `${AMBER}${BOLD}${modelName}⚠${RESET}`
      : `${DIM}${modelName}${RESET}`;

    // guard count
    const rules = loadEffectiveRules();
    const guardCount = rules.length;

    // recent fires (last 5 min)
    // session_id not available in statusline stdin; scan latest session log
    let firesStr = '';
    try {
      const eventsDir = path.join(os.homedir(), '.claude', 'proompt-police', 'events');
      const fs = require('fs');
      const files = fs.readdirSync(eventsDir).sort();
      if (files.length > 0) {
        const latest = files[files.length - 1].replace('.jsonl', '');
        const fires = eventlog.recentFires(latest, 300000);
        if (fires.length > 0) {
          const counts = {};
          for (const f of fires) {
            counts[f.id] = (counts[f.id] || 0) + 1;
          }
          const parts = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id, n]) => n > 1 ? `${id}×${n}` : id);
          firesStr = ` ${AMBER}⚑${parts.join(',')}${RESET}`;
        }
      }
    } catch (_) {}

    const line = [
      `${costColor}${costStr}${RESET}`,
      tokenStr,
      modelBadge,
      `${DIM}guards:${guardCount}${RESET}`,
      firesStr,
    ].filter(Boolean).join('  ');

    process.stdout.write(line);
  } catch (_) {
    process.stdout.write('proompt-police');
  }
  process.exit(0);
});
