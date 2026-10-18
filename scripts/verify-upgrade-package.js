#!/usr/bin/env node
'use strict';

// 本地校验离线升级包：清单完整性、SHA256、HMAC 签名。
// 用法：UPGRADE_SIGNING_KEY='生产密钥' node scripts/verify-upgrade-package.js <包路径>

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

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

function walkFiles(dir, prefix, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, rel, files);
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

function fail(message) {
  process.stderr.write(`校验失败：${message}\n`);
  process.exit(1);
}

function main() {
  const packagePath = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.existsSync(packagePath)) {
    fail('请传入存在的升级包路径，例如 onsite-ops-upgrade-v1.0.16.tar.gz');
  }

  const signingKey = String(process.env.UPGRADE_SIGNING_KEY || '').trim();
  if (signingKey.length < 32) {
    fail('请设置不少于 32 位的 UPGRADE_SIGNING_KEY，并与目标服务器保持一致');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-verify-'));
  try {
    const fileList = execFileSync('tar', ['-tzf', packagePath], { timeout: 10000, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map(item => item.replace(/^\.\//, '').replace(/\/+$/, ''));
    for (const entry of fileList) {
      if (entry.startsWith('/') || entry.includes('..')) fail(`包内含非法路径 ${entry}`);
    }

    execFileSync('tar', ['-xzf', packagePath, '-C', workDir, '--no-same-owner', '--no-same-permissions'], { timeout: 30000 });

    const manifestPath = path.join(workDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) fail('包内缺少 manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      fail(`manifest.json 解析失败：${error.message}`);
    }

    const declared = Array.isArray(manifest.files) ? manifest.files.map(item => String(item)) : [];
    if (declared.length === 0) fail('manifest.files 为空');
    const checksums = manifest.sha256 && typeof manifest.sha256 === 'object' ? manifest.sha256 : {};

    const actualFiles = walkFiles(workDir, '', []).filter(item => item !== 'manifest.json').sort();
    const declaredSorted = [...declared].sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(declaredSorted)) {
      const extra = actualFiles.find(item => !declaredSorted.includes(item));
      const missing = declaredSorted.find(item => !actualFiles.includes(item));
      fail(extra ? `包内存在未声明文件 ${extra}` : `包内缺少清单声明的 ${missing}`);
    }

    for (const file of declaredSorted) {
      const expected = String(checksums[file] || '').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expected)) fail(`manifest.sha256 中 ${file} 的摘要无效`);
      const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(workDir, file))).digest('hex');
      if (actual !== expected) fail(`${file} 的 SHA256 与清单不一致`);
    }

    for (const key of Object.keys(checksums)) {
      if (!declaredSorted.includes(key)) fail(`manifest.sha256 存在未声明的条目 ${key}`);
    }

    const signature = String(manifest.signature || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(signature)) fail('包未签名，生产环境会拒绝安装');

    const payload = JSON.stringify(canonicalizeJson({
      version: manifest.version || '',
      files: declared,
      sha256: declared.reduce((result, file) => {
        result[file] = String(checksums[file] || '').trim().toLowerCase();
        return result;
      }, {})
    }));
    const expectedSignature = crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      fail('签名与当前 UPGRADE_SIGNING_KEY 不匹配，请核对密钥');
    }

    process.stdout.write(`校验通过：版本 ${manifest.version || '未知'}，${declared.length} 个文件，签名有效\n`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
