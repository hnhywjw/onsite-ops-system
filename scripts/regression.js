const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const httpsTestCert = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUPr7bIVsMkY3VtlXPIxK8jJFFSmgwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDYyMDA0MDc1MVoXDTI3MDYy
MDA0MDc1MVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAvGuESDW7ZpGGrxHxIIqRMgk+6Bb7fugecIia8WsfhN2W
8h3jfzyvo5VRpplEaVoLZDDXYIzC2ah6PtiKplLR12fHamFfyOJUIXxD2ETHfu6+
ufPQ9yBU2AYihTB2jhJlnSKERTI79a+hX8ZMS8CNIYGkQ+g9N5tUqlsXGMx3cg+p
IFd7v8C5gYYylM5tyOQqiNMoSpTXzvxXLAYahmM4cNu8TP5kmDBfMmKu4WYDcuMo
dKUnr3Wq2u+L+LIwx3lDspCOvraBUPAmtmYM57ATh1E9LBvOGD6Vv3oafTrKQd7X
uk0ZzS4S8gm3hF3Z8UICaha8lHyJHACBKbYH8YdWCwIDAQABo1MwUTAdBgNVHQ4E
FgQUi+OD2gGTk4FC3ENWPnx1mj6fRTkwHwYDVR0jBBgwFoAUi+OD2gGTk4FC3ENW
Pnx1mj6fRTkwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAd+Am
CDc1dLzwOydViljX+j5sjw2NdEzJKzikYeKkWNJi2pFp0yImJzVbNymvJEpkBcln
3lSWzyT2ChpeZ+fRfJUQUSnEizETFKU/NZKlTcHrowEeUrVjJaw/TXlxefHwQNx8
+tbRm/gNXx9QKlENVPg6uuu7Y2zH2mgwqbgk8IQVpSFg+t0abIBJZQXoViyMysOe
y0StA2KU8U7UT4xy5TCj6a+tSTdsJWJs0RH61laOiWAmz1FQtgP9zHXKI8Z42t/Y
d4JvLGzKCNhqjhj0ksaU+Y+UKKU89UzrHEaw+XmGvzWz16gq3mYEUwR19CXJ9nJI
Hnv2J6pGaElGKc9Bgw==
-----END CERTIFICATE-----
`;
const httpsTestKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC8a4RINbtmkYav
EfEgipEyCT7oFvt+6B5wiJrxax+E3ZbyHeN/PK+jlVGmmURpWgtkMNdgjMLZqHo+
2IqmUtHXZ8dqYV/I4lQhfEPYRMd+7r6589D3IFTYBiKFMHaOEmWdIoRFMjv1r6Ff
xkxLwI0hgaRD6D03m1SqWxcYzHdyD6kgV3u/wLmBhjKUzm3I5CqI0yhKlNfO/Fcs
BhqGYzhw27xM/mSYMF8yYq7hZgNy4yh0pSevdara74v4sjDHeUOykI6+toFQ8Ca2
ZgznsBOHUT0sG84YPpW/ehp9OspB3te6TRnNLhLyCbeEXdnxQgJqFryUfIkcAIEp
tgfxh1YLAgMBAAECggEAGHO3igt3E3uFSAkDCt8QsraidEovPyvub1o7CWOGhp6f
LTKVyHhertL88qrnRujJm6n++WerDcYgfzFo5ObQlqzAI10Zqh89Hc9bmqBqZ12i
YM10a+3FNPeu2SwN5qgaicbl9XjscRjmz2ATnK0TY6rIX4uvDh1ZYnZJzA0U3zdS
EM0UN/9iw9koIXa+V3Ze3dGs1Z/x9yscmq8CELFKREtbw2DkZm6uC+lqif0B1xLk
bE+s6mmSsMGWkl8GFi8JfiTZ8Xte9lj1vA/BWrhNM4WL8U5HdyELh5n26XotUmaK
Df6n2mqBnhzVicXLWm/3XvHanWbI9RUydfwOExR0kQKBgQDdnpHrXzn32wob0bjK
N+SBvOMEPb2htiXTawDUQPJEHYr7dRkDJLHa2jNlT73X2VsL3r2s+3ljrKr6HiSv
mmEt8tKcM2xPzUFkl3jooqS+jpKqqhqW7HB/ZJe5teEsMDY1cW4COrEDhEWKcyvH
ImEXDPnWL2q+M8dWy4QVEtjNyQKBgQDZpnWOx4pQvQgst2EirBjnP5DTIerRlwO7
S2bWAeqW6GGypOMR07in2DdHx+khkvKmhwgpOEpDjw+Vfz3gYEKgO75OVsGGvFz5
aeuvMlzQmPGjTtu3xp+u+OyYuKDmcSPRvHbFL7/4r0fA3qXVhIWpgfqCTgfwamah
UURHHZMfMwKBgEN/IAIHpqgOVi3S2ez8yOOam6mXBEJUL4EMfdwnS6HjPYkISO3k
Jyb4fd7FQpSS5l/fHvWoQXhSBmDW/WVeJ2rPIcXhA4Pqh5gTagewQWyoD5Na6247
5KdoA63T7xh+NoRgX5jeNztS9bsNCLBFkDxs/0p0dpYnPvb4VOn2K4HBAoGALMLF
DnYPBge6NKgJ+/10qaoy+JjTGAN8qvoYzg5a1mo4HWs3n6TxJuOaitKcKWF1MbY3
gXKoIzi6tb4TVZ+2VAm1W5sP9curO0gDRmaPG/84QqOnICZjFLLwxX/C52GBQlMG
AguN6XDyysF/TWgRrQikIkQ18cWQEcEKz61PYm0CgYEAhLZYlZnA7WRcM1QdOIu0
Ed8p38rf6LvP0hM00pIctNdxAYigRPo3aTz5asiTZW9+f6uBBpH8HCQF66momCG9
OlH+r81wJmSLX1a0CWSVGJJSbUBRAfstHV8U8sw4RRBS3ttZ7MmrYEAkgBcA/WS9
LUOYqexQkXh94z6tgslGT6E=
-----END PRIVATE KEY-----
`;

const csrfByCookie = new Map();

function withCsrf(headers = {}, method = 'GET') {
  const result = { ...headers };
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
  const cookie = result.cookie || result.Cookie;
  if (unsafe && cookie && csrfByCookie.has(cookie)) result['X-CSRF-Token'] = csrfByCookie.get(cookie);
  return result;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey, offset) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return formatDateKey(date);
}

function addMonthsToDateKey(dateKey, offset) {
  const date = new Date(`${dateKey}T00:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth() + offset;
  const day = date.getDate();
  const shifted = new Date(year, month, 1);
  const maxDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, maxDay));
  return formatDateKey(shifted);
}

function getWeekRangeStart(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = date.getDay() || 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day + 1);
  return formatDateKey(date);
}

function getNextMonthMidDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  return formatDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 15));
}

function getMonthDaysLeft(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return Math.floor((monthEnd.getTime() - date.getTime()) / 86400000);
}

function getLocalHour(isoString, timezoneOffsetMinutes) {
  const timestamp = Date.parse(String(isoString || ''));
  const localTime = new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) + (timezoneOffsetMinutes * 60 * 1000));
  return localTime.getUTCHours();
}

function getLocalDateKey(isoString, timezoneOffsetMinutes) {
  const timestamp = Date.parse(String(isoString || ''));
  const localTime = new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) + (timezoneOffsetMinutes * 60 * 1000));
  return localTime.toISOString().slice(0, 10);
}

function getTimezoneOffsetForHour(isoString, targetHour) {
  const timestamp = Date.parse(String(isoString || ''));
  const utcHour = new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).getUTCHours();
  let deltaHours = targetHour - utcHour;
  while (deltaHours > 14) deltaHours -= 24;
  while (deltaHours < -12) deltaHours += 24;
  return deltaHours * 60;
}

async function request(path, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(base + path, { ...options, headers: withCsrf(options.headers || {}, method) });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
  }
  return {
    status: response.status,
    data,
    headers: Object.fromEntries(response.headers.entries())
  };
}

async function requestHttps(path, port) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      rejectUnauthorized: false
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
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const { decodeCaptchaFromSvg } = require('./captcha-glyphs');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  const movingFactor = Buffer.alloc(8);
  movingFactor.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  movingFactor.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(movingFactor).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

async function login(username, password, options = {}) {
  const captcha = await request('/api/captcha');
  const result = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify({ username, password, captchaToken: captcha.data.token, captcha: decodeCaptchaFromSvg(captcha.data) })
  });
  const cookie = (result.headers['set-cookie'] || '').split(';')[0];
  if (cookie && result.data.csrfToken) csrfByCookie.set(cookie, result.data.csrfToken);
  return {
    ...result,
    cookie
  };
}

async function updateSystemSettings(cookie, payload) {
  const sensitiveKeys = ['httpsLoginEnabled', 'httpLoginDisabled', 'allowRegistration', 'loginRateLimitMaxAttempts', 'loginRateLimitWindowMinutes', 'loginRateLimitLockMinutes', 'monitorTargetAllowlist'];
  const needsStepUp = sensitiveKeys.some(key => payload[key] !== undefined);
  const body = needsStepUp && payload.password === undefined ? { ...payload, password: 'Admin123!' } : payload;
  return request('/api/system/settings', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function exportSystemSnapshot(cookie, password = 'Admin123!') {
  const exported = await request('/api/system/export', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  assert(exported.status === 200, '导出当前数据失败');
  return exported.data;
}

async function importSystemSnapshot(cookie, snapshot, password = 'Admin123!') {
  return request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...snapshot, password })
  });
}

function buildImportSnapshot(snapshot) {
  const clone = JSON.parse(JSON.stringify(snapshot));
  for (const [key, value] of Object.entries(clone)) {
    if (Array.isArray(value) && value.length > 50000) {
      clone[key] = value.slice(0, 50000);
    }
  }
  return clone;
}

async function listProjectNotifications(cookie, projectId) {
  const response = await request('/api/notifications?all=1', { headers: { cookie } });
  assert(response.status === 200, '查询通知列表失败');
  const list = Array.isArray(response.data?.data)
    ? response.data.data
    : (Array.isArray(response.data) ? response.data : []);
  return list.filter(item => item.projectId === projectId);
}

async function waitForProjectNotifications(cookie, projectId, predicate, attempts = 5, delayMs = 200) {
  let list = [];
  for (let index = 0; index < attempts; index += 1) {
    list = await listProjectNotifications(cookie, projectId);
    if (!predicate || predicate(list)) {
      return list;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return list;
}

// 调度器每分钟自动采集，手动采集可能与其重叠；遇到 409 时等待本轮结束后重试。
async function runMonitorNow(cookie, assetIds) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request('/api/monitor/run', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(assetIds ? { assetIds } : {})
    });
    if (response.status !== 409) return response;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return { status: 409, data: { message: '监控采集任务持续占用，无法完成回归验证' } };
}

// 通道回归用本机回环 HTTP 服务接收 Webhook，避免依赖外部通知平台。
function startWebhookReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8')
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, port: server.address().port });
    });
  });
}

async function waitFor(predicate, timeoutMs = 10000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasAuditLog(logs, action, detailKeyword) {
  return Array.isArray(logs) && logs.some(item => item.action === action && String(item.targetType || '') === 'system' && String(item.detail || '').includes(detailKeyword));
}

function hasAuditLogForTarget(logs, action, targetType, targetId, detailKeyword) {
  return Array.isArray(logs) && logs.some(item => item.action === action
    && String(item.targetType || '') === targetType
    && String(item.targetId || '') === targetId
    && String(item.detail || '').includes(detailKeyword));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function scryptHash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(value), salt, 64);
  return `$scrypt$${salt}$${derived.toString('hex')}`;
}

function createTarGz(entries) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onsite-upgrade-'));
  const archivePath = path.join(tempDir, 'upgrade.tar.gz');
  const sourceDir = path.join(tempDir, 'payload');
  fs.mkdirSync(sourceDir, { recursive: true });
  try {
    for (const entry of entries) {
      const targetPath = path.join(sourceDir, entry.name);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data));
    }
    execFileSync('tar', ['-czf', archivePath, '-C', sourceDir, '.']);
    return fs.readFileSync(archivePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const regressionTestProjectPrefixes = ['提醒回归项目-', '时区提醒项目-', '布局隔离项目-', '视图范围回归项目-', '多项目回归项目-', 'P2回归项目-'];
// 监控类测试资产会参与每轮采集，失败中断后必须能自动清除，否则会拖慢后续回归。
const regressionTestAssetPrefixes = [
  '布局Ping-', '布局SNMP-', '布局他项-', '布局冲突', '布局排序', '布局未分配-', '布局非法U-', '布局缺起始U-',
  '监控回归资产-', '维护窗口资产-', '通知通道资产-', '生命周期资产-', '多项目兼任资产-',
  '并发测试资产A', '并发测试资产B', '视图范围资产', '无团体字-'
];

// 回归用例创建的项目不会自动消失，长期累积会撑爆登录时的项目下拉（pageSize=100）并让 e2e 偶发失败。
// 用例结束统一强制删除本轮项目及其关联数据，并清理中断运行时残留的测试周期任务。
async function cleanupRegressionArtifacts(cookie) {
  const projects = await request('/api/projects?all=1', { headers: { cookie } });
  const projectList = Array.isArray(projects.data?.data) ? projects.data.data : [];
  for (const project of projectList) {
    if (!regressionTestProjectPrefixes.some(prefix => String(project.name || '').startsWith(prefix))) continue;
    await request(`/api/projects/${project.id}?force=1`, { method: 'DELETE', headers: { cookie } });
  }
  const assets = await request('/api/assets?all=1', { headers: { cookie } });
  const assetList = Array.isArray(assets.data?.data) ? assets.data.data : [];
  for (const asset of assetList) {
    if (!regressionTestAssetPrefixes.some(prefix => String(asset.name || '').startsWith(prefix))) continue;
    await request(`/api/assets/${asset.id}`, { method: 'DELETE', headers: { cookie } });
  }
  const tasks = await request('/api/ai-inspection/tasks?all=1', { headers: { cookie } });
  const taskList = Array.isArray(tasks.data?.data) ? tasks.data.data : [];
  for (const task of taskList) {
    if (!String(task.title || '').startsWith('AI 周期巡检回归任务')) continue;
    await request(`/api/ai-inspection/tasks/${task.id}`, { method: 'DELETE', headers: { cookie } });
  }
}

async function main() {
  const health = await request('/api/health');
  assert(health.status === 200 && health.data.ok === true, '健康检查接口失败');
  const ready = await request('/api/ready');
  assert(ready.status === 200 && ready.data.ok === true, '就绪检查接口失败');
  const indexPage = await request('/');
  const cspHeader = indexPage.headers['content-security-policy'] || '';
  assert(indexPage.status === 200 && typeof indexPage.data === 'string', '首页加载失败');
  assert(/script-src 'self' 'nonce-[^']+'/.test(cspHeader), 'HTML 应使用 nonce 限制内联脚本');
  assert(!/script-src[^;]*'unsafe-inline'/.test(cspHeader), 'script-src 不应包含 unsafe-inline');
  assert(!/onclick=/.test(indexPage.data), '首页不应包含内联事件属性');
  const cspNonce = (cspHeader.match(/'nonce-([^']+)'/) || [])[1];
  assert(cspNonce && indexPage.data.includes(`nonce="${cspNonce}"`), 'HTML 内联脚本应携带匹配的 nonce');
  const captchaProbe = await request('/api/captcha');
  assert(captchaProbe.status === 200 && captchaProbe.data.token, '验证码接口失败');
  assert(captchaProbe.data.code === undefined, '验证码接口不应返回明文 code');
  assert(!String(captchaProbe.data.token || '').includes(':'), '验证码 token 不应编码明文');
  assert(!String(captchaProbe.data.svgMarkup || captchaProbe.data.svg || '').includes('<text'), '验证码 SVG 不应包含 text 节点');
  assert(captchaProbe.data.svgMarkup === undefined, '验证码接口不应返回 svgMarkup 原文');
  assert(decodeCaptchaFromSvg(captchaProbe.data).length === 4, '验证码 SVG 未能解析出 4 位字符');
  const certNotice = await request('/api/https-certificate/notice');
  assert(certNotice.status === 200 && certNotice.data.warningDays === 7, '证书到期提示接口异常');
  if (certNotice.data.notice) {
    assert(Boolean(certNotice.data.notice.validTo), '证书到期提示应包含到期时间');
  }
  const throttledHeaders = { 'x-forwarded-for': '198.51.100.10' };
  for (let index = 0; index < 5; index += 1) {
    const failedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
    assert(failedLogin.status === 401 || failedLogin.status === 429, '错误密码登录未返回预期状态');
  }
  const blockedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
  assert(blockedLogin.status === 429, '登录限流未生效');
  const persistentBlockedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
  assert(persistentBlockedLogin.status === 429, '登录限流持久化未生效');
  // 伪造成 X-Forwarded-For 首段不应重置限流桶，真实客户端取可信代理追加的最后一跳
  const spoofedForwardedLogin = await login('admin', 'wrong-password', { headers: { 'x-forwarded-for': '203.0.113.77, 198.51.100.10' } });
  assert(spoofedForwardedLogin.status === 429, '伪造 X-Forwarded-For 首段不应绕过登录限流');
  const admin = await login('admin', 'Admin123!');
  assert(admin.status === 200, '管理员登录失败');
  assert(admin.data.sessionToken === undefined, '登录响应不应返回 sessionToken');
  assert(Number(admin.data.systemConfig?.webIdleLogoutMinutes) >= 1, '登录响应未返回控制台超时配置');
  let cookie = admin.cookie;
  assert(String(admin.headers['set-cookie'] || '').includes('SameSite=Lax'), '登录 Cookie 应为 SameSite=Lax');
  // 先清掉上一次中断留下的监控测试资产，避免累积资产拖慢本轮采集。
  await cleanupRegressionArtifacts(cookie);

  // 动态令牌（TOTP）二次认证：绑定、挑战登录、恢复码、重新生成与关闭。
  const twoFactorUsername = `tf_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const twoFactorPassword = 'TotpRegress1!';
  const twoFactorUser = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: twoFactorUsername, password: twoFactorPassword, role: 'viewer', name: '动态令牌回归账号' })
  });
  assert(twoFactorUser.status === 201 && twoFactorUser.data.id, '创建动态令牌回归账号失败');
  const twoFactorUserId = twoFactorUser.data.id;
  try {
    const plainLogin = await login(twoFactorUsername, twoFactorPassword);
    assert(plainLogin.status === 200 && plainLogin.cookie, '动态令牌回归账号首次登录失败');
    const plainCookie = plainLogin.cookie;
    const initialStatus = await request('/api/account/2fa', { headers: { cookie: plainCookie } });
    assert(initialStatus.status === 200 && initialStatus.data.enabled === false, '新账号动态令牌应默认关闭');
    const setup = await request('/api/account/2fa/setup', {
      method: 'POST',
      headers: { cookie: plainCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: twoFactorPassword })
    });
    assert(setup.status === 200 && setup.data.secret && setup.data.otpauthUrl, '动态令牌绑定初始化失败');
    assert(!String(setup.data.otpauthUrl).includes('undefined'), '动态令牌二维码链接异常');
    const validCode = totpCode(setup.data.secret);
    const wrongCode = String((Number(validCode) + 1) % 1000000).padStart(6, '0');
    const wrongEnable = await request('/api/account/2fa/enable', {
      method: 'POST',
      headers: { cookie: plainCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: wrongCode })
    });
    assert(wrongEnable.status === 400, '错误动态码不应启用二次认证');
    const enable = await request('/api/account/2fa/enable', {
      method: 'POST',
      headers: { cookie: plainCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: validCode })
    });
    assert(enable.status === 200 && Array.isArray(enable.data.recoveryCodes) && enable.data.recoveryCodes.length === 10, '启用动态令牌失败');
    await request('/api/logout', { method: 'POST', headers: { cookie: plainCookie, 'Content-Type': 'application/json' }, body: '{}' });

    const challenge = await login(twoFactorUsername, twoFactorPassword);
    assert(challenge.status === 200 && challenge.data.twoFactorRequired === true, '启用二次认证后登录未返回动态码挑战');
    assert(!challenge.cookie, '仅凭密码不应建立会话');
    assert(challenge.data.user === undefined, '动态码挑战阶段不应返回用户信息');
    const badChallenge = await request('/api/login/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: challenge.data.challengeToken, code: wrongCode })
    });
    assert(badChallenge.status === 401, '错误动态码不应通过二次认证');
    const verified = await request('/api/login/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: challenge.data.challengeToken, code: validCode })
    });
    assert(verified.status === 200 && verified.data.user, '正确动态码二次认证失败');
    assert(verified.data.user.twoFactorSecret === undefined && verified.data.user.twoFactorRecoveryCodeHashes === undefined, '登录响应不应返回动态令牌密钥');
    const verifiedCookie = (verified.headers['set-cookie'] || '').split(';')[0];
    assert(Boolean(verifiedCookie), '二次认证成功未建立会话');
    csrfByCookie.set(verifiedCookie, verified.data.csrfToken);
    const enabledStatus = await request('/api/account/2fa', { headers: { cookie: verifiedCookie } });
    assert(enabledStatus.status === 200 && enabledStatus.data.enabled === true && enabledStatus.data.recoveryCodesRemaining === 10, '动态令牌启用状态异常');
    await request('/api/logout', { method: 'POST', headers: { cookie: verifiedCookie, 'Content-Type': 'application/json' }, body: '{}' });

    const recoveryChallenge = await login(twoFactorUsername, twoFactorPassword);
    assert(recoveryChallenge.status === 200 && recoveryChallenge.data.challengeToken, '恢复码登录未取得挑战');
    const recoveryLogin = await request('/api/login/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: recoveryChallenge.data.challengeToken, code: enable.data.recoveryCodes[0] })
    });
    assert(recoveryLogin.status === 200 && recoveryLogin.data.recoveryCodeUsed === true, '恢复码登录失败');
    const recoveryCookie = (recoveryLogin.headers['set-cookie'] || '').split(';')[0];
    csrfByCookie.set(recoveryCookie, recoveryLogin.data.csrfToken);
    const afterRecovery = await request('/api/account/2fa', { headers: { cookie: recoveryCookie } });
    assert(afterRecovery.data.recoveryCodesRemaining === 9, '恢复码使用后未失效');

    const regenerated = await request('/api/account/2fa/recovery-codes', {
      method: 'POST',
      headers: { cookie: recoveryCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: totpCode(setup.data.secret) })
    });
    assert(regenerated.status === 200 && regenerated.data.recoveryCodes.length === 10, '重新生成恢复码失败');
    const disabled = await request('/api/account/2fa/disable', {
      method: 'POST',
      headers: { cookie: recoveryCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: twoFactorPassword, code: totpCode(setup.data.secret) })
    });
    assert(disabled.status === 200, '关闭动态令牌失败');
    const disabledStatus = await request('/api/account/2fa', { headers: { cookie: recoveryCookie } });
    assert(disabledStatus.status === 200 && disabledStatus.data.enabled === false, '关闭动态令牌后状态未更新');
    await request('/api/logout', { method: 'POST', headers: { cookie: recoveryCookie, 'Content-Type': 'application/json' }, body: '{}' });
  } finally {
    await request(`/api/users/${twoFactorUserId}`, { method: 'DELETE', headers: { cookie } });
  }

  // 管理员强制启用动态令牌：未绑定前业务接口应被拦截，绑定后放行，重置后仍需重新绑定。
  const enforcedUsername = `tfe_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const enforcedPassword = 'TotpEnforced1!';
  const enforcedUser = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: enforcedUsername, password: enforcedPassword, role: 'viewer', name: '强制令牌回归账号', twoFactorEnforced: true })
  });
  assert(enforcedUser.status === 201 && enforcedUser.data.twoFactorEnforced === true, '创建强制启用动态令牌账号失败');
  const enforcedUserId = enforcedUser.data.id;
  try {
    const enforcedLogin = await login(enforcedUsername, enforcedPassword);
    assert(enforcedLogin.status === 200 && enforcedLogin.cookie, '强制令牌账号登录失败');
    const gated = await request('/api/projects', { headers: { cookie: enforcedLogin.cookie } });
    assert(gated.status === 403 && gated.data.code === 'two_factor_enrollment_required', '未绑定动态令牌时业务接口未被拦截');
    const enforcementStatus = await request('/api/account/2fa', { headers: { cookie: enforcedLogin.cookie } });
    assert(enforcementStatus.status === 200 && enforcementStatus.data.enforced === true, '未绑定期间应仍可读取二次认证状态');
    const enforcedSetup = await request('/api/account/2fa/setup', {
      method: 'POST',
      headers: { cookie: enforcedLogin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: enforcedPassword })
    });
    assert(enforcedSetup.status === 200 && enforcedSetup.data.secret, '未绑定期间应可发起动态令牌绑定');
    const enforcedEnable = await request('/api/account/2fa/enable', {
      method: 'POST',
      headers: { cookie: enforcedLogin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: totpCode(enforcedSetup.data.secret) })
    });
    assert(enforcedEnable.status === 200, '强制账号绑定动态令牌失败');
    const ungated = await request('/api/projects', { headers: { cookie: enforcedLogin.cookie } });
    assert(ungated.status === 200, '绑定动态令牌后业务接口仍被拦截');
    const enforcedDisable = await request('/api/account/2fa/disable', {
      method: 'POST',
      headers: { cookie: enforcedLogin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: enforcedPassword, code: totpCode(enforcedSetup.data.secret) })
    });
    assert(enforcedDisable.status === 400, '被强制启用的账号不应允许自行关闭动态令牌');
    const adminReset = await request(`/api/users/${enforcedUserId}/reset-2fa`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Admin123!' })
    });
    assert(adminReset.status === 200 && String(adminReset.data.message).includes('重新绑定'), '管理员重置动态令牌失败');
    const afterResetLogin = await login(enforcedUsername, enforcedPassword);
    assert(afterResetLogin.status === 200 && !afterResetLogin.data.twoFactorRequired, '重置后应可用密码直接登录');
    const stillGated = await request('/api/projects', { headers: { cookie: afterResetLogin.cookie } });
    assert(stillGated.status === 403, '重置后未重新绑定前仍应保持拦截');
    const clearEnforcement = await request(`/api/users/${enforcedUserId}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ twoFactorEnforced: false })
    });
    assert(clearEnforcement.status === 200, '取消强制启用动态令牌失败');
    const relaxed = await request('/api/projects', { headers: { cookie: afterResetLogin.cookie } });
    assert(relaxed.status === 200, '取消强制启用后业务接口未恢复');
  } finally {
    await request(`/api/users/${enforcedUserId}`, { method: 'DELETE', headers: { cookie } });
  }

  // 每轮回归用独立客户端 IP，避免反复运行累积触发忘记密码的进程内限流
  const forgotTestIp = `198.18.${(Date.now() % 200) + 1}.${Math.floor(Math.random() * 250) + 1}`;
  const forgotHeaders = { 'Content-Type': 'application/json', 'x-forwarded-for': forgotTestIp };
  // 重置密码必须先通过 verify 换取一次性票据，票据缺失时直接 400。
  const requestForgotTicket = async (username) => {
    const captcha = await request('/api/captcha');
    const verify = await request('/api/forgot-password/verify', {
      method: 'POST',
      headers: forgotHeaders,
      body: JSON.stringify({ username, captchaToken: captcha.data.token, captcha: decodeCaptchaFromSvg(captcha.data) })
    });
    return verify.data && verify.data.ticket;
  };
  const forgotMissingTicket = await requestForgotTicket('no-such-user');
  const forgotMissingCaptcha = await request('/api/captcha');
  const forgotMissing = await request('/api/forgot-password/reset', {
    method: 'POST',
    headers: forgotHeaders,
    body: JSON.stringify({ username: 'no-such-user', securityAnswer: 'x', newPassword: 'Newpass1!', ticket: forgotMissingTicket, captchaToken: forgotMissingCaptcha.data.token, captcha: decodeCaptchaFromSvg(forgotMissingCaptcha.data) })
  });
  const forgotWrongTicket = await requestForgotTicket('admin');
  const forgotWrongCaptcha = await request('/api/captcha');
  const forgotWrong = await request('/api/forgot-password/reset', {
    method: 'POST',
    headers: forgotHeaders,
    body: JSON.stringify({ username: 'admin', securityAnswer: 'wrong-answer', newPassword: 'Newpass1!', ticket: forgotWrongTicket, captchaToken: forgotWrongCaptcha.data.token, captcha: decodeCaptchaFromSvg(forgotWrongCaptcha.data) })
  });
  assert(forgotMissing.status === 200 && forgotWrong.status === 200, '忘记密码失败应返回 200');
  assert(forgotMissing.data.reset !== true && forgotWrong.data.reset !== true, '忘记密码失败不应标记 reset');
  assert(forgotMissing.data.message === forgotWrong.data.message, '忘记密码失败响应应一致');
  const forgotResetNoCaptcha = await request('/api/forgot-password/reset', {
    method: 'POST',
    headers: forgotHeaders,
    body: JSON.stringify({ username: 'admin', securityAnswer: 'wrong-answer', newPassword: 'Newpass1!' })
  });
  assert(forgotResetNoCaptcha.status === 401, '忘记密码重置缺少验证码应被拒绝');
  const forgotResetNoTicketCaptcha = await request('/api/captcha');
  const forgotResetNoTicket = await request('/api/forgot-password/reset', {
    method: 'POST',
    headers: forgotHeaders,
    body: JSON.stringify({ username: 'admin', securityAnswer: 'wrong-answer', newPassword: 'Newpass1!', captchaToken: forgotResetNoTicketCaptcha.data.token, captcha: decodeCaptchaFromSvg(forgotResetNoTicketCaptcha.data) })
  });
  assert(forgotResetNoTicket.status === 400, '忘记密码重置缺少票据应返回 400');
  const forgotVerifyMissingCaptcha = await request('/api/captcha');
  const forgotVerifyMissing = await request('/api/forgot-password/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': forgotTestIp },
    body: JSON.stringify({ username: 'no-such-user', captchaToken: forgotVerifyMissingCaptcha.data.token, captcha: decodeCaptchaFromSvg(forgotVerifyMissingCaptcha.data) })
  });
  const forgotVerifyExistingCaptcha = await request('/api/captcha');
  const forgotVerifyExisting = await request('/api/forgot-password/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': forgotTestIp },
    body: JSON.stringify({ username: 'admin', captchaToken: forgotVerifyExistingCaptcha.data.token, captcha: decodeCaptchaFromSvg(forgotVerifyExistingCaptcha.data) })
  });
  assert(forgotVerifyMissing.status === 200 && forgotVerifyExisting.status === 200, '忘记密码验证应返回 200');
  assert(Boolean(forgotVerifyMissing.data.ticket) && Boolean(forgotVerifyExisting.data.ticket), '忘记密码验证应签发票据');
  assert(forgotVerifyMissing.data.question === forgotVerifyExisting.data.question, '忘记密码验证响应应一致');
  const forgotVerifyNoCaptcha = await request('/api/forgot-password/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': forgotTestIp },
    body: JSON.stringify({ username: 'admin' })
  });
  assert(forgotVerifyNoCaptcha.status === 401, '忘记密码验证缺少验证码应被拒绝');
  const exported = await request('/api/system/export', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Admin123!' })
  });
  assert(exported.status === 200, '导出当前数据失败');
  const snapshot = exported.data;
  // 导出需包含可恢复凭据，保证在其它环境导入后账号可登录、监控凭据可用。
  assert((snapshot.users || []).length > 0 && (snapshot.users || []).every(item => Boolean(item.passwordHash)), '系统导出应包含密码哈希');
  assert((snapshot.users || []).every(item => Object.prototype.hasOwnProperty.call(item, 'securityAnswerHash')), '系统导出应包含安全问题哈希字段');
  assert(Array.isArray(snapshot.assets) && Array.isArray(snapshot.documents), '系统导出应包含资产与资料集合');
  const projects = await request('/api/projects', { headers: { cookie } });
  const users = await request('/api/users', { headers: { cookie } });
  const assets = await request('/api/assets', { headers: { cookie } });
  assert(assets.status === 200 && Array.isArray(assets.data.data), '查询资产列表失败');
  assert(assets.data.data.every(item => item.snmpCommunity === undefined), '资产列表不应返回 snmpCommunity');
  const topology = await request('/api/assets/topology', { headers: { cookie } });
  assert(topology.status === 200 && Array.isArray(topology.data.assets), '查询资产拓扑失败');
  assert(topology.data.assets.every(item => item.snmpCommunity === undefined), '资产拓扑不应返回 snmpCommunity');
  const topologyProjectId = (snapshot.projects || [])[0]?.id;
  if (topologyProjectId) {
    const filteredTopology = await request(`/api/assets/topology?projectId=${encodeURIComponent(topologyProjectId)}`, { headers: { cookie } });
    assert(filteredTopology.status === 200, '按项目查询资产拓扑失败');
    assert(filteredTopology.data.assets.every(item => item.projectId === topologyProjectId), '资产拓扑项目筛选未生效');
    assert(filteredTopology.data.assets.length <= topology.data.assets.length, '资产拓扑项目筛选结果不应超过全部资产');
  }
  const pagedProjects = await request('/api/projects?pageSize=1', { headers: { cookie } });
  assert(Array.isArray(pagedProjects.data.data) && pagedProjects.data.data.length === 1, '分页 pageSize=1 应只返回 1 条');
  const allProjects = await request('/api/projects?all=1', { headers: { cookie } });
  assert(Array.isArray(allProjects.data.data), 'all=1 应返回项目数组');
  assert(Number(allProjects.data.total) >= Number(pagedProjects.data.total || 0), 'all=1 返回数量应覆盖分页 total');
  assert(allProjects.data.data.length === Number(allProjects.data.total), 'all=1 应返回全部项目');
  assert(allProjects.data.totalPages === 1, 'all=1 的 totalPages 应为 1');
  const backupResult = await request('/api/system/backup', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'Admin123!' }) });
  assert(backupResult.status === 200, '创建系统备份失败');
  assert(String(backupResult.data.filename || '').startsWith('backup-'), '系统备份文件名不符合预期');
  const backupGetDenied = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}`, { headers: { cookie } });
  assert(backupGetDenied.status !== 200, '系统备份下载不应允许 GET');
  const systemBackupDownload = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Admin123!' })
  });
  assert(systemBackupDownload.status === 200, 'POST 下载系统备份失败');
  assert((systemBackupDownload.data.users || []).every(item => Boolean(item.passwordHash)), '备份下载应包含可恢复的 passwordHash');
  const systemBackupDownloadNoPassword = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(systemBackupDownloadNoPassword.status === 401, '系统备份下载缺少管理员密码应被拒绝');
  const systemExportNoPassword = await request('/api/system/export', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(systemExportNoPassword.status === 401, '系统导出缺少管理员密码应被拒绝');
  const systemBackupNoPassword = await request('/api/system/backup', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(systemBackupNoPassword.status === 401, '创建系统备份缺少管理员密码应被拒绝');
  const systemInfo = await request('/api/system/info', { headers: { cookie } });
  assert(systemInfo.status === 200, '查询系统信息失败');
  assert(Number(systemInfo.data.systemConfig?.webIdleLogoutMinutes) >= 1, '系统信息未返回控制台超时配置');
  const settingsResult = await updateSystemSettings(cookie, {
    webIdleLogoutMinutes: 45,
    httpsLoginEnabled: false,
    httpsPort: 3443,
    dailyReportReminderHour: 11,
    weeklyReportReminderDays: 5,
    monthlyReportReminderDays: 10,
    dailyLowHoursThreshold: 1.5,
    dailyHighHoursThreshold: 10.5,
    noLogStreakDays: 4,
    projectInactiveDays: 9
  });
  assert(settingsResult.status === 200, '保存控制台超时设置失败');
  assert(Number(settingsResult.data.systemConfig?.webIdleLogoutMinutes) === 45, '控制台超时设置保存结果不正确');
  assert(settingsResult.data.systemConfig?.httpsLoginEnabled === false, 'HTTPS 登录默认设置保存失败');
  assert(Number(settingsResult.data.systemConfig?.dailyReportReminderHour) === 11, '日报提醒时间保存结果不正确');
  assert(Number(settingsResult.data.systemConfig?.weeklyReportReminderDays) === 5, '周报提醒天数保存结果不正确');
  assert(Number(settingsResult.data.systemConfig?.monthlyReportReminderDays) === 10, '月报提醒天数保存结果不正确');
  assert(Number(settingsResult.data.systemConfig?.dailyLowHoursThreshold) === 1.5, '低工时阈值保存结果不正确');
  assert(Number(settingsResult.data.systemConfig?.dailyHighHoursThreshold) === 10.5, '高工时阈值保存结果不正确');
  assert(Number(settingsResult.data.systemConfig?.noLogStreakDays) === 4, '连续无记录阈值保存结果不正确');
  assert(Number(settingsResult.data.systemConfig?.projectInactiveDays) === 9, '项目无人填报阈值保存结果不正确');
  const secureLoginBeforeHttps = await login('admin', 'Admin123!', { headers: { 'x-forwarded-proto': 'https' } });
  assert(String(secureLoginBeforeHttps.headers['set-cookie'] || '').includes('Secure'), 'HTTPS 反代请求应派发 Secure Cookie');
  const adminReauth = await login('admin', 'Admin123!');
  cookie = adminReauth.cookie;
  const httpsUploadForm = new FormData();
  httpsUploadForm.append('cert', new Blob([httpsTestCert], { type: 'application/x-pem-file' }), 'https-test-cert.pem');
  httpsUploadForm.append('key', new Blob([httpsTestKey], { type: 'application/x-pem-file' }), 'https-test-key.pem');
  httpsUploadForm.append('password', 'Admin123!');
  const httpsUpload = await fetch(base + '/api/system/https/certificate', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: httpsUploadForm });
  const httpsUploadData = await httpsUpload.json();
  assert(httpsUpload.status === 200, '上传 HTTPS 证书失败');
  assert(String(httpsUploadData.systemConfig?.httpsCertFilename || '').includes('https-test-cert.pem'), 'HTTPS 证书文件名未保存');
  assert(String(httpsUploadData.systemConfig?.httpsCertSubject || '').includes('CN=127.0.0.1'), 'HTTPS 证书主题未保存');
  assert(typeof httpsUploadData.systemConfig?.httpsCertFingerprint256 === 'string' && httpsUploadData.systemConfig.httpsCertFingerprint256.length > 10, 'HTTPS 证书指纹未保存');
  const httpsPortCandidates = [3443, 3444, 3445, 3446, 3447, 3448, 3449, 3450];
  let httpsSettings = null;
  let httpsPort = 0;
  for (const candidate of httpsPortCandidates) {
    const response = await updateSystemSettings(cookie, { httpsLoginEnabled: true, httpsPort: candidate, webIdleLogoutMinutes: 45 });
    if (response.status === 200 && response.data.systemConfig?.httpsLoginEnabled === true) {
      httpsSettings = response;
      httpsPort = candidate;
      break;
    }
  }
  assert(httpsSettings && httpsPort, '启用 HTTPS 登录失败');
  assert(Number(httpsSettings.data.systemConfig?.httpsPort) === httpsPort, 'HTTPS 端口保存结果不正确');
  const secureLoginAfterEnabled = await login('admin', 'Admin123!', { headers: { 'x-forwarded-proto': 'https' } });
  assert(String(secureLoginAfterEnabled.headers['set-cookie'] || '').includes('Secure'), '启用 HTTPS 登录后未下发 Secure Cookie');
  cookie = (await login('admin', 'Admin123!')).cookie;
  const httpsServices = await request('/api/system/services', { headers: { cookie } });
  const httpsService = Array.isArray(httpsServices.data) ? httpsServices.data.find(item => item.key === 'https-login') : null;
  assert(httpsServices.status === 200 && httpsService, 'HTTPS 服务状态未返回');
  assert(httpsService.status === 'running', 'HTTPS 服务未启动');
  const httpsHealth = await requestHttps('/api/health', httpsPort);
  assert(httpsHealth.status === 200 && httpsHealth.data.ok === true, 'HTTPS 健康检查失败');
  const auditAfterSettings = await request('/api/audit-logs?all=1', { headers: { cookie } });
  assert(auditAfterSettings.status === 200, '查询系统设置操作日志失败');
   assert(hasAuditLog(auditAfterSettings.data.data, 'update', '更新系统设置'), '更新系统设置未写入操作日志');
   assert(hasAuditLog(auditAfterSettings.data.data, 'upload', '上传 HTTPS 登录证书'), '上传 HTTPS 证书未写入操作日志');
  const auditAfterBackup = await request('/api/audit-logs?all=1', { headers: { cookie } });
  assert(auditAfterBackup.status === 200, '查询操作日志失败');
   assert(hasAuditLog(auditAfterBackup.data.data, 'export', '导出系统数据'), '导出系统数据未写入操作日志');
   assert(hasAuditLog(auditAfterBackup.data.data, 'backup', '创建系统备份'), '创建系统备份未写入操作日志');
  const invalidUpgradeForm = new FormData();
  const invalidManifest = JSON.stringify({
    version: '1.0.1',
    files: ['package.json', 'server.js', 'public/version.txt'],
    sha256: {
      'package.json': sha256(JSON.stringify({ name: 'onsite-ops-system', version: '1.0.1' })),
      'server.js': sha256('module.exports = "upgrade";\n'),
      'public/version.txt': sha256('wrong-content')
    }
  }, null, 2);
  const invalidArchive = createTarGz([
    { name: 'manifest.json', data: invalidManifest },
    { name: 'package.json', data: JSON.stringify({ name: 'onsite-ops-system', version: '1.0.1' }) },
    { name: 'server.js', data: 'module.exports = "upgrade";\n' },
    { name: 'public/version.txt', data: 'upgrade-content' }
  ]);
  invalidUpgradeForm.append('package', new Blob([invalidArchive], { type: 'application/gzip' }), 'invalid-upgrade.tar.gz');
  const missingUpgradePassword = await fetch(base + '/api/system/upgrade', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: invalidUpgradeForm });
  const missingUpgradePasswordData = await missingUpgradePassword.json();
  assert(missingUpgradePassword.status === 401 && /管理员密码/.test(String(missingUpgradePasswordData.message || '')), '升级缺少管理员密码时应拒绝');
  const signedInvalidUpgradeForm = new FormData();
  signedInvalidUpgradeForm.append('package', new Blob([invalidArchive], { type: 'application/gzip' }), 'invalid-upgrade.tar.gz');
  signedInvalidUpgradeForm.append('password', 'Admin123!');
  const invalidUpgrade = await fetch(base + '/api/system/upgrade', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: signedInvalidUpgradeForm });
  const invalidUpgradeData = await invalidUpgrade.json();
  assert(invalidUpgrade.status === 400 && /签名|SHA256/.test(String(invalidUpgradeData.message || '')), `升级包完整性校验未生效: ${invalidUpgrade.status} ${String(invalidUpgradeData.message || '')}`);
  const upgradeLogsAfterInvalid = await request('/api/system/upgrade/logs', { headers: { cookie } });
  assert(upgradeLogsAfterInvalid.status === 200 && Array.isArray(upgradeLogsAfterInvalid.data.data), '升级日志接口失败');
  assert(upgradeLogsAfterInvalid.data.data.some(item => item.status === 'failed' && /签名|SHA256/.test(String(item.message || ''))), '失败升级未写入升级日志');
  const projectId = projects.data.data[0]?.id || '';
  const assetId = assets.data.data.find(item => item.projectId === projectId)?.id || '';
  const approverId = users.data.data.find(item => item.role === 'admin')?.id || '';
  const engineerAccount = users.data.data.find(item => item.role === 'engineer' && item.projectId === projectId);
  const changeApproverId = engineerAccount?.id || '';
  const customerId = users.data.data.find(item => item.role === 'customer' && item.projectId === projectId)?.id || '';
  assert(engineerAccount?.username, '未找到可用的工程师测试账号');

  // 导入/重启都会经过 normalizeDb，动态令牌字段若被白名单丢弃，已启用二步验证的账号会被静默关闭。
  const twoFactorSnapshotUser = (snapshot.users || []).find(item => item.role === 'customer')
    || (snapshot.users || []).find(item => item.username !== 'admin');
  assert(twoFactorSnapshotUser?.id, '导入快照缺少可验证动态令牌保留的用户');
  Object.assign(twoFactorSnapshotUser, {
    twoFactorEnabled: true,
    twoFactorEnabledAt: '2026-01-02T03:04:05.000Z',
    twoFactorEnforced: true,
    twoFactorSecret: 'regression-totp-secret-cipher',
    twoFactorRecoveryCodeHashes: ['regression-recovery-hash-1', 'regression-recovery-hash-2']
  });
  // LDAP 账号的本地口令只是占位值，绑定动态令牌时必须回到 LDAP 校验域口令。
  // 未配置 LDAP 时任何口令都应被拒绝，避免退化成「无需复核即可绑定」。
  const ldapRegressionUsername = `ldap_regression_${Date.now()}`;
  const ldapRegressionPassword = 'LdapVerify1!';
  const ldapRegressionUserId = `user_ldap_${Date.now()}`;
  snapshot.users.push({
    id: ldapRegressionUserId,
    username: ldapRegressionUsername,
    passwordHash: scryptHash(ldapRegressionPassword),
    role: 'viewer',
    name: 'LDAP 复核回归账号',
    projectId,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z'
  });

  const importDenied = await request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildImportSnapshot(snapshot))
  });
  assert(importDenied.status === 401, '导入缺少管理员密码时应拒绝');
  const importResult = await request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...buildImportSnapshot(snapshot), password: 'Admin123!' })
  });
  assert(importResult.status === 200, `导入接口失败: ${importResult.status} ${JSON.stringify(importResult.data)}`);
  assert(String(importResult.data.message || '').includes('当前登录状态已保留'), '导入成功消息未包含会话保留提示');
  const auditAfterImport = await request('/api/audit-logs?all=1', { headers: { cookie } });
  assert(auditAfterImport.status === 200, '导入后查询操作日志失败');
  assert(hasAuditLog(auditAfterImport.data.data, 'import', '导入系统数据'), '导入系统数据未写入操作日志');
  const sessionAfterImport = await request('/api/session', { headers: { cookie } });
  assert(sessionAfterImport.status === 200 && sessionAfterImport.data.user?.username === 'admin', '导入后当前会话未保留');
  const usersAfterImport = await request('/api/users?all=1', { headers: { cookie } });
  const twoFactorUserAfterImport = (usersAfterImport.data.data || []).find(item => item.id === twoFactorSnapshotUser.id);
  assert(twoFactorUserAfterImport, '导入后未找到动态令牌测试用户');
  assert(twoFactorUserAfterImport.twoFactorEnabled === true, '导入后动态令牌启用状态丢失');
  assert(twoFactorUserAfterImport.twoFactorEnforced === true, '导入后强制启用动态令牌设置丢失');
  assert(twoFactorUserAfterImport.twoFactorEnabledAt === '2026-01-02T03:04:05.000Z', '导入后动态令牌启用时间丢失');
  assert(!Object.prototype.hasOwnProperty.call(twoFactorUserAfterImport, 'twoFactorSecret'), '人员列表不应返回动态令牌密钥');
  assert(!Object.prototype.hasOwnProperty.call(twoFactorUserAfterImport, 'twoFactorRecoveryCodeHashes'), '人员列表不应返回恢复码哈希');

  const ldapLogin = await login(ldapRegressionUsername, ldapRegressionPassword);
  assert(ldapLogin.status === 200 && ldapLogin.cookie, 'LDAP 回归账号本地登录失败');
  const ldapSetup = await request('/api/account/2fa/setup', {
    method: 'POST',
    headers: { cookie: ldapLogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ldapRegressionPassword })
  });
  assert(ldapSetup.status === 401, `LDAP 账号绑定动态令牌应校验域口令，实际返回 ${ldapSetup.status}`);
  const ldapPendingStatus = await request('/api/account/2fa', { headers: { cookie: ldapLogin.cookie } });
  assert(ldapPendingStatus.status === 200 && ldapPendingStatus.data.pending === false, 'LDAP 复核失败后不应留下待绑定密钥');
  await request('/api/logout', { method: 'POST', headers: { cookie: ldapLogin.cookie, 'Content-Type': 'application/json' }, body: '{}' });
  await request(`/api/users/${ldapRegressionUserId}`, { method: 'DELETE', headers: { cookie } });

  const engineer = await login(engineerAccount.username, 'Engineer123!');
  assert(engineer.status === 200, '工程师登录失败');
  const engineerCookie = engineer.cookie;
  assert(engineer.data.systemConfig?.httpsCertFingerprint256 === undefined, '工程师登录响应不应返回证书指纹');
  const engineerSession = await request('/api/session', { headers: { cookie: engineerCookie } });
  assert(engineerSession.status === 200, '工程师会话校验失败');
  assert(engineerSession.data.systemConfig?.httpsCertFingerprint256 === undefined, '工程师会话不应返回完整系统配置');
  assert(Number(engineerSession.data.systemConfig?.webIdleLogoutMinutes) >= 1, '工程师会话应返回超时配置');
  // 非管理员请求 all=1 只能拿到分页结果；全量返回保留给管理员。
  const engineerUnpaged = await request('/api/projects?all=1', { headers: { cookie: engineerCookie } });
  assert(engineerUnpaged.status === 200, '工程师读取项目列表失败');
  assert(engineerUnpaged.data.all !== true && Number(engineerUnpaged.data.pageSize) <= 100, '非管理员 all=1 应退回分页');
  const adminUnpaged = await request('/api/projects?all=1', { headers: { cookie } });
  assert(adminUnpaged.data.all === true, '管理员 all=1 应返回全量数据');
  // 审计员只能看到本项目审计日志，无项目归属与其他项目记录均不可见。
  const auditorUsername = `auditor_${Date.now()}`;
  const createAuditor = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: auditorUsername, password: 'Auditor123!', role: 'auditor', name: '审计回归账号', projectId })
  });
  assert(createAuditor.status === 201, '创建审计员账号失败');
  const auditorLogin = await login(auditorUsername, 'Auditor123!');
  assert(auditorLogin.status === 200, '审计员登录失败');
  const auditorLogs = await request('/api/audit-logs?pageSize=100&sortBy=createdAt&sortDirection=desc', { headers: { cookie: auditorLogin.cookie } });
  assert(auditorLogs.status === 200, '审计员读取审计日志失败');
  const auditorRows = auditorLogs.data.data || [];
  assert(auditorRows.length > 0, '审计员应能看到本项目审计日志');
  assert(auditorRows.every(item => item.projectId === projectId), '审计员仅能看到本项目审计日志');
  const adminLogsForScope = await request('/api/audit-logs?all=1', { headers: { cookie } });
  const foreignAuditEntry = (adminLogsForScope.data.data || []).find(item => item.projectId !== projectId);
  if (foreignAuditEntry) {
    assert(!auditorRows.some(item => item.id === foreignAuditEntry.id), '审计员不应看到其他项目审计日志');
  }
  const auditorUnpaged = await request('/api/audit-logs?all=1', { headers: { cookie: auditorLogin.cookie } });
  assert(auditorUnpaged.data.all !== true, '审计员 all=1 应退回分页');
  const engineerAudit = await request('/api/audit-logs?all=1', { headers: { cookie: engineerCookie } });
  assert(engineerAudit.status === 403, '工程师不应读取审计日志');
  const engineerUpgradeLogs = await request('/api/system/upgrade/logs', { headers: { cookie: engineerCookie } });
  assert(engineerUpgradeLogs.status === 403, '工程师不应读取升级日志');
  const engineerWorkReports = await request(`/api/work-reports?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(engineerAccount.id)}`, { headers: { cookie } });
  assert(engineerWorkReports.status === 200, '查询工程师工作汇报失败');
  const existingEngineerReports = engineerWorkReports.data.data || [];
  const logDictionaries = await request('/api/logs/dictionaries', { headers: { cookie: engineerCookie } });
  assert(logDictionaries.status === 200, '查询日志标准字典失败');
  assert(Array.isArray(logDictionaries.data.ticketTypes) && logDictionaries.data.ticketTypes.includes('事务工作'), '日志工单类型字典不正确');
  assert(Array.isArray(logDictionaries.data.results) && logDictionaries.data.results.includes('已完成'), '日志结果字典不正确');
  const existingLogsResponse = await request(`/api/logs?projectId=${encodeURIComponent(projectId)}`, { headers: { cookie } });
  assert(existingLogsResponse.status === 200, '查询工程师历史日志失败');
  const existingEngineerLogDates = new Set((existingLogsResponse.data.data || [])
    .filter(item => item.projectId === projectId && item.userId === engineerAccount.id)
    .map(item => String(item.date || '').slice(0, 10)));
  const latestExistingRangeEnd = existingEngineerReports.reduce((max, item) => {
    const candidate = String(item.rangeEnd || item.rangeStart || '');
    return candidate > max ? candidate : max;
  }, '2099-12-31');
  let reportDate = getNextMonthMidDate(latestExistingRangeEnd);
  while (
    existingEngineerReports.some(item => String(item.reportType) === 'daily' && String(item.rangeStart) === reportDate)
    || existingEngineerLogDates.has(reportDate)
    || existingEngineerLogDates.has(addDaysToDateKey(reportDate, -1))
  ) {
    reportDate = addDaysToDateKey(reportDate, 1);
  }
  while (
    getWeekRangeStart(reportDate) !== getWeekRangeStart(addDaysToDateKey(reportDate, 1))
    || existingEngineerReports.some(item => String(item.reportType) === 'weekly' && String(item.rangeStart) === getWeekRangeStart(reportDate))
  ) {
    reportDate = addDaysToDateKey(reportDate, 1);
    while (
      existingEngineerReports.some(item => String(item.reportType) === 'daily' && String(item.rangeStart) === reportDate)
      || existingEngineerLogDates.has(reportDate)
      || existingEngineerLogDates.has(addDaysToDateKey(reportDate, -1))
    ) {
      reportDate = addDaysToDateKey(reportDate, 1);
    }
  }
  const previousDayReportDate = addDaysToDateKey(reportDate, -1);
  let previousMonthReportDate = addMonthsToDateKey(reportDate, -1);
  const previousMonthPrefix = previousMonthReportDate.slice(0, 7);
  while (
    previousMonthReportDate.slice(0, 7) === previousMonthPrefix
    && (
      existingEngineerReports.some(item => String(item.reportType) === 'daily' && String(item.rangeStart) === previousMonthReportDate)
      || existingEngineerLogDates.has(previousMonthReportDate)
    )
  ) {
    previousMonthReportDate = addDaysToDateKey(previousMonthReportDate, -1);
  }
  assert(previousMonthReportDate.slice(0, 7) === previousMonthPrefix, '未找到可用的上月日报日期');
  const engineerLog = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      assetId,
      date: reportDate,
      ticketType: '事务工作',
      event: '工作汇报回归日志',
      relatedTarget: '核心交换机',
      result: '已完成',
      process: '执行工作汇报回归检查',
      conclusion: '检查完成',
      durationHours: 2.5
    })
  });
  assert(engineerLog.status === 201, '工程师创建回归日志失败');
  const previousDayLog = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      assetId,
      date: previousDayReportDate,
      ticketType: '事务工作',
      event: '上一周期工作量回归日志',
      relatedTarget: '核心交换机',
      result: '已完成',
      process: '执行上一周期回归检查',
      conclusion: '检查完成',
      durationHours: 1
    })
  });
  assert(previousDayLog.status === 201, '工程师创建上一周期日志失败');
  const previousMonthLog = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      assetId,
      date: previousMonthReportDate,
      ticketType: '事务工作',
      event: '上月工作汇报回归日志',
      relatedTarget: '核心交换机',
      result: '已完成',
      process: '执行上月回归检查',
      conclusion: '检查完成',
      durationHours: 1.25
    })
  });
  assert(previousMonthLog.status === 201, '工程师创建上月日志失败');
  const invalidLog = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      assetId,
      date: `${reportDate}T23:30`,
      ticketType: '事务工作',
      event: '超长工时校验',
      relatedTarget: '核心交换机',
      result: '已完成',
      process: '执行超长工时校验',
      conclusion: '应被拦截',
      durationHours: 25
    })
  });
  assert(invalidLog.status === 400, '日志工时上限校验未生效');
  const logQualityCheck = await request('/api/logs/quality-check', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      assetId,
      date: reportDate,
      ticketType: '事务工作',
      event: '工作汇报回归日志',
      relatedTarget: '核心交换机',
      result: '已完成',
      process: '执行工作汇报回归检查',
      conclusion: '检查完成',
      durationHours: 2.5
    })
  });
  assert(logQualityCheck.status === 200, '日志质量检查接口失败');
  assert(Array.isArray(logQualityCheck.data.warnings) && logQualityCheck.data.warnings.length >= 1, '日志质量检查未返回重复或重叠提醒');
  // 现场取证附件：只接受图片 dataURL，保留拍摄时间与定位元数据，并限制张数。
  const sampleImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const logWithAttachment = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      assetId,
      date: reportDate,
      ticketType: '事务工作',
      event: '现场取证附件回归日志',
      result: '已完成',
      process: '上传现场取证图片',
      conclusion: '附件入库成功',
      durationHours: 0.5,
      attachments: [{
        name: '现场取证.png',
        mimeType: 'image/png',
        dataUrl: sampleImageDataUrl,
        capturedAt: '2026-06-20T10:00:00.000Z',
        location: { latitude: 31.2304, longitude: 121.4737, address: '31.230400, 121.473700' },
        watermark: '拍摄时间：2026-06-20 10:00 ｜ 拍摄地点：31.230400, 121.473700'
      }]
    })
  });
  assert(logWithAttachment.status === 201, `创建带现场取证附件的日志失败: ${JSON.stringify(logWithAttachment.data)}`);
  const savedAttachment = (logWithAttachment.data.attachments || [])[0];
  assert(savedAttachment && savedAttachment.dataUrl === sampleImageDataUrl, '日志附件未正确保存');
  assert(savedAttachment.capturedAt === '2026-06-20T10:00:00.000Z' && savedAttachment.location?.latitude === 31.2304, '日志附件元数据丢失');
  const invalidAttachmentType = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId, assetId, date: reportDate, ticketType: '事务工作', event: '非法附件类型校验',
      result: '已完成', process: '校验非法附件', conclusion: '应被拦截', durationHours: 1,
      attachments: [{ name: 'payload.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' }]
    })
  });
  assert(invalidAttachmentType.status === 400, '非图片附件应返回 400');
  const tooManyAttachments = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId, assetId, date: reportDate, ticketType: '事务工作', event: '附件数量校验',
      result: '已完成', process: '校验附件张数', conclusion: '应被拦截', durationHours: 1,
      attachments: Array.from({ length: 7 }, (_, index) => ({ name: `取证-${index}.png`, dataUrl: sampleImageDataUrl }))
    })
  });
  assert(tooManyAttachments.status === 400, '超过 6 张现场取证附件应返回 400');
  const deleteAttachmentLog = await request(`/api/logs/${logWithAttachment.data.id}`, { method: 'DELETE', headers: { cookie: engineerCookie } });
  assert(deleteAttachmentLog.status === 200, '清理现场取证回归日志失败');
  const previousMonthWorkReport = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: previousMonthReportDate,
      summary: '上月日报回归基线',
      completedWork: '完成上月基线汇报',
      pendingWork: '无',
      risks: '无',
      nextPlan: '进入本月回归'
    })
  });
  assert(previousMonthWorkReport.status === 200, '创建上月工作汇报失败');
  const createWorkReport = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: reportDate,
      summary: '工作汇报主链路回归测试',
      completedWork: '完成日报录入与指标校验',
      pendingWork: '等待管理员确认并锁定',
      risks: '无',
      nextPlan: '继续执行后续回归'
    })
  });
  assert(createWorkReport.status === 200, '创建工作汇报失败');
  assert(createWorkReport.data.data?.status === 'draft', '新建工作汇报默认状态不正确');
  assert(createWorkReport.data.data?.metricsSnapshot?.logCount === 1, '工作汇报日志快照数量不正确');
  assert(Number(createWorkReport.data.data?.metricsSnapshot?.totalHours) === 2.5, '工作汇报工时快照不正确');
  const reportId = createWorkReport.data.data.id;
  const bogusProjectReport = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportType: 'daily', anchorDate: reportDate, projectId: 'project_not_exists', summary: '非法项目' })
  });
  assert(bogusProjectReport.status === 400, '工作汇报不应绑定不存在的项目');
  const partialUpdateWorkReport = await request(`/api/work-reports/${reportId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: '工作汇报主链路回归测试-部分保存' })
  });
  assert(partialUpdateWorkReport.status === 200, '草稿部分字段保存失败');
  assert(partialUpdateWorkReport.data.data?.summary === '工作汇报主链路回归测试-部分保存', '部分保存后总结未更新');
  assert(partialUpdateWorkReport.data.data?.completedWork === '完成日报录入与指标校验', '部分保存清空了已完成事项');
  const periodEditDate = '2098-06-17';
  const periodEditReport = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: periodEditDate,
      summary: '周期修改回归',
      completedWork: '准备改为周报',
      pendingWork: '待改周期',
      risks: '无',
      nextPlan: '改为周报后保存'
    })
  });
  assert(periodEditReport.status === 200, '创建周期修改用日报失败');
  const periodEditId = periodEditReport.data.data.id;
  const updatePeriodWorkReport = await request(`/api/work-reports/${periodEditId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'weekly',
      anchorDate: periodEditDate,
      summary: '周期修改回归-已改为周报',
      completedWork: '已改为周报',
      pendingWork: '无',
      risks: '无',
      nextPlan: '保持草稿'
    })
  });
  assert(updatePeriodWorkReport.status === 200, '草稿修改汇报周期失败');
  assert(updatePeriodWorkReport.data.data?.reportType === 'weekly', '修改后汇报类型不正确');
  assert(updatePeriodWorkReport.data.data?.rangeStart === getWeekRangeStart(periodEditDate), '修改后周报周期起点不正确');
  const mergeDateA = '2098-07-01';
  const mergeDateB = '2098-07-02';
  const mergeReportA = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: mergeDateA,
      summary: '合并源草稿',
      completedWork: '源已完成',
      pendingWork: '源未完成',
      risks: '无',
      nextPlan: '合并到目标周期'
    })
  });
  assert(mergeReportA.status === 200, '创建合并源草稿失败');
  const mergeReportB = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: mergeDateB,
      summary: '合并目标草稿',
      completedWork: '目标已完成',
      pendingWork: '目标未完成',
      risks: '无',
      nextPlan: '等待合并'
    })
  });
  assert(mergeReportB.status === 200, '创建合并目标草稿失败');
  const mergeSourceId = mergeReportA.data.data.id;
  const mergeTargetId = mergeReportB.data.data.id;
  const mergeWorkReport = await request(`/api/work-reports/${mergeSourceId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: mergeDateB,
      summary: '已合并到目标周期'
    })
  });
  assert(mergeWorkReport.status === 200, '草稿改到已有周期应合并成功');
  assert(mergeWorkReport.data.data?.id === mergeTargetId, '合并后未返回目标周期草稿');
  assert(mergeWorkReport.data.data?.summary === '已合并到目标周期', '合并后总结未更新到目标草稿');
  const mergedList = await request('/api/work-reports?reportType=daily', { headers: { cookie: engineerCookie } });
  const mergedRows = Array.isArray(mergedList.data.data) ? mergedList.data.data : [];
  assert(!mergedRows.some(item => item.id === mergeSourceId), '合并后源草稿仍存在');
  assert(mergedRows.some(item => item.id === mergeTargetId && item.summary === '已合并到目标周期'), '合并后目标草稿未保留');
  const deleteDraftReport = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: '2098-08-15',
      summary: '待删除草稿',
      completedWork: '删除验证',
      pendingWork: '无',
      risks: '无',
      nextPlan: '删除'
    })
  });
  assert(deleteDraftReport.status === 200, '创建待删除草稿失败');
  const deleteDraftId = deleteDraftReport.data.data.id;
  const deleteDraft = await request(`/api/work-reports/${deleteDraftId}`, {
    method: 'DELETE',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(deleteDraft.status === 200, `删除草稿工作汇报失败: ${deleteDraft.status} ${JSON.stringify(deleteDraft.data)}`);
  const afterDeleteDraft = await request('/api/work-reports?reportType=daily', { headers: { cookie: engineerCookie } });
  const afterDeleteRows = Array.isArray(afterDeleteDraft.data.data) ? afterDeleteDraft.data.data : [];
  assert(!afterDeleteRows.some(item => item.id === deleteDraftId), '草稿删除后仍可查询到');
  const engineerReports = await request('/api/work-reports?reportType=daily', { headers: { cookie: engineerCookie } });
  assert(engineerReports.status === 200, '工程师查询工作汇报列表失败');
  assert(Array.isArray(engineerReports.data.data) && engineerReports.data.data.some(item => item.id === reportId), '工程师未查询到自己的工作汇报');
  const submitWorkReport = await request(`/api/work-reports/${reportId}/submit`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(submitWorkReport.status === 200, '提交工作汇报失败');
  assert(submitWorkReport.data.data?.status === 'submitted', '提交后工作汇报状态不正确');
  const updateSubmittedWorkReport = await request(`/api/work-reports/${reportId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: '提交后编辑应失败' })
  });
  assert(updateSubmittedWorkReport.status === 400, '已提交的工作汇报仍可编辑');
  const resubmitWorkReport = await request(`/api/work-reports/${reportId}/submit`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(resubmitWorkReport.status === 400, '已提交的工作汇报仍可再次提交');
  const approveWorkReport = await request(`/api/work-reports/${reportId}/review`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approved', comment: '回归确认通过' })
  });
  assert(approveWorkReport.status === 200, '管理员确认工作汇报失败');
  assert(approveWorkReport.data.data?.status === 'approved', '管理员确认后状态不正确');
  const updateApprovedWorkReport = await request(`/api/work-reports/${reportId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: '确认后编辑应失败' })
  });
  assert(updateApprovedWorkReport.status === 400, '已确认的工作汇报仍可编辑');
  const submitApprovedWorkReport = await request(`/api/work-reports/${reportId}/submit`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(submitApprovedWorkReport.status === 400, '已确认的工作汇报仍可提交');
  const lockWorkReport = await request(`/api/work-reports/${reportId}/review`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'locked', comment: '回归锁定' })
  });
  assert(lockWorkReport.status === 200, '管理员锁定工作汇报失败');
  assert(lockWorkReport.data.data?.status === 'locked' && lockWorkReport.data.data?.lockedAt, '管理员锁定后状态不正确');
  const updateLockedWorkReport = await request(`/api/work-reports/${reportId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: '锁定后编辑应失败' })
  });
  assert(updateLockedWorkReport.status === 400, '锁定后的工作汇报仍可编辑');
  const submitLockedWorkReport = await request(`/api/work-reports/${reportId}/submit`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(submitLockedWorkReport.status === 400, '锁定后的工作汇报仍可提交');
  const returnableDate = '2098-08-01';
  const returnableReport = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'daily',
      anchorDate: returnableDate,
      summary: '确认后退回归',
      completedWork: '已完成确认后退回',
      pendingWork: '待退回',
      risks: '无',
      nextPlan: '退回后修改'
    })
  });
  assert(returnableReport.status === 200, '创建确认后退回用日报失败');
  const returnableId = returnableReport.data.data.id;
  const submitReturnable = await request(`/api/work-reports/${returnableId}/submit`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(submitReturnable.status === 200, '提交确认后退回用日报失败');
  const approveReturnable = await request(`/api/work-reports/${returnableId}/review`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approved', comment: '先确认再退回' })
  });
  assert(approveReturnable.status === 200 && approveReturnable.data.data?.status === 'approved', '确认后退回用日报确认失败');
  const returnApproved = await request(`/api/work-reports/${returnableId}/review`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'returned', comment: '确认后需要退回修改' })
  });
  assert(returnApproved.status === 200, '已确认工作汇报退回失败');
  assert(returnApproved.data.data?.status === 'returned', '已确认工作汇报退回后状态不正确');
  const reviseReturnedApproved = await request(`/api/work-reports/${returnableId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: '确认退回后已修订' })
  });
  assert(reviseReturnedApproved.status === 200, '确认后退回的工作汇报不可再编辑');
  const lockedReports = await request(`/api/work-reports?status=locked&reportType=daily&projectId=${encodeURIComponent(projectId)}`, { headers: { cookie } });
  assert(lockedReports.status === 200, '管理员筛选锁定工作汇报失败');
  const lockedReport = Array.isArray(lockedReports.data.data) ? lockedReports.data.data.find(item => item.id === reportId) : null;
  assert(lockedReport && lockedReport.reviewerName, '锁定工作汇报详情缺少审核人信息');
  const lockedReportsByUser = await request(`/api/work-reports?status=locked&userId=${encodeURIComponent(engineerAccount.id)}`, { headers: { cookie } });
  assert(lockedReportsByUser.status === 200, '管理员按人员筛选工作汇报失败');
  assert(Array.isArray(lockedReportsByUser.data.data) && lockedReportsByUser.data.data.some(item => item.id === reportId), '管理员按人员筛选未命中目标日报');
  const workloadReport = await request(`/api/reports/workload?period=custom&projectId=${encodeURIComponent(projectId)}&startDate=${reportDate}&endDate=${reportDate}`, { headers: { cookie } });
  assert(workloadReport.status === 200, '查询工作量看板失败');
  const workloadRow = Array.isArray(workloadReport.data.data) ? workloadReport.data.data.find(item => item.userId === engineerAccount.id) : null;
  assert(workloadRow, '工作量看板缺少工程师行');
  assert(workloadRow.logCount === 1 && Number(workloadRow.totalHours) === 2.5, '工作量看板统计结果不正确');
  assert(Number(workloadRow.categoryCounts?.task || 0) >= 1 && Number(workloadRow.categoryHours?.task || 0) >= 2.5, '工作量分类口径统计结果不正确');
  assert(workloadReport.data.previousRange?.rangeStart === previousDayReportDate && workloadReport.data.previousRange?.rangeEnd === previousDayReportDate, '工作量看板上周期范围不正确');
  assert(Number(workloadReport.data.summaryComparison?.logCount?.previous || 0) === 1, '工作量看板上周期工单数不正确');
  assert(Number(workloadReport.data.summaryComparison?.totalHours?.change || 0) === 1.5, '工作量看板工时环比差值不正确');
  const workloadCsv = await request(`/api/reports/workload/export?period=custom&projectId=${encodeURIComponent(projectId)}&startDate=${reportDate}&endDate=${reportDate}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(workloadCsv.status === 200 && String(workloadCsv.data || '').includes(engineerAccount.name), '工作量 CSV 导出失败');
  let weeklyReportDate = addDaysToDateKey(reportDate, 1);
  while (existingEngineerReports.some(item => String(item.reportType) === 'weekly' && String(item.rangeStart) === getWeekRangeStart(weeklyReportDate))) {
    weeklyReportDate = addDaysToDateKey(weeklyReportDate, 1);
  }
  const weeklyReport = await request('/api/work-reports', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'weekly',
      anchorDate: weeklyReportDate,
      summary: '周报退回回归测试',
      completedWork: '完成初版周报',
      pendingWork: '等待管理员审核',
      risks: '存在待补充项',
      nextPlan: '根据退回意见修改'
    })
  });
  assert(weeklyReport.status === 200, '创建周报失败');
  const weeklyReportId = weeklyReport.data.data.id;
  const submitWeeklyReport = await request(`/api/work-reports/${weeklyReportId}/submit`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(submitWeeklyReport.status === 200 && submitWeeklyReport.data.data?.status === 'submitted', '提交周报失败');
  const returnWeeklyReport = await request(`/api/work-reports/${weeklyReportId}/review`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'returned', comment: '请补充本周风险说明' })
  });
  assert(returnWeeklyReport.status === 200 && returnWeeklyReport.data.data?.status === 'returned', '管理员退回周报失败');
  assert(returnWeeklyReport.data.data?.reviewComment === '请补充本周风险说明', '退回意见未保存');
  const reviseWeeklyReport = await request(`/api/work-reports/${weeklyReportId}`, {
    method: 'PUT',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: '周报退回后已补充',
      completedWork: '完成周报修改',
      pendingWork: '等待再次审核',
      risks: '已补充风险说明',
      nextPlan: '重新提交管理员审核',
      status: 'draft'
    })
  });
  assert(reviseWeeklyReport.status === 200, '退回后编辑周报失败');
  assert(reviseWeeklyReport.data.data?.status === 'draft', '退回后回到草稿状态失败');
  const resubmitWeeklyReport = await request(`/api/work-reports/${weeklyReportId}/submit`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(resubmitWeeklyReport.status === 200 && resubmitWeeklyReport.data.data?.status === 'submitted', '退回后的周报重新提交失败');
  const submittedWeeklyReports = await request(`/api/work-reports?status=submitted&reportType=weekly&projectId=${encodeURIComponent(projectId)}`, { headers: { cookie } });
  assert(submittedWeeklyReports.status === 200, '管理员按项目筛选周报失败');
  assert(Array.isArray(submittedWeeklyReports.data.data) && submittedWeeklyReports.data.data.some(item => item.id === weeklyReportId), '管理员按项目筛选未命中目标周报');
  const workReportOverview = await request(`/api/reports/work-reports/overview?period=month&anchorDate=${encodeURIComponent(weeklyReportDate)}&projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(engineerAccount.id)}&trendUnit=week`, { headers: { cookie } });
  assert(workReportOverview.status === 200, '查询工作汇报管理汇总看板失败');
  assert(Number(workReportOverview.data.totals?.reportCount) >= 2, '管理汇总看板汇报总数不正确');
  assert(Number(workReportOverview.data.totals?.locked) >= 1, '管理汇总看板已锁定数量不正确');
  assert(Number(workReportOverview.data.totals?.submitted) >= 1, '管理汇总看板待审核数量不正确');
  assert(String(workReportOverview.data.previousRange?.rangeStart || '').slice(0, 7) === previousMonthReportDate.slice(0, 7), '管理汇总看板上周期范围不正确');
  assert(Number(workReportOverview.data.totalsComparison?.reportCount?.previous || 0) >= 1, '管理汇总看板上周期汇报总数不正确');
  assert(typeof workReportOverview.data.totalsComparison?.reportCount?.change === 'number', '管理汇总看板汇报总数环比差值不正确');
  assert(Array.isArray(workReportOverview.data.trend) && workReportOverview.data.trend.some(item => Number(item.reportCount) >= 2), '管理汇总看板趋势数据不正确');
  assert(workReportOverview.data.trend.every(item => Number(item.submittedCount || 0) + Number(item.approvedCount || 0) + Number(item.lockedCount || 0) <= Number(item.reportCount || 0)), '管理汇总看板趋势状态计数不正确');
  assert(Array.isArray(workReportOverview.data.rankings?.users) && workReportOverview.data.rankings.users.some(item => item.id === engineerAccount.id && Number(item.reportCount) >= 2), '管理汇总看板人员排行不正确');
  assert(Array.isArray(workReportOverview.data.rankings?.projects) && workReportOverview.data.rankings.projects.some(item => item.id === projectId && Number(item.reportCount) >= 2), '管理汇总看板项目排行不正确');
  assert(Number(workReportOverview.data.pendingSummary?.total) >= 1, '管理汇总看板待审核汇总数量不正确');
  assert(Array.isArray(workReportOverview.data.pendingSummary?.items) && workReportOverview.data.pendingSummary.items.some(item => item.id === weeklyReportId), '管理汇总看板待审核列表未命中目标周报');
  assert(Array.isArray(workReportOverview.data.pendingSummary?.byUsers) && workReportOverview.data.pendingSummary.byUsers.some(item => item.id === engineerAccount.id && Number(item.pendingCount) >= 1), '待审核人员汇总不正确');
  assert(Array.isArray(workReportOverview.data.pendingSummary?.byProjects) && workReportOverview.data.pendingSummary.byProjects.some(item => item.id === projectId && Number(item.pendingCount) >= 1), '待审核项目汇总不正确');
  const workReportListCsv = await request(`/api/reports/work-reports/export?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(engineerAccount.id)}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(workReportListCsv.status === 200, '导出工作汇报列表失败');
  assert(String(workReportListCsv.data || '').includes('周期开始') && String(workReportListCsv.data || '').includes(engineerAccount.name), '工作汇报列表导出内容不正确');
  const workReportOverviewCsv = await request(`/api/reports/work-reports/overview/export?period=month&anchorDate=${encodeURIComponent(weeklyReportDate)}&projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(engineerAccount.id)}&trendUnit=week`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(workReportOverviewCsv.status === 200, '导出工作汇报管理汇总看板失败');
  assert(String(workReportOverviewCsv.data || '').includes('汇总指标') && String(workReportOverviewCsv.data || '').includes('待审核汇报'), '工作汇报管理汇总导出内容不正确');
  assert(String(workReportOverviewCsv.data || '').includes('统计口径') && String(workReportOverviewCsv.data || '').includes('导出时间'), '工作汇报管理汇总导出缺少口径或导出时间');
  const wrCustomerPayload = {
    name: '汇报只读客户',
    username: `wr_customer_${Date.now()}`,
    password: 'Testpass1!',
    role: 'customer',
    phone: '13800001111',
    wechat: '',
    email: 'wr-customer@example.com',
    idCard: '110101199001011234',
    projectId,
    startDate: '',
    endDate: ''
  };
  const createWrCustomer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(wrCustomerPayload)
  });
  assert(createWrCustomer.status === 201, '创建工作汇报测试客户失败');
  const adminUserList = await request('/api/users?all=1', { headers: { cookie } });
  const wrCustomerFromAdmin = (adminUserList.data.data || []).find(item => item.id === createWrCustomer.data.id);
  assert(wrCustomerFromAdmin && wrCustomerFromAdmin.phone === '13800001111' && wrCustomerFromAdmin.idCard === '110101199001011234', '管理员用户列表应保留联系方式');
  const engineerUserList = await request('/api/users?all=1', { headers: { cookie: engineerCookie } });
  const wrCustomerFromEngineer = (engineerUserList.data.data || []).find(item => item.id === createWrCustomer.data.id);
  assert(wrCustomerFromEngineer && wrCustomerFromEngineer.idCard === '' && wrCustomerFromEngineer.phone === '' && wrCustomerFromEngineer.email === '' && wrCustomerFromEngineer.username === '' && wrCustomerFromEngineer.wechat === '', '非管理员用户列表应脱敏证件、账号与联系方式');
  const wrCustomerLogin = await login(wrCustomerPayload.username, wrCustomerPayload.password);
  assert(wrCustomerLogin.status === 200 && wrCustomerLogin.data.user?.role === 'customer', '工作汇报测试客户登录失败');
  const wrCustomerCookie = wrCustomerLogin.cookie;
  const customerWorkReports = await request('/api/work-reports', { headers: { cookie: wrCustomerCookie } });
  assert(customerWorkReports.status === 200, '客户查询工作汇报失败');
  const customerReportIds = (customerWorkReports.data.data || []).map(item => item.id);
  assert(customerReportIds.includes(weeklyReportId), '客户应能看到已提交周报');
  assert(customerReportIds.includes(reportId), '客户应能看到已锁定日报');
  assert((customerWorkReports.data.data || []).every(item => ['submitted', 'approved', 'locked'].includes(item.status)), '客户不应看到草稿或退回汇报');
  const customerOverviewDenied = await request(`/api/reports/work-reports/overview?period=month&anchorDate=${encodeURIComponent(weeklyReportDate)}`, { headers: { cookie: wrCustomerCookie } });
  assert(customerOverviewDenied.status === 403, '客户不应访问管理汇总看板');
  const engineerOverviewDenied = await request(`/api/reports/work-reports/overview?period=month&anchorDate=${encodeURIComponent(weeklyReportDate)}`, { headers: { cookie: engineerCookie } });
  assert(engineerOverviewDenied.status === 403, '工程师不应访问管理汇总看板');
  const customerLogsDenied = await request('/api/logs?all=1', { headers: { cookie: wrCustomerCookie } });
  assert(customerLogsDenied.status === 200 && (customerLogsDenied.data.data || []).length === 0, '客户不应读取运维日志');
  const customerKb = await request('/api/kb?all=1', { headers: { cookie: wrCustomerCookie } });
  assert(customerKb.status === 200, '客户读取知识库失败');
  assert((customerKb.data.data || []).every(item => item.problem === undefined && item.solution === undefined && item.content === undefined), '客户知识库不应返回正文');
  const kbOracleKeyword = `kboracle_${Date.now()}`;
  const kbOracle = await request('/api/kb', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      title: `客户可见知识标题_${Date.now()}`,
      keywords: 'visible-tag',
      problem: kbOracleKeyword,
      solution: '内部处理步骤'
    })
  });
  assert(kbOracle.status === 201, '创建知识库侧信道测试条目失败');
  const customerKbOracle = await request(`/api/kb?keyword=${encodeURIComponent(kbOracleKeyword)}`, { headers: { cookie: wrCustomerCookie } });
  assert(customerKbOracle.status === 200, '客户知识库关键字搜索失败');
  assert(!(customerKbOracle.data.data || []).some(item => item.id === kbOracle.data.id), '客户不应通过正文关键字命中知识库');
  const customerKbTitle = await request(`/api/kb?keyword=${encodeURIComponent(kbOracle.data.title)}`, { headers: { cookie: wrCustomerCookie } });
  assert((customerKbTitle.data.data || []).some(item => item.id === kbOracle.data.id), '客户应能按标题搜索知识库');
  const customerKbDetail = await request(`/api/kb/${kbOracle.data.id}`, { headers: { cookie: wrCustomerCookie } });
  assert(customerKbDetail.status === 200, '客户应能读取知识条目详情');
  assert(customerKbDetail.data.problem === kbOracleKeyword && customerKbDetail.data.solution === '内部处理步骤', '知识条目详情应返回完整正文');
  const customerKbDetailMissing = await request(`/api/kb/kb_not_exists_${Date.now()}`, { headers: { cookie: wrCustomerCookie } });
  assert(customerKbDetailMissing.status === 404, '不存在的知识条目详情应返回 404');
  const customerChanges = await request('/api/change-records?all=1', { headers: { cookie: wrCustomerCookie } });
  assert(customerChanges.status === 200, '客户读取变更记录失败');
  assert((customerChanges.data.data || []).every(item => item.content === '' && item.title === '' && item.assetId === '' && item.rejectionReason === ''), '客户变更记录应隐藏标题、正文、资产和驳回原因');
  const customerIncidents = await request('/api/incidents?all=1', { headers: { cookie: wrCustomerCookie } });
  assert(customerIncidents.status === 200, '客户读取故障记录失败');
  assert((customerIncidents.data.data || []).every(item => item.description === '' && item.resolution === ''), '客户故障记录应隐藏处理细节');
  const customerBackupPlans = await request('/api/ai-inspection/config-backup/plans', { headers: { cookie: wrCustomerCookie } });
  assert(customerBackupPlans.status === 200 && (customerBackupPlans.data.data || []).length === 0, '客户不应看到配置备份计划');
  const customerBackupRecords = await request('/api/ai-inspection/config-backup/records', { headers: { cookie: wrCustomerCookie } });
  assert(customerBackupRecords.status === 200 && (customerBackupRecords.data.data || []).length === 0, '客户不应看到配置备份记录');
  const customerSpareParts = await request('/api/spare-parts?all=1', { headers: { cookie: wrCustomerCookie } });
  assert(customerSpareParts.status === 200 && (customerSpareParts.data.data || []).length === 0, '客户不应看到备件库存');
  const customerSpareMoves = await request('/api/spare-part-movements?all=1', { headers: { cookie: wrCustomerCookie } });
  assert(customerSpareMoves.status === 200 && (customerSpareMoves.data.data || []).length === 0, '客户不应看到备件流水');
  const customerOnline = await request('/api/sessions/online', { headers: { cookie: wrCustomerCookie } });
  assert(customerOnline.status === 200, '客户读取在线会话失败');
  assert((customerOnline.data.users || []).every(item => !item.username || item.id === wrCustomerLogin.data.user.id), '客户在线会话不应暴露他人账号');
  const customerSummaryBoundDenied = await request('/api/reports/summary?period=week', { headers: { cookie: wrCustomerCookie } });
  assert(customerSummaryBoundDenied.status === 403, '已绑定项目的客户不应查看日志汇总');
  const drilldownRemoved = await request('/api/reports/drilldown?period=month', { headers: { cookie: wrCustomerCookie } });
  assert(drilldownRemoved.status === 404, '下钻报表接口应已下线');
  const enableRegistration = await updateSystemSettings(cookie, { allowRegistration: true });
  assert(enableRegistration.status === 200, '开启自主注册失败');
  const pendingUsername = `reg_enum_${Date.now()}`;
  const postRegister = async username => {
    const captcha = await request('/api/captcha');
    return request('/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Captcha-Token': captcha.data.token,
        'X-CSRF-Token': captcha.data.csrfToken || ''
      },
      body: JSON.stringify({
        username,
        name: '枚举测试',
        password: 'Testpass1!',
        phone: '13800002222',
        securityQuestion: '测试问题',
        securityAnswer: '答案',
        captchaToken: captcha.data.token,
        captcha: decodeCaptchaFromSvg(captcha.data)
      })
    });
  };
  const firstRegister = await postRegister(pendingUsername);
  const duplicateRegister = await postRegister(pendingUsername);
  assert(firstRegister.status === 201 && duplicateRegister.status === 201, '重复注册应返回相同成功状态');
  assert(firstRegister.data.message === duplicateRegister.data.message, '重复注册文案应一致');
  const pendingUser = ((await request('/api/users?all=1', { headers: { cookie } })).data.data || []).find(item => item.username === pendingUsername);
  assert(pendingUser && pendingUser.status === 'pending', '自注册账号应进入待审批');
  const approvePendingDenied = await request(`/api/users/${pendingUser.id}/approve`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(approvePendingDenied.status === 400, '审批未绑定项目时应拒绝');
  const approvePending = await request(`/api/users/${pendingUser.id}/approve`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId })
  });
  assert(approvePending.status === 200 && approvePending.data.user?.role === 'viewer', '审批默认角色应为只读');
  const deletePending = await request(`/api/users/${pendingUser.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deletePending.status === 200, '清理自注册测试账号失败');
  await updateSystemSettings(cookie, { allowRegistration: false });
  const customerListCsv = await request(`/api/reports/work-reports/export?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { cookie: wrCustomerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(customerListCsv.status === 200 && String(customerListCsv.data || '').includes('周期开始'), '客户导出已提交工作汇报失败');
  const scopedNotify = await request('/api/notifications', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title: '按用户已读回归', content: '仅当前用户已读', level: 'info', category: 'manual' })
  });
  assert(scopedNotify.status === 201, '创建按用户已读通知失败');
  const adminNotes = await request('/api/notifications?all=1', { headers: { cookie } });
  const targetNote = (adminNotes.data.data || []).find(item => item.title === '按用户已读回归');
  assert(targetNote && !targetNote.readBy && !targetNote.hiddenBy, '通知列表不应暴露已读映射');
  const engineerNotesBefore = await request('/api/notifications?all=1', { headers: { cookie: engineerCookie } });
  const engineerNoteBefore = (engineerNotesBefore.data.data || []).find(item => item.id === targetNote.id);
  assert(engineerNoteBefore && !engineerNoteBefore.readAt, '工程师通知初始应为未读');
  const adminMarkAll = await request('/api/notifications/read-all', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(adminMarkAll.status === 200, '管理员全部已读失败');
  const engineerNotesAfter = await request('/api/notifications?all=1', { headers: { cookie: engineerCookie } });
  const engineerNoteAfter = (engineerNotesAfter.data.data || []).find(item => item.id === targetNote.id);
  assert(engineerNoteAfter && !engineerNoteAfter.readAt, '管理员全部已读不应改变工程师未读状态');
  const deleteWrCustomer = await request(`/api/users/${createWrCustomer.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteWrCustomer.status === 200, '清理工作汇报测试客户失败');
  const reminderProject = await request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `提醒回归项目-${Date.now()}`,
      customerName: '提醒回归客户',
      projectStartDate: reportDate,
      projectEndDate: addMonthsToDateKey(reportDate, 6),
      description: '用于工作汇报提醒回归'
    })
  });
  assert(reminderProject.status === 201, '创建提醒回归项目失败');
  const reminderProjectId = reminderProject.data.id;
  const suffix = String(Date.now());
  const missingEngineer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '提醒漏填工程师',
      username: `reminder_missing_${suffix}`,
      password: 'Reminder123!',
      role: 'engineer',
      projectId: reminderProjectId
    })
  });
  assert(missingEngineer.status === 201, '创建提醒漏填工程师失败');
  const lowEngineer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '提醒低工时工程师',
      username: `reminder_low_${suffix}`,
      password: 'Reminder123!',
      role: 'engineer',
      projectId: reminderProjectId
    })
  });
  assert(lowEngineer.status === 201, '创建提醒低工时工程师失败');
  const highEngineer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '提醒高工时工程师',
      username: `reminder_high_${suffix}`,
      password: 'Reminder123!',
      role: 'engineer',
      projectId: reminderProjectId
    })
  });
  assert(highEngineer.status === 201, '创建提醒高工时工程师失败');
  const invalidRoleUser = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '非法角色用户',
      username: `invalid_role_${suffix}`,
      password: 'Reminder123!',
      role: 'superuser',
      projectId: reminderProjectId
    })
  });
  assert(invalidRoleUser.status === 400, '创建用户不应接受非法角色');

  // 删除阻断：项目存在工作汇报、人员存在工作汇报时都不允许删除
  const blockProjectA = await request('/api/projects', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `删除阻断项目A-${suffix}` })
  });
  const blockProjectB = await request('/api/projects', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `删除阻断项目B-${suffix}` })
  });
  assert(blockProjectA.status === 201 && blockProjectB.status === 201, '创建删除阻断用项目失败');
  const blockUser = await request('/api/users', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '删除阻断用户', username: `block_user_${suffix}`, password: 'Block123!', role: 'engineer', projectId: blockProjectA.data.id })
  });
  assert(blockUser.status === 201, '创建删除阻断用人员失败');
  const blockUserB = await request('/api/users', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '删除阻断用户B', username: `block_user_b_${suffix}`, password: 'Block123!', role: 'engineer', projectId: blockProjectB.data.id })
  });
  assert(blockUserB.status === 201, '创建删除阻断用人员B失败');
  // 汇报人须属于所选项目：项目A的人员不能为项目B写汇报
  const crossProjectReport = await request('/api/work-reports', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportType: 'daily', anchorDate: '2098-04-10', projectId: blockProjectB.data.id, userId: blockUser.data.id, summary: '跨项目汇报应被拒绝' })
  });
  assert(crossProjectReport.status === 400 && String(crossProjectReport.data.message || '').includes('不属于所选项目'), '汇报人不属于所选项目时应被拒绝');
  const reportForProjectB = await request('/api/work-reports', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportType: 'daily', anchorDate: '2098-04-11', projectId: blockProjectB.data.id, userId: blockUserB.data.id, summary: '项目删除阻断回归' })
  });
  assert(reportForProjectB.status === 200, '创建项目删除阻断用汇报失败');
  const deleteProjectWithReport = await request(`/api/projects/${blockProjectB.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteProjectWithReport.status === 400 && String(deleteProjectWithReport.data.message || '').includes('workReports'), '存在工作汇报的项目不应被删除');
  const reportForUser = await request('/api/work-reports', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportType: 'daily', anchorDate: '2098-04-12', projectId: blockProjectA.data.id, userId: blockUser.data.id, summary: '人员删除阻断回归' })
  });
  assert(reportForUser.status === 200, '创建人员删除阻断用汇报失败');
  const deleteUserWithReport = await request(`/api/users/${blockUser.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteUserWithReport.status === 400 && String(deleteUserWithReport.data.message || '').includes('工作汇报'), '存在工作汇报的人员不应被删除');
  // 清理阻断测试数据
  await request(`/api/work-reports/${reportForProjectB.data.data.id}`, { method: 'DELETE', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  await request(`/api/work-reports/${reportForUser.data.data.id}`, { method: 'DELETE', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  await request(`/api/users/${blockUserB.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/users/${blockUser.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/projects/${blockProjectA.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/projects/${blockProjectB.data.id}`, { method: 'DELETE', headers: { cookie } });

  // 通知属于过程性记录，项目删除时应级联清理而非长期阻断
  const cascadeProject = await request('/api/projects', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `通知级联清理项目-${suffix}` })
  });
  assert(cascadeProject.status === 201, '创建通知级联清理项目失败');
  const cascadeNotification = await request('/api/notifications', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: cascadeProject.data.id, title: '级联通知', content: '项目删除应清理该通知', level: 'info', category: 'manual' })
  });
  assert(cascadeNotification.status === 201, '创建级联清理通知失败');
  const deleteCascadeProject = await request(`/api/projects/${cascadeProject.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteCascadeProject.status === 200, `带通知的项目应可删除: ${deleteCascadeProject.status} ${JSON.stringify(deleteCascadeProject.data)}`);

  const reminderTriggerOffset = getTimezoneOffsetForHour(String(health.data.checkedAt || ''), 12);
  // 周报提醒阈值放宽到 7 天，保证周一（距周日 6 天）运行时仍能覆盖周报截止提醒分支。
  const reminderTriggerSettings = await updateSystemSettings(cookie, { timezoneOffset: reminderTriggerOffset, dailyReportReminderHour: 11, weeklyReportReminderDays: 7 });
  assert(reminderTriggerSettings.status === 200, '保存提醒触发时区设置失败');

  const serverNow = String(health.data.checkedAt || '');
  const todayKey = getLocalDateKey(serverNow, reminderTriggerOffset) || formatDateKey(new Date());
  const reminderLocalHour = getLocalHour(serverNow, reminderTriggerOffset);
  const monthDaysLeft = getMonthDaysLeft(todayKey);
  assert(reminderLocalHour >= 11, '提醒触发时区本地小时计算不正确');
  const reminderSeedList = await waitForProjectNotifications(cookie, reminderProjectId, list => list.some(item => item.category === 'work-report-daily-missing' && String(item.content || '').includes('提醒漏填工程师')));
  assert(reminderSeedList.some(item => item.category === 'work-report-daily-missing' && String(item.content || '').includes('提醒漏填工程师')), '日报漏填提醒未生成');
  assert(reminderSeedList.some(item => item.category === 'work-report-weekly-deadline' && String(item.content || '').includes('提醒漏填工程师')), '周报截止提醒未生成');
  if (monthDaysLeft <= 10) {
    assert(reminderSeedList.some(item => item.category === 'work-report-monthly-deadline' && String(item.content || '').includes('提醒漏填工程师')), '月报截止提醒未生成');
  }
  assert(reminderSeedList.some(item => item.category === 'work-log-streak-missing' && String(item.content || '').includes('提醒漏填工程师')), '连续无记录提醒未生成');
  assert(reminderSeedList.some(item => item.category === 'project-report-inactive'), '项目长期无人填报提醒未生成');

  const lowEngineerLogin = await login(lowEngineer.data.username, 'Reminder123!');
  assert(lowEngineerLogin.status === 200, '提醒低工时工程师登录失败');
  const highEngineerLogin = await login(highEngineer.data.username, 'Reminder123!');
  assert(highEngineerLogin.status === 200, '提醒高工时工程师登录失败');
  const lowHourLog = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: lowEngineerLogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: reminderProjectId,
      date: `${todayKey}T09:00`,
      ticketType: '事务工作',
      event: '提醒低工时回归日志',
      relatedTarget: '提醒测试对象',
      result: '已完成',
      process: '登记低工时测试日志',
      conclusion: '低工时提醒测试完成',
      durationHours: 0.5
    })
  });
  assert(lowHourLog.status === 201, '创建低工时测试日志失败');
  const highHourLog = await request('/api/logs', {
    method: 'POST',
    headers: { cookie: highEngineerLogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: reminderProjectId,
      date: `${todayKey}T08:00`,
      ticketType: '事务工作',
      event: '提醒高工时回归日志',
      relatedTarget: '提醒测试对象',
      result: '已完成',
      process: '登记高工时测试日志',
      conclusion: '高工时提醒测试完成',
      durationHours: 12.5
    })
  });
  assert(highHourLog.status === 201, '创建高工时测试日志失败');

  const reminderHourList = await waitForProjectNotifications(cookie, reminderProjectId, list => list.some(item => item.category === 'work-log-hours-low' && String(item.content || '').includes('提醒低工时工程师'))
    && list.some(item => item.category === 'work-log-hours-high' && String(item.content || '').includes('提醒高工时工程师')));
  assert(reminderHourList.some(item => item.category === 'work-log-hours-low' && String(item.content || '').includes('提醒低工时工程师')), '工时偏低提醒未生成');
  assert(reminderHourList.some(item => item.category === 'work-log-hours-high' && String(item.content || '').includes('提醒高工时工程师')), '工时偏高提醒未生成');

  const beforeThresholdOffset = getTimezoneOffsetForHour(serverNow, 10);
  const beforeThresholdSettings = await updateSystemSettings(cookie, { timezoneOffset: beforeThresholdOffset, dailyReportReminderHour: 11 });
  assert(beforeThresholdSettings.status === 200, '保存提醒前阈值时区设置失败');
  assert(getLocalHour(serverNow, beforeThresholdOffset) < 11, '前阈值时区本地小时计算不正确');

  const timezoneProject = await request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `时区提醒项目-${Date.now()}`,
      customerName: '时区提醒客户',
      projectStartDate: todayKey,
      projectEndDate: addMonthsToDateKey(todayKey, 3),
      description: '用于提醒时区与去重边界回归'
    })
  });
  assert(timezoneProject.status === 201, '创建时区提醒项目失败');
  const timezoneProjectId = timezoneProject.data.id;
  const timezoneEngineer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '时区提醒工程师',
      username: `timezone_engineer_${suffix}`,
      password: 'Reminder123!',
      role: 'engineer',
      projectId: timezoneProjectId
    })
  });
  assert(timezoneEngineer.status === 201, '创建时区提醒工程师失败');
  const beforeThresholdNotifications = await listProjectNotifications(cookie, timezoneProjectId);
  assert(!beforeThresholdNotifications.some(item => item.category === 'work-report-daily-missing' && String(item.content || '').includes('时区提醒工程师')), '前阈值时区不应生成日报漏填提醒');

  const afterThresholdOffset = getTimezoneOffsetForHour(serverNow, 12);
  const afterThresholdSettings = await updateSystemSettings(cookie, { timezoneOffset: afterThresholdOffset, dailyReportReminderHour: 11 });
  assert(afterThresholdSettings.status === 200, '保存提醒后阈值时区设置失败');
  assert(getLocalHour(serverNow, afterThresholdOffset) >= 11, '后阈值时区本地小时计算不正确');
  const afterThresholdNotifications = await listProjectNotifications(cookie, timezoneProjectId);
  const timezoneDailyMissing = afterThresholdNotifications.filter(item => item.category === 'work-report-daily-missing' && String(item.content || '').includes('时区提醒工程师'));
  const initialTimezoneDailyMissingCount = timezoneDailyMissing.length;
  assert(initialTimezoneDailyMissingCount >= 1, '后阈值时区未生成日报漏填提醒');

  const auditAfterWorkReports = await request('/api/audit-logs?all=1', { headers: { cookie } });
  assert(auditAfterWorkReports.status === 200, '查询工作汇报审计日志失败');
  const workReportAuditLogs = auditAfterWorkReports.data.data || [];
  assert(hasAuditLogForTarget(workReportAuditLogs, 'create', 'workReport', reportId, '创建daily工作汇报'), '创建日报未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'submit', 'workReport', reportId, '提交工作汇报'), '提交日报未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'approved', 'workReport', reportId, '工作汇报已确认'), '确认日报未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'locked', 'workReport', reportId, '工作汇报已锁定'), '锁定日报未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'create', 'workReport', weeklyReportId, '创建weekly工作汇报'), '创建周报未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'returned', 'workReport', weeklyReportId, '工作汇报已退回'), '退回周报未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'update', 'workReport', weeklyReportId, '编辑工作汇报'), '编辑退回周报未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'export', 'workReport', 'work-report-list', '导出工作汇报列表'), '导出工作汇报列表未写入审计日志');
  assert(hasAuditLogForTarget(workReportAuditLogs, 'export', 'workReport', 'work-report-overview', '导出工作汇报管理汇总看板'), '导出工作汇报管理汇总看板未写入审计日志');
  const weeklySubmitCount = workReportAuditLogs.filter(item => item.action === 'submit' && String(item.targetType || '') === 'workReport' && String(item.targetId || '') === weeklyReportId).length;
  assert(weeklySubmitCount >= 2, '周报重新提交审计日志数量不正确');

  const plan = await request('/api/inspection-plans', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, title: '回归巡检计划', cycle: 'weekly', nextDate: '2026-06-30', owner: 'admin' })
  });
  assert(plan.status === 201, '创建巡检计划失败');
  const execution = await request('/api/inspection-executions', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: plan.data.id, executedAt: '2026-06-19T13:00', executor: 'admin', result: '正常', checklist: '回归检查', issue: '发现端口异常', suggestion: '更换交换机', nextDate: '2026-07-01' })
  });
  assert(execution.status === 201, '创建巡检执行记录失败');
  // 计划的下次巡检日必须保留真实值，不能被滚动到未来（否则首页逾期统计恒为 0）
  const plansAfterExecution = await request('/api/inspection-plans', { headers: { cookie } });
  const refreshedPlan = (plansAfterExecution.data.data || []).find(item => item.id === plan.data.id);
  assert(refreshedPlan && refreshedPlan.nextDate === '2026-07-01', `巡检计划下次巡检日被改写: ${refreshedPlan && refreshedPlan.nextDate}`);

  // 逾期计划应产生提醒且同一到期日只提醒一次
  const reminderPlan = await request('/api/inspection-plans', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, title: '回归逾期提醒计划', cycle: 'weekly', nextDate: '2025-01-06', owner: 'admin' })
  });
  assert(reminderPlan.status === 201, '创建逾期巡检计划失败');
  const notificationsFirst = await request('/api/notifications?all=1', { headers: { cookie } });
  const reminderNotes = (notificationsFirst.data.data || []).filter(item => item.category === 'inspection-overdue' && item.sourceId === reminderPlan.data.id);
  assert(reminderNotes.length === 1, `逾期巡检提醒数量不正确: ${reminderNotes.length}`);
  const notificationsSecond = await request('/api/notifications?all=1', { headers: { cookie } });
  const reminderNotesAgain = (notificationsSecond.data.data || []).filter(item => item.category === 'inspection-overdue' && item.sourceId === reminderPlan.data.id);
  assert(reminderNotesAgain.length === 1, '同一到期日不应重复产生巡检提醒');
  const reminderPlanDelete = await request(`/api/inspection-plans/${reminderPlan.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(reminderPlanDelete.status === 200, '删除逾期巡检计划失败');

  // 执行记录未填下次巡检日时，应按周期从执行日期自动顺延
  const autoPlan = await request('/api/inspection-plans', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, title: '回归自动顺延计划', cycle: 'daily', nextDate: '2025-01-01', owner: 'admin' })
  });
  assert(autoPlan.status === 201, '创建自动顺延巡检计划失败');
  const autoExecution = await request('/api/inspection-executions', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: autoPlan.data.id, executedAt: '2025-01-02T09:00', executor: 'admin', result: '正常', checklist: '回归检查' })
  });
  assert(autoExecution.status === 201, '创建自动顺延执行记录失败');
  const autoPlans = await request('/api/inspection-plans', { headers: { cookie } });
  const autoPlanAfter = (autoPlans.data.data || []).find(item => item.id === autoPlan.data.id);
  assert(autoPlanAfter && autoPlanAfter.nextDate === '2025-01-03' && autoPlanAfter.status === '待执行', `巡检计划未按周期顺延或到期状态未回退: ${autoPlanAfter && `${autoPlanAfter.nextDate}/${autoPlanAfter.status}`}`);
  await request(`/api/inspection-plans/${autoPlan.data.id}`, { method: 'DELETE', headers: { cookie } });

  // 到期未执行的计划状态应回到「待执行」，避免长期停留在上一轮结果
  const stalePlan = await request('/api/inspection-plans', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, title: '回归到期回退计划', cycle: 'weekly', nextDate: '2025-02-03', owner: 'admin', status: '已执行' })
  });
  assert(stalePlan.status === 201 && stalePlan.data.status === '已执行', '创建到期回退巡检计划失败');
  const stalePlanList = await request('/api/inspection-plans', { headers: { cookie } });
  const stalePlanAfter = (stalePlanList.data.data || []).find(item => item.id === stalePlan.data.id);
  assert(stalePlanAfter && stalePlanAfter.status === '待执行', `到期未执行的巡检计划状态未回退: ${stalePlanAfter && stalePlanAfter.status}`);
  await request(`/api/inspection-plans/${stalePlan.data.id}`, { method: 'DELETE', headers: { cookie } });

  let change = null;
  if (customerId) {
    change = await request('/api/change-records', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, assetId, approverId: changeApproverId, customerId, title: '回归变更', content: '回归测试变更', riskLevel: '中' })
    });
    assert(change.status === 201, '创建变更记录失败');
  }

  // 自审禁止：提交人不能指定自己为审批人
  const selfChangeApproval = await request('/api/change-records', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, approverId, customerId, title: '自审变更', content: '自审', riskLevel: '中' })
  });
  assert(selfChangeApproval.status === 400 && String(selfChangeApproval.data.message || '').includes('本人'), '变更记录不应允许指定提交人本人为审批人');
  const selfApproval = await request('/api/approvals', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, category: 'change', title: '自审审批', content: '自审', approverId, customerId })
  });
  assert(selfApproval.status === 400 && String(selfApproval.data.message || '').includes('本人'), '审批不应允许指定提交人本人为审批人');

  // 审批归属与角色校验：relatedId 必须属于本项目，审批人必须是可写的运维角色
  if (changeApproverId) {
    const approvalWithForeignRelated = await request('/api/approvals', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, category: 'change', title: '越权关联审批', content: '越权', approverId: changeApproverId, customerId, relatedId: 'change_not_exists' })
    });
    assert(approvalWithForeignRelated.status === 400, '审批不应关联不存在的变更记录');
    const viewerUser = await request('/api/users', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `只读审批人-${Date.now()}`, username: `viewer_approver_${Date.now()}`, password: 'Viewer123!', role: 'viewer', projectId })
    });
    assert(viewerUser.status === 201, '创建只读测试账号失败');
    const approvalWithViewerApprover = await request('/api/approvals', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, category: 'change', title: '只读审批人审批', content: '越权', approverId: viewerUser.data.id, customerId })
    });
    assert(approvalWithViewerApprover.status === 400, '只读角色不应被指定为审批人');

    // 独立审批的作废/删除闭环：仅提交人本人或管理员可作废未完成的审批
    const voidCustomer = await request('/api/users', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `作废审批客户-${Date.now()}`, username: `void_customer_${Date.now()}`, password: 'Voidpass1!', role: 'customer', projectId })
    });
    assert(voidCustomer.status === 201, '创建作废审批客户失败');
    const voidableApproval = await request('/api/approvals', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, category: 'other', title: '待作废审批', content: '待作废', approverId: changeApproverId, customerId: voidCustomer.data.id })
    });
    assert(voidableApproval.status === 201, `创建待作废审批失败: ${voidableApproval.status} ${JSON.stringify(voidableApproval.data)}`);
    const voidByEngineer = await request(`/api/approvals/${voidableApproval.data.id}`, { method: 'DELETE', headers: { cookie: engineerCookie } });
    assert(voidByEngineer.status === 403, '非提交人不应作废他人审批');
    const voidByOwner = await request(`/api/approvals/${voidableApproval.data.id}`, { method: 'DELETE', headers: { cookie } });
    assert(voidByOwner.status === 200, '提交人应能作废未完成的审批');
    const approvalsAfterVoid = await request('/api/approvals?all=1', { headers: { cookie } });
    assert(!(approvalsAfterVoid.data.data || []).some(item => item.id === voidableApproval.data.id), '作废后审批不应再出现在列表中');
    const delVoidCustomer = await request(`/api/users/${voidCustomer.data.id}`, { method: 'DELETE', headers: { cookie } });
    assert(delVoidCustomer.status === 200, '清理作废审批客户失败');
    // 管理员删除变更流程审批会级联清理变更记录，用独立数据验证，避免影响后续客户脱敏用例。
    const cascadeChange = await request('/api/change-records', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, assetId, approverId: changeApproverId, customerId, title: '级联删除变更', content: '级联删除', riskLevel: '低' })
    });
    assert(cascadeChange.status === 201 && cascadeChange.data.approvalId, '创建级联删除变更失败');
    const voidLinkedChange = await request(`/api/approvals/${cascadeChange.data.approvalId}`, { method: 'DELETE', headers: { cookie } });
    assert(voidLinkedChange.status === 200 && voidLinkedChange.data.cascadedChangeId === cascadeChange.data.id,
      '管理员删除变更流程审批应级联清理变更记录');
    const changesAfterCascade = await request('/api/change-records?all=1', { headers: { cookie } });
    assert(!(changesAfterCascade.data.data || []).some(item => item.id === cascadeChange.data.id), '级联删除后变更记录不应残留');
  }

  const incident = await request('/api/incidents', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, title: '回归故障', faultType: '网络中断', severity: '中', slaStatus: '正常', status: '处理中', occurredAt: '2026-06-19T13:10', resolution: '待处理' })
  });
  assert(incident.status === 201, '创建故障记录失败');
  const incidentWithoutTime = await request('/api/incidents', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, title: '回归无发生时间故障', faultType: '网络中断' })
  });
  assert(incidentWithoutTime.status === 400, '缺少故障发生时间应返回 400');
  const incidentDelete = await request(`/api/incidents/${incident.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(incidentDelete.status === 200, '删除故障记录失败');

  const aiTarget = await request('/api/ai-inspection/targets', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, name: '回归巡检对象', category: 'server', address: '10.0.0.10', protocol: 'winrm', port: 5985, authType: 'password', account: 'administrator', credentialDomain: 'CONTOSO', password: 'P@ssw0rd!', systemVersion: 'Windows Server 2022', location: '机房A' })
  });
  assert(aiTarget.status === 201, '创建 AI 巡检对象失败');
  assert(aiTarget.data.protocol === 'winrm' && aiTarget.data.authType === 'password', 'AI 巡检对象协议或认证方式不符合预期');
  assert(aiTarget.data.hasPassword === true && !('password' in aiTarget.data), 'AI 巡检对象敏感字段返回不符合预期');
  const aiCustomerPayload = {
    name: '巡检只读客户',
    username: `ai_customer_${Date.now()}`,
    password: 'Testpass1!',
    role: 'customer',
    projectId
  };
  const createAiCustomer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(aiCustomerPayload)
  });
  assert(createAiCustomer.status === 201, '创建巡检测试客户失败');
  const aiCustomerLogin = await login(aiCustomerPayload.username, aiCustomerPayload.password);
  assert(aiCustomerLogin.status === 200 && aiCustomerLogin.data.user?.role === 'customer', '巡检测试客户登录失败');
  const customerTargets = await request('/api/ai-inspection/targets?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerTargets.status === 200, `客户查询巡检对象失败: ${customerTargets.status} ${JSON.stringify(customerTargets.data)}`);
  assert((customerTargets.data.data || []).every(item => item.account === undefined && item.backupCommand === undefined && item.webBackupPath === undefined), '客户巡检对象不应返回账号或备份命令');
  assert((customerTargets.data.data || []).every(item => item.address === undefined), '客户巡检对象不应返回设备地址');
  const customerAssets = await request('/api/assets?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerAssets.status === 200 && (customerAssets.data.data || []).every(item => item.monitorHost === undefined && item.installationLocation === undefined), '客户资产列表不应返回监测地址');
  const customerLayout = await request('/api/assets/cabinet-layout', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerLayout.status === 200, `客户查询布局图失败: ${customerLayout.status} ${JSON.stringify(customerLayout.data)}`);
  const customerDump = JSON.stringify(customerLayout.data);
  assert(!customerDump.includes('monitorHost') && !customerDump.includes('snmpCommunity'), '客户布局数据不应包含监测地址或 SNMP 团体字');
  assert(!customerDump.includes('"metrics"') && !customerDump.includes('cpuPercent'), '客户布局数据不应包含 SNMP 性能指标');
  const customerAiResults = await request('/api/ai-inspection/results?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerAiResults.status === 200 && (customerAiResults.data.data || []).every(item => item.rawOutput === undefined && item.stdout === undefined && item.stderr === undefined && (item.probeError === undefined || item.probeError === true || item.probeError === false)), '客户巡检结果应脱敏探测细节');
  assert((customerAiResults.data.data || []).every(item => !String(item.suggestion || '').includes('10.0.0.10') && !String(item.summary || '').includes('10.0.0.10')), '客户巡检结果不应包含设备地址');
  const customerAiSearch = await request('/api/ai-inspection/results?q=10.0.0.10', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerAiSearch.status === 200 && (customerAiSearch.data.data || []).length === 0, '客户不应通过设备地址搜索巡检结果');
  const firstCustomerResult = (customerAiResults.data.data || [])[0];
  if (firstCustomerResult) {
    const customerReport = await request(`/api/reports/ai-inspection/results/${firstCustomerResult.id}/html`, { method: 'POST', headers: { cookie: aiCustomerLogin.cookie } });
    assert(customerReport.status === 200, '客户下载巡检 HTML 报告失败');
    assert(!String(customerReport.data || '').includes('10.0.0.10'), '客户巡检 HTML 报告不应包含设备地址');
  }
  const customerPlans = await request('/api/inspection-plans?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerPlans.status === 200, `客户读取巡检计划失败: ${customerPlans.status} ${JSON.stringify(customerPlans.data)}`);
  assert((customerPlans.data.data || []).every(item => item.assetId === undefined && item.owner === undefined && item.description === undefined), '客户巡检计划不应返回资产或负责人细节');
  const customerExecutions = await request('/api/inspection-executions?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerExecutions.status === 200, '客户读取巡检执行记录失败');
  assert((customerExecutions.data.data || []).every(item => item.issue === undefined && item.suggestion === undefined && item.checklist === undefined && item.executor === undefined && item.assetId === undefined), '客户巡检执行记录不应返回处理细节');
  const customerAiTasks = await request('/api/ai-inspection/tasks?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerAiTasks.status === 200 && (customerAiTasks.data.data || []).length === 0, '客户不应看到智能巡检任务');
  if (change?.data?.id) {
    const customerChangeDetail = await request('/api/change-records?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
    const customerChangeItem = (customerChangeDetail.data.data || []).find(item => item.id === change.data.id);
    assert(customerChangeItem && customerChangeItem.title === '' && customerChangeItem.content === '' && customerChangeItem.assetId === '' && !customerChangeItem.rejectionReason, '客户变更记录应隐藏标题、正文、资产和驳回原因');
  }
  const deleteAiCustomer = await request(`/api/users/${createAiCustomer.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteAiCustomer.status === 200, '清理巡检测试客户失败');
  const executionDelete = await request(`/api/inspection-executions/${execution.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(executionDelete.status === 200, '删除巡检执行记录失败');
  const planDelete = await request(`/api/inspection-plans/${plan.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(planDelete.status === 200, '删除巡检计划失败');
  if (change?.data?.id) {
    const changeDelete = await request(`/api/change-records/${change.data.id}`, { method: 'DELETE', headers: { cookie } });
    assert(changeDelete.status === 200, '删除变更记录失败');
  }
  const aiTemplates = await request('/api/ai-inspection/templates', { headers: { cookie } });
  assert(aiTemplates.status === 200 && Array.isArray(aiTemplates.data.data) && aiTemplates.data.data.length >= 1, '查询 AI 巡检模板失败');
   const serverTemplate = aiTemplates.data.data.find(item => item.category === 'server');
  assert(serverTemplate, '未找到服务器默认巡检模板');
  const aiInvalidTask = await request('/api/ai-inspection/tasks', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetId: aiTarget.data.id,
      templateId: serverTemplate.id,
      title: 'AI 非法指标任务',
      executor: 'admin',
      executedAt: '2026-06-19T13:50',
      metrics: [{ key: 'cpuUsage', label: 'CPU使用率', unit: '%', warn: 70, critical: 90, direction: 'high', value: 'abc' }]
    })
  });
  assert(aiInvalidTask.status === 400, '非法指标值未返回校验错误');
  const aiTask = await request('/api/ai-inspection/tasks', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetId: aiTarget.data.id,
      templateId: serverTemplate.id,
      title: 'AI 巡检回归任务',
      executor: 'admin',
      executedAt: '2026-06-19T14:00',
      metrics: (serverTemplate.metrics || []).map(metric => ({ ...metric, value: metric.key === 'cpuUsage' ? 95 : 10 }))
    })
  });
  assert(aiTask.status === 201, '创建 AI 巡检任务失败');
  assert(aiTask.data.result?.level === '异常' || aiTask.data.result?.level === '严重', 'AI 巡检结果等级不符合预期');
  // 执行权限收紧到创建者：同项目其它工程师不得执行他人巡检任务
  const engineerExecuteAiTask = await request(`/api/ai-inspection/tasks/${aiTask.data.task.id}/execute`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(engineerExecuteAiTask.status === 403, '非创建者不应执行他人巡检任务');
  const aiFutureTask = await request('/api/ai-inspection/tasks', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetId: aiTarget.data.id,
      templateId: serverTemplate.id,
      title: 'AI 巡检待执行任务',
      executor: 'admin',
      executedAt: '2099-06-19T14:00',
      metrics: (serverTemplate.metrics || []).map(metric => ({ ...metric, value: 10 }))
    })
  });
  assert(aiFutureTask.status === 201, '创建待执行 AI 巡检任务失败');
  assert(aiFutureTask.data.task?.status === '待执行' && !aiFutureTask.data.result, '未来时间任务未保持待执行状态');
  const aiResultsAfterFuture = await request('/api/ai-inspection/results?pageSize=1000', { headers: { cookie } });
  const aiResultsAfterFutureList = Array.isArray(aiResultsAfterFuture.data?.data)
    ? aiResultsAfterFuture.data.data
    : (Array.isArray(aiResultsAfterFuture.data) ? aiResultsAfterFuture.data : []);
  assert(aiResultsAfterFuture.status === 200 && !aiResultsAfterFutureList.some(item => item.taskId === aiFutureTask.data.task.id), '待执行任务提前生成了巡检结果');
  const notificationsAfterAiSnapshot = await exportSystemSnapshot(cookie);
  const aiNotification = (notificationsAfterAiSnapshot.notifications || []).find(item => item.category === 'ai-inspection' && String(item.content || '').includes('AI 巡检回归任务'));
  assert(aiNotification, 'AI 巡检通知未生成');
  const markNotificationRead = await request(`/api/notifications/${aiNotification.id}/read`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(markNotificationRead.status === 200 && markNotificationRead.data.readAt, '通知已读接口失败');
  const notificationPage = await request('/api/notifications?page=1&pageSize=10', { headers: { cookie } });
  assert(notificationPage.status === 200 && Array.isArray(notificationPage.data.data), '通知分页查询失败');
  assert(typeof notificationPage.data.unreadTotal === 'number', '通知未返回 unreadTotal');
  const markAllRead = await request('/api/notifications/read-all', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(markAllRead.status === 200 && typeof markAllRead.data.marked === 'number', '全部已读接口失败');
  const aiFutureTaskExecute = await request(`/api/ai-inspection/tasks/${aiFutureTask.data.task.id}/execute`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(aiFutureTaskExecute.status === 200, '手动执行待执行 AI 巡检任务失败');
  assert(aiFutureTaskExecute.data.task?.status === '失败', '地址不通时手动执行任务未标记失败');
  assert(aiFutureTaskExecute.data.result?.level === '严重', '地址不通时巡检结果未标记严重');
  assert(Array.isArray(aiFutureTaskExecute.data.result?.abnormalItems) && aiFutureTaskExecute.data.result.abnormalItems.some(item => String(item).includes('探测失败')), '地址不通时巡检结果未记录探测失败');
  const aiCycleTask = await request('/api/ai-inspection/tasks', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetId: aiTarget.data.id,
      templateId: serverTemplate.id,
      title: 'AI 周期巡检回归任务',
      executor: 'admin',
      cycle: 'daily',
      executedAt: '2099-06-19T14:00',
      metrics: (serverTemplate.metrics || []).map(metric => ({ ...metric, value: 10 }))
    })
  });
  assert(aiCycleTask.status === 201 && aiCycleTask.data.task?.status === '待执行', '创建周期 AI 巡检任务失败');
  const aiCycleExecute1 = await request(`/api/ai-inspection/tasks/${aiCycleTask.data.task.id}/execute`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(aiCycleExecute1.status === 200 && aiCycleExecute1.data.task?.status === '待执行', '周期巡检失败后未保持待执行');
  const aiCycleExecute2 = await request(`/api/ai-inspection/tasks/${aiCycleTask.data.task.id}/execute`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(aiCycleExecute2.status === 200, '周期巡检第二次执行失败');
  assert(aiCycleExecute1.data.result?.id && aiCycleExecute2.data.result?.id && aiCycleExecute1.data.result.id !== aiCycleExecute2.data.result.id, '周期巡检第二次执行未生成新结果');
  const aiCycleResult1 = await request(`/api/ai-inspection/results/${aiCycleExecute1.data.result.id}`, { headers: { cookie } });
  const aiCycleResult2 = await request(`/api/ai-inspection/results/${aiCycleExecute2.data.result.id}`, { headers: { cookie } });
  assert(aiCycleResult1.status === 200 && aiCycleResult1.data.taskId === aiCycleTask.data.task.id, '周期巡检首个结果查询失败');
  assert(aiCycleResult2.status === 200 && aiCycleResult2.data.taskId === aiCycleTask.data.task.id, '周期巡检第二个结果查询失败');
  const backupTarget = await request('/api/ai-inspection/targets', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, name: '回归配置备份对象', category: 'server', address: '127.0.0.1', protocol: 'http', port: 3000, authType: 'token', accessToken: 'regression-token', systemVersion: 'RegressionOS', location: '机房A', backupMode: 'web', webBackupPath: '/api/health', webBackupMethod: 'GET' })
  });
  assert(backupTarget.status === 201, '创建配置备份巡检对象失败');
  const backupPlan = await request('/api/ai-inspection/config-backup/plans', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId: backupTarget.data.id, name: '回归配置备份计划', cycle: 'daily', executedAt: '2099-06-19T14:00' })
  });
  assert(backupPlan.status === 201, '创建配置备份计划失败');
  // 执行权限收紧到创建者：同项目其它工程师不得执行他人配置备份计划，但可在项目内新建计划
  const engineerExecuteBackup = await request(`/api/ai-inspection/config-backup/plans/${backupPlan.data.id}/execute`, {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(engineerExecuteBackup.status === 403, '非创建者不应执行他人配置备份计划');
  const engineerBackupPlan = await request('/api/ai-inspection/config-backup/plans', {
    method: 'POST',
    headers: { cookie: engineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId: backupTarget.data.id, name: '工程师自建备份计划', cycle: 'daily', executedAt: '2099-06-19T14:00' })
  });
  assert(engineerBackupPlan.status === 201, '同项目工程师应可基于巡检对象新建备份计划');
  await request(`/api/ai-inspection/config-backup/plans/${engineerBackupPlan.data.id}`, { method: 'DELETE', headers: { cookie: engineerCookie } });
  const backupExecute = await request(`/api/ai-inspection/config-backup/plans/${backupPlan.data.id}/execute`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(backupExecute.status === 200 && backupExecute.data.record?.status === '成功', '立即执行配置备份失败');
  const backupRecords = await request('/api/ai-inspection/config-backup/records', { headers: { cookie } });
  const backupRecord = Array.isArray(backupRecords.data.data) ? backupRecords.data.data.find(item => item.planId === backupPlan.data.id) : null;
  assert(backupRecords.status === 200 && backupRecord, '配置备份列表未返回备份记录');
  const backupDownloadGetDenied = await request(`/api/ai-inspection/config-backup/records/${backupRecord.id}/download`, { headers: { cookie } });
  assert(backupDownloadGetDenied.status !== 200, '配置备份下载不应允许 GET');
  const backupDownload = await request(`/api/ai-inspection/config-backup/records/${backupRecord.id}/download`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(backupDownload.status === 200 && String(backupDownload.data || '').includes('配置备份名称'), '配置备份文件下载失败');
  const backupRecordDelete = await request(`/api/ai-inspection/config-backup/records/${backupRecord.id}`, { method: 'DELETE', headers: { cookie } });
  assert(backupRecordDelete.status === 200, '删除配置备份记录失败');
  const backupRecordsAfterDelete = await request('/api/ai-inspection/config-backup/records', { headers: { cookie } });
  const deletedBackupRecord = Array.isArray(backupRecordsAfterDelete.data.data) ? backupRecordsAfterDelete.data.data.find(item => item.id === backupRecord.id) : null;
  assert(backupRecordsAfterDelete.status === 200 && !deletedBackupRecord, '配置备份记录删除后仍存在');
  const backupPlanDelete = await request(`/api/ai-inspection/config-backup/plans/${backupPlan.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(backupPlanDelete.status === 200, '删除配置备份计划失败');
  const backupTargetDelete = await request(`/api/ai-inspection/targets/${backupTarget.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(backupTargetDelete.status === 200, '删除配置备份巡检对象失败');

  // 出站 Web 备份必须拒绝与巡检对象地址不一致的绝对 URL，防止绕过目标校验访问其他主机
  const ssrfTarget = await request('/api/ai-inspection/targets', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, name: '回归出站校验对象', category: 'server', address: '127.0.0.1', protocol: 'http', port: 3000, authType: 'token', accessToken: 'ssrf-token', systemVersion: 'RegressionOS', location: '机房A', backupMode: 'web', webBackupPath: 'http://169.254.169.254/latest/meta-data/', webBackupMethod: 'GET' })
  });
  assert(ssrfTarget.status === 201, '创建出站校验巡检对象失败');
  const ssrfPlan = await request('/api/ai-inspection/config-backup/plans', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId: ssrfTarget.data.id, name: '回归出站校验计划', cycle: 'daily', executedAt: '2099-06-19T14:00' })
  });
  assert(ssrfPlan.status === 201, '创建出站校验计划失败');
  const ssrfExecute = await request(`/api/ai-inspection/config-backup/plans/${ssrfPlan.data.id}/execute`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(ssrfExecute.status === 200 && ssrfExecute.data.record?.status === '失败' && String(ssrfExecute.data.record?.message || '').includes('一致'), 'Web 备份应拒绝与巡检对象地址不一致的绝对 URL');
  await request(`/api/ai-inspection/config-backup/plans/${ssrfPlan.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/ai-inspection/targets/${ssrfTarget.data.id}`, { method: 'DELETE', headers: { cookie } });

  const aiReportHtmlGetDenied = await request(`/api/reports/ai-inspection/results/${encodeURIComponent(aiTask.data.result.id)}/html`, { headers: { cookie } });
  assert(aiReportHtmlGetDenied.status !== 200, 'AI 巡检 HTML 报告不应允许 GET');
  const aiReportHtml = await request(`/api/reports/ai-inspection/results/${encodeURIComponent(aiTask.data.result.id)}/html`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(aiReportHtml.status === 200, 'AI 巡检 HTML 报告失败');
  const aiReportPptx = await request(`/api/reports/ai-inspection/results/${encodeURIComponent(aiTask.data.result.id)}/pptx`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(aiReportPptx.status === 200, 'AI 巡检 PPT 报告失败');
  const aiCycleTaskDelete = await request(`/api/ai-inspection/tasks/${aiCycleTask.data.task.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiCycleTaskDelete.status === 200, '删除周期 AI 巡检任务失败');
  const aiFutureTaskDelete = await request(`/api/ai-inspection/tasks/${aiFutureTask.data.task.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiFutureTaskDelete.status === 200, '删除待执行 AI 巡检任务失败');
  const aiTaskDelete = await request(`/api/ai-inspection/tasks/${aiTask.data.task.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiTaskDelete.status === 200, '删除 AI 巡检任务失败');
  const aiTargetDelete = await request(`/api/ai-inspection/targets/${aiTarget.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiTargetDelete.status === 200, '删除 AI 巡检对象失败');

  const projectPptx = await request(`/api/reports/project/${encodeURIComponent(projectId)}/pptx?period=month`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(projectPptx.status === 200, '项目报表下载失败');
  const projectHtml = await request(`/api/reports/project/${encodeURIComponent(projectId)}/html?period=month`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(projectHtml.status === 200, '项目 HTML 报表失败');
  assert(String(projectHtml.data || '').includes('项目现状摘要'), '项目 HTML 报表缺少项目现状分区');
  assert(String(projectHtml.data || '').includes('周期产出摘要'), '项目 HTML 报表缺少周期产出分区');
  assert(String(projectHtml.data || '').includes('section-group') && String(projectHtml.data || '').includes('项目现状') && String(projectHtml.data || '').includes('资产台账'), '项目 HTML 报表缺少项目现状样式标题');
  assert(String(projectHtml.data || '').includes('section-name') && String(projectHtml.data || '').includes('周期产出') && String(projectHtml.data || '').includes('运维日志'), '项目 HTML 报表缺少周期产出样式标题');
  const inspectionHtml = await request(`/api/reports/inspection/project/${encodeURIComponent(projectId)}/html?period=month`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(inspectionHtml.status === 200, '巡检 HTML 报表失败');
  assert(String(inspectionHtml.data || '').includes('巡检执行报表'), '巡检 HTML 报表标题不正确');
  assert(String(inspectionHtml.data || '').includes('巡检对象画像'), '巡检 HTML 报表缺少巡检对象分区');
  assert(String(inspectionHtml.data || '').includes('异常与整改跟踪'), '巡检 HTML 报表缺少异常整改分区');
  const inspectionCsv = await request(`/api/reports/inspection/project/${encodeURIComponent(projectId)}/csv?period=month`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(inspectionCsv.status === 200, '巡检 CSV 报表失败');

  // 报表导出必须对客户角色应用与列表接口一致的字段脱敏
  const reportSecret = `机密内容-${Date.now()}`;
  const reportKb = await request('/api/kb', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `报表脱敏-${Date.now()}`, keywords: 'report', problem: reportSecret, solution: reportSecret, projectId })
  });
  assert(reportKb.status === 201, '创建报表脱敏知识条目失败');
  const adminReportHtml = await request(`/api/reports/project/${encodeURIComponent(projectId)}/html?period=year`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(adminReportHtml.status === 200 && String(adminReportHtml.data || '').includes(reportSecret), '管理员项目报表应包含知识条目内容');
  const reportCustomerPayload = { name: '报表脱敏客户', username: `report_customer_${Date.now()}`, password: 'Report1pass!', role: 'customer', projectId };
  const createReportCustomer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(reportCustomerPayload)
  });
  assert(createReportCustomer.status === 201, '创建报表脱敏客户失败');
  const reportCustomerLogin = await login(reportCustomerPayload.username, reportCustomerPayload.password);
  assert(reportCustomerLogin.status === 200, '报表脱敏客户登录失败');
  const customerReportHtml = await request(`/api/reports/project/${encodeURIComponent(projectId)}/html?period=year`, {
    method: 'POST',
    headers: { cookie: reportCustomerLogin.cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(customerReportHtml.status === 200, '客户项目报表生成失败');
  assert(!String(customerReportHtml.data || '').includes(reportSecret), '客户项目报表不应泄露知识条目问题与解决方案');
  const customerReportPptx = await request(`/api/reports/project/${encodeURIComponent(projectId)}/pptx?period=year`, {
    method: 'POST',
    headers: { cookie: reportCustomerLogin.cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(customerReportPptx.status === 200, '客户项目 PPTX 报表生成失败');
  await request(`/api/kb/${reportKb.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/users/${createReportCustomer.data.id}`, { method: 'DELETE', headers: { cookie } });

  const reset = await request('/api/system/reset', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Admin123!' })
  });
  assert(reset.status === 200, '初始化数据库失败');
  const usersAfterReset = await request('/api/users', { headers: { cookie } });
  assert(usersAfterReset.status === 200, '初始化后会话失效');
  assert(Array.isArray(usersAfterReset.data.data) && usersAfterReset.data.data.length === 1 && usersAfterReset.data.data[0].username === 'admin', '初始化后保留账号不符合预期');
  const auditAfterReset = await request('/api/audit-logs?all=1', { headers: { cookie } });
  assert(auditAfterReset.status === 200, '初始化后查询操作日志失败');
  assert(hasAuditLog(auditAfterReset.data.data, 'reset', '初始化数据库'), '初始化数据库未写入操作日志');

  const restoreDenied = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}/restore`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(restoreDenied.status === 401, '恢复缺少管理员密码时应拒绝');
  const restore = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}/restore`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Admin123!' })
  });
  assert(restore.status === 200, '恢复原始数据失败');
  const sessionAfterRestore = await request('/api/session', { headers: { cookie } });
  assert(sessionAfterRestore.status === 200 && sessionAfterRestore.data.user?.username === 'admin', '恢复原始数据后当前会话未保留');

  // L5: Customer role KB permission test
  // Ensure stale test user is cleaned up before creating
  const allUsers = await request('/api/users?all=1', { headers: { cookie } });
  const existingCustomerUser = allUsers.data.data.find(u => u.username === 'kb_test_customer');
  if (existingCustomerUser) {
    const kbList = await request('/api/kb?all=1', { headers: { cookie } });
    if (kbList.status === 200 && Array.isArray(kbList.data.data)) {
      const customerKbEntries = kbList.data.data.filter(item => item.createdBy === existingCustomerUser.id);
      for (const entry of customerKbEntries) {
        await request(`/api/kb/${entry.id}`, { method: 'DELETE', headers: { cookie } });
      }
    }
    await request(`/api/users/${existingCustomerUser.id}`, { method: 'DELETE', headers: { cookie } });
  }
  const kbEntriesBefore = await request('/api/kb', { headers: { cookie } });
  assert(kbEntriesBefore.status === 200, '读取知识库列表失败');
  const kbCountBefore = Array.isArray(kbEntriesBefore.data.data) ? kbEntriesBefore.data.data.length : 0;
  const testCustomerUsername = `kb_test_customer_${Date.now()}`;
  const testCustomerUser = { name: 'KB测试客户', username: testCustomerUsername, password: 'Testpass1!', role: 'customer', phone: '', wechat: '', email: '', idCard: '', projectId: '', startDate: '', endDate: '' };
  const createCustomer = await request('/api/users', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(testCustomerUser) });
  assert(createCustomer.status === 201, `创建测试客户失败: ${createCustomer.status} ${JSON.stringify(createCustomer.data)}`);
  const customerLogin = await login(testCustomerUsername, 'Testpass1!');
  assert(customerLogin.status === 200 && customerLogin.data.user?.role === 'customer', '测试客户登录失败或角色不正确');
  const customerCookie = customerLogin.cookie;
  const customerSummaryDenied = await request('/api/reports/summary', { headers: { cookie: customerCookie } });
  assert(customerSummaryDenied.status === 403, '未绑定项目的客户不应查看全库汇总');
  const customerUserList = await request('/api/users?all=1', { headers: { cookie: customerCookie } });
  assert(customerUserList.status === 200 && (customerUserList.data.data || []).length === 0, '未绑定项目的客户用户列表应为空');
  const custKbRead = await request('/api/kb', { headers: { cookie: customerCookie } });
  assert(custKbRead.status === 200 && Array.isArray(custKbRead.data.data), '客户角色无法读取知识库');
  const custKbCreate = await request('/api/kb', { method: 'POST', headers: { cookie: customerCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '客户测试', keywords: 'test', problem: 'test', solution: 'test' }) });
  assert(custKbCreate.status === 403, '客户角色不应允许创建知识库条目（预期 403）');
  const kickPassword = await request(`/api/users/${createCustomer.data.id}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...testCustomerUser, password: 'Testpass2!' })
  });
  assert(kickPassword.status === 200, '管理员修改客户密码失败');
  const kickedSession = await request('/api/session', { headers: { cookie: customerCookie } });
  assert(kickedSession.status === 200 && !kickedSession.data.user, '管理员改密后旧会话应失效');
  const kickedKb = await request('/api/kb', { headers: { cookie: customerCookie } });
  assert(kickedKb.status === 401, '管理员改密后旧会话访问业务接口应失败');
  const delCustomer = await request(`/api/users/${createCustomer.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(delCustomer.status === 200, '清理测试客户失败');

  // L6: Document management CRUD, password, and download
  const docForm1 = new FormData();
  docForm1.append('projectId', projectId);
  docForm1.append('type', 'device');
  docForm1.append('title', '回归测试设备');
  docForm1.append('brand', '华为');
  docForm1.append('model', 'S6730-H48X6C');
  docForm1.append('serialNumber', 'REG-DEV-001');
  docForm1.append('managementIp', '192.168.1.100');
  docForm1.append('loginAccount', 'admin');
  docForm1.append('loginPassword', 'Device@123');
  docForm1.append('purchaseDate', '2026-01-15');
  docForm1.append('warrantyExpiryDate', '2029-01-15');
  docForm1.append('managementMethod', 'ssh');
  docForm1.append('accessPassword', 'DocPass123');
  const createDoc1 = await fetch(base + '/api/documents', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: docForm1 });
  const doc1Data = await createDoc1.json();
  assert(createDoc1.status === 200 || createDoc1.status === 201, `创建设备资料失败: ${doc1Data.message || createDoc1.status}`);
  assert(doc1Data.id, '创建资料未返回 ID');
  assert(!('accessPasswordHash' in doc1Data), '资料返回了 accessPasswordHash 敏感字段');
  const docId1 = doc1Data.id;

  const docForm2 = new FormData();
  docForm2.append('projectId', projectId);
  docForm2.append('type', 'contract');
  docForm2.append('title', '回归测试合同');
  docForm2.append('attachment', new Blob(['回归测试合同内容'], { type: 'application/pdf' }), 'test-contract.pdf');
  docForm2.append('accessPassword', 'DocPass456');
  const createDoc2 = await fetch(base + '/api/documents', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: docForm2 });
  const doc2Data = await createDoc2.json();
  assert(createDoc2.status === 200 || createDoc2.status === 201, `创建合同资料失败: ${doc2Data.message || createDoc2.status}`);
  assert(doc2Data.attachmentName === 'test-contract.pdf', '附件名称未保存');
  const docId2 = doc2Data.id;
  if (process.env.EXPECT_DOCUMENT_QUOTA === '1') {
    // 服务端以 DOCUMENT_QUOTA_PER_USER_BYTES 限制个人累计附件体积，超限时必须拒绝落盘。
    const quotaForm = new FormData();
    quotaForm.append('projectId', projectId);
    quotaForm.append('type', 'contract');
    quotaForm.append('title', '配额测试合同');
    quotaForm.append('attachment', new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'application/pdf' }), 'quota-contract.pdf');
    quotaForm.append('accessPassword', 'DocPass789');
    const quotaResponse = await fetch(base + '/api/documents', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: quotaForm });
    const quotaData = await quotaResponse.json();
    assert(quotaResponse.status === 413 && /配额/.test(String(quotaData.message || '')), '附件超出个人配额应返回 413');
  }

  const listDocs = await request('/api/documents', { headers: { cookie } });
  assert(listDocs.status === 200 && Array.isArray(listDocs.data.data), '资料列表读取失败');
  assert(listDocs.data.data.some(d => d.id === docId1), '资料列表中未找到设备资料');
  assert(listDocs.data.data.some(d => d.id === docId2), '资料列表中未找到合同资料');
  assert(listDocs.data.data.every(d => d.serialNumber === undefined && d.managementIp === undefined && d.loginAccount === undefined), '资料列表不应返回管理字段');

  const listByType = await request(`/api/documents?type=contract`, { headers: { cookie } });
  assert(listByType.status === 200 && listByType.data.data.every(d => d.type === 'contract'), '按类型筛选资料失败');

  const wrongPwd = await request(`/api/documents/${docId1}/verify-password`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'WrongPass123' })
  });
  assert(wrongPwd.status === 401, '错误密码未返回 401');

  const correctPwd = await request(`/api/documents/${docId1}/verify-password`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'DocPass123' })
  });
  assert(correctPwd.status === 200 && correctPwd.data.token, '正确密码验证未返回 token');
  assert(correctPwd.data.loginPassword === 'Device@123', '验密后应返回设备登录密码');

  const docDetailWithoutToken = await request(`/api/documents/${docId1}`, { headers: { cookie } });
  assert(docDetailWithoutToken.status === 403, '未验证 token 不应读取资料详情');

  const docDetailQueryDenied = await request(`/api/documents/${docId1}?token=${encodeURIComponent(correctPwd.data.token)}`, { headers: { cookie } });
  assert(docDetailQueryDenied.status === 403, 'query token 不应读取资料详情');
  const docDetail = await request(`/api/documents/${docId1}`, { headers: { cookie, 'X-Document-Access-Token': correctPwd.data.token } });
  assert(docDetail.status === 200, '查询资料详情失败');
  assert(!docDetail.data.accessPasswordHash && !docDetail.data.loginPasswordHash, '资料详情暴露了密码哈希');
  assert(docDetail.data.serialNumber === 'REG-DEV-001' && docDetail.data.managementIp === '192.168.1.100', '验密后资料详情应返回管理字段');
  const docCustomerPayload = {
    name: '资料只读客户',
    username: `doc_customer_${Date.now()}`,
    password: 'Testpass1!',
    role: 'customer',
    phone: '',
    wechat: '',
    email: '',
    idCard: '',
    projectId,
    startDate: '',
    endDate: ''
  };
  const createDocCustomer = await request('/api/users', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(docCustomerPayload)
  });
  assert(createDocCustomer.status === 201, '创建资料测试客户失败');
  const docCustomerLogin = await login(docCustomerPayload.username, docCustomerPayload.password);
  assert(docCustomerLogin.status === 200, '资料测试客户登录失败');
  const customerDocVerify = await request(`/api/documents/${docId1}/verify-password`, {
    method: 'POST', headers: { cookie: docCustomerLogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'DocPass123' })
  });
  assert(customerDocVerify.status === 200 && customerDocVerify.data.token, '客户验证资料密码失败');
  assert(!customerDocVerify.data.loginPassword, '客户验密后不应返回设备登录密码');
  const customerDocDetail = await request(`/api/documents/${docId1}`, { headers: { cookie: docCustomerLogin.cookie, 'X-Document-Access-Token': customerDocVerify.data.token } });
  assert(customerDocDetail.status === 200, '客户读取资料详情失败');
  assert(customerDocDetail.data.serialNumber === undefined && customerDocDetail.data.managementIp === undefined && customerDocDetail.data.loginAccount === undefined, '客户资料详情不应返回管理字段');
  const deleteDocCustomer = await request(`/api/users/${createDocCustomer.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteDocCustomer.status === 200, '清理资料测试客户失败');

  const downloadResp = await request(`/api/documents/${docId2}/download`, { headers: { cookie } });
  assert(downloadResp.status === 403, '错误 token 应拒绝下载');

  const verifyPwd2 = await request(`/api/documents/${docId2}/verify-password`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'DocPass456' })
  });
  assert(verifyPwd2.status === 200 && verifyPwd2.data.token, '合同密码验证失败');
  const downloadQueryDenied = await fetch(base + `/api/documents/${docId2}/download?token=${encodeURIComponent(verifyPwd2.data.token)}`, { headers: { cookie } });
  assert(downloadQueryDenied.status === 403, 'query token 应拒绝下载');
  const downloadOk = await fetch(base + `/api/documents/${docId2}/download`, { headers: { cookie, 'X-Document-Access-Token': verifyPwd2.data.token } });
  assert(downloadOk.status === 200, '正确 token 下载失败');

  const docUpdateForm = new FormData();
  docUpdateForm.append('type', 'device');
  docUpdateForm.append('title', '回归测试设备-已更新');
  docUpdateForm.append('brand', '华为');
  docUpdateForm.append('model', 'S6730-H48X6C');
  docUpdateForm.append('accessPassword', '');
  const updateDoc = await fetch(base + `/api/documents/${docId1}`, { method: 'PUT', headers: withCsrf({ cookie }, 'PUT'), body: docUpdateForm });
  const updateData = await updateDoc.json();
  assert(updateDoc.status === 200, `更新资料失败: ${updateData.message || updateDoc.status}`);
  assert(updateData.title === '回归测试设备-已更新', '资料标题未更新');

  const docConfigUpdateForm = new FormData();
  docConfigUpdateForm.append('type', 'config');
  docConfigUpdateForm.append('title', '回归测试合同-配置文档');
  docConfigUpdateForm.append('accessPassword', '');
  const updateConfigDoc = await fetch(base + `/api/documents/${docId2}`, { method: 'PUT', headers: withCsrf({ cookie }, 'PUT'), body: docConfigUpdateForm });
  const updateConfigData = await updateConfigDoc.json();
  assert(updateConfigDoc.status === 200, `更新配置文档类型失败: ${updateConfigData.message || updateConfigDoc.status}`);
  assert(updateConfigData.type === 'config', '配置文档类型未更新');

  const verifyAfterUpdate = await request(`/api/documents/${docId1}/verify-password`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'DocPass123' })
  });
  assert(verifyAfterUpdate.status === 200, '密码留空后原密码应保持不变');

  // 连续 3 次错误密码应锁定 5 分钟，锁定期间即使密码正确也必须拒绝。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const failedVerify = await request(`/api/documents/${docId1}/verify-password`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: `WrongDocPass${attempt}` })
    });
    assert(failedVerify.status === 401 || failedVerify.status === 429, '错误资料密码未返回预期状态');
  }
  const lockedVerify = await request(`/api/documents/${docId1}/verify-password`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'DocPass123' })
  });
  assert(lockedVerify.status === 429, '连续错误密码后资料验密未锁定');

  const delDoc2 = await request(`/api/documents/${docId2}`, { method: 'DELETE', headers: { cookie } });
  assert(delDoc2.status === 200, '删除资料失败');
  const listAfterDel = await request('/api/documents', { headers: { cookie } });
  assert(!listAfterDel.data.data.some(d => d.id === docId2), '删除后资料仍存在');

  const delDoc1 = await request(`/api/documents/${docId1}`, { method: 'DELETE', headers: { cookie } });
  assert(delDoc1.status === 200, '清理设备资料失败');

  const auditAfterDocs = await request('/api/audit-logs?all=1&sortBy=createdAt&sortDirection=desc', { headers: { cookie } });
  const docCreateLog = (auditAfterDocs.data.data || []).find(item => item.targetType === 'document' && item.action === 'create');
  assert(docCreateLog, '创建资料未写入操作日志');
  const docDeleteLog = (auditAfterDocs.data.data || []).find(item => item.targetType === 'document' && item.action === 'delete');
  assert(docDeleteLog, '删除资料未写入操作日志');
  const docDownloadLog = (auditAfterDocs.data.data || []).find(item => item.targetType === 'document' && item.action === 'access');
  assert(docDownloadLog, '资料下载未写入操作日志');

  // L3: Concurrent operation test - verify DB write lock prevents corruption
  const assetA = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '并发测试资产A', brand: '', model: '', type: '服务器', version: '', serialNumber: '', status: '运行中', projectId, maintainExpiryDate: '' })
  });
  const assetB = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '并发测试资产B', brand: '', model: '', type: '网络设备', version: '', serialNumber: '', status: '运行中', projectId, maintainExpiryDate: '' })
  });
  assert(assetA.status === 201 || assetA.status === 200, `创建资产A失败: ${assetA.data?.message || assetA.status}`);
  assert(assetB.status === 201 || assetB.status === 200, `创建资产B失败: ${assetB.data?.message || assetB.status}`);
  const assetList = await request('/api/assets', { headers: { cookie } });
  const foundA = (assetList.data.data || []).find(item => item.id === assetA.data.id);
  const foundB = (assetList.data.data || []).find(item => item.id === assetB.data.id);
  assert(foundA && foundB, '创建的资产在后续查询中缺失（写锁异常）');
  await request(`/api/assets/${assetA.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${assetB.data.id}`, { method: 'DELETE', headers: { cookie } });

  const unauthLayout = await request('/api/assets/cabinet-layout');
  assert(unauthLayout.status === 401, '布局图未登录应返回 401');
  const invalidRack = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `布局非法U-${Date.now()}`, brand: '测', model: '测', type: '服务器', serialNumber: `SN-BAD-${Date.now()}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31', cabinetName: '测试机柜', rackUnitStart: 99, rackUnitSize: 1
    })
  });
  assert(invalidRack.status === 400, '起始U超出范围应返回 400');
  const sizeWithoutStart = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `布局缺起始U-${Date.now()}`, brand: '测', model: '测', type: '服务器', serialNumber: `SN-NOSTART-${Date.now()}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31', cabinetName: '测试机柜', rackUnitSize: 4
    })
  });
  assert(sizeWithoutStart.status === 400, '只填写占用U数时应返回 400');
  const layoutPingName = `布局Ping-${Date.now()}`;
  const layoutSnmpName = `布局SNMP-${Date.now()}`;
  const layoutOtherName = `布局他项-${Date.now()}`;
  const layoutConflictA = `布局冲突A-${Date.now()}`;
  const layoutConflictB = `布局冲突B-${Date.now()}`;
  const layoutConflictC = `布局冲突C-${Date.now()}`;
  const conflictCabinetName = `回归冲突柜-${Date.now()}`;
  const pingAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: layoutPingName, brand: '测', model: '测', type: '服务器', serialNumber: `SN-PING-${Date.now()}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31',
      cabinetName: '回归01号机柜', rackUnitStart: 10, rackUnitSize: 2,
      monitorEnabled: true, monitorType: 'ping', monitorHost: '127.0.0.1'
    })
  });
  assert(pingAsset.status === 201, `创建布局 Ping 资产失败: ${JSON.stringify(pingAsset.data)}`);
  const snmpAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: layoutSnmpName, brand: '测', model: '测', type: '网络设备', serialNumber: `SN-SNMP-${Date.now()}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31',
      installationLocation: 'A区机房-回归02号机柜-8U',
      monitorEnabled: true, monitorType: 'snmp', monitorHost: '10.255.255.254', snmpCommunity: 'layout-secret'
    })
  });
  assert(snmpAsset.status === 201, `创建布局 SNMP 资产失败: ${JSON.stringify(snmpAsset.data)}`);
  const conflictA = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: layoutConflictA, brand: '测', model: '测', type: '服务器', serialNumber: `SN-CA-${Date.now()}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31',
      cabinetName: conflictCabinetName, rackUnitStart: 5, rackUnitSize: 2
    })
  });
  const conflictB = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: layoutConflictB, brand: '测', model: '测', type: '服务器', serialNumber: `SN-CB-${Date.now()}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31',
      cabinetName: conflictCabinetName, rackUnitStart: 6, rackUnitSize: 2
    })
  });
  assert(conflictA.status === 201 && conflictB.status === 201, '创建冲突槽位资产失败');
  const conflictC = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: layoutConflictC, brand: '测', model: '测', type: '服务器', serialNumber: `SN-CC-${Date.now()}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31',
      cabinetName: conflictCabinetName, rackUnitStart: 5, rackUnitSize: 2
    })
  });
  assert(conflictC.status === 201, '创建第三台冲突槽位资产失败');
  const otherProject = await request('/api/projects', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `布局隔离项目-${Date.now()}`, customerName: '布局客户' })
  });
  assert(otherProject.status === 201, '创建布局隔离项目失败');
  const otherAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: layoutOtherName, brand: '测', model: '测', type: '服务器', serialNumber: `SN-OT-${Date.now()}`,
      status: '使用中', projectId: otherProject.data.id, maintainExpiryDate: '2027-12-31',
      cabinetName: '他项机柜', rackUnitStart: 1, rackUnitSize: 1
    })
  });
  assert(otherAsset.status === 201, '创建他项目资产失败');
  const layoutSortSuffix = Date.now();
  const sortCabinetSmall = `回归排序2号柜-${layoutSortSuffix}`;
  const sortCabinetLarge = `回归排序10号柜-${layoutSortSuffix}`;
  const sortAssetSmall = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `布局排序A-${layoutSortSuffix}`, brand: '测', model: '测', type: '服务器', serialNumber: `SN-SORT-A-${layoutSortSuffix}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31',
      cabinetName: sortCabinetSmall, rackUnitStart: 1, rackUnitSize: 1
    })
  });
  const sortAssetLarge = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `布局排序B-${layoutSortSuffix}`, brand: '测', model: '测', type: '服务器', serialNumber: `SN-SORT-B-${layoutSortSuffix}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31',
      cabinetName: sortCabinetLarge, rackUnitStart: 1, rackUnitSize: 1
    })
  });
  assert(sortAssetSmall.status === 201 && sortAssetLarge.status === 201, '创建排序测试资产失败');
  const adminLayout = await request('/api/assets/cabinet-layout', { headers: { cookie } });
  assert(adminLayout.status === 200, '管理员查询布局图失败');
  const adminDump = JSON.stringify(adminLayout.data);
  assert(!adminDump.includes('layout-secret') && !adminDump.includes('snmpCommunity') && !adminDump.includes('monitorHost'), '布局接口不应返回监测地址或 SNMP 团体字');
  const adminCabinets = adminLayout.data.cabinets || [];
  const pingCabinet = adminCabinets.find(item => item.name === '回归01号机柜');
  assert(pingCabinet && pingCabinet.devices.some(item => item.assetId === pingAsset.data.id), '带机柜字段的资产应出现在对应机柜');
  const locCabinet = adminCabinets.find(item => item.name === '回归02号机柜');
  assert(locCabinet && locCabinet.devices.some(item => item.assetId === snmpAsset.data.id), '安装位置中的机柜片段应作为机柜名称');
  const pingDevice = pingCabinet.devices.find(item => item.assetId === pingAsset.data.id);
  assert(pingDevice.metrics.cpuPercent === null && pingDevice.metrics.memoryPercent === null && pingDevice.metrics.diskPercent === null && pingDevice.metrics.trafficInBps === null, 'Ping 监测资产的 SNMP 指标应为 null');
  const conflictCabinet = adminCabinets.find(item => item.name === conflictCabinetName);
  assert(conflictCabinet && conflictCabinet.devices.filter(item => item.conflict).length >= 2, '重叠 U 位应标记槽位冲突');
  const conflictDevices = conflictCabinet.devices.filter(item => item.conflict);
  assert(conflictDevices.every(item => item.conflictCount >= 2), '冲突设备应返回分列数量');
  assert(conflictDevices.every(item => item.conflictCount === 3), '三台同槽位设备应分成三列');
  assert(new Set(conflictDevices.map(item => item.conflictColumn)).size === conflictDevices.length, '冲突设备应各自分列显示');
  const sortNames = adminCabinets.map(item => item.name);
  assert(sortNames.indexOf(sortCabinetSmall) !== -1 && sortNames.indexOf(sortCabinetLarge) !== -1, '排序测试机柜应出现在布局中');
  assert(sortNames.indexOf(sortCabinetSmall) < sortNames.indexOf(sortCabinetLarge), '机柜名排序应按数字大小而非字典序');
  const sortCabinetSmallEntry = adminCabinets.find(item => item.name === sortCabinetSmall);
  const sortCabinetSmallDevices = sortCabinetSmallEntry.devices.map(item => item.name);
  assert(sortCabinetSmallDevices.length >= 1, '排序机柜应包含测试设备');
  const engineerRelogin = await login(engineerAccount.username, 'Engineer123!');
  assert(engineerRelogin.status === 200, `工程师重新登录失败: ${engineerRelogin.status}`);
  // 批量归位：把两台设备移到同一新机柜，并按起始 U 顺序排布。
  const relocateCabinet = `回归归位柜-${layoutSortSuffix}`;
  const relocateDenied = await request('/api/assets/cabinet-layout/relocate', {
    method: 'POST', headers: { cookie: engineerRelogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cabinetName: relocateCabinet, updates: [{ assetId: otherAsset.data.id }] })
  });
  assert(relocateDenied.status === 403, '工程师不应归位其他项目资产');
  const relocateEmpty = await request('/api/assets/cabinet-layout/relocate', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cabinetName: relocateCabinet, updates: [] })
  });
  assert(relocateEmpty.status === 400, '空设备列表应返回 400');
  const relocateNoName = await request('/api/assets/cabinet-layout/relocate', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cabinetName: '  ', updates: [{ assetId: sortAssetSmall.data.id }] })
  });
  assert(relocateNoName.status === 400, '空机柜名称应返回 400');
  const relocateOverflow = await request('/api/assets/cabinet-layout/relocate', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cabinetName: relocateCabinet, rackUnitStart: 48, updates: [{ assetId: sortAssetSmall.data.id }, { assetId: sortAssetLarge.data.id }] })
  });
  assert(relocateOverflow.status === 400, '归位超出机柜 U 位上限应返回 400');
  const relocateOk = await request('/api/assets/cabinet-layout/relocate', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cabinetName: relocateCabinet, rackUnitStart: 3, updates: [{ assetId: sortAssetSmall.data.id }, { assetId: sortAssetLarge.data.id }] })
  });
  assert(relocateOk.status === 200 && relocateOk.data.updated === 2, `批量归位失败: ${relocateOk.status} ${JSON.stringify(relocateOk.data)}`);
  const relocateLayout = await request('/api/assets/cabinet-layout', { headers: { cookie } });
  const relocateCabinetEntry = (relocateLayout.data.cabinets || []).find(item => item.name === relocateCabinet);
  assert(relocateCabinetEntry && relocateCabinetEntry.devices.length === 2, '归位后应在新机柜看到两台设备');
  const relocateSmallDevice = relocateCabinetEntry.devices.find(item => item.assetId === sortAssetSmall.data.id);
  const relocateLargeDevice = relocateCabinetEntry.devices.find(item => item.assetId === sortAssetLarge.data.id);
  assert(relocateSmallDevice.rackUnitStart === 3 && relocateLargeDevice.rackUnitStart === 4, '归位应按起始 U 依次排布');
  // 未分配机柜设备需出现在 unassigned 列表并保留 U 位信息。
  const unassignedAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `布局未分配-${layoutSortSuffix}`, brand: '测', model: '测', type: '服务器', serialNumber: `SN-UN-${layoutSortSuffix}`,
      status: '使用中', projectId, maintainExpiryDate: '2027-12-31'
    })
  });
  assert(unassignedAsset.status === 201, '创建未分配机柜资产失败');
  const unassignedLayout = await request('/api/assets/cabinet-layout', { headers: { cookie } });
  const unassignedEntry = (unassignedLayout.data.unassigned || []).find(item => item.assetId === unassignedAsset.data.id);
  assert(unassignedEntry && unassignedEntry.rackUnitSize >= 1, '未分配机柜设备应保留占用 U 数');
  const engineerLayout = await request('/api/assets/cabinet-layout', { headers: { cookie: engineerRelogin.cookie } });
  assert(engineerLayout.status === 200, `工程师查询布局图失败: ${engineerLayout.status} ${JSON.stringify(engineerLayout.data)}`);
  const engineerNames = (engineerLayout.data.cabinets || []).map(item => item.name);
  assert(!engineerNames.includes('他项机柜'), '工程师不应看到其他项目机柜');
  assert(engineerNames.includes('回归01号机柜'), '工程师应看到本项目机柜');
  const scopedLayout = await request(`/api/assets/cabinet-layout?projectId=${otherProject.data.id}`, { headers: { cookie } });
  assert(scopedLayout.status === 200, '管理员按项目查询布局图失败');
  assert((scopedLayout.data.cabinets || []).every(item => item.projectId === otherProject.data.id), '管理员按项目过滤应只返回该项目机柜');
  const otherCabinet = adminCabinets.find(item => item.name === '他项机柜' && item.projectId === otherProject.data.id);
  assert(otherCabinet && otherCabinet.projectId === otherProject.data.id, '同名机柜应按项目拆分');
  assert(otherCabinet.label && otherCabinet.label.includes('布局隔离项目'), '多项目机柜标题应带项目标识');

  // 巡检模板按项目隔离：管理员可指定归属项目，其他项目工程师不可见且不可改删
  const scopedTemplate = await request('/api/ai-inspection/templates', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `项目隔离模板-${Date.now()}`, category: 'server', projectId: otherProject.data.id,
      metrics: [{ key: 'cpuUsage', label: 'CPU使用率', unit: '%', warn: 70, critical: 90, direction: 'high' }]
    })
  });
  assert(scopedTemplate.status === 201 && scopedTemplate.data.projectId === otherProject.data.id, '管理员应能创建指定项目的巡检模板');
  const bogusProjectTemplate = await request('/api/ai-inspection/templates', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `非法项目模板-${Date.now()}`, category: 'server', projectId: 'project_not_exists',
      metrics: [{ key: 'cpuUsage', label: 'CPU使用率', unit: '%', warn: 70, critical: 90, direction: 'high' }]
    })
  });
  assert(bogusProjectTemplate.status === 400, '巡检模板不应绑定不存在的项目');
  const crossProjectSpare = await request('/api/spare-parts', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `跨项目备件-${Date.now()}`, projectId: otherProject.data.id, assetId: sortAssetSmall.data.id, quantity: 1, safeStock: 0 })
  });
  assert(crossProjectSpare.status === 400, '备件不应关联其他项目的资产');
  const spareOnOther = await request('/api/spare-parts', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `归属备件-${Date.now()}`, projectId, assetId: sortAssetSmall.data.id, quantity: 2, safeStock: 0 })
  });
  assert(spareOnOther.status === 201 && spareOnOther.data.assetId === sortAssetSmall.data.id, `创建归属备件失败: ${spareOnOther.status} ${JSON.stringify(spareOnOther.data)}`);
  const spareProjectMove = await request(`/api/spare-parts/${spareOnOther.data.id}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: otherProject.data.id })
  });
  assert(spareProjectMove.status === 200 && spareProjectMove.data.assetId === '', `备件改项目后应清空不匹配的关联资产: ${spareProjectMove.status} ${JSON.stringify(spareProjectMove.data)}`);
  await request(`/api/spare-parts/${spareOnOther.data.id}`, { method: 'DELETE', headers: { cookie } });
  const engineerTemplates = await request('/api/ai-inspection/templates?all=1', { headers: { cookie: engineerRelogin.cookie } });
  assert(engineerTemplates.status === 200, '工程师查询巡检模板失败');
  assert(!(engineerTemplates.data.data || []).some(item => item.id === scopedTemplate.data.id), '工程师不应看到其他项目的巡检模板');
  assert((engineerTemplates.data.data || []).some(item => item.createdBy === 'system'), '工程师应能看到内置巡检模板');
  const crossProjectTemplatePut = await request(`/api/ai-inspection/templates/${scopedTemplate.data.id}`, {
    method: 'PUT', headers: { cookie: engineerRelogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '跨项目改名' })
  });
  assert(crossProjectTemplatePut.status === 403, '工程师不应修改其他项目的巡检模板');
  const engineerTemplate = await request('/api/ai-inspection/templates', {
    method: 'POST', headers: { cookie: engineerRelogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `工程师自建模板-${Date.now()}`, category: 'network',
      metrics: [{ key: 'packetLoss', label: '丢包率', unit: '%', warn: 1, critical: 5, direction: 'high' }]
    })
  });
  assert(engineerTemplate.status === 201 && engineerTemplate.data.projectId === projectId, '工程师创建模板应归属本项目的 projectId');
  const scopedTemplateDelete = await request(`/api/ai-inspection/templates/${scopedTemplate.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(scopedTemplateDelete.status === 200, '管理员应能删除项目隔离巡检模板');
  const engineerTemplateDelete = await request(`/api/ai-inspection/templates/${engineerTemplate.data.id}`, { method: 'DELETE', headers: { cookie: engineerRelogin.cookie } });
  assert(engineerTemplateDelete.status === 200, '工程师应能删除自己创建的巡检模板');

  // 一人多项目：projectIds 参与权限判断，主项目仍是默认写归属。
  const lifecycleSuffix = Date.now();
  const multiProject = await request('/api/projects', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `多项目回归项目-${lifecycleSuffix}`, customerName: '多项目客户' })
  });
  assert(multiProject.status === 201, '创建多项目回归项目失败');
  const multiUsername = `multi_engineer_${lifecycleSuffix}`;
  const multiUser = await request('/api/users', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: multiUsername, password: 'MultiPass1!', role: 'engineer', name: '多项目回归工程师',
      projectId, projectIds: [projectId, multiProject.data.id]
    })
  });
  assert(multiUser.status === 201, `创建多项目工程师失败: ${JSON.stringify(multiUser.data)}`);
  const multiLogin = await login(multiUsername, 'MultiPass1!');
  assert(multiLogin.status === 200, '多项目工程师登录失败');
  const multiCookie = multiLogin.cookie;
  const multiProjects = await request('/api/projects?all=1', { headers: { cookie: multiCookie } });
  const multiProjectIds = (multiProjects.data.data || []).map(item => item.id);
  assert(multiProjectIds.includes(projectId) && multiProjectIds.includes(multiProject.data.id), '多项目工程师应看到主项目与兼任项目');
  assert(!multiProjectIds.includes(otherProject.data.id), '多项目工程师不应看到未授权项目');
  const multiAssetOther = await request('/api/assets', {
    method: 'POST', headers: { cookie: multiCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `多项目兼任资产-${lifecycleSuffix}`, type: '服务器', brand: '测', model: '测',
      serialNumber: `SN-MULTI-${lifecycleSuffix}`, status: '使用中', maintainExpiryDate: '2027-12-31',
      projectId: multiProject.data.id
    })
  });
  assert(multiAssetOther.status === 201 && multiAssetOther.data.projectId === multiProject.data.id, '工程师应能在兼任项目下创建资产');
  const multiScopedAssets = await request('/api/assets?all=1', { headers: { cookie: multiCookie } });
  const multiVisibleProjectIds = new Set((multiScopedAssets.data.data || []).map(item => item.projectId));
  assert(multiVisibleProjectIds.has(projectId) && multiVisibleProjectIds.has(multiProject.data.id), '多项目资产列表应覆盖主项目与兼任项目');
  assert(!multiVisibleProjectIds.has(otherProject.data.id), '多项目资产列表不应包含未授权项目');
  const multiCrossEdit = await request(`/api/assets/${otherAsset.data.id}`, {
    method: 'PUT', headers: { cookie: multiCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '越权改名' })
  });
  assert(multiCrossEdit.status === 403, '多项目工程师修改未授权项目资产应返回 403');
  const multiCrossTransfer = await request(`/api/assets/${multiAssetOther.data.id}/transfer`, {
    method: 'POST', headers: { cookie: multiCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: otherProject.data.id, reason: '越权调拨' })
  });
  assert(multiCrossTransfer.status === 403, '工程师不应执行跨项目调拨');

  // 资产全生命周期：借出 → 归还 → 调拨 → 报废，以及盘点差异。
  const lifecycleAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `生命周期资产-${lifecycleSuffix}`, type: '服务器', brand: '测', model: '测',
      serialNumber: `SN-LIFE-${lifecycleSuffix}`, status: '使用中', maintainExpiryDate: '2027-12-31',
      projectId, cabinetName: '生命周期柜', rackUnitStart: 20, rackUnitSize: 1,
      monitorEnabled: true, monitorType: 'ping', monitorHost: '127.0.0.1'
    })
  });
  assert(lifecycleAsset.status === 201, `创建生命周期资产失败: ${JSON.stringify(lifecycleAsset.data)}`);
  const lifeAssetId = lifecycleAsset.data.id;
  const checkoutRecord = await request('/api/asset-checkouts', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId: lifeAssetId, borrowerId: approverId, purpose: '回归借出', dueAt: '2027-01-31' })
  });
  assert(checkoutRecord.status === 201 && checkoutRecord.data.status === 'checked_out', '资产借出登记失败');
  const lifeAssetAfterCheckout = (await request('/api/assets?all=1', { headers: { cookie } })).data.data.find(item => item.id === lifeAssetId);
  assert(lifeAssetAfterCheckout?.status === '借出', '借出后资产状态应变为借出');
  const duplicateCheckout = await request('/api/asset-checkouts', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId: lifeAssetId, borrowerId: approverId, purpose: '重复借出' })
  });
  assert(duplicateCheckout.status === 400, '重复借出应返回 400');
  const retireWhileCheckedOut = await request(`/api/assets/${lifeAssetId}/retire`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '借出中退役' })
  });
  assert(retireWhileCheckedOut.status === 400, '借出中的资产不应允许退役');
  const returnRecord = await request(`/api/asset-checkouts/${checkoutRecord.data.id}/return`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ condition: '外观完好' })
  });
  assert(returnRecord.status === 200 && returnRecord.data.status === 'returned', '资产归还失败');
  const lifeAssetAfterReturn = (await request('/api/assets?all=1', { headers: { cookie } })).data.data.find(item => item.id === lifeAssetId);
  assert(lifeAssetAfterReturn?.status === '使用中', '归还后资产状态应恢复为使用中');
  const transferBack = await request(`/api/assets/${lifeAssetId}/transfer`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: otherProject.data.id, reason: '回归调拨' })
  });
  assert(transferBack.status === 200 && transferBack.data.projectId === otherProject.data.id, '资产调拨失败');
  const lifecyclesAfterTransfer = await request(`/api/asset-lifecycles?assetId=${encodeURIComponent(lifeAssetId)}&all=1`, { headers: { cookie } });
  const lifecycleActions = (lifecyclesAfterTransfer.data.data || []).map(item => item.action);
  assert(lifecycleActions.includes('create') && lifecycleActions.includes('checkout') && lifecycleActions.includes('return'), '生命周期流水缺少创建/借出/归还记录');
  assert(lifecycleActions.includes('transfer'), '生命周期流水缺少调拨记录');
  assert((lifecyclesAfterTransfer.data.data || []).every(item => item.projectId === otherProject.data.id), '调拨后历史流水应跟随资产归属');
  const transferWithoutReason = await request(`/api/assets/${lifeAssetId}/scrap`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert(transferWithoutReason.status === 400, '报废未填写原因应返回 400');
  const scrapAsset = await request(`/api/assets/${lifeAssetId}/scrap`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '主板损坏' })
  });
  assert(scrapAsset.status === 200 && scrapAsset.data.status === '已报废', '资产报废失败');
  assert(scrapAsset.data.monitorEnabled === false, '报废资产应自动停止监控');
  const directTerminal = await request(`/api/assets/${lifeAssetId}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '已退役' })
  });
  assert(directTerminal.status === 200, '终态资产之间允许管理员调整终态类型');
  const inventoryTask = await request('/api/asset-inventory-tasks', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: multiProject.data.id, name: `回归盘点-${lifecycleSuffix}` })
  });
  assert(inventoryTask.status === 201 && inventoryTask.data.items.length >= 1, '创建盘点任务失败');
  const inventoryTaskId = inventoryTask.data.id;
  const inventoryStart = await request(`/api/asset-inventory-tasks/${inventoryTaskId}/start`, { method: 'POST', headers: { cookie } });
  assert(inventoryStart.status === 200 && inventoryStart.data.status === 'running', '启动盘点任务失败');
  const inventoryEntries = inventoryTask.data.items.map((item, index) => index === 0
    ? { assetId: item.assetId, missing: true, note: '回归缺失' }
    : { assetId: item.assetId, actualStatus: item.expectedStatus, location: item.location });
  const inventorySave = await request(`/api/asset-inventory-tasks/${inventoryTaskId}/items`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: inventoryEntries })
  });
  assert(inventorySave.status === 200, `登记盘点结果失败: ${JSON.stringify(inventorySave.data)}`);
  assert(inventorySave.data.items.some(item => item.result === 'missing'), '盘点缺失应标记为 missing');
  const inventoryComplete = await request(`/api/asset-inventory-tasks/${inventoryTaskId}/complete`, { method: 'POST', headers: { cookie } });
  assert(inventoryComplete.status === 200 && inventoryComplete.data.status === 'completed', '完成盘点任务失败');
  const inventoryAfter = await request('/api/asset-inventory-tasks?all=1', { headers: { cookie: multiCookie } });
  assert((inventoryAfter.data.data || []).some(item => item.id === inventoryTaskId), '多项目工程师应能查看主项目盘点任务');
  const inventoryForeign = await request('/api/asset-inventory-tasks?all=1', { headers: { cookie: engineerRelogin.cookie } });
  assert(!(inventoryForeign.data.data || []).some(item => item.id === inventoryTaskId), '其他项目工程师不应看到盘点任务');

  // 监控历史与告警处置：连续失败触发、确认后重触发、静默抑制、维护窗口抑制与恢复。
  const monitorOutsiderName = `monitor_outsider_${Date.now()}`;
  const monitorOutsider = await request('/api/users', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: monitorOutsiderName, password: 'MonitorPass1!', role: 'engineer',
      name: '监控越权回归工程师', projectId: multiProject.data.id
    })
  });
  assert(monitorOutsider.status === 201, `创建监控越权测试账号失败: ${JSON.stringify(monitorOutsider.data)}`);
  const monitorOutsiderLogin = await login(monitorOutsiderName, 'MonitorPass1!');
  assert(monitorOutsiderLogin.status === 200, '监控越权测试账号登录失败');
  const monitorOutsiderCookie = monitorOutsiderLogin.cookie;
  const monitorSettings = await updateSystemSettings(cookie, { monitorSampleIntervalMinutes: 1, monitorConsecutiveFailures: 1 });
  assert(monitorSettings.status === 200 && monitorSettings.data.systemConfig?.monitorConsecutiveFailures === 1, '监控阈值设置保存失败');
  const monitorAssetName = `监控回归资产-${Date.now()}`;
  const monitorAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: monitorAssetName, type: '服务器', brand: '测', model: '测',
      serialNumber: `SN-MONITOR-${Date.now()}`, status: '使用中', maintainExpiryDate: '2027-12-31',
      projectId, monitorEnabled: true, monitorType: 'tcp', monitorHost: '127.0.0.1', monitorPort: 1
    })
  });
  assert(monitorAsset.status === 201, `创建监控回归资产失败: ${JSON.stringify(monitorAsset.data)}`);
  const monitorAssetId = monitorAsset.data.id;
  const monitorRun = await runMonitorNow(cookie, [monitorAssetId]);
  assert(monitorRun.status === 200 && monitorRun.data.sampled === true, `手动采集失败: ${JSON.stringify(monitorRun.data)}`);
  const monitorHistory = await request(`/api/monitor/history?assetId=${encodeURIComponent(monitorAssetId)}&range=1h`, { headers: { cookie } });
  assert(monitorHistory.status === 200 && monitorHistory.data.sampleCount >= 1, '监控历史未写入采样');
  assert(Array.isArray(monitorHistory.data.points) && monitorHistory.data.points.length > 0, '监控趋势缺少数据点');
  assert(monitorHistory.data.availability === 0, '离线资产的可用性应统计为 0');
  const openAlerts = await request(`/api/monitor/alerts?assetId=${encodeURIComponent(monitorAssetId)}&status=open&all=1`, { headers: { cookie } });
  const availabilityAlert = (openAlerts.data.data || []).find(item => item.metric === 'availability');
  assert(openAlerts.status === 200 && availabilityAlert && availabilityAlert.status === 'open', '连续失败应触发可用性告警');
  const historyForeign = await request(`/api/monitor/history?assetId=${encodeURIComponent(monitorAssetId)}&range=1h`, { headers: { cookie: monitorOutsiderCookie } });
  assert(historyForeign.status === 403, '其他项目工程师查看监控历史应返回 403');
  const foreignAlerts = await request(`/api/monitor/alerts?assetId=${encodeURIComponent(monitorAssetId)}&all=1`, { headers: { cookie: monitorOutsiderCookie } });
  assert(foreignAlerts.status === 200 && (foreignAlerts.data.data || []).length === 0, '其他项目工程师不应看到告警');
  const foreignAck = await request(`/api/monitor/alerts/${availabilityAlert.id}/acknowledge`, {
    method: 'POST', headers: { cookie: monitorOutsiderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: '越权确认' })
  });
  assert(foreignAck.status === 403, '其他项目工程师确认告警应返回 403');
  const ackAlert = await request(`/api/monitor/alerts/${availabilityAlert.id}/acknowledge`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: '已通知现场' })
  });
  assert(ackAlert.status === 200 && ackAlert.data.status === 'acknowledged' && ackAlert.data.acknowledgeNote === '已通知现场', '告警确认失败');
  await runMonitorNow(cookie, [monitorAssetId]);
  const reopenedAlerts = await request(`/api/monitor/alerts?assetId=${encodeURIComponent(monitorAssetId)}&all=1`, { headers: { cookie } });
  const reopenedAlert = (reopenedAlerts.data.data || []).find(item => item.id === availabilityAlert.id);
  assert(reopenedAlert?.status === 'open' && reopenedAlert.occurrences >= 2, '已确认告警再次触发应回到待确认并累计次数');
  const notificationsBeforeSilence = await listProjectNotifications(cookie, projectId);
  const alertNotificationCount = notificationsBeforeSilence.filter(item => item.sourceId === monitorAssetId && item.category === 'monitor-alert').length;
  const silenceAlert = await request(`/api/monitor/alerts/${availabilityAlert.id}/silence`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: 30 })
  });
  assert(silenceAlert.status === 200 && Date.parse(silenceAlert.data.silencedUntil) > Date.now(), '告警静默失败');
  await runMonitorNow(cookie, [monitorAssetId]);
  const notificationsAfterSilence = await listProjectNotifications(cookie, projectId);
  assert(notificationsAfterSilence.filter(item => item.sourceId === monitorAssetId && item.category === 'monitor-alert').length === alertNotificationCount, '静默期内不应重复推送告警通知');
  const resolveAlert = await request(`/api/monitor/alerts/${availabilityAlert.id}/resolve`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '回归人工恢复' })
  });
  assert(resolveAlert.status === 200 && resolveAlert.data.status === 'resolved', '告警恢复标记失败');

  const maintenanceAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `维护窗口资产-${Date.now()}`, type: '服务器', brand: '测', model: '测',
      serialNumber: `SN-WINDOW-${Date.now()}`, status: '使用中', maintainExpiryDate: '2027-12-31',
      projectId, monitorEnabled: true, monitorType: 'tcp', monitorHost: '127.0.0.1', monitorPort: 1
    })
  });
  assert(maintenanceAsset.status === 201, '创建维护窗口资产失败');
  const maintenanceAssetId = maintenanceAsset.data.id;
  const maintenanceWindow = await request('/api/monitor/maintenance-windows', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `回归维护窗口-${Date.now()}`, projectId, assetIds: [maintenanceAssetId],
      startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(),
      notes: '回归窗口'
    })
  });
  assert(maintenanceWindow.status === 201, `创建维护窗口失败: ${JSON.stringify(maintenanceWindow.data)}`);
  await runMonitorNow(cookie, [maintenanceAssetId]);
  const suppressedAlerts = await request(`/api/monitor/alerts?assetId=${encodeURIComponent(maintenanceAssetId)}&all=1`, { headers: { cookie } });
  const suppressedAlert = (suppressedAlerts.data.data || []).find(item => item.metric === 'availability');
  assert(suppressedAlert?.suppressedReason === 'maintenance', '维护窗口内的告警应标记为维护抑制');
  const windowUpdate = await request(`/api/monitor/maintenance-windows/${maintenanceWindow.data.id}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `回归维护窗口改名-${Date.now()}` })
  });
  assert(windowUpdate.status === 200 && windowUpdate.data.name.startsWith('回归维护窗口改名-'), '维护窗口修改失败');
  const windowDelete = await request(`/api/monitor/maintenance-windows/${maintenanceWindow.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(windowDelete.status === 200, '维护窗口删除失败');
  await runMonitorNow(cookie, [maintenanceAssetId]);
  const resumedAlerts = await request(`/api/monitor/alerts?assetId=${encodeURIComponent(maintenanceAssetId)}&all=1`, { headers: { cookie } });
  const resumedAlert = (resumedAlerts.data.data || []).find(item => item.metric === 'availability');
  assert(resumedAlert?.suppressedReason === '', '维护窗口结束后应恢复正常告警推送状态');

  // 通知外发通道：Webhook 投递、签名、事件订阅、权限与参数校验。
  const webhookReceiver = await startWebhookReceiver();
  try {
    const badChannel = await request('/api/notification-channels', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '非法通道', type: 'webhook', webhookUrl: 'ftp://example.com/hook', events: ['monitor-alert'] })
    });
    assert(badChannel.status === 400, '非 http(s) Webhook 地址应返回 400');
    const badEmailChannel = await request('/api/notification-channels', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '缺收件人', type: 'email', smtpHost: '127.0.0.1', smtpPort: '2525', fromAddress: 'ops@example.com', toAddresses: [], events: ['monitor-alert'] })
    });
    assert(badEmailChannel.status === 400, '邮件通道缺少收件人应返回 400');
    const createChannel = await request('/api/notification-channels', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `回归 Webhook-${Date.now()}`,
        type: 'webhook',
        projectId,
        events: ['monitor-alert'],
        webhookUrl: `http://127.0.0.1:${webhookReceiver.port}/hook`,
        webhookSecret: 'regression-webhook-secret'
      })
    });
    assert(createChannel.status === 201 && createChannel.data.hasWebhookSecret === true, `创建 Webhook 通道失败: ${JSON.stringify(createChannel.data)}`);
    assert(createChannel.data.webhookSecret === undefined, 'Webhook 通道不应返回明文密钥');
    const channelList = await request('/api/notification-channels', { headers: { cookie } });
    assert(channelList.status === 200 && (channelList.data.data || []).some(item => item.id === createChannel.data.id), '通知通道列表缺少新建通道');
    assert((channelList.data.events || []).some(item => item.value === 'monitor-alert'), '通知通道应返回可选事件目录');
    const foreignChannelList = await request('/api/notification-channels', { headers: { cookie: monitorOutsiderCookie } });
    assert(foreignChannelList.status === 403, '非管理员不应查看通知通道');
    const testChannel = await request(`/api/notification-channels/${createChannel.data.id}/test`, { method: 'POST', headers: { cookie } });
    assert(testChannel.status === 200 && webhookReceiver.received.length === 1, `测试投递失败: ${JSON.stringify(testChannel.data)}`);
    const testPayload = JSON.parse(webhookReceiver.received[0].body);
    assert(testPayload.title === '通知通道测试' && testPayload.msgtype === 'text', 'Webhook 测试载荷格式异常');
    assert(Boolean(webhookReceiver.received[0].headers['x-onsite-signature']), 'Webhook 应携带 HMAC 签名头');

    const channelAsset = await request('/api/assets', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `通知通道资产-${Date.now()}`, type: '服务器', brand: '测', model: '测',
        serialNumber: `SN-NOTIFY-${Date.now()}`, status: '使用中', maintainExpiryDate: '2027-12-31',
        projectId, monitorEnabled: true, monitorType: 'tcp', monitorHost: '127.0.0.1', monitorPort: 1
      })
    });
    assert(channelAsset.status === 201, '创建通知通道测试资产失败');
    await runMonitorNow(cookie, [channelAsset.data.id]);
    const webhookDelivered = await waitFor(() => webhookReceiver.received.length >= 2, 15000);
    assert(webhookDelivered, '监控告警未推送到 Webhook 通道');
    const alertPayload = JSON.parse(webhookReceiver.received[webhookReceiver.received.length - 1].body);
    assert(alertPayload.event === 'monitor-alert' && alertPayload.notificationId, 'Webhook 告警事件载荷异常');
    const channelAfterSend = await request('/api/notification-channels', { headers: { cookie } });
    const sentChannel = (channelAfterSend.data.data || []).find(item => item.id === createChannel.data.id);
    assert(sentChannel?.lastSentAt && !sentChannel.lastError, 'Webhook 发送后应记录最近发送时间且无错误');
    const disableChannel = await request(`/api/notification-channels/${createChannel.data.id}`, {
      method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    assert(disableChannel.status === 200 && disableChannel.data.enabled === false, '停用通知通道失败');
    assert(disableChannel.data.hasWebhookSecret === true, '编辑通道时应保留已配置的密钥');
    const deleteChannel = await request(`/api/notification-channels/${createChannel.data.id}`, { method: 'DELETE', headers: { cookie } });
    assert(deleteChannel.status === 200, '删除通知通道失败');
    await request(`/api/assets/${channelAsset.data.id}`, { method: 'DELETE', headers: { cookie } });
  } finally {
    webhookReceiver.server.close();
  }

  await request(`/api/assets/${monitorAssetId}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${maintenanceAssetId}`, { method: 'DELETE', headers: { cookie } });
  const deleteMonitorOutsider = await request(`/api/users/${monitorOutsider.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteMonitorOutsider.status === 200, `清理监控越权测试账号失败: ${JSON.stringify(deleteMonitorOutsider.data)}`);
  const restoreMonitorSettings = await updateSystemSettings(cookie, { monitorSampleIntervalMinutes: 5, monitorConsecutiveFailures: 3 });
  assert(restoreMonitorSettings.status === 200, '恢复监控阈值设置失败');

  await request(`/api/assets/${multiAssetOther.data.id}`, { method: 'DELETE', headers: { cookie } });
  const deleteMultiUser = await request(`/api/users/${multiUser.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteMultiUser.status === 200, `清理多项目工程师失败: ${JSON.stringify(deleteMultiUser.data)}`);
  const deleteMultiProject = await request(`/api/projects/${multiProject.data.id}?force=1`, { method: 'DELETE', headers: { cookie } });
  assert(deleteMultiProject.status === 200, '清理多项目回归项目失败');
  await request(`/api/assets/${lifeAssetId}`, { method: 'DELETE', headers: { cookie } });

  await request(`/api/assets/${pingAsset.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${snmpAsset.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${conflictA.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${conflictB.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${conflictC.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${otherAsset.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${sortAssetSmall.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${sortAssetLarge.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${unassignedAsset.data.id}`, { method: 'DELETE', headers: { cookie } });

  const unnamedAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '   ', type: '服务器', projectId, brand: '测', model: '测', serialNumber: `SN-EMPTY-${Date.now()}`, status: '使用中', maintainExpiryDate: '2027-12-31' })
  });
  assert(unnamedAsset.status === 400, '空资产名称应返回 400');
  const badMonitorHost = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `非法监控地址-${Date.now()}`, type: '服务器', projectId, brand: '测', model: '测', serialNumber: `SN-HOST-${Date.now()}`,
      status: '使用中', maintainExpiryDate: '2027-12-31', monitorEnabled: true, monitorType: 'ping', monitorHost: 'A区机房-01号机柜'
    })
  });
  assert(badMonitorHost.status === 400, '非法监控地址应返回 400');
  const reservedPut = await request('/api/assets/cabinet-layout', {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '不应更新' })
  });
  assert(reservedPut.status === 404, 'PUT 保留路径应返回 404');
  const noSnmpName = `无团体字-${Date.now()}`;
  const noSnmpAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: noSnmpName, type: '网络设备', projectId, brand: '测', model: '测', serialNumber: `SN-NOSNMP-${Date.now()}`,
      status: '使用中', maintainExpiryDate: '2027-12-31', monitorEnabled: true, monitorType: 'snmp', monitorHost: '10.255.255.253'
    })
  });
  assert(noSnmpAsset.status === 201 && noSnmpAsset.data.hasSnmpCommunity === false, '未填写 SNMP 团体字时不应默认 public');
  const noSnmpPut = await request(`/api/assets/${noSnmpAsset.data.id}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: noSnmpName, type: '网络设备', projectId, monitorEnabled: true, monitorType: 'snmp', monitorHost: '10.255.255.253', snmpCommunity: '' })
  });
  assert(noSnmpPut.status === 200 && noSnmpPut.data.hasSnmpCommunity === false, 'PUT 空团体字不应回写成 public');
  const relSrc = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `关系源-${Date.now()}`, type: '服务器', projectId, brand: '测', model: '测', serialNumber: `SN-RS-${Date.now()}`, status: '使用中', maintainExpiryDate: '2027-12-31' })
  });
  const relTgt = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `关系目标-${Date.now()}`, type: '服务器', projectId, brand: '测', model: '测', serialNumber: `SN-RT-${Date.now()}`, status: '使用中', maintainExpiryDate: '2027-12-31' })
  });
  assert(relSrc.status === 201 && relTgt.status === 201, '创建关系测试资产失败');
  const rel = await request('/api/asset-relations', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceAssetId: relSrc.data.id, targetAssetId: relTgt.data.id })
  });
  assert(rel.status === 201, `创建资产关系失败: ${JSON.stringify(rel.data)}`);
  const blankRelEndpoint = await request(`/api/asset-relations/${rel.data.id}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceAssetId: '' })
  });
  assert(blankRelEndpoint.status === 400, '资产关系更新不应允许清空端点');
  const delRelSrc = await request(`/api/assets/${relSrc.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(delRelSrc.status === 200, '删除带拓扑关系的资产应成功');
  const relsAfter = await request('/api/asset-relations', { headers: { cookie } });
  assert(!(relsAfter.data || []).some(item => item.id === rel.data.id), '删除资产后应级联清理拓扑关系');
  await request(`/api/assets/${relTgt.data.id}`, { method: 'DELETE', headers: { cookie } });
  await request(`/api/assets/${noSnmpAsset.data.id}`, { method: 'DELETE', headers: { cookie } });
  const importProjectName = (projects.data.data || []).find(item => item.id === projectId)?.name || '';
  const importOkName = `导入监测-${Date.now()}`;
  const assetImportResult = await request('/api/assets/import', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assets: [
        { '关联项目': importProjectName, '资产名称': importOkName, '资产类型': '服务器', '监控方式': 'ping', '监控地址/IP': '10.255.255.252', '机柜名称': '导入01号机柜', '起始U': 3, '占用U': 1 },
        { '关联项目': importProjectName, '资产名称': `导入非法U-${Date.now()}`, '资产类型': '服务器', '机柜名称': '导入坏柜', '起始U': 99, '占用U': 1 }
      ]
    })
  });
  assert(assetImportResult.status === 200, `资产导入失败: ${JSON.stringify(assetImportResult.data)}`);
  assert(assetImportResult.data.created === 1 && assetImportResult.data.skipped >= 1, '导入应写入监测字段并跳过非法 U 位');
  const importedList = await request('/api/assets?all=1', { headers: { cookie } });
  const imported = (importedList.data.data || []).find(item => item.name === importOkName);
  assert(imported && imported.monitorEnabled && imported.monitorHost === '10.255.255.252' && imported.cabinetName === '导入01号机柜', '导入监测与机柜字段未落地');
  if (imported) await request(`/api/assets/${imported.id}`, { method: 'DELETE', headers: { cookie } });

  // Excel 数字单元格（资产名称为纯数字）不应导致整批导入 500
  const numericNameImport = await request('/api/assets/import', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assets: [{ '关联项目': importProjectName, '资产名称': 20260001, '资产类型': '服务器' }] })
  });
  assert(numericNameImport.status === 200 && numericNameImport.data.created === 1, `数字单元格资产名称导入失败: ${JSON.stringify(numericNameImport.data)}`);
  const numericImportedList = await request('/api/assets?all=1', { headers: { cookie } });
  const numericImported = (numericImportedList.data.data || []).find(item => item.name === '20260001');
  assert(numericImported, '数字资产名称未按字符串落地');
  if (numericImported) await request(`/api/assets/${numericImported.id}`, { method: 'DELETE', headers: { cookie } });

  // Excel 日期序列号必须按 UTC 纪元换算，避免非 UTC 时区整体偏移一天
  const excelDateName = `导入Excel日期-${Date.now()}`;
  const excelDateImport = await request('/api/assets/import', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assets: [{ '关联项目': importProjectName, '资产名称': excelDateName, '资产类型': '服务器', '维保到期日': 46000 }] })
  });
  assert(excelDateImport.status === 200 && excelDateImport.data.created === 1, `Excel 日期导入失败: ${JSON.stringify(excelDateImport.data)}`);
  const excelDateImportedList = await request('/api/assets?all=1', { headers: { cookie } });
  const excelDateImported = (excelDateImportedList.data.data || []).find(item => item.name === excelDateName);
  assert(excelDateImported && excelDateImported.maintainExpiryDate === '2025-12-09', `Excel 日期序列号换算错误: ${excelDateImported && excelDateImported.maintainExpiryDate}`);
  if (excelDateImported) await request(`/api/assets/${excelDateImported.id}`, { method: 'DELETE', headers: { cookie } });

  // 非法 JSON 请求体属于客户端错误，应返回 400 而不是 500
  const invalidJson = await request('/api/assets/import', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{"assets": ['
  });
  assert(invalidJson.status === 400, `非法 JSON 请求体应返回 400，实际 ${invalidJson.status}`);

  // 畸形 URL 编码不能再让请求挂死，应快速返回 400
  // 并发写入不能因陈旧快照合并而丢失更新或让删除失效
  const concurrencyStamp = Date.now();
  const concurrencyCreates = await Promise.all(Array.from({ length: 10 }, (_, i) => request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `并发-${concurrencyStamp}-${i}`, type: '服务器', projectId })
  })));
  assert(concurrencyCreates.every(item => item.status === 201), `并发创建资产失败: ${concurrencyCreates.map(item => item.status).join(',')}`);
  const concurrencyAssets = concurrencyCreates.map(item => item.data);
  const concurrentUpdates = await Promise.all(concurrencyAssets.slice(0, 5).map((asset, i) => request(`/api/assets/${asset.id}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `并发已改-${concurrencyStamp}-${i}`, type: '服务器', projectId })
  })));
  const concurrentDeletes = await Promise.all(concurrencyAssets.slice(5).map(asset => request(`/api/assets/${asset.id}`, { method: 'DELETE', headers: { cookie } })));
  assert(concurrentUpdates.every(item => item.status === 200), `并发更新资产失败: ${concurrentUpdates.map(item => item.status).join(',')}`);
  assert(concurrentDeletes.every(item => item.status === 200), `并发删除资产失败: ${concurrentDeletes.map(item => item.status).join(',')}`);
  const concurrencyList = await request('/api/assets?all=1', { headers: { cookie } });
  const concurrencyNames = new Set((concurrencyList.data.data || []).map(item => item.name));
  for (let i = 0; i < 5; i += 1) {
    assert(concurrencyNames.has(`并发已改-${concurrencyStamp}-${i}`), `并发更新丢失记录 ${i}`);
  }
  for (let i = 5; i < 10; i += 1) {
    assert(!concurrencyNames.has(`并发-${concurrencyStamp}-${i}`), `并发删除未生效 ${i}`);
  }
  for (const asset of (concurrencyList.data.data || [])) {
    if (String(asset.name).startsWith(`并发-${concurrencyStamp}`) || String(asset.name).startsWith(`并发已改-${concurrencyStamp}`)) {
      await request(`/api/assets/${asset.id}`, { method: 'DELETE', headers: { cookie } });
    }
  }

  // 畸形 URL 编码不能再让请求挂死，应快速返回 400
  const malformedTarget = new URL(base);
  const malformedStatus = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: malformedTarget.hostname, port: malformedTarget.port || 80, path: '/%', method: 'GET' }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert(malformedStatus === 400, `畸形 URL 应返回 400，实际 ${malformedStatus}`);

  // 登录安全设置与证书上传需要管理员二次验证
  const settingsNoPassword = await request('/api/system/settings', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ httpsLoginEnabled: false })
  });
  assert(settingsNoPassword.status === 401, '缺少管理员密码时修改登录安全设置应被拒绝');
  const settingsWrongPassword = await request('/api/system/settings', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ httpsLoginEnabled: false, password: 'wrong-password' })
  });
  assert(settingsWrongPassword.status === 401, '管理员密码错误时修改登录安全设置应被拒绝');
  const certUploadNoPassword = new FormData();
  certUploadNoPassword.append('cert', new Blob([httpsTestCert], { type: 'application/x-pem-file' }), 'https-nopass-cert.pem');
  certUploadNoPassword.append('key', new Blob([httpsTestKey], { type: 'application/x-pem-file' }), 'https-nopass-key.pem');
  const certUploadNoPasswordRes = await fetch(base + '/api/system/https/certificate', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: certUploadNoPassword });
  assert(certUploadNoPasswordRes.status === 401, '缺少管理员密码时上传 HTTPS 证书应被拒绝');

  // 巡检模板指标必须净化尖括号，且非创建者不能修改/删除
  const xssTemplateName = `XSS净化模板-${Date.now()}`;
  const xssTemplate = await request('/api/ai-inspection/templates', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: xssTemplateName,
      category: 'server',
      metrics: [{ key: 'cpuUsage', label: '<img src=x>', unit: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' }]
    })
  });
  assert(xssTemplate.status === 201, `创建巡检模板失败: ${JSON.stringify(xssTemplate.data)}`);
  assert(!/[<>]/.test(JSON.stringify(xssTemplate.data.metrics || [])), '巡检模板指标应净化尖括号字符');
  const crossUserPut = await request(`/api/ai-inspection/templates/${xssTemplate.data.id}`, {
    method: 'PUT',
    headers: { cookie: engineerRelogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '越权改名' })
  });
  assert(crossUserPut.status === 403, '工程师不应能修改他人创建的巡检模板');
  const crossUserDelete = await request(`/api/ai-inspection/templates/${xssTemplate.data.id}`, {
    method: 'DELETE',
    headers: { cookie: engineerRelogin.cookie }
  });
  assert(crossUserDelete.status === 403, '工程师不应能删除他人创建的巡检模板');
  const cleanupTemplate = await request(`/api/ai-inspection/templates/${xssTemplate.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(cleanupTemplate.status === 200, '创建者应能删除自己创建的巡检模板');

  // 导入数据中的非法 ID 必须被拒绝，避免可注入 HTML 属性的 ID 进入前端渲染
  const unsafeImport = await request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: [{ id: 'x" onmouseover="alert(1)', username: 'x' }], password: 'Admin123!' })
  });
  assert(unsafeImport.status === 400, '导入包含非法 ID 的数据应返回 400');

  // 巡检对象管理地址与端口需要在创建时就校验
  const badAddressTarget = await request('/api/ai-inspection/targets', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, name: `非法地址-${Date.now()}`, address: '10.0.0.1:x', protocol: 'winrm', port: 5985, authType: 'password', account: 'a', password: 'b' })
  });
  assert(badAddressTarget.status === 400, '非法巡检管理地址应返回 400');
  const badPortTarget = await request('/api/ai-inspection/targets', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, name: `非法端口-${Date.now()}`, address: '10.0.0.1', protocol: 'winrm', port: 99999, authType: 'password', account: 'a', password: 'b' })
  });
  assert(badPortTarget.status === 400, '非法巡检端口应返回 400');

  // 巡检目标白名单：保存时校验条目语法，创建/连接前按白名单收窄，特殊地址始终禁止
  const invalidAllowlist = await updateSystemSettings(cookie, { monitorTargetAllowlist: 'not a host!' });
  assert(invalidAllowlist.status === 400, '非法白名单条目应返回 400');
  const savedAllowlist = await updateSystemSettings(cookie, { monitorTargetAllowlist: '10.0.0.0/24' });
  assert(savedAllowlist.status === 200 && savedAllowlist.data.systemConfig?.monitorTargetAllowlist === '10.0.0.0/24', '白名单保存结果不正确');
  const buildTargetPayload = address => ({
    projectId, name: `白名单目标-${Date.now()}`, address, protocol: 'winrm', port: 5985, authType: 'password', account: 'a', password: 'b'
  });
  const allowlistOutside = await request('/api/ai-inspection/targets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(buildTargetPayload('192.168.50.10'))
  });
  assert(allowlistOutside.status === 400, '白名单外地址应被拒绝');
  const allowlistSpecial = await request('/api/ai-inspection/targets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(buildTargetPayload('169.254.169.254'))
  });
  assert(allowlistSpecial.status === 400, '云元数据等特殊地址应被拒绝');
  const allowlistInside = await request('/api/ai-inspection/targets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(buildTargetPayload('10.0.0.77'))
  });
  assert(allowlistInside.status === 201, `白名单内地址应被放行: ${allowlistInside.status} ${JSON.stringify(allowlistInside.data)}`);
  await request(`/api/ai-inspection/targets/${allowlistInside.data.id}`, { method: 'DELETE', headers: { cookie } });
  const clearedAllowlist = await updateSystemSettings(cookie, { monitorTargetAllowlist: '' });
  assert(clearedAllowlist.status === 200 && clearedAllowlist.data.systemConfig?.monitorTargetAllowlist === '', '清空白名单失败');
  const privateAfterClear = await request('/api/ai-inspection/targets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(buildTargetPayload('192.168.50.10'))
  });
  assert(privateAfterClear.status === 201, '清空白名单后内网地址应默认放行');
  await request(`/api/ai-inspection/targets/${privateAfterClear.data.id}`, { method: 'DELETE', headers: { cookie } });

  // 列表视图范围：同项目工程师默认只看本人，scope=project 可查看项目全量
  const scopeProject = await request('/api/projects', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `视图范围回归项目-${suffix}`, customerName: '视图范围客户' })
  });
  assert(scopeProject.status === 201, `创建视图范围项目失败: ${scopeProject.status} ${JSON.stringify(scopeProject.data)}`);
  const scopeProjectId = scopeProject.data.id;
  const scopeAsset = await request('/api/assets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '视图范围资产', type: '服务器', status: '运行中', projectId: scopeProjectId })
  });
  assert(scopeAsset.status === 201, '创建视图范围资产失败');
  const createScopeUser = async (role, label) => {
    const result = await request('/api/users', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `视图范围${label}`, username: `scope_${label}_${suffix}`, password: 'Scope123!', role, projectId: scopeProjectId })
    });
    assert(result.status === 201, `创建视图范围${label}失败: ${result.status} ${JSON.stringify(result.data)}`);
    return result.data;
  };
  const scopeEngineerA = await createScopeUser('engineer', '工程师A');
  const scopeEngineerB = await createScopeUser('engineer', '工程师B');
  const scopeEngineerC = await createScopeUser('engineer', '工程师C');
  const scopeCustomer = await createScopeUser('customer', '客户');
  const scopeCookieA = (await login(scopeEngineerA.username, 'Scope123!')).cookie;
  const scopeCookieB = (await login(scopeEngineerB.username, 'Scope123!')).cookie;
  const scopeCookieC = (await login(scopeEngineerC.username, 'Scope123!')).cookie;
  const scopeCustomerCookie = (await login(scopeCustomer.username, 'Scope123!')).cookie;
  assert(scopeCookieA && scopeCookieB && scopeCookieC && scopeCustomerCookie, '视图范围测试账号登录失败');

  const scopeLogPayload = event => ({
    projectId: scopeProjectId,
    assetId: scopeAsset.data.id,
    date: formatDateKey(new Date()),
    ticketType: '事务工作',
    event,
    relatedTarget: '视图范围设备',
    result: '已完成',
    process: '视图范围回归',
    conclusion: '完成',
    durationHours: 1
  });
  const scopeLogA = await request('/api/logs', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify(scopeLogPayload('视图范围日志A'))
  });
  const scopeLogB = await request('/api/logs', {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify(scopeLogPayload('视图范围日志B'))
  });
  assert(scopeLogA.status === 201 && scopeLogB.status === 201, '创建视图范围日志失败');
  const scopeLogsMine = await request(`/api/logs?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeLogsMine.status === 200 && (scopeLogsMine.data.data || []).length === 1 && scopeLogsMine.data.data[0].id === scopeLogA.data.id, 'scope=mine 应只返回本人日志');
  const scopeLogsProject = await request(`/api/logs?all=1&scope=project&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeLogsProject.status === 200 && (scopeLogsProject.data.data || []).length === 2, 'scope=project 应返回同项目全部日志');
  const scopeLogsDefault = await request(`/api/logs?all=1&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeLogsDefault.status === 200 && (scopeLogsDefault.data.data || []).length === 2, '未传 scope 时应保持项目全量，避免影响报表数据');

  const scopePlanA = await request('/api/inspection-plans', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围巡检A', cycle: 'monthly', nextDate: '2099-12-31' })
  });
  const scopePlanB = await request('/api/inspection-plans', {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围巡检B', cycle: 'monthly', nextDate: '2099-12-31' })
  });
  assert(scopePlanA.status === 201 && scopePlanB.status === 201, '创建视图范围巡检计划失败');
  const scopePlansMine = await request(`/api/inspection-plans?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopePlansMine.status === 200 && (scopePlansMine.data.data || []).length === 1 && scopePlansMine.data.data[0].id === scopePlanA.data.id, 'scope=mine 应只返回本人巡检计划');
  const scopePlansProject = await request(`/api/inspection-plans?all=1&scope=project&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopePlansProject.status === 200 && (scopePlansProject.data.data || []).length === 2, 'scope=project 应返回同项目全部巡检计划');
  const scopeExecutionA = await request('/api/inspection-executions', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: scopePlanA.data.id, executedAt: '2026-06-19T13:00', result: '正常', checklist: '视图范围检查' })
  });
  const scopeExecutionB = await request('/api/inspection-executions', {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: scopePlanB.data.id, executedAt: '2026-06-19T13:00', result: '正常', checklist: '视图范围检查' })
  });
  assert(scopeExecutionA.status === 201 && scopeExecutionB.status === 201, '创建视图范围巡检执行失败');
  const scopeExecutionsMine = await request(`/api/inspection-executions?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeExecutionsMine.status === 200 && (scopeExecutionsMine.data.data || []).length === 1 && scopeExecutionsMine.data.data[0].id === scopeExecutionA.data.id, 'scope=mine 应只返回本人巡检执行');

  // 工单闭环：接单 -> 回单 -> 客户确认，客户视图不应暴露内部处理字段
  const scopeTicket = await request('/api/tickets', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围工单', description: '内部处理说明', category: '故障', priority: '高', assigneeId: scopeEngineerB.id })
  });
  assert(scopeTicket.status === 201 && /^WO\d{8}\d{4}$/.test(scopeTicket.data.ticketNo || ''), `创建工单失败: ${scopeTicket.status} ${JSON.stringify(scopeTicket.data)}`);
  assert(scopeTicket.data.status === '待接单' && scopeTicket.data.slaStatus === '正常', '新工单应处于待接单且 SLA 正常');
  const scopeTicketAccept = await request(`/api/tickets/${scopeTicket.data.id}/actions`, {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'accept' })
  });
  assert(scopeTicketAccept.status === 200 && scopeTicketAccept.data.status === '处理中' && scopeTicketAccept.data.acceptedAt, '工程师应能接单');
  const scopeTicketResolve = await request(`/api/tickets/${scopeTicket.data.id}/actions`, {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resolve', resolution: '已更换故障磁盘' })
  });
  assert(scopeTicketResolve.status === 200 && scopeTicketResolve.data.status === '待客户确认', '处理人应能回单');
  const scopeTicketsCustomer = await request(`/api/tickets?all=1&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCustomerCookie } });
  const scopeTicketForCustomer = (scopeTicketsCustomer.data.data || []).find(item => item.id === scopeTicket.data.id);
  assert(scopeTicketForCustomer && scopeTicketForCustomer.description === undefined, '客户视图不应包含工单处理描述');
  const scopeTicketConfirmByEngineer = await request(`/api/tickets/${scopeTicket.data.id}/actions`, {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'confirm' })
  });
  assert(scopeTicketConfirmByEngineer.status === 403, '工程师不应能代客户确认工单');
  const scopeTicketConfirm = await request(`/api/tickets/${scopeTicket.data.id}/actions`, {
    method: 'POST', headers: { cookie: scopeCustomerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'confirm', comment: '确认完成' })
  });
  assert(scopeTicketConfirm.status === 200 && scopeTicketConfirm.data.status === '已完成' && scopeTicketConfirm.data.customerConfirmedAt, '客户应能确认工单完成');

  // 值班交接：开始值班 -> 交接给备班人
  const scopeShift = await request('/api/duty-shifts', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, dutyDate: '2099-12-30', startTime: '09:00', endTime: '18:00', shiftType: '白班', primaryUserId: scopeEngineerA.id, backupUserId: scopeEngineerB.id })
  });
  assert(scopeShift.status === 201 && scopeShift.data.status === '待开始', `创建值班排班失败: ${scopeShift.status} ${JSON.stringify(scopeShift.data)}`);
  const scopeShiftDuplicate = await request('/api/duty-shifts', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, dutyDate: '2099-12-30', startTime: '09:00', endTime: '18:00', primaryUserId: scopeEngineerA.id })
  });
  assert(scopeShiftDuplicate.status === 409, '同一值班人同一时段不应重复排班');
  const scopeShiftStart = await request(`/api/duty-shifts/${scopeShift.data.id}`, {
    method: 'PUT', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '值班中' })
  });
  assert(scopeShiftStart.status === 200 && scopeShiftStart.data.status === '值班中', '应能开始值班');
  const scopeShiftHandover = await request(`/api/duty-shifts/${scopeShift.data.id}/handover`, {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoverContent: '夜间无异常', handoverIssue: 'UPS 电池待更换', receivedBy: scopeEngineerB.id })
  });
  assert(scopeShiftHandover.status === 200 && scopeShiftHandover.data.status === '已交接' && scopeShiftHandover.data.receivedBy === scopeEngineerB.id, '值班交接应记录接班人并置为已交接');

  // 巡检异常：逐项异常强制整单异常、自动生成工单，复查后推进关联工单
  const scopeChecklistPlan = await request('/api/inspection-plans', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围检查项巡检', cycle: 'monthly', nextDate: '2099-12-31', checklistTemplate: [{ name: '设备指示灯' }, { name: '备份任务' }] })
  });
  assert(scopeChecklistPlan.status === 201 && (scopeChecklistPlan.data.checklistTemplate || []).length === 2, '巡检计划应保存检查项模板');
  const scopeAbnormalExecution = await request('/api/inspection-executions', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planId: scopeChecklistPlan.data.id,
      executedAt: '2026-06-20T09:00',
      result: '正常',
      checklist: '设备指示灯、备份任务',
      checklistItems: [{ name: '设备指示灯', result: '正常', remark: '' }, { name: '备份任务', result: '异常', remark: '昨日备份失败' }]
    })
  });
  assert(scopeAbnormalExecution.status === 201 && scopeAbnormalExecution.data.result === '异常', '存在异常检查项时整单应强制为异常');
  assert(scopeAbnormalExecution.data.ticketId && scopeAbnormalExecution.data.recheckStatus === '待复查', '巡检异常应自动生成工单并置为待复查');
  const scopeRecheck = await request(`/api/inspection-executions/${scopeAbnormalExecution.data.id}/recheck`, {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recheckResult: '已重新执行备份并校验成功' })
  });
  assert(scopeRecheck.status === 200 && scopeRecheck.data.recheckStatus === '已复查', '异常巡检记录应能复查');
  const scopeLinkedTickets = await request(`/api/tickets?all=1&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  const scopeLinkedTicket = (scopeLinkedTickets.data.data || []).find(item => item.id === scopeAbnormalExecution.data.ticketId);
  assert(scopeLinkedTicket && scopeLinkedTicket.status === '待客户确认' && String(scopeLinkedTicket.resolution || '').includes('已重新执行备份并校验成功'), '复查结果应推进关联工单并记录结论');

  const scopeIncidentA = await request('/api/incidents', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围故障A', faultType: '硬件故障', severity: '低', status: '处理中', occurredAt: '2099-01-01T10:00' })
  });
  const scopeIncidentB = await request('/api/incidents', {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围故障B', faultType: '软件故障', severity: '低', status: '处理中', occurredAt: '2099-01-01T10:00' })
  });
  assert(scopeIncidentA.status === 201 && scopeIncidentB.status === 201, '创建视图范围故障失败');
  const scopeIncidentsMine = await request(`/api/incidents?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeIncidentsMine.status === 200 && (scopeIncidentsMine.data.data || []).length === 1 && scopeIncidentsMine.data.data[0].id === scopeIncidentA.data.id, 'scope=mine 应只返回本人故障记录');
  const scopeIncidentsProject = await request(`/api/incidents?all=1&scope=project&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeIncidentsProject.status === 200 && (scopeIncidentsProject.data.data || []).length === 2, 'scope=project 应返回同项目全部故障记录');

  const scopeSpare = await request('/api/spare-parts', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, name: '视图范围备件', quantity: 10, safeStock: 1 })
  });
  assert(scopeSpare.status === 201, '创建视图范围备件失败');
  const scopeStockA = await request(`/api/spare-parts/${scopeSpare.data.id}/stock`, {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'inbound', quantity: 5, reason: '视图范围A入库' })
  });
  const scopeStockB = await request(`/api/spare-parts/${scopeSpare.data.id}/stock`, {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'inbound', quantity: 3, reason: '视图范围B入库' })
  });
  assert(scopeStockA.status === 200 && scopeStockB.status === 200, '创建视图范围备件流水失败');
  const scopeMovementsMine = await request(`/api/spare-part-movements?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeMovementsMine.status === 200 && (scopeMovementsMine.data.data || []).length === 1 && scopeMovementsMine.data.data[0].operatorId === scopeEngineerA.id, 'scope=mine 应只返回本人备件流水');
  const scopeMovementsProject = await request(`/api/spare-part-movements?all=1&scope=project&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeMovementsProject.status === 200 && (scopeMovementsProject.data.data || []).length === 2, 'scope=project 应返回同项目全部备件流水');

  const scopeChangeA = await request('/api/change-records', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围变更A', content: '视图范围变更内容A', approverId: scopeEngineerB.id, customerId: scopeCustomer.id })
  });
  const scopeChangeB = await request('/api/change-records', {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, title: '视图范围变更B', content: '视图范围变更内容B', approverId: scopeEngineerA.id, customerId: scopeCustomer.id })
  });
  assert(scopeChangeA.status === 201 && scopeChangeB.status === 201, `创建视图范围变更失败: ${scopeChangeA.status}/${scopeChangeB.status}`);
  const scopeChangesMine = await request(`/api/change-records?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeChangesMine.status === 200 && (scopeChangesMine.data.data || []).length === 1 && scopeChangesMine.data.data[0].id === scopeChangeA.data.id, 'scope=mine 应只返回本人变更记录');
  const scopeChangesProject = await request(`/api/change-records?all=1&scope=project&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeChangesProject.status === 200 && (scopeChangesProject.data.data || []).length === 2, 'scope=project 应返回同项目全部变更记录');

  const scopeApprovalsC = await request(`/api/approvals?all=1&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieC } });
  const scopeApprovalA = (scopeApprovalsC.data.data || []).find(item => item.relatedId === scopeChangeA.data.id);
  assert(scopeApprovalA && scopeApprovalA.content === '' && !scopeApprovalA.rejectionReason, '无关人员不应看到审批正文与驳回原因');
  const scopeApprovalsB = await request(`/api/approvals?all=1&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieB } });
  const scopeApprovalForB = (scopeApprovalsB.data.data || []).find(item => item.relatedId === scopeChangeA.data.id);
  assert(scopeApprovalForB && scopeApprovalForB.content === '视图范围变更内容A', '审批人应看到审批正文');
  const scopeDecisionDenied = await request(`/api/approvals/${scopeApprovalA.id}/decision`, {
    method: 'POST', headers: { cookie: scopeCookieC, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' })
  });
  assert(scopeDecisionDenied.status === 403, '无关人员不应能处理审批');
  const scopeDecisionApproved = await request(`/api/approvals/${scopeApprovalA.id}/decision`, {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' })
  });
  assert(scopeDecisionApproved.status === 200 && scopeDecisionApproved.data.status === '待客户确认', '指定审批人应能通过运维审批');
  const scopeDecisionCustomer = await request(`/api/approvals/${scopeApprovalA.id}/decision`, {
    method: 'POST', headers: { cookie: scopeCustomerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' })
  });
  assert(scopeDecisionCustomer.status === 200 && scopeDecisionCustomer.data.status === '已通过', '甲方客户应能完成最终确认');

  const scopeTemplates = await request('/api/ai-inspection/templates', { headers: { cookie } });
  const scopeTemplate = (scopeTemplates.data.data || []).find(item => item.category === 'server');
  assert(scopeTemplate, '未找到可用于视图范围的巡检模板');
  const scopeTarget = await request('/api/ai-inspection/targets', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: scopeProjectId, assetId: scopeAsset.data.id, name: '视图范围巡检对象', category: 'server', address: '10.0.0.10', protocol: 'winrm', port: 5985, authType: 'password', account: 'administrator', password: 'P@ssw0rd!' })
  });
  assert(scopeTarget.status === 201, '创建视图范围巡检对象失败');
  const scopeTaskPayload = (title, executedAt) => ({
    targetId: scopeTarget.data.id,
    templateId: scopeTemplate.id,
    title,
    executedAt,
    metrics: (scopeTemplate.metrics || []).map(metric => ({ ...metric, value: 10 }))
  });
  const scopeTaskA = await request('/api/ai-inspection/tasks', {
    method: 'POST', headers: { cookie: scopeCookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify(scopeTaskPayload('视图范围巡检任务A', '2026-01-01T10:00'))
  });
  const scopeTaskB = await request('/api/ai-inspection/tasks', {
    method: 'POST', headers: { cookie: scopeCookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify(scopeTaskPayload('视图范围巡检任务B', '2099-01-01T10:00'))
  });
  assert(scopeTaskA.status === 201 && scopeTaskB.status === 201, `创建视图范围巡检任务失败: ${scopeTaskA.status}/${scopeTaskB.status}`);
  const scopeTasksMine = await request(`/api/ai-inspection/tasks?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeTasksMine.status === 200 && (scopeTasksMine.data.data || []).length === 1 && scopeTasksMine.data.data[0].id === scopeTaskA.data.task.id, 'scope=mine 应只返回本人巡检任务');
  const scopeTasksProject = await request(`/api/ai-inspection/tasks?all=1&scope=project&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeTasksProject.status === 200 && (scopeTasksProject.data.data || []).length === 2, 'scope=project 应返回同项目全部巡检任务');
  const scopeResultsA = await request(`/api/ai-inspection/results?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieA } });
  assert(scopeResultsA.status === 200 && (scopeResultsA.data.data || []).length >= 1 && (scopeResultsA.data.data || []).every(item => item.createdBy === scopeEngineerA.id), 'scope=mine 应只返回本人巡检结果');
  const scopeResultsB = await request(`/api/ai-inspection/results?all=1&scope=mine&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieB } });
  assert(scopeResultsB.status === 200 && (scopeResultsB.data.data || []).length === 0, '无巡检结果的人员 scope=mine 应为空');
  const scopeResultsProject = await request(`/api/ai-inspection/results?all=1&scope=project&projectId=${encodeURIComponent(scopeProjectId)}`, { headers: { cookie: scopeCookieB } });
  assert(scopeResultsProject.status === 200 && (scopeResultsProject.data.data || []).length >= 1, 'scope=project 应返回同项目巡检结果');

  // P2：合同结算、供应商采购、备件盘点、知识库审核、全局搜索、审计导出与服务报告。
  const p2Suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const p2Keyword = `P2检索${p2Suffix}`;
  const p2Project = await request('/api/projects', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `P2回归项目-${p2Suffix}`, customerName: 'P2客户' })
  });
  assert(p2Project.status === 201, `创建 P2 回归项目失败: ${p2Project.status} ${JSON.stringify(p2Project.data)}`);
  const p2ProjectId = p2Project.data.id;
  const createP2User = async (role, label) => {
    const result = await request('/api/users', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `P2${label}`, username: `p2_${label}_${p2Suffix}`, password: 'P2regress1!', role, projectId: p2ProjectId })
    });
    assert(result.status === 201, `创建 P2 ${label} 失败: ${result.status} ${JSON.stringify(result.data)}`);
    return result.data;
  };
  const p2Engineer = await createP2User('engineer', 'engineer');
  const p2Customer = await createP2User('customer', 'customer');
  const p2EngineerLogin = await login(p2Engineer.username, 'P2regress1!');
  const p2CustomerLogin = await login(p2Customer.username, 'P2regress1!');
  assert(p2EngineerLogin.status === 200 && p2CustomerLogin.status === 200, 'P2 测试账号登录失败');
  const p2EngineerCookie = p2EngineerLogin.cookie;
  const p2CustomerCookie = p2CustomerLogin.cookie;

  const p2Contract = await request('/api/contracts', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: p2ProjectId, name: `${p2Keyword}服务合同`, amount: 100000, taxRate: 6, settlementCycle: 'monthly', status: 'active' })
  });
  assert(p2Contract.status === 201 && p2Contract.data.amount === 100000, `创建合同失败: ${p2Contract.status} ${JSON.stringify(p2Contract.data)}`);
  const p2ContractId = p2Contract.data.id;
  const p2Settlement = await request('/api/contract-settlements', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractId: p2ContractId, periodKey: '2026-10', title: '首期结算', invoiceAmount: 60000, receivedAmount: 40000, costAmount: 15000, status: 'received' })
  });
  assert(p2Settlement.status === 201 && p2Settlement.data.projectId === p2ProjectId, '创建合同结算失败');
  const p2ContractSummary = await request(`/api/contracts/summary?projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  assert(p2ContractSummary.status === 200 && p2ContractSummary.data.grossProfit === 25000 && p2ContractSummary.data.grossMargin === 62.5,
    `合同汇总毛利不正确: ${JSON.stringify(p2ContractSummary.data)}`);
  const p2ContractList = await request(`/api/contracts?all=1&projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  const p2ContractRow = (p2ContractList.data.data || []).find(item => item.id === p2ContractId);
  assert(p2ContractRow && p2ContractRow.invoiceAmount === 60000 && p2ContractRow.receivedAmount === 40000 && p2ContractRow.grossProfit === 25000,
    '合同列表应附带结算汇总');
  const p2CustomerContracts = await request('/api/contracts', { headers: { cookie: p2CustomerCookie } });
  assert(p2CustomerContracts.status === 403, '客户不应查看合同');
  const p2EngineerContract = await request('/api/contracts', {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${p2Keyword}工程师合同`, amount: 5000 })
  });
  assert(p2EngineerContract.status === 201 && p2EngineerContract.data.projectId === p2ProjectId, '工程师创建合同时应自动归属本人项目');
  const p2ContractUpdated = await request(`/api/contracts/${p2ContractId}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 120000, status: 'completed' })
  });
  assert(p2ContractUpdated.status === 200 && p2ContractUpdated.data.amount === 120000 && p2ContractUpdated.data.status === 'completed', '更新合同失败');
  const p2NegativeContract = await request('/api/contracts', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: p2ProjectId, name: '负数合同', amount: -1 })
  });
  assert(p2NegativeContract.status === 400, '合同金额为负数时应拒绝');
  const p2EngineerSettlement = await request('/api/contract-settlements', {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractId: p2ContractId, invoiceAmount: 5000, receivedAmount: 5000, costAmount: 1000 })
  });
  assert(p2EngineerSettlement.status === 201, '同项目工程师应能登记结算');
  const p2SettlementDeleted = await request(`/api/contract-settlements/${p2EngineerSettlement.data.id}`, {
    method: 'DELETE', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2SettlementDeleted.status === 200, '删除合同结算失败');
  const p2SettlementFiltered = await request(`/api/contract-settlements?all=1&projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  assert(p2SettlementFiltered.status === 200 && (p2SettlementFiltered.data.data || []).length === 1, '删除后结算列表数量不正确');

  const p2Vendor = await request('/api/spare-part-vendors', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: p2ProjectId, name: `${p2Keyword}供应商`, contactName: '张三', contactPhone: '13800000000' })
  });
  assert(p2Vendor.status === 201 && p2Vendor.data.projectId === p2ProjectId, '创建供应商失败');
  const p2VendorId = p2Vendor.data.id;
  const p2Spare = await request('/api/spare-parts', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: p2ProjectId, name: `${p2Keyword}硬盘`, model: 'SSD-1T', quantity: 1, safeStock: 1 })
  });
  assert(p2Spare.status === 201, '创建 P2 备件失败');
  const p2SpareId = p2Spare.data.id;
  const p2Purchase = await request('/api/spare-part-purchases', {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sparePartId: p2SpareId, vendorId: p2VendorId, quantity: 3, unitPrice: 500 })
  });
  assert(p2Purchase.status === 201 && p2Purchase.data.totalAmount === 1500 && p2Purchase.data.status === 'pending', '创建采购申请失败');
  const p2PurchaseId = p2Purchase.data.id;
  const p2VendorDeleteBlocked = await request(`/api/spare-part-vendors/${p2VendorId}`, {
    method: 'DELETE', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2VendorDeleteBlocked.status === 409, '存在未取消采购申请时供应商应不可删除');
  const p2ApproveByEngineer = await request(`/api/spare-part-purchases/${p2PurchaseId}/approve`, {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2ApproveByEngineer.status === 403, '仅管理员可审批采购申请');
  const p2Approved = await request(`/api/spare-part-purchases/${p2PurchaseId}/approve`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ note: '同意采购' })
  });
  assert(p2Approved.status === 200 && p2Approved.data.status === 'approved' && p2Approved.data.approverName, '审批采购申请失败');
  const p2Received = await request(`/api/spare-part-purchases/${p2PurchaseId}/receive`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2Received.status === 200 && p2Received.data.status === 'received', '采购收货失败');
  const p2SpareAfterReceive = await request(`/api/spare-parts?all=1&projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  const p2SpareRow = (p2SpareAfterReceive.data.data || []).find(item => item.id === p2SpareId);
  assert(p2SpareRow && p2SpareRow.quantity === 4, `采购收货应自动入库，当前库存 ${p2SpareRow?.quantity}`);
  const p2ReceiveAgain = await request(`/api/spare-part-purchases/${p2PurchaseId}/receive`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2ReceiveAgain.status === 400, '已收货的采购申请不应重复收货');
  const p2CancelReceived = await request(`/api/spare-part-purchases/${p2PurchaseId}/cancel`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2CancelReceived.status === 400, '已入库的采购申请不应取消');
  const p2PurchaseToCancel = await request('/api/spare-part-purchases', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sparePartId: p2SpareId, vendorId: p2VendorId, quantity: 1, unitPrice: 500 })
  });
  const p2Cancelled = await request(`/api/spare-part-purchases/${p2PurchaseToCancel.data.id}/cancel`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2Cancelled.status === 200 && p2Cancelled.data.status === 'cancelled', '取消未入库采购申请失败');

  const p2Inventory = await request('/api/spare-part-inventory-tasks', {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: p2ProjectId, name: `${p2Keyword}盘点` })
  });
  assert(p2Inventory.status === 201 && p2Inventory.data.status === 'pending' && (p2Inventory.data.items || []).length === 1, '创建盘点任务失败');
  const p2InventoryId = p2Inventory.data.id;
  const p2InventoryItem = p2Inventory.data.items[0];
  const p2CompleteTooEarly = await request(`/api/spare-part-inventory-tasks/${p2InventoryId}/complete`, {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2CompleteTooEarly.status === 400, '存在未盘点项时不应允许完成盘点');
  const p2Recorded = await request(`/api/spare-part-inventory-tasks/${p2InventoryId}/record`, {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sparePartId: p2InventoryItem.sparePartId, actualQuantity: 6, note: '实盘多出 2 块' })
  });
  assert(p2Recorded.status === 200 && p2Recorded.data.status === 'running' && p2Recorded.data.items[0].result === 'mismatch', '登记盘点结果失败');
  const p2InventoryCompleted = await request(`/api/spare-part-inventory-tasks/${p2InventoryId}/complete`, {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2InventoryCompleted.status === 200 && p2InventoryCompleted.data.status === 'completed', '完成盘点失败');
  const p2SpareAfterInventory = await request(`/api/spare-parts?all=1&projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  const p2SpareAfterInventoryRow = (p2SpareAfterInventory.data.data || []).find(item => item.id === p2SpareId);
  assert(p2SpareAfterInventoryRow && p2SpareAfterInventoryRow.quantity === 6, `盘点完成后应按实盘回写库存，当前 ${p2SpareAfterInventoryRow?.quantity}`);
  const p2InventoryMovements = await request(`/api/spare-part-movements?all=1&projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  assert((p2InventoryMovements.data.data || []).some(item => item.type === 'adjust' && item.quantity === 2), '盘点差异应写入 adjust 流水');
  const p2RecordAfterComplete = await request(`/api/spare-part-inventory-tasks/${p2InventoryId}/record`, {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sparePartId: p2InventoryItem.sparePartId, actualQuantity: 1 })
  });
  assert(p2RecordAfterComplete.status === 400, '已完成盘点不应继续登记');
  const p2VendorDeleted = await request(`/api/spare-part-vendors/${p2VendorId}`, {
    method: 'DELETE', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert(p2VendorDeleted.status === 409, '已收货的采购申请仍应阻止供应商删除');

  const p2Kb = await request('/api/kb', {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `${p2Keyword}知识`, keywords: p2Keyword, problem: '初始问题', solution: '初始方案', status: 'published' })
  });
  assert(p2Kb.status === 201 && p2Kb.data.version === 1 && p2Kb.data.status === 'published', '创建知识条目失败');
  const p2KbId = p2Kb.data.id;
  const p2KbUpdated = await request(`/api/kb/${p2KbId}`, {
    method: 'PUT', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ solution: '更新后的方案' })
  });
  assert(p2KbUpdated.status === 200 && p2KbUpdated.data.version === 2 && p2KbUpdated.data.status === 'pending', '内容变更应递增版本并回到待审核');
  const p2KbRevisions = await request(`/api/kb/${p2KbId}/revisions`, { headers: { cookie } });
  assert(p2KbRevisions.status === 200 && (p2KbRevisions.data.data || []).length >= 2 && p2KbRevisions.data.currentVersion === 2, '知识库版本历史不正确');
  const p2KbReviewDenied = await request(`/api/kb/${p2KbId}/review`, {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'publish' })
  });
  assert(p2KbReviewDenied.status === 403, '仅管理员可审核知识条目');
  const p2KbPublished = await request(`/api/kb/${p2KbId}/review`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'publish', note: '审核通过' })
  });
  assert(p2KbPublished.status === 200 && p2KbPublished.data.status === 'published' && p2KbPublished.data.reviewNote === '审核通过', '发布知识条目失败');
  const p2KbReviewAgain = await request(`/api/kb/${p2KbId}/review`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'publish' })
  });
  assert(p2KbReviewAgain.status === 400, '非待审核条目不应重复审核');
  const p2KbDraft = await request('/api/kb', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: p2ProjectId, title: `${p2Keyword}草稿`, keywords: p2Keyword, status: 'draft' })
  });
  assert(p2KbDraft.status === 201 && p2KbDraft.data.status === 'draft', '创建知识草稿失败');
  const p2CustomerKbList = await request('/api/kb?all=1', { headers: { cookie: p2CustomerCookie } });
  assert(p2CustomerKbList.status === 200 && (p2CustomerKbList.data.data || []).every(item => item.id !== p2KbDraft.data.id), '客户不应看到知识草稿');
  const p2CustomerKbDetail = await request(`/api/kb/${p2KbDraft.data.id}`, { headers: { cookie: p2CustomerCookie } });
  assert(p2CustomerKbDetail.status === 403, '客户不应读取知识草稿详情');
  const p2KbRejected = await request(`/api/kb/${p2KbDraft.data.id}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ solution: '待审核内容', status: 'pending' })
  });
  assert(p2KbRejected.status === 200 && p2KbRejected.data.status === 'pending', '提交知识审核失败');
  const p2KbRejectDecision = await request(`/api/kb/${p2KbDraft.data.id}/review`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject', note: '描述不足' })
  });
  assert(p2KbRejectDecision.status === 200 && p2KbRejectDecision.data.status === 'rejected', '驳回答辩知识条目失败');

  const p2Search = await request(`/api/search?keyword=${encodeURIComponent(p2Keyword)}&types=contracts,spareParts,projects`, { headers: { cookie } });
  assert(p2Search.status === 200 && p2Search.data.counts?.contracts >= 1 && p2Search.data.counts?.spareParts >= 1, '全局搜索未命中合同与备件');
  assert((p2Search.data.data || []).every(item => ['contracts', 'spareParts', 'projects'].includes(item.type)), '全局搜索应按 types 过滤');
  const p2CustomerSearch = await request(`/api/search?keyword=${encodeURIComponent(p2Keyword)}&types=contracts,spareParts`, { headers: { cookie: p2CustomerCookie } });
  assert(p2CustomerSearch.status === 200 && p2CustomerSearch.data.total === 0, '客户搜索不应返回合同与备件');
  const p2ShortSearch = await request('/api/search?keyword=a', { headers: { cookie } });
  assert(p2ShortSearch.status === 400, '全局搜索关键字过短应拒绝');

  const p2AuditCsv = await request(`/api/audit-logs/export?format=csv&projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  assert(p2AuditCsv.status === 200 && String(p2AuditCsv.headers['content-type'] || '').includes('text/csv'), '审计日志 CSV 导出失败');
  assert(typeof p2AuditCsv.data === 'string' && p2AuditCsv.data.includes('操作人') && p2AuditCsv.data.includes(p2Keyword), '审计日志 CSV 内容不正确');
  const p2AuditJson = await request(`/api/audit-logs/export?format=json&projectId=${encodeURIComponent(p2ProjectId)}`, { headers: { cookie } });
  assert(p2AuditJson.status === 200 && Array.isArray(p2AuditJson.data.data) && p2AuditJson.data.total === p2AuditJson.data.data.length, '审计日志 JSON 导出失败');
  assert(p2AuditJson.data.data.every(item => item.projectId === p2ProjectId), '审计导出应按项目过滤');

  const p2ServiceReport = await request(`/api/reports/service/${encodeURIComponent(p2ProjectId)}?period=month`, { headers: { cookie } });
  assert(p2ServiceReport.status === 200 && String(p2ServiceReport.headers['content-type'] || '').includes('text/html'), '服务报告生成失败');
  assert(typeof p2ServiceReport.data === 'string' && p2ServiceReport.data.includes('服务报告') && p2ServiceReport.data.includes('P2客户'), '服务报告内容不完整');

  const p2Log = await request('/api/logs', {
    method: 'POST', headers: { cookie: p2EngineerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: p2ProjectId, date: formatDateKey(new Date()), ticketType: '事务工作',
      event: 'P2客户日志可见性', process: '内部处理过程', result: '已完成', conclusion: '完成', durationHours: 1
    })
  });
  assert(p2Log.status === 201, '创建 P2 日志失败');
  const p2CustomerLogsHidden = await request('/api/logs?all=1', { headers: { cookie: p2CustomerCookie } });
  assert(p2CustomerLogsHidden.status === 200 && (p2CustomerLogsHidden.data.data || []).length === 0, '未开启开关时客户不应看到服务日志');
  const p2ProjectVisible = await request(`/api/projects/${p2ProjectId}`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: p2Project.data.name, customerName: 'P2客户', customerLogVisible: true })
  });
  assert(p2ProjectVisible.status === 200 && p2ProjectVisible.data.customerLogVisible === true, '开启客户日志可见性失败');
  const p2CustomerLogsVisible = await request('/api/logs?all=1', { headers: { cookie: p2CustomerCookie } });
  assert(p2CustomerLogsVisible.status === 200 && (p2CustomerLogsVisible.data.data || []).length === 1, '开启开关后客户应看到本项目服务日志');
  const p2CustomerLogRow = p2CustomerLogsVisible.data.data[0];
  assert(p2CustomerLogRow.event === 'P2客户日志可见性' && p2CustomerLogRow.userId === undefined && p2CustomerLogRow.attachments === undefined,
    '客户日志不应下发内部字段');

  await cleanupRegressionArtifacts(cookie);

  process.stdout.write('Regression passed\n');
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
