'use strict';
const fs = require('fs');

function matches(when, toolInput, cwd) {
  if (!when) return false;

  const fieldVal = toolInput[when.field];
  if (typeof fieldVal !== 'string') {
    // fileExists predicate applies to file_path field
    if (when.fileExists !== undefined) {
      return checkFileExists(when, toolInput, cwd);
    }
    return false;
  }

  // matchesAny: at least one regex must match
  if (when.matchesAny) {
    const hit = when.matchesAny.some(pat => new RegExp(pat, 'i').test(fieldVal));
    if (!hit) return false;
  }

  // matchesAll: every regex must match
  if (when.matchesAll) {
    const allHit = when.matchesAll.every(pat => new RegExp(pat, 'i').test(fieldVal));
    if (!allHit) return false;
  }

  // andNot: if any negative pattern matches, suppress the rule
  if (when.andNot) {
    const negHit = when.andNot.some(pat => new RegExp(pat, 'i').test(fieldVal));
    if (negHit) return false;
  }

  // minLength on the field value
  if (when.minLength !== undefined && fieldVal.length < when.minLength) return false;
  if (when.maxLength !== undefined && fieldVal.length > when.maxLength) return false;

  // fileExists: only relevant when minLength/maxLength checks also pass
  if (when.fileExists !== undefined) {
    return checkFileExists(when, toolInput, cwd);
  }

  return true;
}

function checkFileExists(when, toolInput, cwd) {
  const filePath = toolInput.file_path;
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    fs.statSync(filePath);
    return when.fileExists === true;
  } catch (_) {
    return when.fileExists === false;
  }
}

function matchesRule(rule, toolName, toolInput, cwd) {
  if (!rule.enabled) return false;
  if (!rule.tools.includes(toolName)) return false;
  return matches(rule.when, toolInput, cwd);
}

module.exports = { matchesRule };
