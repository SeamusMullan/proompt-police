'use strict';
const fs = require('fs');

function checkFileExists(when, toolInput) {
  const filePath = toolInput.file_path;
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    fs.statSync(filePath);
    return when.fileExists === true;
  } catch (_) {
    return when.fileExists === false;
  }
}

// fileSizeGt: true if file_path exists and byte size exceeds threshold
function checkFileSizeGt(when, toolInput) {
  const filePath = toolInput.file_path;
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    return fs.statSync(filePath).size > when.fileSizeGt;
  } catch (_) {
    return false;
  }
}

// fieldAbsent: true if named field is undefined/null in toolInput
function checkFieldAbsent(when, toolInput) {
  const val = toolInput[when.fieldAbsent];
  return val === undefined || val === null;
}

function matches(when, toolInput) {
  if (!when) return false;

  // String-field predicates (matchesAny, matchesAll, andNot, minLength, maxLength)
  // Only evaluated when `when.field` is set.
  if (when.field !== undefined) {
    const fieldVal = toolInput[when.field];
    if (typeof fieldVal !== 'string') return false;

    if (when.matchesAny) {
      if (!when.matchesAny.some(pat => new RegExp(pat, 'i').test(fieldVal))) return false;
    }
    if (when.matchesAll) {
      if (!when.matchesAll.every(pat => new RegExp(pat, 'i').test(fieldVal))) return false;
    }
    if (when.andNot) {
      if (when.andNot.some(pat => new RegExp(pat, 'i').test(fieldVal))) return false;
    }
    if (when.minLength !== undefined && fieldVal.length < when.minLength) return false;
    if (when.maxLength !== undefined && fieldVal.length > when.maxLength) return false;
  }

  // Non-string predicates — evaluated independently of `when.field`
  if (when.fileExists !== undefined && !checkFileExists(when, toolInput)) return false;
  if (when.fileSizeGt !== undefined && !checkFileSizeGt(when, toolInput)) return false;
  if (when.fieldAbsent !== undefined && !checkFieldAbsent(when, toolInput)) return false;

  return true;
}

function matchesRule(rule, toolName, toolInput) {
  if (!rule.enabled) return false;
  if (!rule.tools.includes(toolName)) return false;
  return matches(rule.when, toolInput);
}

module.exports = { matchesRule };
