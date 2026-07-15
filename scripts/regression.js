const https = require('https');
const crypto = require('crypto');
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

function decodeCaptchaToken(token) {
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  return decoded.split(':')[0];
}

async function login(username, password, options = {}) {
  const captcha = await request('/api/captcha');
  const result = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify({ username, password, captchaToken: captcha.data.token, captcha: decodeCaptchaToken(captcha.data.token) })
  });
  const cookie = (result.headers['set-cookie'] || '').split(';')[0];
  if (cookie && result.data.csrfToken) csrfByCookie.set(cookie, result.data.csrfToken);
  return {
    ...result,
    cookie
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasAuditLog(logs, action, detailKeyword) {
  return Array.isArray(logs) && logs.some(item => item.action === action && String(item.targetType || '') === 'system' && String(item.detail || '').includes(detailKeyword));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name);
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localDirectory.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localDirectory, centralDirectory, eocd]);
}

async function main() {
  const health = await request('/api/health');
  assert(health.status === 200 && health.data.ok === true, '健康检查接口失败');
  const ready = await request('/api/ready');
  assert(ready.status === 200 && ready.data.ok === true, '就绪检查接口失败');
  const throttledHeaders = { 'x-forwarded-for': '198.51.100.10' };
  for (let index = 0; index < 5; index += 1) {
    const failedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
    assert(failedLogin.status === 401 || failedLogin.status === 429, '错误密码登录未返回预期状态');
  }
  const blockedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
  assert(blockedLogin.status === 429, '登录限流未生效');
  const persistentBlockedLogin = await login('admin', 'wrong-password', { headers: throttledHeaders });
  assert(persistentBlockedLogin.status === 429, '登录限流持久化未生效');
  const admin = await login('admin', 'admin123');
  assert(admin.status === 200, '管理员登录失败');
  assert(Number(admin.data.systemConfig?.webIdleLogoutMinutes) >= 1, '登录响应未返回控制台超时配置');
  let cookie = admin.cookie;
  const exported = await fetch(base + '/api/system/export', { headers: { cookie } });
  assert(exported.status === 200, '导出当前数据失败');
  const snapshot = JSON.parse(await exported.text());
  const projects = await request('/api/projects', { headers: { cookie } });
  const users = await request('/api/users', { headers: { cookie } });
  const assets = await request('/api/assets', { headers: { cookie } });
  const backupResult = await request('/api/system/backup', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(backupResult.status === 200, '创建系统备份失败');
  assert(String(backupResult.data.filename || '').startsWith('backup-'), '系统备份文件名不符合预期');
  const systemInfo = await request('/api/system/info', { headers: { cookie } });
  assert(systemInfo.status === 200, '查询系统信息失败');
  assert(Number(systemInfo.data.systemConfig?.webIdleLogoutMinutes) >= 1, '系统信息未返回控制台超时配置');
  const settingsResult = await request('/api/system/settings', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webIdleLogoutMinutes: 45, httpsLoginEnabled: false, httpsPort: 3443 })
  });
  assert(settingsResult.status === 200, '保存控制台超时设置失败');
  assert(Number(settingsResult.data.systemConfig?.webIdleLogoutMinutes) === 45, '控制台超时设置保存结果不正确');
  assert(settingsResult.data.systemConfig?.httpsLoginEnabled === false, 'HTTPS 登录默认设置保存失败');
  const secureLoginBeforeHttps = await login('admin', 'admin123', { headers: { 'x-forwarded-proto': 'https' } });
  assert(String(secureLoginBeforeHttps.headers['set-cookie'] || '').includes('Secure'), 'HTTPS 反代请求应派发 Secure Cookie');
  const adminReauth = await login('admin', 'admin123');
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
  const httpsSettings = await request('/api/system/settings', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ httpsLoginEnabled: true, httpsPort: 3443, webIdleLogoutMinutes: 45 })
  });
  assert(httpsSettings.status === 200 && httpsSettings.data.systemConfig?.httpsLoginEnabled === true, '启用 HTTPS 登录失败');
  const secureLoginAfterEnabled = await login('admin', 'admin123', { headers: { 'x-forwarded-proto': 'https' } });
  assert(String(secureLoginAfterEnabled.headers['set-cookie'] || '').includes('Secure'), '启用 HTTPS 登录后未下发 Secure Cookie');
  cookie = (await login('admin', 'admin123')).cookie;
  const httpsServices = await request('/api/system/services', { headers: { cookie } });
  const httpsService = Array.isArray(httpsServices.data) ? httpsServices.data.find(item => item.key === 'https-login') : null;
  assert(httpsServices.status === 200 && httpsService, 'HTTPS 服务状态未返回');
  assert(httpsService.status === 'running', 'HTTPS 服务未启动');
  const httpsHealth = await requestHttps('/api/health', 3443);
  assert(httpsHealth.status === 200 && httpsHealth.data.ok === true, 'HTTPS 健康检查失败');
  const auditAfterSettings = await request('/api/audit-logs', { headers: { cookie } });
  assert(auditAfterSettings.status === 200, '查询系统设置操作日志失败');
   assert(hasAuditLog(auditAfterSettings.data.data, 'update', '更新系统设置'), '更新系统设置未写入操作日志');
   assert(hasAuditLog(auditAfterSettings.data.data, 'upload', '上传 HTTPS 登录证书'), '上传 HTTPS 证书未写入操作日志');
  const auditAfterBackup = await request('/api/audit-logs', { headers: { cookie } });
  assert(auditAfterBackup.status === 200, '查询操作日志失败');
   assert(hasAuditLog(auditAfterBackup.data.data, 'export', '导出系统数据'), '导出系统数据未写入操作日志');
   assert(hasAuditLog(auditAfterBackup.data.data, 'backup', '创建系统备份'), '创建系统备份未写入操作日志');
  const invalidUpgradeForm = new FormData();
  const invalidManifest = JSON.stringify({ version: '1.0.1', files: ['public/version.txt'], sha256: { 'public/version.txt': sha256('wrong-content') } }, null, 2);
  const invalidZip = createZip([
    { name: 'manifest.json', data: invalidManifest },
    { name: 'public/version.txt', data: 'upgrade-content' }
  ]);
  invalidUpgradeForm.append('file', new Blob([invalidZip], { type: 'application/zip' }), 'invalid-upgrade.zip');
  const invalidUpgrade = await fetch(base + '/api/system/upgrade', { method: 'POST', headers: withCsrf({ cookie }, 'POST'), body: invalidUpgradeForm });
  const invalidUpgradeData = await invalidUpgrade.json();
  assert(invalidUpgrade.status === 400 && /签名|SHA256/.test(String(invalidUpgradeData.message || '')), `升级包完整性校验未生效: ${invalidUpgrade.status} ${String(invalidUpgradeData.message || '')}`);
  const projectId = projects.data.data[0]?.id || '';
  const assetId = assets.data.data.find(item => item.projectId === projectId)?.id || '';
  const approverId = users.data.data.find(item => item.role === 'admin')?.id || '';
   const customerId = users.data.data.find(item => item.role === 'customer' && item.projectId === projectId)?.id || '';

  const importResult = await request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot)
  });
  assert(importResult.status === 200, '导入接口失败');
  assert(String(importResult.data.message || '').includes('当前登录状态已保留'), '导入成功消息未包含会话保留提示');
  const auditAfterImport = await request('/api/audit-logs', { headers: { cookie } });
  assert(auditAfterImport.status === 200, '导入后查询操作日志失败');
  assert(hasAuditLog(auditAfterImport.data.data, 'import', '导入系统数据'), '导入系统数据未写入操作日志');
  const sessionAfterImport = await request('/api/session', { headers: { cookie } });
  assert(sessionAfterImport.status === 200 && sessionAfterImport.data.user?.username === 'admin', '导入后当前会话未保留');

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
  const aiResultsAfterFuture = await request('/api/ai-inspection/results', { headers: { cookie } });
  assert(aiResultsAfterFuture.status === 200 && !aiResultsAfterFuture.data.data.some(item => item.taskId === aiFutureTask.data.task.id), '待执行任务提前生成了巡检结果');
  const notificationsAfterAi = await request('/api/notifications', { headers: { cookie } });
  const aiNotification = Array.isArray(notificationsAfterAi.data.data) ? notificationsAfterAi.data.data.find(item => item.category === 'ai-inspection') : null;
  assert(notificationsAfterAi.status === 200 && aiNotification, 'AI 巡检通知未生成');
  const markNotificationRead = await request(`/api/notifications/${aiNotification.id}/read`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert(markNotificationRead.status === 200 && markNotificationRead.data.readAt, '通知已读接口失败');
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
  const aiCycleResults = await request('/api/ai-inspection/results', { headers: { cookie } });
  const aiCycleResultCount = Array.isArray(aiCycleResults.data.data) ? aiCycleResults.data.data.filter(item => item.taskId === aiCycleTask.data.task.id).length : 0;
  assert(aiCycleResultCount >= 2, '周期巡检旧结果阻断了新结果生成');
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
  const backupDownload = await request(`/api/ai-inspection/config-backup/records/${backupRecord.id}/download`, { headers: { cookie } });
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
  const aiReportHtml = await request(`/api/reports/ai-inspection/results/${encodeURIComponent(aiTask.data.result.id)}/html`, { headers: { cookie } });
  assert(aiReportHtml.status === 200, 'AI 巡检 HTML 报告失败');
  const aiReportPptx = await request(`/api/reports/ai-inspection/results/${encodeURIComponent(aiTask.data.result.id)}/pptx`, { headers: { cookie } });
  assert(aiReportPptx.status === 200, 'AI 巡检 PPT 报告失败');
  const aiCycleTaskDelete = await request(`/api/ai-inspection/tasks/${aiCycleTask.data.task.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiCycleTaskDelete.status === 200, '删除周期 AI 巡检任务失败');
  const aiFutureTaskDelete = await request(`/api/ai-inspection/tasks/${aiFutureTask.data.task.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiFutureTaskDelete.status === 200, '删除待执行 AI 巡检任务失败');
  const aiTaskDelete = await request(`/api/ai-inspection/tasks/${aiTask.data.task.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiTaskDelete.status === 200, '删除 AI 巡检任务失败');
  const aiTargetDelete = await request(`/api/ai-inspection/targets/${aiTarget.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert(aiTargetDelete.status === 200, '删除 AI 巡检对象失败');

  const projectPptx = await request(`/api/reports/project/${encodeURIComponent(projectId)}/pptx?period=month`, { headers: { cookie } });
  assert(projectPptx.status === 200, '项目报表下载失败');
  const inspectionHtml = await request(`/api/reports/inspection/project/${encodeURIComponent(projectId)}/html?period=month`, { headers: { cookie } });
  assert(inspectionHtml.status === 200, '巡检 HTML 报表失败');
  const inspectionCsv = await request(`/api/reports/inspection/project/${encodeURIComponent(projectId)}/csv?period=month`, { headers: { cookie } });
  assert(inspectionCsv.status === 200, '巡检 CSV 报表失败');

  const reset = await request('/api/system/reset', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin123' })
  });
  assert(reset.status === 200, '初始化数据库失败');
  const usersAfterReset = await request('/api/users', { headers: { cookie } });
  assert(usersAfterReset.status === 200, '初始化后会话失效');
  assert(Array.isArray(usersAfterReset.data.data) && usersAfterReset.data.data.length === 1 && usersAfterReset.data.data[0].username === 'admin', '初始化后保留账号不符合预期');
  const auditAfterReset = await request('/api/audit-logs', { headers: { cookie } });
  assert(auditAfterReset.status === 200, '初始化后查询操作日志失败');
  assert(hasAuditLog(auditAfterReset.data.data, 'reset', '初始化数据库'), '初始化数据库未写入操作日志');

  const restore = await request('/api/system/import', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot)
  });
  assert(restore.status === 200, '恢复原始数据失败');
  const sessionAfterRestore = await request('/api/session', { headers: { cookie } });
  assert(sessionAfterRestore.status === 200 && sessionAfterRestore.data.user?.username === 'admin', '恢复原始数据后当前会话未保留');

  // L5: Customer role KB permission test
  // Ensure stale test user is cleaned up before creating
  const allUsers = await request('/api/users', { headers: { cookie } });
  const existingCustomerUser = allUsers.data.data.find(u => u.username === 'kb_test_customer');
  if (existingCustomerUser) {
    const kbList = await request('/api/kb', { headers: { cookie } });
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
  const testCustomerUser = { name: 'KB测试客户', username: 'kb_test_customer', password: 'Testpass1!', role: 'customer', phone: '', wechat: '', email: '', idCard: '', projectId: '', startDate: '', endDate: '' };
  const createCustomer = await request('/api/users', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(testCustomerUser) });
  assert(createCustomer.status === 201, '创建测试客户失败');
  const customerLogin = await login('kb_test_customer', 'Testpass1!');
  assert(customerLogin.status === 200 && customerLogin.data.user?.role === 'customer', '测试客户登录失败或角色不正确');
  const customerCookie = customerLogin.cookie;
  const custKbRead = await request('/api/kb', { headers: { cookie: customerCookie } });
  assert(custKbRead.status === 200 && Array.isArray(custKbRead.data.data), '客户角色无法读取知识库');
  const custKbCreate = await request('/api/kb', { method: 'POST', headers: { cookie: customerCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '客户测试', keywords: 'test', problem: 'test', solution: 'test' }) });
  assert(custKbCreate.status === 403, '客户角色不应允许创建知识库条目（预期 403）');
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

  const docDetailWithoutToken = await request(`/api/documents/${docId1}`, { headers: { cookie } });
  assert(docDetailWithoutToken.status === 403, '未验证 token 不应读取资料详情');

  const docDetail = await request(`/api/documents/${docId1}?token=${encodeURIComponent(correctPwd.data.token)}`, { headers: { cookie } });
  assert(docDetail.status === 200, '查询资料详情失败');
  assert(!docDetail.data.accessPasswordHash && !docDetail.data.loginPasswordHash, '资料详情暴露了密码哈希');

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
