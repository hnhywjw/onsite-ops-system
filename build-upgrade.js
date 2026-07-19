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
  'docker-entrypoint.sh'
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

const entries = [...includeFiles, ...includeDirs];

try {
  execSync(`tar -czf "${outputPath}" ${entries.map(e => `"${e}"`).join(' ')}`, {
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
console.log('');

const hashesFile = path.join(rootDir, 'SHA256SUMS');
const hashLines = [];
for (const file of includeFiles) {
  const p = path.join(rootDir, file);
  if (fs.existsSync(p)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    hashLines.push(`${hash}  ${file}`);
    console.log(`  SHA256 ${file}: ${hash.substring(0, 16)}...`);
  }
}
for (const dir of includeDirs) {
  const dirPath = path.join(rootDir, dir);
  try {
    const walkDir = (dp, prefix) => {
      const entries = fs.readdirSync(dp, { withFileTypes: true });
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : `${dir}/${e.name}`;
        const abs = path.join(dp, e.name);
        if (e.isDirectory()) {
          walkDir(abs, rel);
        } else {
          const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
          hashLines.push(`${hash}  ${rel}`);
        }
      }
    };
    walkDir(dirPath, dir);
  } catch (_) {}
}
fs.writeFileSync(hashesFile, hashLines.join('\n') + '\n');
console.log(`  SHA256SUMS written (${hashLines.length} files)`);
console.log('');
console.log('To apply the upgrade:');
console.log('  1. Upload via System Management -> Software Upgrade in the web UI');
console.log('  2. Restart the container: docker compose restart');
console.log('');
console.log('The entrypoint script will automatically apply the upgrade on startup.');
