#!/usr/bin/env node
// 一次性维护脚本：调用管理员接口为历史通知补齐 sourceType/sourceId。
// 用法：node scripts/backfill-notification-sources.js [用户名] [密码]
// 也可通过 ADMIN_USERNAME/ADMIN_PASSWORD 提供凭据，缺失时由命令行参数补齐。
const http = require('http');
const https = require('https');
const { decodeCaptchaFromSvg } = require('./captcha-glyphs');

const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const username = process.argv[2] || process.env.ADMIN_USERNAME || '';
const password = process.argv[3] || process.env.ADMIN_PASSWORD || '';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url, base);
    const client = target.protocol === 'https:' ? https : http;
    const payload = options.body === undefined ? null : Buffer.from(String(options.body));
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {}),
        ...(payload ? { 'Content-Length': payload.length } : {})
      },
      // 默认保持证书校验；自签证书场景通过 NODE_EXTRA_CA_CERTS 提供 CA。
      rejectUnauthorized: true
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = text;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (_) {
        }
        resolve({ status: res.statusCode || 0, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  if (!username || !password) {
    throw new Error('请通过命令行参数或 ADMIN_USERNAME/ADMIN_PASSWORD 提供管理员凭据');
  }
  const captcha = await request('/api/captcha');
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      captchaToken: captcha.data.token,
      captcha: decodeCaptchaFromSvg(captcha.data)
    })
  });
  if (login.status !== 200) {
    throw new Error(`登录失败（${login.status}）：${login.data.message || '请检查用户名/密码'}`);
  }
  const cookie = (login.headers['set-cookie'] || '').split(';')[0];
  const csrfToken = login.data.csrfToken || '';
  const result = await request('/api/system/backfill-notification-sources', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (result.status !== 200) {
    throw new Error(`回填失败（${result.status}）：${result.data.message || '未知错误'}`);
  }
  console.log(result.data.message);
  if (result.data.byType && Object.keys(result.data.byType).length) {
    console.log('按来源类型补齐：', result.data.byType);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
