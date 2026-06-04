#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { estimateCost } = require('../hooks/lib/pricing');

const DATA_DIR = process.env.PROOMPT_POLICE_DATA
  || path.join(os.homedir(), '.claude', 'proompt-police');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const AMBER = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function fmt(n) {
  if (n === undefined || n === null) return '?';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function bar(pct, width = 20) {
  const filled = Math.round(pct / 100 * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

function sparkline(values, width = 20) {
  if (!values.length) return ' '.repeat(width);
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...values, 1);
  const slice = values.slice(-width);
  return slice.map(v => chars[Math.min(7, Math.floor(v / max * 7))]).join('');
}

function readJsonlSafe(filePath, maxBytes = 4 * 1024 * 1024) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return [];
    if (st.size > maxBytes) {
      // read last maxBytes only
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, st.size - maxBytes);
      fs.closeSync(fd);
      return buf.toString('utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
    }
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function loadTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
  return readJsonlSafe(transcriptPath);
}

function latestSessionId() {
  try {
    const eventsDir = path.join(DATA_DIR, 'events');
    const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl')).sort();
    if (!files.length) return null;
    return files[files.length - 1].replace('.jsonl', '');
  } catch (_) { return null; }
}

function loadEventLog(sessionId) {
  if (!sessionId) return [];
  const logPath = path.join(DATA_DIR, 'events', `${sessionId}.jsonl`);
  return readJsonlSafe(logPath);
}

function analyze(transcript, events) {
  // per-turn usage from transcript
  const turns = transcript.filter(e => e.type === 'assistant' && e.message && e.message.usage);
  const byModel = {};
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
  const outputPerTurn = [];

  for (const t of turns) {
    const u = t.message.usage;
    const model = t.message.model || 'unknown';
    if (!byModel[model]) byModel[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
    byModel[model].input += u.input_tokens || 0;
    byModel[model].output += u.output_tokens || 0;
    byModel[model].cacheRead += u.cache_read_input_tokens || 0;
    byModel[model].cacheWrite += u.cache_creation_input_tokens || 0;
    byModel[model].cost += estimateCost(u, model);
    byModel[model].turns++;
    totalInput += u.input_tokens || 0;
    totalOutput += u.output_tokens || 0;
    totalCacheRead += u.cache_read_input_tokens || 0;
    totalCacheWrite += u.cache_creation_input_tokens || 0;
    outputPerTurn.push({ output: u.output_tokens || 0, model, idx: outputPerTurn.length });
  }

  const totalCost = Object.values(byModel).reduce((s, m) => s + m.cost, 0);
  const cacheTotal = totalCacheRead + totalInput;
  const cacheHitPct = cacheTotal > 0 ? Math.round(totalCacheRead / cacheTotal * 100) : 0;

  // habit scoreboard from event log
  const habits = {};
  for (const e of events) {
    if (e.type === 'rule_fire') {
      habits[e.id] = (habits[e.id] || 0) + 1;
    }
  }
  const habitBoard = Object.entries(habits).sort((a, b) => b[1] - a[1]);

  // top output-token turns
  const topTurns = [...outputPerTurn].sort((a, b) => b.output - a.output).slice(0, 5);

  return { byModel, totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost,
    cacheHitPct, outputPerTurn, habitBoard, topTurns };
}

function render(transcriptPath) {
  const sessionId = process.env.CLAUDE_SESSION_ID || latestSessionId();
  const transcript = loadTranscript(transcriptPath);
  const events = loadEventLog(sessionId);
  const a = analyze(transcript, events);

  clearScreen();
  const w = process.stdout.columns || 80;
  const sep = DIM + '─'.repeat(w) + RESET;

  console.log(`${BOLD}${CYAN}  proompt-police dashboard${RESET}  ${DIM}session: ${sessionId || 'unknown'}${RESET}`);
  console.log(sep);

  // spend + sparkline
  const spark = sparkline(a.outputPerTurn.map(t => t.output), 30);
  console.log(`${BOLD}  Spend${RESET}  ${GREEN}$${a.totalCost.toFixed(4)}${RESET}  output sparkline: ${AMBER}${spark}${RESET}`);
  console.log(`  in: ${fmt(a.totalInput)}  out: ${fmt(a.totalOutput)}  cache-read: ${fmt(a.totalCacheRead)}  cache-write: ${fmt(a.totalCacheWrite)}`);
  console.log();

  // cache efficiency
  const cacheBar = bar(a.cacheHitPct, 20);
  const cacheColor = a.cacheHitPct >= 80 ? GREEN : a.cacheHitPct >= 50 ? AMBER : RED;
  console.log(`${BOLD}  Cache${RESET}  ${cacheColor}${cacheBar} ${a.cacheHitPct}% hit${RESET}`);
  console.log();

  // cost by model
  console.log(`${BOLD}  Cost by model${RESET}`);
  const totalCost = a.totalCost || 0.0001;
  for (const [model, m] of Object.entries(a.byModel).sort((a, b) => b[1].cost - a[1].cost)) {
    const pct = Math.round(m.cost / totalCost * 100);
    const isOpus = model.toLowerCase().includes('opus');
    const color = isOpus ? RED : GREEN;
    const modelBar = bar(pct, 15);
    console.log(`  ${color}${model.replace('claude-', '').padEnd(18)}${RESET} ${modelBar} $${m.cost.toFixed(4)} (${pct}%) ${DIM}${m.turns} turns${RESET}`);
  }
  console.log();

  // habit scoreboard
  console.log(`${BOLD}  Habit scoreboard${RESET}  ${DIM}(rule fires this session)${RESET}`);
  if (!a.habitBoard.length) {
    console.log(`  ${GREEN}No guards fired yet.${RESET}`);
  } else {
    const maxCount = a.habitBoard[0][1];
    for (const [id, count] of a.habitBoard) {
      const pct = Math.round(count / maxCount * 100);
      const hBar = bar(pct, 12);
      console.log(`  ${AMBER}${id.padEnd(22)}${RESET} ${hBar} ×${count}`);
    }
  }
  console.log();

  // top output-token turns
  console.log(`${BOLD}  Top output-token turns${RESET}`);
  if (!a.topTurns.length) {
    console.log(`  ${DIM}No turns yet.${RESET}`);
  } else {
    for (const t of a.topTurns) {
      const isOpus = t.model.toLowerCase().includes('opus');
      const color = isOpus ? AMBER : DIM;
      console.log(`  turn #${String(t.idx + 1).padStart(3)}  ${color}${fmt(t.output).padStart(7)} output tokens${RESET}  ${DIM}${t.model.replace('claude-', '')}${RESET}`);
    }
  }
  console.log();
  console.log(`${DIM}  Refreshes every 2s. Press q or Ctrl+C to exit.${RESET}`);
}

// find transcript path
const transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH
  || process.argv[2]
  || null;

if (!transcriptPath) {
  console.log(`${AMBER}Usage: thrift-dashboard <transcript.jsonl>${RESET}`);
  console.log(`Or set CLAUDE_TRANSCRIPT_PATH env var.`);
  console.log(`The transcript path is shown in session-start hook stdin as 'transcript_path'.`);
  process.exit(0);
}

// keyboard input for quit
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (key && (key.name === 'q' || (key.ctrl && key.name === 'c'))) {
      clearScreen();
      process.exit(0);
    }
  });
}

render(transcriptPath);
const interval = setInterval(() => render(transcriptPath), 2000);
interval.unref();
