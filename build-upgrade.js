#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
  if (!fs.statSync(path.join(rootDir, dir)).isDirectory()) {
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
console.log('To apply the upgrade:');
console.log('  1. Upload via System Management -> Software Upgrade in the web UI');
console.log('  2. Restart the container: docker compose restart');
console.log('');
console.log('The entrypoint script will automatically apply the upgrade on startup.');
