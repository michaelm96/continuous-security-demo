import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', '..', '.gitleaks.toml');
const CONFIG_TEXT = readFileSync(CONFIG_PATH, 'utf8');

const ALLOWLISTS = parseGitleaksToml(CONFIG_TEXT).allowlists;

const PLAN_PATH_LITERAL =
  "docs/superpowers/plans/2026-08-29-project-2-deterministic-pr-security\\.md";
const PLAN_REGEX_LITERAL = "secret,\\s+prohibited/missing";

test('.gitleaks.toml contains the existing LocalOnly passwords allowlist', () => {
  const found = ALLOWLISTS.find((a) =>
    /LocalOnly-Admin1!/.test((a.regexes || []).join('\n'))
  );
  assert.ok(found, 'expected an allowlist matching LocalOnly-* demo passwords');
  assert.ok(
    (found.paths || []).some((p) => /seed-identities\\.ts/.test(p)),
    'LocalOnly allowlist must be scoped to seed-identities.ts'
  );
});

test('.gitleaks.toml contains the existing fixtures allowlist', () => {
  const found = ALLOWLISTS.find((a) =>
    (a.paths || []).some((p) => p.includes('security/fixtures'))
  );
  assert.ok(found, 'expected an allowlist for security/fixtures');
});

test('.gitleaks.toml contains the narrow plan-file prose allowlist', () => {
  const found = ALLOWLISTS.find((a) =>
    (a.paths || []).some((p) => p === PLAN_PATH_LITERAL)
  );
  assert.ok(found, `expected an allowlist with path ${PLAN_PATH_LITERAL}`);
  assert.ok(
    (found.regexes || []).includes(PLAN_REGEX_LITERAL),
    `expected the plan allowlist regex literal to equal ${JSON.stringify(PLAN_REGEX_LITERAL)}`
  );
});

test('every allowlist entry has a description of at least 30 characters', () => {
  assert.ok(ALLOWLISTS.length >= 4, 'expected at least 4 allowlist entries');
  for (const entry of ALLOWLISTS) {
    assert.ok(
      typeof entry.description === 'string',
      'every allowlist must have a description'
    );
    assert.ok(
      entry.description.length >= 30,
      `description too short (${entry.description.length} chars): ${JSON.stringify(entry.description)}`
    );
  }
});

test('no allowlist path is a directory or uses ** globs', () => {
  for (const entry of ALLOWLISTS) {
    for (const p of entry.paths || []) {
      const unescaped = p.replace(/\\(.)/g, '$1');
      const isFilenameOnly = /^[^/]*$/.test(unescaped);
      const hasNoGlob = !unescaped.includes('**');
      assert.ok(
        isFilenameOnly || hasNoGlob,
        `allowlist path must be a filename-only pattern or contain no **: ${JSON.stringify(p)}`
      );
    }
  }
});

test('plan-file allowlist description is specific (mentions plan or Project 2)', () => {
  const found = ALLOWLISTS.find((a) =>
    (a.paths || []).some((p) => p === PLAN_PATH_LITERAL)
  );
  assert.ok(found);
  assert.ok(
    /Project 2|plan file/i.test(found.description),
    `description must reference Project 2 / plan file: ${JSON.stringify(found.description)}`
  );
});

test('.gitleaks.toml contains the narrow NestJS scaffold README allowlist', () => {
  const README_PATH_LITERAL = 'apps/api/README\\.md';
  const README_REGEX_LITERAL = 'token=abc123def456';
  const found = ALLOWLISTS.find((a) =>
    (a.paths || []).some((p) => p === README_PATH_LITERAL)
  );
  assert.ok(
    found,
    `expected an allowlist with path ${README_PATH_LITERAL}`
  );
  assert.ok(
    (found.regexes || []).includes(README_REGEX_LITERAL),
    `expected the README allowlist regex literal to equal ${JSON.stringify(README_REGEX_LITERAL)}`
  );
});

/**
 * Minimal TOML parser for .gitleaks.toml. Handles only the constructs used by
 * this repo's config: comments, table headers ([a] / [[a]]), basic strings,
 * literal-multi-line strings ('''...'''), arrays of strings, and booleans.
 *
 * Returns { allowlists: [ ... ] }; only the [[allowlists]] tables are surfaced.
 */
function parseGitleaksToml(text) {
  const allowlists = [];
  let current = null;
  let arrayKey = null;
  let arrayBuffer = '';
  let braceDepth = 0;

  const flushArray = () => {
    if (!current || arrayKey === null) return;
    current[arrayKey] = parseArrayValue(arrayBuffer);
    arrayKey = null;
    arrayBuffer = '';
    braceDepth = 0;
  };

  for (const rawLine of text.split('\n')) {
    // Strip end-of-line comments but preserve ''' ''' boundaries.
    let line = rawLine;
    const hashIdx = line.indexOf('#');
    if (hashIdx !== -1) {
      // Skip # inside literal strings.
      const before = line.slice(0, hashIdx);
      if (!isInsideTripleQuote(before)) line = before;
    }
    const trimmed = line.trim();

    if (trimmed === '') continue;

    // Multi-line array accumulation takes priority over section headers,
    // otherwise a `]` line would be mistaken for a new section.
    if (arrayKey !== null) {
      arrayBuffer += '\n' + line;
      for (const ch of line) {
        if (ch === '[') braceDepth++;
        else if (ch === ']') braceDepth--;
      }
      if (braceDepth <= 0) flushArray();
      continue;
    }

    if (line.trim() === '[[allowlists]]') {
      if (current) allowlists.push(current);
      current = {};
      continue;
    }

    if (/^\[\[.+\]\]$/.test(trimmed)) {
      if (current) allowlists.push(current);
      current = null;
      continue;
    }

    if (/^\[.+\]$/.test(trimmed)) {
      if (current) allowlists.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (value === '[') {
      arrayKey = key;
      arrayBuffer = '';
      braceDepth = 1;
      continue;
    }

    if (value.endsWith(']')) {
      current[key] = parseArrayValue('[' + value);
      continue;
    }

    if (value.startsWith("'''")) {
      current[key] = value.slice(3, -3);
      continue;
    }

    if (value.startsWith('"') && value.endsWith('"')) {
      current[key] = JSON.parse(value);
      continue;
    }

    if (value === 'true' || value === 'false') {
      current[key] = value === 'true';
    }
  }

  flushArray();
  if (current) allowlists.push(current);
  return { allowlists };
}

function isInsideTripleQuote(s) {
  const matches = s.match(/'''/g);
  return matches ? matches.length % 2 === 1 : false;
}

function parseArrayValue(text) {
  let s = text.trim();
  if (s.startsWith('[')) s = s.slice(1);
  if (s.endsWith(']')) s = s.slice(0, -1);

  const out = [];
  let i = 0;
  let buf = '';
  while (i < s.length) {
    const c = s[i];
    if (c === "'" && s[i + 1] === "'" && s[i + 2] === "'") {
      const end = s.indexOf("'''", i + 3);
      buf += s.slice(i, end === -1 ? s.length : end + 3);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    if (c === '"') {
      const end = findBasicStringEnd(s, i);
      buf += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === ',') {
      out.push(stripStringWrapper(buf.trim()));
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push(stripStringWrapper(buf.trim()));
  return out;
}

function findBasicStringEnd(s, start) {
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '"') return i;
    i++;
  }
  return s.length - 1;
}

function stripStringWrapper(s) {
  if (s.startsWith("'''") && s.endsWith("'''")) return s.slice(3, -3);
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s);
  return s;
}