#!/usr/bin/env node

/**
 * Simple post-build helper that ensures every relative ESM import
 * emitted into the dist folder ends with a real file name.
 *
 * Node's native ESM loader (without experimental flags) refuses to
 * resolve extensionless specifiers like `./config/database`, so we
 * append `.js` (or `/index.js` for folders) whenever a matching file
 * exists in the dist tree.
 */
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '../dist');
const FILE_EXTENSIONS = ['.js'];
const INDEX_FILES = ['index.js'];

if (!fs.existsSync(DIST_DIR)) {
  console.error(`Dist directory not found at ${DIST_DIR}. Did you run "tsc" first?`);
  process.exit(1);
}

const jsFiles = collectJsFiles(DIST_DIR);
let updatedFiles = 0;

jsFiles.forEach((filePath) => {
  const original = fs.readFileSync(filePath, 'utf8');
  const transformed = transformImports(original, filePath);

  if (original !== transformed) {
    fs.writeFileSync(filePath, transformed, 'utf8');
    updatedFiles += 1;
  }
});

console.log(`✅ ESM import specifiers normalized in ${updatedFiles} file(s).`);

function collectJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

function transformImports(source, filePath) {
  return [sideEffectRegex(), fromRegex(), importCallRegex()].reduce(
    (current, regex) => current.replace(regex, (_, prefix, specifier, suffix = '') => {
      const nextSpecifier = ensureExtension(filePath, specifier);
      return `${prefix}${nextSpecifier}${suffix}`;
    }),
    source,
  );
}

function sideEffectRegex() {
  return /(import\s+['"])(\.{1,2}\/[^'"]*)(['"])/g;
}

function fromRegex() {
  return /((?:import|export)\s+(?:[^'"]+?\s+from\s+|\*\s+from\s+|{[^}]*}\s+from\s+)['"])(\.{1,2}\/[^'"]*)(['"])/g;
}

function importCallRegex() {
  return /(import\s*\(\s*['"])(\.{1,2}\/[^'"]*)(['"]\s*\))/g;
}

function ensureExtension(filePath, specifier) {
  if (!specifier.startsWith('.')) {
    return specifier;
  }

  if (hasExplicitExtension(specifier)) {
    return specifier;
  }

  const originatingDir = path.dirname(filePath);
  const resolvedWithoutExt = path.resolve(originatingDir, specifier);

  for (const ext of FILE_EXTENSIONS) {
    if (fs.existsSync(resolvedWithoutExt + ext)) {
      return specifier + ext;
    }
  }

  if (fs.existsSync(resolvedWithoutExt) && fs.statSync(resolvedWithoutExt).isDirectory()) {
    for (const indexFile of INDEX_FILES) {
      const candidate = path.join(resolvedWithoutExt, indexFile);
      if (fs.existsSync(candidate)) {
        const normalized = specifier.endsWith('/') ? specifier : `${specifier}/`;
        return normalized + indexFile;
      }
    }
  }

  return specifier;
}

function hasExplicitExtension(specifier) {
  const lastSlash = specifier.lastIndexOf('/');
  const lastSegment = lastSlash === -1 ? specifier : specifier.slice(lastSlash + 1);
  return lastSegment.includes('.');
}
