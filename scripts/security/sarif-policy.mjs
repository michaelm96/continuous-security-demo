import fs from 'node:fs';

/**
 * Read and parse a SARIF JSON file from disk, returning normalized results.
 *
 * Throws when the file does not exist, cannot be read, or is not valid SARIF.
 *
 * @param {string} filePath - Absolute or relative path to the SARIF file.
 * @returns {Array} Array of normalized SARIF results.
 */
export function readSarif(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const log = JSON.parse(content);
  return normalizeSarif(log);
}

/**
 * Validate a SARIF v2.1.0 log and flatten every `runs[].results[]` entry
 * into a single array. Each entry is enriched with `severity` (number|null),
 * `scanner` (tool driver name), `ruleProperties`, and `fingerprint` so the
 * evaluator can work without re-walking the SARIF graph.
 *
 * Throws on malformed input. The function never silently treats bad SARIF as
 * empty.
 *
 * @param {object} log - SARIF log object.
 * @returns {Array<object>} Flattened array of normalized results.
 */
export function normalizeSarif(log) {
  if (!log || typeof log !== 'object') {
    throw new Error('Invalid SARIF: must be an object');
  }
  if (log.version !== '2.1.0') {
    throw new Error(
      `Invalid SARIF version: expected 2.1.0, got ${log.version || 'missing'}`,
    );
  }
  if (!Array.isArray(log.runs)) {
    throw new Error('Invalid SARIF: missing runs array');
  }

  const ruleIndex = new Map();
  for (const run of log.runs) {
    const rules = run?.tool?.driver?.rules;
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        if (rule && typeof rule.id === 'string') {
          ruleIndex.set(rule.id, rule);
        }
      }
    }
  }

  const normalized = [];
  for (const run of log.runs) {
    const scanner =
      run?.tool?.driver?.name || 'unknown-scanner';
    if (!Array.isArray(run?.results)) continue;
    for (const result of run.results) {
      const ruleProps =
        (result.ruleId && ruleIndex.get(result.ruleId)?.properties) || {};
      const ownProps = (result.properties && typeof result.properties === 'object')
        ? result.properties
        : {};
      const props = { ...ruleProps, ...ownProps };
      const severity = readSeverity(props);
      const fingerprint = readFingerprint(result);
      const location = readLocation(result);
      normalized.push({
        ruleId: result.ruleId || 'unknown',
        level: result.level || 'warning',
        message: sanitizeMessage(result.message),
        scanner,
        severity,
        fingerprint,
        location: location.uri,
        line: location.line,
        props,
      });
    }
  }
  return normalized;
}

/**
 * Evaluate SARIF results against a numeric CVSS threshold.
 *
 * Accepts an array of raw SARIF result objects (the same shape produced by
 * `runs[].results[]`) or the normalized objects returned by `normalizeSarif`.
 * Each entry MUST carry either:
 *   - a numeric `properties['security-severity']` (OSV / standard), or
 *   - the explicit `severity` field produced by `normalizeSarif`.
 *
 * Behavior:
 *  - results with severity >= threshold go to `blocked`
 *  - results with severity < threshold go to `reported`
 *  - results with no severity are resolved through `options.classification`
 *    (a map keyed by the result's artifact URI). Production unknowns block,
 *    development unknowns are reported. Unknowns without a classification
 *    record fall back to "unknown" (treated like production: blocked).
 *  - results with no severity when `options.checkov === true` are always
 *    blocked regardless of classification, because Checkov emits no CVSS.
 *  - malformed entries (missing ruleId AND missing severity) throw.
 *
 * The optional `options` shape is:
 *   {
 *     classification: { 'package-lock.json': 'production' | 'development' },
 *     checkov: boolean,
 *   }
 *
 * @param {Array<object>} results - Raw SARIF results or normalized entries.
 * @param {number} [threshold=7] - Numeric CVSS threshold (>= blocks).
 * @param {object} [options] - Classification and scanner hints.
 * @returns {{blocked: Array, reported: Array, errors: Array}}
 */
export function evaluateSarif(results, threshold = 7, options = {}) {
  if (!Array.isArray(results)) {
    throw new Error('evaluateSarif: results must be an array');
  }
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new Error('evaluateSarif: threshold must be a finite number');
  }

  const classification = options.classification || {};
  const checkov = options.checkov === true;

  const blocked = [];
  const reported = [];
  const errors = [];
  const seen = new Set();

  for (const raw of results) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid SARIF result: not an object');
    }
    // Reject entries that look like a SARIF log wrapper instead of a result.
    if (
      raw.version !== undefined &&
      raw.properties === undefined &&
      raw.severity === undefined &&
      raw.ruleId === undefined &&
      Array.isArray(raw.runs)
    ) {
      throw new Error(
        'Invalid SARIF result: looks like a SARIF log, not a result. Pass runs[].results[] directly or normalize first.',
      );
    }

    const normalized = raw.severity !== undefined
      ? raw
      : {
          ruleId: raw.ruleId || 'unknown',
          level: raw.level || 'warning',
          message: sanitizeMessage(raw.message),
          scanner: raw.scanner || 'unknown-scanner',
          severity: raw.severity !== undefined
            ? raw.severity
            : readSeverity({
                ...(raw.ruleProperties || {}),
                ...(raw.properties || {}),
              }),
          fingerprint: raw.fingerprint !== undefined
            ? raw.fingerprint
            : readFingerprint(raw),
          location: raw.location !== undefined
            ? raw.location
            : readLocation(raw).uri,
          line: raw.line !== undefined ? raw.line : readLocation(raw).line,
        };

    if (!normalized.ruleId && normalized.severity === null) {
      throw new Error('Invalid SARIF result: missing ruleId and severity');
    }

    const dedupeKey = normalized.fingerprint
      || `${normalized.scanner}|${normalized.ruleId}|${normalized.location}|${normalized.line}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const severity = normalized.severity;
    if (severity === null || severity === undefined) {
      // Unknown severity. Checkov rules always block; OSV rules need a
      // classification to decide.
      if (checkov) {
        blocked.push(makeFinding(normalized, null, 'unknown severity from checkov', 'checkov'));
        continue;
      }
      const scope = classification[normalized.location];
      if (scope === 'production') {
        blocked.push(makeFinding(normalized, null, 'unknown severity for production dependency'));
      } else if (scope === 'development') {
        reported.push(makeFinding(normalized, null, 'unknown severity for development dependency'));
      } else {
        // No classification: fail closed (block) and record the error.
        blocked.push(makeFinding(normalized, null, 'unknown severity without dependency classification'));
        errors.push({
          ruleId: normalized.ruleId,
          message: `Unknown severity for ${normalized.location} without a production/development classification`,
        });
      }
      continue;
    }

    if (severity >= threshold) {
      blocked.push(makeFinding(normalized, severity, 'severity >= threshold'));
    } else {
      reported.push(makeFinding(normalized, severity, 'severity < threshold'));
    }
  }

  return { blocked, reported, errors };
}

/**
 * Build the normalized finding shape returned by evaluateSarif.
 *
 * @param {object} result - Normalized SARIF result.
 * @param {number|null} severity - Numeric CVSS or null.
 * @param {string} reason - Why this finding landed in its bucket.
 * @param {string} [scannerOverride] - Force a particular scanner label.
 * @returns {object}
 */
function makeFinding(result, severity, reason, scannerOverride) {
  return {
    ruleId: result.ruleId,
    scanner: scannerOverride || result.scanner,
    level: result.level,
    severity,
    location: result.location,
    line: result.line,
    message: result.message,
    fingerprint: result.fingerprint,
    reason,
  };
}

/**
 * Read a numeric CVSS severity from SARIF result/rule properties. Accepts
 * the explicit OSV-Scanner key `security-severity` plus case-insensitive
 * variants and the SARIF-standard `security-severity` key.
 *
 * @param {object} props - Merged result + rule properties.
 * @returns {number|null} Numeric CVSS or null when missing/invalid/out-of-range.
 */
function readSeverity(props) {
  for (const key of Object.keys(props)) {
    if (key.toLowerCase() === 'security-severity') {
      const raw = props[key];
      // null/undefined/empty = no severity
      if (raw === null || raw === undefined || raw === '') {
        return null;
      }
      const num = typeof raw === 'number' ? raw : parseFloat(raw);
      if (!Number.isFinite(num)) {
        // Invalid numeric value - treat as unknown
        return null;
      }
      if (num < 0 || num > 10) {
        throw new Error(
          `Security-severity ${num} outside [0,10] range`,
        );
      }
      return num;
    }
  }
  return null;
}

/**
 * Pull the most informative fingerprint off a SARIF result.
 *
 * @param {object} result - SARIF result.
 * @returns {string|undefined}
 */
function readFingerprint(result) {
  const fp = result.partialFingerprints || {};
  return fp.primary || fp['1'] || Object.values(fp)[0];
}

/**
 * Read the artifact URI and start line from the first physical location.
 *
 * @param {object} result - SARIF result.
 * @returns {{uri: string|undefined, line: number|undefined}}
 */
function readLocation(result) {
  const loc = result.locations?.[0]?.physicalLocation;
  const uri = loc?.artifactLocation?.uri;
  const line = loc?.region?.startLine;
  return { uri, line };
}

/**
 * Best-effort scrub of the result message so that obvious secret-shaped
 * substrings never reach GitHub issue text or PR comments.
 *
 * @param {string|object|undefined} message - SARIF message field.
 * @returns {string} Sanitized message.
 */
function sanitizeMessage(message) {
  if (!message) return '';
  const text = typeof message === 'object' ? message.text : String(message);
  if (!text) return '';
  return text
    .replace(/gh[pousr]_[A-Za-z0-9]{8,}/g, '[REDACTED-TOKEN]')
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[REDACTED-TOKEN]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED-KEY]')
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[REDACTED]')
    .replace(/[A-Fa-f0-9]{32,}/g, '[REDACTED-HEX]');
}

// CLI entry point. Accepts one or more SARIF files after `--input`, optional
// classification JSON after `--classification`, and optional `--threshold`,
// `--checkov`, and `--output` flags. Exits 0 only when no findings block.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const inputs = [];
  let output = null;
  let threshold = 7;
  let checkov = false;
  let classificationPath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '--classification' || arg === '--output') {
      const value = args[i + 1];
      if (!value) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      if (arg === '--input') inputs.push(value);
      if (arg === '--classification') classificationPath = value;
      if (arg === '--output') output = value;
      i++;
      continue;
    }
    if (arg === '--threshold') {
      threshold = parseFloat(args[++i]);
      continue;
    }
    if (arg === '--checkov') {
      checkov = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      inputs.push(arg);
    }
  }

  if (inputs.length === 0) {
    console.error(
      'Usage: sarif-policy.mjs [--threshold N] [--checkov] [--classification <map.json>] [--output <summary.json>] <file.sarif>...',
    );
    process.exit(1);
  }

  const classification = classificationPath
    ? JSON.parse(fs.readFileSync(classificationPath, 'utf8'))
    : {};

  const allBlocked = [];
  const allReported = [];
  const allErrors = [];

  for (const input of inputs) {
    try {
      const normalized = readSarif(input);
      const out = evaluateSarif(normalized, threshold, {
        classification,
        checkov,
      });
      allBlocked.push(...out.blocked);
      allReported.push(...out.reported);
      allErrors.push(...out.errors);
    } catch (err) {
      console.error(`Error processing ${input}: ${err.message}`);
      process.exit(1);
    }
  }

  const summary = {
    threshold,
    checkov,
    blocked: allBlocked,
    reported: allReported,
    errors: allErrors,
    counts: {
      blocked: allBlocked.length,
      reported: allReported.length,
      errors: allErrors.length,
    },
  };

  if (output) {
    fs.writeFileSync(output, JSON.stringify(summary, null, 2));
    console.log(`Wrote ${output}`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }

  if (allBlocked.length > 0 || allErrors.length > 0) {
    process.exit(1);
  }
}
