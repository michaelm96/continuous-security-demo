import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Scanners that must succeed before a production scan is provably complete.
 * Project 3 refuses to mutate Issues when any of these is missing.
 */
export const REQUIRED_TOOLS = Object.freeze([
  'osv',
  'gitleaks',
  'checkov',
  'licenses',
  'sbom',
]);

/**
 * Tool versions that must be recorded for the evidence to identify what
 * produced it. `licenses` is derived from the npm lockfile, so it has no
 * separate binary version.
 */
export const REQUIRED_TOOL_VERSIONS = Object.freeze([
  'osv',
  'gitleaks',
  'checkov',
  'cyclonedx',
]);

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const SCHEMA_VERSION = 1;

/**
 * Build the production security evidence manifest from already-collected
 * scanner facts. Pure: it reads no files, no environment, and no clock, and
 * it never mutates `input`.
 *
 * Input shape:
 *   {
 *     headSha, ref, runId, generationTime (ISO string),
 *     toolVersions: { osv, gitleaks, checkov, cyclonedx },
 *     reports: [{
 *       tool, category: 'production'|'fixture', path, status, digest,
 *       expectedDigest?, bytes?, malformed?, fixture?
 *     }],
 *     policy: { verdict: 'clean'|'blocking', blockedCount, reportedCount },
 *   }
 *
 * `complete` is true only when every required production scanner reported
 * `status: success` with a non-empty, parseable report whose SHA-256 digest
 * matches the digest declared by the job that produced it. A blocking policy
 * verdict is recorded but never makes the evidence incomplete: CI blocks on
 * the verdict, Project 3 still needs the evidence.
 *
 * @param {object} input - Collected scanner facts.
 * @returns {object} Manifest object with `complete` and `incompleteReason`.
 */
export function buildManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('buildManifest: input must be an object');
  }

  const incompleteReason = [];

  const headSha = nonEmptyString(input.headSha);
  const ref = nonEmptyString(input.ref);
  const runId = nonEmptyString(input.runId);
  if (!headSha) incompleteReason.push('provenance: missing headSha');
  if (!ref) incompleteReason.push('provenance: missing ref');
  if (!runId) incompleteReason.push('provenance: missing runId');

  const generationTime = nonEmptyString(input.generationTime);
  if (!generationTime || Number.isNaN(Date.parse(generationTime))) {
    incompleteReason.push('provenance: missing or invalid generationTime');
  }

  const toolVersions = {};
  if (!input.toolVersions || typeof input.toolVersions !== 'object') {
    incompleteReason.push('provenance: missing toolVersions');
  } else {
    for (const [name, version] of Object.entries(input.toolVersions)) {
      const value = nonEmptyString(version);
      if (value) toolVersions[name] = value;
    }
    for (const tool of REQUIRED_TOOL_VERSIONS) {
      if (!toolVersions[tool]) {
        incompleteReason.push(`provenance: missing tool version for ${tool}`);
      }
    }
  }

  if (!Array.isArray(input.reports)) {
    incompleteReason.push('reports: missing reports array');
  }

  const scanners = [];
  const production = new Map();
  for (const report of Array.isArray(input.reports) ? input.reports : []) {
    if (!report || typeof report !== 'object') {
      throw new TypeError('buildManifest: each report must be an object');
    }
    const tool = nonEmptyString(report.tool);
    if (!tool) {
      throw new TypeError('buildManifest: each report must name a tool');
    }
    const fixture = report.fixture === true || report.category === 'fixture';
    const record = {
      tool,
      category: fixture ? 'fixture' : nonEmptyString(report.category) || 'production',
      reportPath: nonEmptyString(report.path) || null,
      status: nonEmptyString(report.status) || 'missing',
      digest: nonEmptyString(report.digest) || null,
      bytes: Number.isFinite(report.bytes) ? report.bytes : null,
      fixture,
      // Only non-fixture runs of a required scanner count as production evidence.
      expected: !fixture && REQUIRED_TOOLS.includes(tool),
    };
    scanners.push(record);

    if (record.expected) {
      if (production.has(tool)) {
        incompleteReason.push(`${tool}: duplicate production report`);
      } else {
        production.set(tool, { record, report });
      }
    }
  }

  for (const tool of REQUIRED_TOOLS) {
    const entry = production.get(tool);
    if (!entry) {
      incompleteReason.push(`${tool}: no successful production report`);
      continue;
    }
    const { record, report } = entry;
    if (record.status !== 'success') {
      incompleteReason.push(`${tool}: scanner status ${record.status}`);
    }
    if (report.malformed === true) {
      incompleteReason.push(`${tool}: malformed report`);
    }
    if (record.bytes !== null && record.bytes <= 0) {
      incompleteReason.push(`${tool}: empty report`);
    }
    if (!record.reportPath) {
      incompleteReason.push(`${tool}: missing report path`);
    }
    if (!record.digest || !SHA256_HEX.test(record.digest)) {
      incompleteReason.push(`${tool}: missing or invalid SHA-256 digest`);
      continue;
    }
    const declared = nonEmptyString(report.expectedDigest);
    if (declared && declared.toLowerCase() !== record.digest.toLowerCase()) {
      incompleteReason.push(
        `${tool}: digest mismatch (declared ${declared}, actual ${record.digest})`,
      );
    }
  }

  const policy = normalizePolicy(input.policy, incompleteReason);

  return {
    schemaVersion: SCHEMA_VERSION,
    headSha: headSha || null,
    ref: ref || null,
    runId: runId || null,
    generationTime: generationTime || null,
    toolVersions,
    scanners,
    policy,
    complete: incompleteReason.length === 0,
    incompleteReason,
  };
}

/**
 * Normalize the policy verdict, appending a reason for anything unusable.
 *
 * @param {object|undefined} policy - Raw policy input.
 * @param {string[]} incompleteReason - Mutable reason accumulator.
 * @returns {{verdict: string, blockedCount: number|null, reportedCount: number|null}}
 */
function normalizePolicy(policy, incompleteReason) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    incompleteReason.push('policy: missing policy verdict');
    return { verdict: 'unknown', blockedCount: null, reportedCount: null };
  }

  const blockedCount = nonNegativeInteger(policy.blockedCount);
  const reportedCount = nonNegativeInteger(policy.reportedCount);
  if (blockedCount === null || reportedCount === null) {
    incompleteReason.push('policy: missing blocked or reported count');
  }

  const verdict =
    policy.verdict === 'clean' || policy.verdict === 'blocking' ? policy.verdict : null;
  if (!verdict) {
    incompleteReason.push(`policy: unknown verdict ${JSON.stringify(policy.verdict)}`);
  } else if (verdict === 'clean' && blockedCount !== null && blockedCount > 0) {
    incompleteReason.push(
      `policy: verdict clean contradicts blockedCount ${blockedCount}`,
    );
  }

  return { verdict: verdict || 'unknown', blockedCount, reportedCount };
}

/**
 * Read a report from disk and turn it into a `buildManifest` report record.
 * A file that is absent, empty, or not parseable JSON is reported as such
 * instead of throwing, so the manifest can name the exact broken slot.
 *
 * @param {string} tool - Scanner name.
 * @param {string} filePath - Path to the report.
 * @param {{status?: string, expectedDigest?: string, fixture?: boolean}} [options]
 * @returns {object} Report record for `buildManifest`.
 */
export function collectReport(tool, filePath, options = {}) {
  const record = {
    tool,
    category: options.fixture ? 'fixture' : 'production',
    path: filePath,
    status: options.status || 'success',
    digest: null,
    bytes: null,
    fixture: options.fixture === true,
  };
  if (options.expectedDigest) record.expectedDigest = options.expectedDigest;

  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch {
    return { ...record, status: 'missing' };
  }

  record.bytes = content.length;
  record.digest = createHash('sha256').update(content).digest('hex');
  try {
    JSON.parse(content.toString('utf8'));
  } catch {
    record.malformed = true;
  }
  return record;
}

/**
 * Write the manifest atomically: a partially written manifest must never be
 * observable, because Project 3 trusts whatever it finds at this path.
 *
 * @param {string} outputPath - Destination path.
 * @param {object} manifest - Manifest object.
 * @returns {void}
 */
export function writeManifestFile(outputPath, manifest) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(outputPath)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temp, outputPath);
}

/**
 * Read one evaluator summary file and reduce it to blocked/reported counts.
 * Accepts the shapes emitted by `sarif-policy.mjs` and `license-policy.mjs`.
 *
 * @param {string} filePath - Path to the summary JSON.
 * @returns {{blocked: number, reported: number}}
 */
export function readPolicySummary(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data && typeof data === 'object') {
    if (data.counts && typeof data.counts === 'object') {
      return {
        blocked: count(data.counts.blocked) + count(data.counts.errors),
        reported: count(data.counts.reported),
      };
    }
    if (data.summary && typeof data.summary === 'object') {
      return {
        blocked: count(data.summary.totalBlocked),
        reported: count(data.summary.totalReported),
      };
    }
    if (Array.isArray(data.blocked)) {
      return {
        blocked: data.blocked.length,
        reported: Array.isArray(data.reported) ? data.reported.length : 0,
      };
    }
  }
  throw new Error(`Unrecognized policy summary shape: ${filePath}`);
}

/**
 * @param {unknown} value
 * @returns {string|null} Trimmed string, or null when empty/not a string.
 */
function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * @param {unknown} value
 * @returns {number|null} Non-negative integer, or null.
 */
function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number} Numeric value or 0.
 */
function count(value) {
  return Number.isFinite(value) ? value : 0;
}

// CLI entry point. Reads the reports named by `--report <tool>=<path>`,
// verifies them against the digests declared by the jobs that produced them,
// and writes `security-reports/production-manifest.json` atomically. Exits
// nonzero when completeness cannot be proven.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const reports = new Map();
  const statuses = new Map();
  const digests = new Map();
  const fixtures = new Set();
  const toolVersions = {};
  const policyFiles = [];
  let output = 'security-reports/production-manifest.json';
  let verdict = null;
  let blocked = null;
  let reported = null;

  const pair = (raw, flag) => {
    const index = String(raw).indexOf('=');
    if (index <= 0) {
      console.error(`Invalid ${flag} value: expected <name>=<value>, got ${raw}`);
      process.exit(2);
    }
    return [raw.slice(0, index), raw.slice(index + 1)];
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];
    switch (arg) {
      case '--report': {
        const [tool, file] = pair(value, arg);
        reports.set(tool, file);
        i++;
        break;
      }
      case '--status': {
        const [tool, status] = pair(value, arg);
        statuses.set(tool, status);
        i++;
        break;
      }
      case '--digest': {
        const [tool, digest] = pair(value, arg);
        digests.set(tool, digest);
        i++;
        break;
      }
      case '--tool-version': {
        const [tool, version] = pair(value, arg);
        toolVersions[tool] = version;
        i++;
        break;
      }
      case '--fixture':
        fixtures.add(value);
        i++;
        break;
      case '--policy':
        policyFiles.push(value);
        i++;
        break;
      case '--output':
        output = value;
        i++;
        break;
      case '--verdict':
        verdict = value;
        i++;
        break;
      case '--blocked':
        blocked = Number.parseInt(value, 10);
        i++;
        break;
      case '--reported':
        reported = Number.parseInt(value, 10);
        i++;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(2);
    }
  }

  if (reports.size === 0) {
    console.error(
      'Usage: write-scan-manifest.mjs --report <tool>=<path> [--status <tool>=<result>] ' +
        '[--digest <tool>=<sha256>] [--fixture <tool>] [--tool-version <name>=<version>] ' +
        '[--policy <summary.json>] [--verdict clean|blocking --blocked N --reported N] ' +
        '[--output <manifest.json>]',
    );
    process.exit(2);
  }

  const collected = [];
  for (const [tool, file] of reports) {
    collected.push(
      collectReport(tool, file, {
        status: statuses.get(tool),
        expectedDigest: digests.get(tool),
        fixture: fixtures.has(tool),
      }),
    );
  }

  // Evaluator summaries win over the inline verdict flags when both are given:
  // the summaries are produced by the tested policy evaluators.
  if (policyFiles.length > 0) {
    blocked = 0;
    reported = 0;
    for (const file of policyFiles) {
      try {
        const summary = readPolicySummary(file);
        blocked += summary.blocked;
        reported += summary.reported;
      } catch (err) {
        console.error(`Error reading policy summary ${file}: ${err.message}`);
        blocked = null;
        reported = null;
        break;
      }
    }
    verdict = blocked === null ? null : blocked > 0 ? 'blocking' : 'clean';
  }

  const manifest = buildManifest({
    headSha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    runId: process.env.GITHUB_RUN_ID,
    toolVersions,
    generationTime: new Date().toISOString(),
    reports: collected,
    policy:
      verdict === null && blocked === null && reported === null
        ? undefined
        : { verdict, blockedCount: blocked, reportedCount: reported },
  });

  writeManifestFile(output, manifest);
  console.log(`Wrote ${output} (complete: ${manifest.complete})`);

  if (!manifest.complete) {
    for (const reason of manifest.incompleteReason) {
      console.error(`::error::incomplete production evidence: ${reason}`);
    }
    process.exit(1);
  }
}
