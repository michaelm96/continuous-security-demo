import fs from 'node:fs';
import path from 'node:path';

// Regex to match uses: on same line as - (allows quotes and special chars for expressions)
const USES_LINE_REGEX = /^(\s*)-\s*uses:\s*([^\n]+?)\s*(?:#.*)?$/;

// Regex for SHA validation (40 hex characters, case-insensitive)
const SHA40_REGEX = /^[a-fA-F0-9]{40}$/;
// SHA256 hash (64 hex characters)
const SHA256_REGEX = /^[a-fA-F0-9]{64}$/;

/**
 * Extract the action reference part (after @)
 */
function extractRefPart(ref) {
  if (!ref) return null;
  
  // Docker references
  if (ref.startsWith('docker://')) {
    return ref.slice(9);
  }
  
  // GitHub Actions owner/repo@ref
  if (ref.includes('@')) {
    return ref.split('@')[1];
  }
  
  return null;
}

/**
 * Check if an action reference is pinned (immutable)
 */
function isPinnedAction(ref) {
  if (!ref) return false;
  
  // Local action - always allowed (not checked for pinning)
  if (ref.startsWith('./') || ref.startsWith('../')) {
    return false;
  }
  
  // Docker image with SHA256 digest
  if (ref.startsWith('docker://')) {
    const sha256Match = ref.match(/@sha256:([a-fA-F0-9]{64})$/);
    return sha256Match !== null;
  }
  
  // GitHub Action with @sha256:... format
  if (ref.includes('@sha256:')) {
    const hash = ref.split('@sha256:')[1];
    return SHA256_REGEX.test(hash);
  }
  
  // GitHub Action ref
  const afterAt = extractRefPart(ref);
  if (afterAt) {
    // 40-char SHA - pinned
    if (SHA40_REGEX.test(afterAt)) {
      return true;
    }
    return false;
  }
  
  // Full 40-char SHA as entire ref
  if (SHA40_REGEX.test(ref)) {
    return true;
  }
  
  return false;
}

/**
 * Check if an action reference is mutable
 */
function isMutableAction(ref) {
  if (!ref) return false;
  
  // Local actions are not mutable
  if (ref.startsWith('./') || ref.startsWith('../')) {
    return false;
  }
  
  // Docker without sha256 digest is mutable
  if (ref.startsWith('docker://')) {
    const sha256Match = ref.match(/@sha256:([a-fA-F0-9]{64})$/);
    return sha256Match === null;
  }
  
  // GitHub Action ref
  const afterAt = extractRefPart(ref);
  if (afterAt) {
    // sha256:64hex format - valid, not mutable
    if (afterAt.startsWith('sha256:')) {
      const hash = afterAt.slice(7);
      return !SHA256_REGEX.test(hash);
    }
    // 40-char SHA - not mutable
    if (SHA40_REGEX.test(afterAt)) {
      return false;
    }
    // Everything else (tags, branches, expressions) is mutable
    return true;
  }
  
  // Contains expressions - mutable
  if (ref.includes('${{')) {
    return true;
  }
  
  // Any other @ref without known format is mutable
  if (ref.includes('@')) {
    return true;
  }
  
  return false;
}

/**
 * Parse a workflow YAML source and find all uses: statements
 */
export function inspectWorkflow(source, file = 'workflow.yml') {
  const mutable = [];
  const pinned = [];
  
  if (!source || typeof source !== 'string') {
    return { mutable, pinned };
  }
  
  const lines = source.split('\n');
  let lastIndent = 0;
  let inStepItem = false;
  
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let line = lines[i];
    
    // Skip empty lines
    if (!line.trim()) {
      inStepItem = false;
      continue;
    }
    
    // Handle inline comments
    const commentIndex = line.indexOf('#');
    if (commentIndex >= 0) {
      const beforeComment = line.slice(0, commentIndex);
      const afterComment = line.slice(commentIndex);
      
      // Check if this is a commented-out uses line
      if (beforeComment.trim().startsWith('-') && afterComment.includes('uses:')) {
        continue;
      }
      
      line = beforeComment;
    }
    
    // Skip multi-line string indicators
    if (/^\s*[|>][+-]?\d*$/.test(line.trim())) {
      continue;
    }
    
    // Match uses: line on same line as -
    const match = line.match(USES_LINE_REGEX);
    if (match) {
      const [, indent, actionRef] = match;
      const ref = actionRef.trim();
      
      // Local actions are not tracked
      if (ref.startsWith('./') || ref.startsWith('../')) {
        continue;
      }
      
      if (isPinnedAction(ref)) {
        pinned.push({ file, line: lineNum, ref });
      } else if (isMutableAction(ref)) {
        mutable.push({ file, line: lineNum, ref, message: `Mutable action reference: ${ref}` });
      } else {
        mutable.push({ file, line: lineNum, ref, message: `Unknown action reference: ${ref}` });
      }
      continue;
    }
    
    // Track if we're in a step list item (detected by - name:)
    const stepMatch = line.match(/^(\s*)-\s*name:/);
    if (stepMatch) {
      lastIndent = stepMatch[1].length;
      inStepItem = true;
    }
    
    // Check for indented uses: following a step item
    if (inStepItem) {
      const usesMatch = line.match(/^\s+uses:\s*([^\n]+?)\s*(?:#.*)?$/);
      if (usesMatch) {
        const ref = usesMatch[1].trim();
        
        if (ref.startsWith('./') || ref.startsWith('../')) {
          continue;
        }
        
        if (isPinnedAction(ref)) {
          pinned.push({ file, line: lineNum, ref });
        } else if (isMutableAction(ref)) {
          mutable.push({ file, line: lineNum, ref, message: `Mutable action reference: ${ref}` });
        } else {
          mutable.push({ file, line: lineNum, ref, message: `Unknown action reference: ${ref}` });
        }
        continue;
      }
    }
  }
  
  return { mutable, pinned };
}

/**
 * Inspect multiple workflow files in a directory
 */
export function inspectWorkflowFiles(paths) {
  const allMutable = [];
  const allPinned = [];
  
  const pathArray = Array.isArray(paths) ? paths : [paths];
  
  for (const p of pathArray) {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    
    if (stat.isDirectory()) {
      const yamlFiles = findYamlFiles(p);
      for (const yamlFile of yamlFiles) {
        inspectFile(yamlFile, allMutable, allPinned);
      }
    } else if (stat.isFile() && isYamlFile(p)) {
      inspectFile(p, allMutable, allPinned);
    }
  }
  
  return { mutable: allMutable, pinned: allPinned };
}

function findYamlFiles(dir) {
  const results = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          results.push(...findYamlFiles(fullPath));
        }
      } else if (isYamlFile(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore permission errors
  }
  
  return results;
}

function isYamlFile(filename) {
  return /\.(ya?ml)$/i.test(filename);
}

function inspectFile(filePath, mutable, pinned) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const file = path.basename(filePath);
    const result = inspectWorkflow(content, file);
    mutable.push(...result.mutable);
    pinned.push(...result.pinned);
  } catch {
    // Ignore read errors
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let output = null;
  let reportFormat = null;
  const paths = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output') {
      output = args[++i];
    } else if (arg === '--report-format') {
      reportFormat = args[++i];
      if (reportFormat !== 'json') {
        console.error(`Unsupported --report-format: ${reportFormat}`);
        process.exit(2);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.error('Usage: check-action-pins.mjs [--output <file>] [--report-format json] <workflow-dir-or-file>...');
      process.exit(0);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    console.error('Usage: check-action-pins.mjs [--output <file>] [--report-format json] <workflow-dir-or-file>...');
    process.exit(1);
  }

  const result = inspectWorkflowFiles(paths);

  // --output writes JSON so other tools (the fixture inversion self-test)
  // can read the same findings without re-parsing text. Mutable entries gain
  // a stable `id` prefixed with `mutable-action-ref:` and `ruleId: mutable-action-ref`
  // so the inversion check can match it as a SARIF-style rule ID.
  if (output) {
    const payload = {
      mutable: result.mutable.map((item, index) => ({
        id: `mutable-action-ref:${item.file}:${item.line}:${index}`,
        ruleId: 'mutable-action-ref',
        file: item.file,
        line: item.line,
        ref: item.ref,
        message: item.message,
      })),
      pinned: result.pinned.map((item) => ({
        id: `pinned-action:${item.file}:${item.line}`,
        ruleId: 'pinned-action',
        file: item.file,
        line: item.line,
        ref: item.ref,
      })),
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
    // Suppress text diagnostics when JSON is being captured; the caller
    // typically wraps this in `|| true` for fixture scans that expect
    // findings.
    if (result.mutable.length > 0) {
      process.exit(1);
    }
  } else if (result.mutable.length > 0) {
    console.error('Mutable action references found:');
    for (const item of result.mutable) {
      console.error(`  ${item.file}:${item.line} - ${item.ref}`);
    }
    process.exit(1);
  } else {
    console.log('All action references are pinned.');
    if (result.pinned.length > 0) {
      console.log(`Found ${result.pinned.length} pinned action(s).`);
    }
  }
}
