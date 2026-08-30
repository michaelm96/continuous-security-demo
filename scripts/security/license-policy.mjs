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
    // Object with licenses property
    if (value.licenses) {
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
      const result = classifyLicense(item);
      if (result.classification === 'restricted' || result.classification === 'non-commercial') {
        return result;
      }
    }
    // All licenses in array
    return classifyLicense(value[0]);
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
 * Evaluate a list of packages against license policy
 * @param {Array} packages - Array of package objects with name, version, license, dev
 * @param {string} scope - 'production' or 'development'
 * @returns {{blocked: Array, reported: Array}}
 */
export function evaluatePackages(packages, scope = 'production') {
  const blocked = [];
  const reported = [];
  
  for (const pkg of packages) {
    const licenseResult = classifyLicense(pkg.license);
    
    const entry = {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      classification: licenseResult.classification,
      source: licenseResult.source,
      dev: pkg.dev || false
    };
    
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
  
  return { blocked, reported };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let productionFile = null;
  let developmentFile = null;
  let outputFile = null;
  
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
    }
  }
  
  try {
    const allBlocked = [];
    const allReported = [];
    
    if (productionFile) {
      const prodPkgs = JSON.parse(fs.readFileSync(productionFile, 'utf8'));
      const result = evaluatePackages(prodPkgs, 'production');
      allBlocked.push(...result.blocked.map(p => ({ ...p, scope: 'production' })));
      allReported.push(...result.reported.map(p => ({ ...p, scope: 'production' })));
    }
    
    if (developmentFile) {
      const devPkgs = JSON.parse(fs.readFileSync(developmentFile, 'utf8'));
      const result = evaluatePackages(devPkgs, 'development');
      allReported.push(...result.reported.map(p => ({ ...p, scope: 'development' })));
    }
    
    const summary = {
      blocked: allBlocked,
      reported: allReported,
      summary: {
        totalBlocked: allBlocked.length,
        totalReported: allReported.length
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
