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
  return request('/api/system/settings', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function exportSystemSnapshot(cookie) {
  const exported = await request('/api/system/export', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(exported.status === 200, '导出当前数据失败');
  return exported.data;
}

async function importSystemSnapshot(cookie, snapshot) {
  return request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot)
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

async function main() {
  const health = await request('/api/health');
  assert(health.status === 200 && health.data.ok === true, '健康检查接口失败');
  const ready = await request('/api/ready');
  assert(ready.status === 200 && ready.data.ok === true, '就绪检查接口失败');
  const captchaProbe = await request('/api/captcha');
  assert(captchaProbe.status === 200 && captchaProbe.data.token, '验证码接口失败');
  assert(captchaProbe.data.code === undefined, '验证码接口不应返回明文 code');
  assert(!String(captchaProbe.data.token || '').includes(':'), '验证码 token 不应编码明文');
  assert(!String(captchaProbe.data.svgMarkup || captchaProbe.data.svg || '').includes('<text'), '验证码 SVG 不应包含 text 节点');
  assert(decodeCaptchaFromSvg(captchaProbe.data).length === 4, '验证码 SVG 未能解析出 4 位字符');
  const throttledHeaders = { 'x-forwarded-for': '198.51.100.10' };
  for (let index = 0; index < 5; index += 1) {
    const failedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
    assert(failedLogin.status === 401 || failedLogin.status === 429, '错误密码登录未返回预期状态');
  }
  const blockedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
  assert(blockedLogin.status === 429, '登录限流未生效');
  const persistentBlockedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
  assert(persistentBlockedLogin.status === 429, '登录限流持久化未生效');
  const admin = await login('admin', 'Admin123!');
  assert(admin.status === 200, '管理员登录失败');
  assert(admin.data.sessionToken === undefined, '登录响应不应返回 sessionToken');
  assert(Number(admin.data.systemConfig?.webIdleLogoutMinutes) >= 1, '登录响应未返回控制台超时配置');
  let cookie = admin.cookie;
  assert(String(admin.headers['set-cookie'] || '').includes('SameSite=Lax'), '登录 Cookie 应为 SameSite=Lax');
  const forgotMissing = await request('/api/forgot-password/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'no-such-user', securityAnswer: 'x', newPassword: 'Newpass1!' })
  });
  const forgotWrong = await request('/api/forgot-password/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', securityAnswer: 'wrong-answer', newPassword: 'Newpass1!' })
  });
  assert(forgotMissing.status === 200 && forgotWrong.status === 200, '忘记密码失败应返回 200');
  assert(forgotMissing.data.reset !== true && forgotWrong.data.reset !== true, '忘记密码失败不应标记 reset');
  assert(forgotMissing.data.message === forgotWrong.data.message, '忘记密码失败响应应一致');
  const forgotVerifyMissing = await request('/api/forgot-password/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'no-such-user' })
  });
  const forgotVerifyExisting = await request('/api/forgot-password/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin' })
  });
  assert(forgotVerifyMissing.status === 200 && forgotVerifyExisting.status === 200, '忘记密码验证应返回 200');
  assert(forgotVerifyMissing.data.question === forgotVerifyExisting.data.question, '忘记密码验证响应应一致');
  const exported = await request('/api/system/export', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(exported.status === 200, '导出当前数据失败');
  const snapshot = exported.data;
  assert((snapshot.users || []).every(item => item.passwordHash === undefined && item.securityAnswerHash === undefined), '系统导出不应包含密码哈希');
  assert((snapshot.assets || []).every(item => item.snmpCommunity === undefined), '系统导出不应包含 snmpCommunity');
  assert((snapshot.documents || []).every(item => item.accessPasswordHash === undefined && item.loginPasswordEncrypted === undefined), '系统导出不应包含资料密钥');
  const projects = await request('/api/projects', { headers: { cookie } });
  const users = await request('/api/users', { headers: { cookie } });
  const assets = await request('/api/assets', { headers: { cookie } });
  assert(assets.status === 200 && Array.isArray(assets.data.data), '查询资产列表失败');
  assert(assets.data.data.every(item => item.snmpCommunity === undefined), '资产列表不应返回 snmpCommunity');
  const topology = await request('/api/assets/topology', { headers: { cookie } });
  assert(topology.status === 200 && Array.isArray(topology.data.assets), '查询资产拓扑失败');
  assert(topology.data.assets.every(item => item.snmpCommunity === undefined), '资产拓扑不应返回 snmpCommunity');
  const pagedProjects = await request('/api/projects?pageSize=1', { headers: { cookie } });
  assert(Array.isArray(pagedProjects.data.data) && pagedProjects.data.data.length === 1, '分页 pageSize=1 应只返回 1 条');
  const allProjects = await request('/api/projects?all=1', { headers: { cookie } });
  assert(Array.isArray(allProjects.data.data), 'all=1 应返回项目数组');
  assert(Number(allProjects.data.total) >= Number(pagedProjects.data.total || 0), 'all=1 返回数量应覆盖分页 total');
  assert(allProjects.data.data.length === Number(allProjects.data.total), 'all=1 应返回全部项目');
  assert(allProjects.data.totalPages === 1, 'all=1 的 totalPages 应为 1');
  const backupResult = await request('/api/system/backup', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(backupResult.status === 200, '创建系统备份失败');
  assert(String(backupResult.data.filename || '').startsWith('backup-'), '系统备份文件名不符合预期');
  const backupGetDenied = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}`, { headers: { cookie } });
  assert(backupGetDenied.status !== 200, '系统备份下载不应允许 GET');
  const systemBackupDownload = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert(systemBackupDownload.status === 200, 'POST 下载系统备份失败');
  assert((systemBackupDownload.data.users || []).every(item => item.passwordHash === undefined), '备份下载不应包含 passwordHash');
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
  const invalidUpgrade = await fetch(base + '/api/system/upgrade', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: invalidUpgradeForm });
  const invalidUpgradeData = await invalidUpgrade.json();
  assert(invalidUpgrade.status === 400 && /签名|SHA256/.test(String(invalidUpgradeData.message || '')), `升级包完整性校验未生效: ${invalidUpgrade.status} ${String(invalidUpgradeData.message || '')}`);
  const upgradeLogsAfterInvalid = await request('/api/system/upgrade/logs', { headers: { cookie } });
  assert(upgradeLogsAfterInvalid.status === 200 && Array.isArray(upgradeLogsAfterInvalid.data.data), '升级日志接口失败');
  assert(upgradeLogsAfterInvalid.data.data.some(item => item.status === 'failed' && /签名|SHA256/.test(String(item.message || ''))), '失败升级未写入升级日志');
  const projectId = projects.data.data[0]?.id || '';
  const assetId = assets.data.data.find(item => item.projectId === projectId)?.id || '';
  const approverId = users.data.data.find(item => item.role === 'admin')?.id || '';
  const engineerAccount = users.data.data.find(item => item.role === 'engineer' && item.projectId === projectId);
  const customerId = users.data.data.find(item => item.role === 'customer' && item.projectId === projectId)?.id || '';
  assert(engineerAccount?.username, '未找到可用的工程师测试账号');

  const importResult = await request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildImportSnapshot(snapshot))
  });
  assert(importResult.status === 200, `导入接口失败: ${importResult.status} ${JSON.stringify(importResult.data)}`);
  assert(String(importResult.data.message || '').includes('当前登录状态已保留'), '导入成功消息未包含会话保留提示');
  const auditAfterImport = await request('/api/audit-logs?all=1', { headers: { cookie } });
  assert(auditAfterImport.status === 200, '导入后查询操作日志失败');
  assert(hasAuditLog(auditAfterImport.data.data, 'import', '导入系统数据'), '导入系统数据未写入操作日志');
  const sessionAfterImport = await request('/api/session', { headers: { cookie } });
  assert(sessionAfterImport.status === 200 && sessionAfterImport.data.user?.username === 'admin', '导入后当前会话未保留');

  const engineer = await login(engineerAccount.username, 'Engineer123!');
  assert(engineer.status === 200, '工程师登录失败');
  const engineerCookie = engineer.cookie;
  assert(engineer.data.systemConfig?.httpsCertFingerprint256 === undefined, '工程师登录响应不应返回证书指纹');
  const engineerSession = await request('/api/session', { headers: { cookie: engineerCookie } });
  assert(engineerSession.status === 200, '工程师会话校验失败');
  assert(engineerSession.data.systemConfig?.httpsCertFingerprint256 === undefined, '工程师会话不应返回完整系统配置');
  assert(Number(engineerSession.data.systemConfig?.webIdleLogoutMinutes) >= 1, '工程师会话应返回超时配置');
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
  const customerSummaryBoundDenied = await request('/api/reports/summary?period=week', { headers: { cookie: wrCustomerCookie } });
  assert(customerSummaryBoundDenied.status === 403, '已绑定项目的客户不应查看日志汇总');
  const customerDrilldownDenied = await request('/api/reports/drilldown?period=month', { headers: { cookie: wrCustomerCookie } });
  assert(customerDrilldownDenied.status === 403, '客户不应查看下钻报表');
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
  const approvePending = await request(`/api/users/${pendingUser.id}/approve`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
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

  const reminderTriggerOffset = getTimezoneOffsetForHour(String(health.data.checkedAt || ''), 12);
  const reminderTriggerSettings = await updateSystemSettings(cookie, { timezoneOffset: reminderTriggerOffset, dailyReportReminderHour: 11 });
  assert(reminderTriggerSettings.status === 200, '保存提醒触发时区设置失败');

  const serverNow = String(health.data.checkedAt || '');
  const todayKey = getLocalDateKey(serverNow, reminderTriggerOffset) || formatDateKey(new Date());
  const reminderLocalHour = getLocalHour(serverNow, reminderTriggerOffset);
  const monthDaysLeft = getMonthDaysLeft(todayKey);
  assert(reminderLocalHour >= 11, '提醒触发时区本地小时计算不正确');
  const reminderSeedList = await waitForProjectNotifications(cookie, reminderProjectId, list => list.some(item => item.category === 'work-report-daily-missing' && String(item.content || '').includes('提醒漏填工程师')));
  assert(reminderSeedList.some(item => item.category === 'work-report-daily-missing' && String(item.content || '').includes('提醒漏填工程师')), '日报漏填提醒未生成');
  assert(reminderSeedList.some(item => item.category === 'work-report-weekly-deadline' && String(item.content || '').includes('提醒漏填工程师')), '周报截止提醒未生成');
  if (monthDaysLeft <= 15) {
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
    body: JSON.stringify({ planId: plan.data.id, executedAt: '2026-06-19T13:00', executor: 'admin', result: '正常', checklist: '回归检查', nextDate: '2026-07-01' })
  });
  assert(execution.status === 201, '创建巡检执行记录失败');
  const executionDelete = await request(`/api/inspection-executions/${execution.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(executionDelete.status === 200, '删除巡检执行记录失败');
  const planDelete = await request(`/api/inspection-plans/${plan.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(planDelete.status === 200, '删除巡检计划失败');

  if (customerId) {
    const change = await request('/api/change-records', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, assetId, approverId, customerId, title: '回归变更', content: '回归测试变更', riskLevel: '中' })
    });
    assert(change.status === 201, '创建变更记录失败');
    const changeDelete = await request(`/api/change-records/${change.data.id}`, { method: 'DELETE', headers: { cookie } });
    assert(changeDelete.status === 200, '删除变更记录失败');
  }

  const incident = await request('/api/incidents', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, assetId, title: '回归故障', faultType: '网络中断', severity: '中', slaStatus: '正常', status: '处理中', occurredAt: '2026-06-19T13:10', resolution: '待处理' })
  });
  assert(incident.status === 201, '创建故障记录失败');
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
  const customerAiResults = await request('/api/ai-inspection/results?all=1', { headers: { cookie: aiCustomerLogin.cookie } });
  assert(customerAiResults.status === 200 && (customerAiResults.data.data || []).every(item => item.rawOutput === undefined && item.stdout === undefined && item.stderr === undefined && (item.probeError === undefined || item.probeError === true || item.probeError === false)), '客户巡检结果应脱敏探测细节');
  assert((customerAiResults.data.data || []).every(item => !String(item.suggestion || '').includes('10.0.0.10') && !String(item.summary || '').includes('10.0.0.10')), '客户巡检结果不应包含设备地址');
  const firstCustomerResult = (customerAiResults.data.data || [])[0];
  if (firstCustomerResult) {
    const customerReport = await request(`/api/reports/ai-inspection/results/${firstCustomerResult.id}/html`, { method: 'POST', headers: { cookie: aiCustomerLogin.cookie } });
    assert(customerReport.status === 200, '客户下载巡检 HTML 报告失败');
    assert(!String(customerReport.data || '').includes('10.0.0.10'), '客户巡检 HTML 报告不应包含设备地址');
  }
  const deleteAiCustomer = await request(`/api/users/${createAiCustomer.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(deleteAiCustomer.status === 200, '清理巡检测试客户失败');
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

  const restore = await request(`/api/system/backups/${encodeURIComponent(backupResult.data.filename)}/restore`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}'
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

  const docDetail = await request(`/api/documents/${docId1}?token=${encodeURIComponent(correctPwd.data.token)}`, { headers: { cookie } });
  assert(docDetail.status === 200, '查询资料详情失败');
  assert(!docDetail.data.accessPasswordHash && !docDetail.data.loginPasswordHash, '资料详情暴露了密码哈希');
  assert(docDetail.data.serialNumber === 'REG-DEV-001' && docDetail.data.managementIp === '192.168.1.100', '验密后资料详情应返回管理字段');

  const downloadResp = await request(`/api/documents/${docId2}/download`, { headers: { cookie } });
  assert(downloadResp.status === 403, '错误 token 应拒绝下载');

  const verifyPwd2 = await request(`/api/documents/${docId2}/verify-password`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'DocPass456' })
  });
  assert(verifyPwd2.status === 200 && verifyPwd2.data.token, '合同密码验证失败');
  const downloadOk = await fetch(base + `/api/documents/${docId2}/download?token=${encodeURIComponent(verifyPwd2.data.token)}`, { headers: { cookie } });
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

  const delDoc2 = await request(`/api/documents/${docId2}`, { method: 'DELETE', headers: { cookie } });
  assert(delDoc2.status === 200, '删除资料失败');
  const listAfterDel = await request('/api/documents', { headers: { cookie } });
  assert(!listAfterDel.data.data.some(d => d.id === docId2), '删除后资料仍存在');

  const delDoc1 = await request(`/api/documents/${docId1}`, { method: 'DELETE', headers: { cookie } });
  assert(delDoc1.status === 200, '清理设备资料失败');

  const auditAfterDocs = await request('/api/audit-logs?pageSize=100&sortBy=createdAt&sortDirection=desc', { headers: { cookie } });
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

  process.stdout.write('Regression passed\n');
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
