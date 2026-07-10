const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function decodeCaptchaToken(token) {
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  return decoded.split(':')[0];
}

async function login(username, password) {
  const captcha = await request('/api/captcha');
  const result = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, captchaToken: captcha.data.token, captcha: decodeCaptchaToken(captcha.data.token) })
  });
  const cookie = (result.headers['set-cookie'] || '').split(';')[0];
  if (cookie && result.data.csrfToken) csrfByCookie.set(cookie, result.data.csrfToken);
  return {
    ...result,
    cookie
  };
}

async function main() {
  const health = await request('/api/health');
  assert(health.status === 200 && health.data.ok === true, '健康检查失败');

  const ready = await request('/api/ready');
  assert(ready.status === 200 && ready.data.ok === true, '就绪检查失败');

  const admin = await login('admin', 'admin123');
  assert(admin.status === 200, '管理员登录失败');
  assert(admin.cookie, '登录后未返回会话 Cookie');

  const headers = { cookie: admin.cookie };
  const session = await request('/api/session', { headers });
  assert(session.status === 200 && session.data.user?.username === 'admin', '会话校验失败');

  const projects = await request('/api/projects', { headers });
  assert(projects.status === 200 && Array.isArray(projects.data.data) && projects.data.data.length >= 1, '项目列表读取失败');

  const templates = await request('/api/ai-inspection/templates', { headers });
  assert(templates.status === 200 && Array.isArray(templates.data.data) && templates.data.data.length >= 1, 'AI 巡检模板读取失败');

  const reports = await request('/api/reports/summary?period=week', { headers });
  assert(reports.status === 200, '报表汇总读取失败');

  // L4: Verify file DB fallback path works (backup writes to disk, export reads from disk)
  const backup = await request('/api/system/backup', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert(backup.status === 200, '系统备份创建失败（文件 DB 路径异常）');
  assert(backup.data.filename, '备份未返回文件名');

  const documents = await request('/api/documents', { headers });
  assert(documents.status === 200 && Array.isArray(documents.data.data), '资料列表读取失败');

  process.stdout.write('Smoke passed\n');
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
