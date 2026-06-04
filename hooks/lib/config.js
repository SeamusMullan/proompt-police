'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.PROOMPT_POLICE_DATA
  || path.join(os.homedir(), '.claude', 'proompt-police');

const BUILTIN_RULES_PATH = path.join(__dirname, '..', '..', 'rules', 'builtin.json');
const USER_RULES_PATH = path.join(DATA_DIR, 'rules.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const MAX_READ_BYTES = 65536; // 64KB cap for config files

function safeReadJson(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_READ_BYTES) return null;

    const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(filePath, flags);
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const n = fs.readSync(fd, buf, 0, MAX_READ_BYTES, 0);
      return JSON.parse(buf.slice(0, n).toString('utf8'));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch (_) {
    return null;
  }
}

function safeWriteJson(filePath, obj) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // refuse if parent dir is a symlink
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) return false;
    } catch (_) {}

    // refuse if target is a symlink
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) return false;
    } catch (_) {}

    const content = JSON.stringify(obj, null, 2);
    const tmpPath = path.join(dir, `.proompt-police.${process.pid}.${Date.now()}.tmp`);
    const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tmpPath, flags, 0o600);
      fs.writeSync(fd, content);
      fs.fchmodSync(fd, 0o600);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function loadEffectiveRules() {
  const builtin = safeReadJson(BUILTIN_RULES_PATH) || [];
  const userOverlay = safeReadJson(USER_RULES_PATH) || [];
  const state = safeReadJson(STATE_PATH) || {};
  const disabled = Array.isArray(state.disabled) ? state.disabled : [];

  // merge: user overlay by id overrides builtin; new ids appended
  const merged = [...builtin];
  for (const uRule of userOverlay) {
    const idx = merged.findIndex(r => r.id === uRule.id);
    if (idx >= 0) merged[idx] = { ...merged[idx], ...uRule };
    else merged.push(uRule);
  }

  return merged.filter(r => r.enabled !== false && !disabled.includes(r.id));
}

function loadState() {
  return safeReadJson(STATE_PATH) || {};
}

function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return safeWriteJson(STATE_PATH, state);
}

module.exports = {
  DATA_DIR,
  loadEffectiveRules,
  loadState,
  writeState,
  safeReadJson,
  safeWriteJson,
};
