import fs from 'node:fs';

// Permitted licenses (whitelist)
const PERMITTED_PATTERNS = [
  /^MIT$/i,
  /^Apache-?2\.0$/i,
  /^ISC$/i,
  /^BSD-?2-Clause$/i,
  /^BSD-?3-Clause$/i,
  /^BSD$/i,
  /^CC0-?1\.0$/i,
  /^Unlicense$/i,
  /^WTFPL$/i,
  /^0BSD$/i,
  /^MPL-?2\.0$/i,
  /^Zlib$/i,
  /^Python-2\.0$/i,
  /^PostgreSQL$/i,
  /^NCSA$/i,
  /^OpenSSL$/i,
  /^BSL-?1\.0$/i,
  /^ Artistic-?2\.0$/i,
];

// Restricted licenses (blacklist patterns)
const RESTRICTED_PATTERNS = [
  /^AGPL/i,
  /^SSPL/i,
  /^BUSL/i,
  /^GPL/i,
  /^LGPL/i,
  /^Elastic/i,
  /^Commons-Clause/i,
  /^PolyForm/i,
];

// Non-commercial license patterns
const NON_COMMERCIAL_PATTERNS = [
  /Non-?Commercial/i,
  /CC-BY-NC/i,
  /NC$/i,
];

// License string variations
const LICENSE_VARIATIONS = {
  'mit': 'MIT',
  'apache-2.0': 'Apache-2.0',
  'apache 2.0': 'Apache-2.0',
  'isc': 'ISC',
  'bsd': 'BSD-3-Clause',
  'bsd-2-clause': 'BSD-2-Clause',
  'bsd-3-clause': 'BSD-3-Clause',
  'cc0': 'CC0-1.0',
  'unlicense': 'Unlicense',
  'wtfpl': 'WTFPL',
  '0bsd': '0BSD',
  'mpl': 'MPL-2.0',
};

/**
 * Normalize a license string to standard SPDX format
 * @param {string} license - Raw license string
 * @returns {string} Normalized license string
 */
function normalizeLicense(license) {
  if (!license || typeof license !== 'string') return '';
  
  let normalized = license.trim();
  
  // Handle compound licenses like "(MIT OR Apache-2.0)"
  normalized = normalized.replace(/[()]/g, '').trim();
  
  // Handle multiple licenses separated by OR/AND
  if (/\bOR\b/i.test(normalized) || /\bAND\b/i.test(normalized)) {
    // For compound licenses, extract the first license for simplicity
    // A full SPDX parser would handle this better
    normalized = normalized.split(/\s+(?:OR|AND)\s+/i)[0].trim();
  }
  
  // Normalize common variations
  const lower = normalized.toLowerCase();
  if (LICENSE_VARIATIONS[lower]) {
    return LICENSE_VARIATIONS[lower];
  }
  
  // Standardize Apache spacing
  normalized = normalized.replace(/Apache-?2\.0?/i, 'Apache-2.0');
  
  // Standardize BSD variations
  if (/^BSD$/i.test(normalized)) return 'BSD-3-Clause';
  
  return normalized;
}

/**
 * Check if license matches any of the given patterns
 * @param {string} license - Normalized license string
 * @param {Array<RegExp>} patterns - Array of regex patterns
 * @returns {boolean}
 */
function matchesAny(license, patterns) {
  return patterns.some(p => p.test(license));
}

/**
 * Extract a license string from a deprecated-style entry ({type: 'X'}).
 * Returns the type string for objects with a string `type` field,
 * or null if the entry cannot be normalized.
 * @param {*} item
 * @returns {string|null}
 */
function extractTypeFromLicenseEntry(item) {
  if (typeof item === 'string') return item;
  if (item !== null && typeof item === 'object' && typeof item.type === 'string') {
    return item.type;
  }
  return null;
}

/**
 * Classify a license string
 * @param {string|Array|object} value - License value (string, array, or object)
 * @returns {{classification: string, source: string, isProduction: boolean}}
 */
export function classifyLicense(value) {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return {
      classification: 'unknown',
      source: 'null-input',
      isProduction: false
    };
  }
  
  // Handle private packages (no license field typically means proprietary)
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (value.type === 'private' || value.private === true) {
      // Private packages without explicit license default to MIT
      return {
        classification: 'permitted',
        source: 'private-default',
        isProduction: true
      };
    }
    // Object with licenses property — handles deprecated {licenses: [...]} format
    if (value.licenses) {
      if (Array.isArray(value.licenses)) {
        if (value.licenses.length === 0) {
          return {
            classification: 'unknown',
            source: 'empty-array',
            isProduction: false
          };
        }
        // Walk entries; pick restricted/non-commercial over the first permitted
        for (const item of value.licenses) {
          const licenseStr = extractTypeFromLicenseEntry(item);
          if (licenseStr === null) continue;
          const result = classifyLicense(licenseStr);
          if (result.classification === 'restricted' || result.classification === 'non-commercial') {
            return result;
          }
        }
        // No restricted entries found — fall back to first entry
        const first = value.licenses[0];
        const firstStr = extractTypeFromLicenseEntry(first);
        if (firstStr !== null) {
          return classifyLicense(firstStr);
        }
        return {
          classification: 'unknown',
          source: 'empty-array',
          isProduction: false
        };
      }
      return classifyLicense(value.licenses);
    }
    return {
      classification: 'unknown',
      source: 'empty-object',
      isProduction: false
    };
  }
  
  // Handle array input (take first valid license)
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        classification: 'unknown',
        source: 'empty-array',
        isProduction: false
      };
    }
    // For compound licenses, check if ANY is permitted/restricted
    for (const item of value) {
      const str = extractTypeFromLicenseEntry(item);
      if (str === null) continue;
      const result = classifyLicense(str);
      if (result.classification === 'restricted' || result.classification === 'non-commercial') {
        return result;
      }
    }
    // All licenses in array — fall back to first valid entry
    for (const item of value) {
      const str = extractTypeFromLicenseEntry(item);
      if (str !== null) {
        return classifyLicense(str);
      }
    }
    return {
      classification: 'unknown',
      source: 'empty-array',
      isProduction: false
    };
  }
  
  // Handle string input
  if (typeof value !== 'string') {
    return {
      classification: 'unknown',
      source: 'invalid-type',
      isProduction: false
    };
  }
  
  const normalized = normalizeLicense(value);
  
  if (!normalized) {
    return {
      classification: 'unknown',
      source: 'empty-string',
      isProduction: false
    };
  }
  
  // Check permitted list
  if (matchesAny(normalized, PERMITTED_PATTERNS)) {
    return {
      classification: 'permitted',
      source: 'whitelist',
      isProduction: true
    };
  }
  
  // Check non-commercial patterns FIRST (more specific)
  if (matchesAny(normalized, NON_COMMERCIAL_PATTERNS) || matchesAny(value, NON_COMMERCIAL_PATTERNS)) {
    return {
      classification: 'non-commercial',
      source: 'non-commercial-pattern',
      isProduction: false
    };
  }
  
  // Check restricted blacklist
  if (matchesAny(normalized, RESTRICTED_PATTERNS)) {
    return {
      classification: 'restricted',
      source: 'blacklist-agpl-sspl',
      isProduction: false
    };
  }
  
  // Unknown license
  return {
    classification: 'unknown',
    source: 'unrecognized',
    isProduction: false
  };
}

/**
 * Load and validate per-package per-version exceptions from a JSON file.
 * Each exception requires package, version, license, and rationale (>=20 chars).
 * @param {string} filePath - Path to license-exceptions.json
 * @returns {Array<{package: string, version: string, license: string, rationale: string}>}
 */
export function loadExceptions(filePath) {
  if (!filePath) return [];
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
  for (const entry of list) {
    if (!entry || typeof entry.package !== 'string' || typeof entry.version !== 'string') {
      throw new Error(`Invalid exception entry (missing package/version): ${JSON.stringify(entry)}`);
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.length < 20) {
      throw new Error(`Exception rationale must be >= 20 chars for ${entry.package}@${entry.version}`);
    }
  }
  return list;
}

/**
 * Evaluate a list of packages against license policy
 * @param {Array} packages - Array of package objects with name, version, license, dev
 * @param {string} scope - 'production' or 'development'
 * @param {Array} exceptions - Per-package per-version exceptions with rationale
 * @returns {{blocked: Array, reported: Array, exceptions: Array}}
 */
export function evaluatePackages(packages, scope = 'production', exceptions = []) {
  const blocked = [];
  const reported = [];
  const exceptionsApplied = [];

  for (const pkg of packages) {
    // Forward deprecated {licenses: [{type:'X'}]} format when license field is missing
    const licenseValue = (pkg.license !== undefined && pkg.license !== null)
      ? pkg.license
      : (pkg.licenses !== undefined ? { licenses: pkg.licenses } : pkg.license);
    const licenseResult = classifyLicense(licenseValue);

    const entry = {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      classification: licenseResult.classification,
      source: licenseResult.source,
      dev: pkg.dev || false
    };

    // Check for matching exception (per-package per-version only)
    const exception = exceptions.find(e =>
      e.package === pkg.name && e.version === pkg.version
    );
    if (exception) {
      exceptionsApplied.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        classification: licenseResult.classification,
        kind: 'exception',
        rationale: exception.rationale,
        dev: pkg.dev || false
      });
      continue;
    }

    if (licenseResult.classification === 'permitted') {
      // Permitted - no action needed
      continue;
    }

    // For production dependencies, block anything not explicitly permitted
    if (scope === 'production' && !pkg.dev) {
      if (licenseResult.classification === 'restricted' ||
          licenseResult.classification === 'non-commercial' ||
          licenseResult.classification === 'unknown') {
        blocked.push(entry);
      }
    } else {
      // Development dependencies or non-production scope - report only
      reported.push(entry);
    }
  }

  return { blocked, reported, exceptions: exceptionsApplied };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let productionFile = null;
  let developmentFile = null;
  let outputFile = null;
  let exceptionsFile = 'security/license-exceptions.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--production' && args[i + 1]) {
      productionFile = args[i + 1];
      i++;
    } else if (args[i] === '--development' && args[i + 1]) {
      developmentFile = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--exceptions' && args[i + 1]) {
      exceptionsFile = args[i + 1];
      i++;
    }
  }

  try {
    const allBlocked = [];
    const allReported = [];
    const allExceptions = [];
    const exceptions = loadExceptions(exceptionsFile);

    if (productionFile) {
      const prodPkgs = JSON.parse(fs.readFileSync(productionFile, 'utf8'));
      const result = evaluatePackages(prodPkgs, 'production', exceptions);
      allBlocked.push(...result.blocked.map(p => ({ ...p, scope: 'production' })));
      allReported.push(...result.reported.map(p => ({ ...p, scope: 'production' })));
      allExceptions.push(...result.exceptions.map(p => ({ ...p, scope: 'production' })));
    }

    if (developmentFile) {
      const devPkgs = JSON.parse(fs.readFileSync(developmentFile, 'utf8'));
      const result = evaluatePackages(devPkgs, 'development', exceptions);
      allReported.push(...result.reported.map(p => ({ ...p, scope: 'development' })));
      allExceptions.push(...result.exceptions.map(p => ({ ...p, scope: 'development' })));
    }

    const summary = {
      blocked: allBlocked,
      reported: allReported,
      exceptions: allExceptions,
      summary: {
        totalBlocked: allBlocked.length,
        totalReported: allReported.length,
        totalExceptions: allExceptions.length
      }
    };

    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
      console.log(`License policy report written to ${outputFile}`);
    } else {
      console.log(JSON.stringify(summary, null, 2));
    }

    if (allBlocked.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
