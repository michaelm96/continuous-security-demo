import fs from 'node:fs';
import path from 'node:path';

/**
 * Pure inversion check used by the fixture self-test.
 *
 * Compares a pre-normalized evidence object against a list of required
 * stable identifiers and reports which are present, missing, or extra.
 * Pure: never reads from disk, never depends on the environment.
 *
 * Evidence shape:
 *   {
 *     osv:      [{ id: 'GHSA-...' }],
 *     gitleaks: [{ ruleId: 'github-pat', props: { tags: ['secret'] } }],
 *     checkov:  [{ ruleId: 'CKV_GHA_2' }],
 *     actions:  [{ id: 'mutable-action-ref:<file>:<line>' }],
 *   }
 *
 * Matching rules per scanner:
 *   - OSV:        id  === requirement
 *   - Gitleaks:   ruleId === requirement, or props.tags includes requirement
 *   - Checkov:    ruleId === requirement
 *   - Actions:    id  startsWith requirement (so a single ruleId prefix
 *                 covers every individual mutable reference)
 *
 * Extras are findings whose identifier is not satisfied by any requirement
 * under the same per-scanner rule.
 *
 * @param {object} evidence - Scanner evidence.
 * @param {{expected: string[]}} requirements
 * @returns {{ok: boolean, detected: string[], missing: string[], extra: string[], fixture: true}}
 */
export function assertFixtureEvidence(evidence, requirements) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new TypeError('assertFixtureEvidence: evidence must be an object');
  }
  if (!requirements || !Array.isArray(requirements.expected)) {
    throw new TypeError(
      'assertFixtureEvidence: requirements.expected must be an array of strings',
    );
  }

  const ids = collectIds(evidence);
  const detected = [];
  const missing = [];

  for (const requirement of requirements.expected) {
    if (matchesRequirement(requirement, ids)) {
      detected.push(requirement);
    } else {
      missing.push(requirement);
    }
  }

  return {
    ok: missing.length === 0,
    detected,
    missing,
    extra: computeExtras(ids, requirements.expected),
    fixture: true,
  };
}

/**
 * Reduce the per-scanner evidence to a flat list of identifiers grouped by
 * scanner. Gitleaks tags are returned separately so `matchesRequirement`
 * can use them as aliases without polluting the extras list (which only
 * reports primary rule IDs).
 *
 * @param {object} evidence
 * @returns {{osv: string[], gitleaks: string[], gitleaksTags: string[], checkov: string[], actions: string[]}}
 */
function collectIds(evidence) {
  const osv = [];
  const gitleaks = [];
  const gitleaksTags = [];
  const checkov = [];
  const actions = [];

  for (const entry of evidence.osv || []) {
    if (entry && typeof entry.id === 'string' && entry.id) osv.push(entry.id);
  }
  for (const entry of evidence.gitleaks || []) {
    if (!entry) continue;
    if (typeof entry.ruleId === 'string' && entry.ruleId) gitleaks.push(entry.ruleId);
    const tags = entry.props && entry.props.tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (typeof tag === 'string' && tag) gitleaksTags.push(tag);
      }
    }
  }
  for (const entry of evidence.checkov || []) {
    if (entry && typeof entry.ruleId === 'string' && entry.ruleId) checkov.push(entry.ruleId);
  }
  for (const entry of evidence.actions || []) {
    if (entry && typeof entry.id === 'string' && entry.id) actions.push(entry.id);
  }

  return { osv, gitleaks, gitleaksTags, checkov, actions };
}

/**
 * Decide whether a single requirement is satisfied by any scanner's findings.
 *
 * @param {string} requirement
 * @param {object} ids - Result of collectIds.
 * @returns {boolean}
 */
function matchesRequirement(requirement, ids) {
  if (ids.osv.includes(requirement)) return true;
  if (ids.gitleaks.includes(requirement)) return true;
  if (ids.gitleaksTags.includes(requirement)) return true;
  if (ids.checkov.includes(requirement)) return true;
  return ids.actions.some((id) => id.startsWith(requirement));
}

/**
 * List every detected identifier that no requirement covers. Used to keep
 * "extra" findings visible without making the gate fail.
 *
 * @param {object} ids
 * @param {string[]} expected
 * @returns {string[]}
 */
function computeExtras(ids, expected) {
  const extras = [];
  const seen = new Set();
  const push = (value) => {
    if (!seen.has(value)) {
      seen.add(value);
      extras.push(value);
    }
  };

  for (const id of ids.osv) {
    if (!expected.includes(id)) push(id);
  }
  for (const id of ids.gitleaks) {
    if (!expected.includes(id)) push(id);
  }
  for (const id of ids.checkov) {
    if (!expected.includes(id)) push(id);
  }
  // Actions use prefix matching for the requirement, so an action id is
  // considered matched when ANY requirement is its prefix.
  for (const id of ids.actions) {
    if (!expected.some((req) => id.startsWith(req))) push(id);
  }

  return extras;
}

/**
 * Read a SARIF v2.1.0 log and flatten every result into a normalized
 * `{ ruleId, props }` pair. Throws on malformed input so the caller can
 * reject the report instead of silently treating it as empty.
 *
 * @param {string} filePath
 * @returns {Array<{ruleId: string, props: object}>}
 */
function readSarifResults(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${filePath}: ${err.message}`);
  }

  let log;
  try {
    log = JSON.parse(content);
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${err.message}`);
  }

  if (!log || typeof log !== 'object') {
    throw new Error(`SARIF log is not an object: ${filePath}`);
  }
  if (log.version !== '2.1.0') {
    throw new Error(
      `Invalid SARIF version: expected 2.1.0, got ${log.version || 'missing'} (${filePath})`,
    );
  }
  if (!Array.isArray(log.runs)) {
    throw new Error(`SARIF log missing runs array: ${filePath}`);
  }

  const results = [];
  for (const run of log.runs) {
    if (!run || !Array.isArray(run.results)) continue;
    for (const result of run.results) {
      const props =
        result && result.properties && typeof result.properties === 'object'
          ? result.properties
          : {};
      results.push({ ruleId: result.ruleId || '', props });
    }
  }
  return results;
}

/**
 * Read an OSV SARIF log. The advisory ID lives in `result.ruleId` for
 * osv-scanner; map it to `id` so the inversion check can match by the
 * shape the requirement file declares.
 *
 * @param {string} filePath
 * @returns {Array<{id: string}>}
 */
function readOsvResults(filePath) {
  return readSarifResults(filePath).map((entry) => ({ id: entry.ruleId }));
}

/**
 * Read the action-ref checker JSON output. Each mutable entry becomes one
 * evidence entry whose `id` starts with `mutable-action-ref:`.
 *
 * @param {string} filePath
 * @returns {Array<{id: string}>}
 */
function readActionResults(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${filePath}: ${err.message}`);
  }

  let log;
  try {
    log = JSON.parse(content);
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${err.message}`);
  }

  if (!log || typeof log !== 'object') {
    throw new Error(`Action JSON is not an object: ${filePath}`);
  }
  if (!Array.isArray(log.mutable)) {
    throw new Error(`Action JSON missing mutable array: ${filePath}`);
  }

  const results = [];
  for (const item of log.mutable) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.id === 'string' && item.id) {
      results.push({ id: item.id });
    } else if (typeof item.file === 'string' && typeof item.line === 'number') {
      // Fall back to synthesizing an id from file/line so callers that
      // forget to include one still produce useful findings.
      results.push({ id: `mutable-action-ref:${item.file}:${item.line}` });
    }
  }
  return results;
}

/**
 * Write the fixture summary atomically: the partial file must never be
 * observable, because `security-fixtures.yml` uploads it as
 * `fixture-security-evidence` on every run.
 *
 * @param {string} outputPath
 * @param {object} summary
 */
function writeSummaryAtomic(outputPath, summary) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(outputPath)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(summary, null, 2)}\n`);
  fs.renameSync(temp, outputPath);
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opts = {
    osv: null,
    gitleaks: null,
    checkov: null,
    actions: null,
    requirements: null,
    output: null,
    fixturesDir: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--osv':
        opts.osv = next;
        i++;
        break;
      case '--gitleaks':
        opts.gitleaks = next;
        i++;
        break;
      case '--checkov':
        opts.checkov = next;
        i++;
        break;
      case '--actions':
        opts.actions = next;
        i++;
        break;
      case '--requirements':
        opts.requirements = next;
        i++;
        break;
      case '--output':
        opts.output = next;
        i++;
        break;
      case '--fixtures-dir':
        opts.fixturesDir = next;
        i++;
        break;
      case '--help':
      case '-h':
        console.error(
          'Usage: assert-fixtures.mjs --osv <file> --gitleaks <file> --checkov <file> --actions <file> ' +
            '[--requirements <file>] [--output <file>] [--fixtures-dir <dir>]',
        );
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(2);
    }
  }

  if (!opts.osv || !opts.gitleaks || !opts.checkov || !opts.actions) {
    console.error(
      'Usage: assert-fixtures.mjs --osv <file> --gitleaks <file> --checkov <file> --actions <file> ' +
        '[--requirements <file>] [--output <file>] [--fixtures-dir <dir>]',
    );
    process.exit(2);
  }

  const fixturesDir = opts.fixturesDir || 'security/fixtures/vulnerable';
  const requirementsPath =
    opts.requirements || path.join(fixturesDir, 'expected-advisories.json');
  const outputPath = opts.output || 'security-reports/fixture-summary.json';

  let requirements;
  try {
    requirements = JSON.parse(fs.readFileSync(requirementsPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Requirements file not found: ${requirementsPath}`);
    } else {
      console.error(`Failed to parse requirements ${requirementsPath}: ${err.message}`);
    }
    process.exit(1);
  }

  if (!requirements || !Array.isArray(requirements.expected)) {
    console.error(
      `Requirements file must contain an "expected" array: ${requirementsPath}`,
    );
    process.exit(1);
  }

  let evidence;
  try {
    evidence = {
      osv: readOsvResults(opts.osv),
      gitleaks: readSarifResults(opts.gitleaks),
      checkov: readSarifResults(opts.checkov),
      actions: readActionResults(opts.actions),
      fixture: true,
    };
  } catch (err) {
    console.error(`Fixture report unreadable: ${err.message}`);
    process.exit(1);
  }

  const result = assertFixtureEvidence(evidence, requirements);
  writeSummaryAtomic(outputPath, result);

  if (!result.ok) {
    console.error(
      `Fixture inversion check FAILED. Missing: ${result.missing.join(', ') || '(none)'} ` +
        `Detected: ${result.detected.join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  console.log(
    `Fixture inversion check OK. Detected: ${result.detected.join(', ')}` +
      (result.extra.length ? ` Extras: ${result.extra.join(', ')}` : ''),
  );
}