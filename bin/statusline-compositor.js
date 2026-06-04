#!/usr/bin/env node
'use strict';

// Composites multiple statusLine segments separated by a dim pipe.
// Runs caveman's statusline (if installed) + proompt-police's own.
// Portable: discovers caveman by scanning ~/.claude/plugins/cache/caveman/.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const SEP = `  ${DIM}|${RESET}  `;

const PROOMPT_SCRIPT = path.join(__dirname, '..', 'hooks', 'statusline.js');

function findCavemanStatusline() {
  // env override for pinned installs
  if (process.env.CAVEMAN_STATUSLINE) return process.env.CAVEMAN_STATUSLINE;

  // scan ~/.claude/plugins/cache/caveman/ for caveman-statusline.sh
  try {
    const base = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'caveman');
    const vendors = fs.readdirSync(base);
    for (const vendor of vendors) {
      const versions = fs.readdirSync(path.join(base, vendor));
      for (const ver of versions) {
        const candidate = path.join(base, vendor, ver, 'hooks', 'caveman-statusline.sh');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (_) {}
  return null;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  const parts = [];

  const cavemanScript = findCavemanStatusline();
  if (cavemanScript) {
    try {
      const out = execFileSync('bash', [cavemanScript], {
        input: raw, timeout: 4000, encoding: 'utf8',
      });
      if (out.trim()) parts.push(out.trimEnd());
    } catch (_) {}
  }

  try {
    const out = execFileSync(process.execPath, [PROOMPT_SCRIPT], {
      input: raw, timeout: 4000, encoding: 'utf8',
    });
    if (out.trim()) parts.push(out.trimEnd());
  } catch (_) {}

  process.stdout.write(parts.join(SEP));
  process.exit(0);
});
