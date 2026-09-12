#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname);
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';
const outputName = `onsite-ops-upgrade-v${version}.tar.gz`;
const outputPath = path.join(rootDir, outputName);

const includeFiles = [
  'server.js',
  'package.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'docker-entrypoint.sh',
  'pptx-template.json'
];

const includeDirs = [
  'public',
  'scripts'
];

const missing = [];
for (const file of includeFiles) {
  if (!fs.existsSync(path.join(rootDir, file))) {
    missing.push(file);
  }
}
for (const dir of includeDirs) {
  const abs = path.join(rootDir, dir);
  try {
    if (!fs.statSync(abs).isDirectory()) {
      missing.push(dir + '/');
    }
  } catch (_) {
    missing.push(dir + '/');
  }
}

if (missing.length > 0) {
  console.error('Missing required files/directories:', missing.join(', '));
  process.exit(1);
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalizeJson(value[key]);
      return result;
    }, {});
  }
  return value;
}

function walkFiles(dir, prefix) {
  const files = [];
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of dirents) {
    if (entry.name === 'downloads' && prefix === 'public') continue;
    const rel = `${prefix}/${entry.name}`;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(abs, rel));
    } else if (entry.isFile()) {
      files.push(rel.split(path.sep).join('/'));
    }
  }
  return files;
}

const files = [...includeFiles];
for (const dir of includeDirs) {
  files.push(...walkFiles(path.join(rootDir, dir), dir));
}
files.sort();

const sha256 = {};
for (const file of files) {
  const abs = path.join(rootDir, file);
  sha256[file] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  console.log(`  SHA256 ${file}: ${sha256[file].substring(0, 16)}...`);
}

const manifest = {
  version,
  files,
  sha256
};

const signingKey = String(process.env.UPGRADE_SIGNING_KEY || '');
if (signingKey.length >= 32) {
  const payload = JSON.stringify(canonicalizeJson({
    version: manifest.version || '',
    files,
    sha256
  }));
  manifest.signature = crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
  console.log('Upgrade package signed with UPGRADE_SIGNING_KEY');
} else {
  console.log('UPGRADE_SIGNING_KEY missing or shorter than 32 chars; manifest has no signature');
  console.log('Production UI upload requires: UPGRADE_SIGNING_KEY=your-key npm run build-upgrade');
}

const manifestPath = path.join(rootDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const entries = [...includeFiles, ...includeDirs, 'manifest.json'];

try {
  execSync(`tar -czf "${outputPath}" --exclude=public/downloads ${entries.map(e => `"${e}"`).join(' ')}`, {
    cwd: rootDir,
    timeout: 60000
  });
} catch (error) {
  console.error('Failed to create upgrade package:', error.message);
  process.exit(1);
}

const stats = fs.statSync(outputPath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);

console.log(`Upgrade package created: ${outputName} (${sizeMB} MB)`);
console.log(`Version: ${version}`);
console.log(`  manifest.json written (${files.length} files)`);
console.log('');
console.log('To apply the upgrade:');
console.log('  1. Upload via System Management -> Software Upgrade in the web UI');
console.log('  2. Restart the container: docker compose restart');
console.log('');
console.log('The entrypoint script will automatically apply the upgrade on startup.');
