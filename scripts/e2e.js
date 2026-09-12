const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    '/usr/local/lib/node_modules/playwright'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
    }
  }
  throw new Error('未找到 Playwright，请先安装全局 playwright');
}

const { chromium } = loadPlaywright();
const { decodeCaptchaFromSvg, CAPTCHA_GLYPHS } = require('./captcha-glyphs');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const downloadDir = '/tmp/opencode/e2e-downloads';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(message) {
  process.stdout.write(`[E2E] ${message}\n`);
}

function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
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

function getWeekRangeStart(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = date.getDay() || 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day + 1);
  return formatDateKey(date);
}

function getWeekRangeEnd(dateString) {
  const date = new Date(`${getWeekRangeStart(dateString)}T00:00:00`);
  date.setDate(date.getDate() + 6);
  return formatDateKey(date);
}

function getMonthRange(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return {
    start: `${date.getFullYear()}-${month}-01`,
    end: `${date.getFullYear()}-${month}-${String(lastDay).padStart(2, '0')}`
  };
}

async function getSelectValues(page, selector) {
  return page.locator(selector).evaluate(select => Array.from(select.options).map(option => ({ value: option.value, label: option.textContent || '' })));
}

async function waitForNonEmptySelect(page, selector, timeout = 15000) {
  await page.waitForFunction(targetSelector => {
    const element = document.querySelector(targetSelector);
    return element && Array.from(element.options).some(option => option.value);
  }, selector, { timeout });
}

async function pickFirstNonEmptyOption(page, selector) {
  await waitForNonEmptySelect(page, selector);
  const options = await getSelectValues(page, selector);
  const target = options.find(option => option.value);
  assert(target, `${selector} 没有可用选项`);
  await page.selectOption(selector, target.value);
  return target;
}

async function pickOptionByText(page, selector, expectedText) {
  await page.waitForFunction(({ targetSelector, text }) => {
    const element = document.querySelector(targetSelector);
    return element && Array.from(element.options).some(option => (option.textContent || '').includes(text));
  }, { targetSelector: selector, text: expectedText }, { timeout: 15000 });
  const options = await getSelectValues(page, selector);
  const target = options.find(option => option.value && option.label.includes(expectedText));
  assert(target, `${selector} 未找到选项 ${expectedText}`);
  await page.selectOption(selector, target.value);
  return target;
}

async function openReportsSubtab(page, subtab) {
  await page.click('button[data-tab="reports"]');
  await page.waitForSelector('section[data-tab="reports"] .title', { state: 'visible', timeout: 5000 });
  await page.evaluate(name => {
    if (typeof switchSectionSubtab !== 'function') throw new Error('switchSectionSubtab 不可用');
    switchSectionSubtab('reports', name);
  }, subtab);
  await page.waitForSelector(`.subtab-panel[data-section="reports"][data-subtab="${subtab}"]:not(.hidden)`, { timeout: 5000 });
}

async function ensureCreatedProjectAndUser(page, project, user) {
  await page.evaluate(({ project: nextProject, user: nextUser }) => {
    const projects = Array.isArray(state.projects) ? state.projects.slice() : [];
    if (nextProject && nextProject.id && !projects.some(item => item.id === nextProject.id)) projects.unshift(nextProject);
    state.projects = projects;
    const users = Array.isArray(state.users) ? state.users.slice() : [];
    if (nextUser && nextUser.id && !users.some(item => item.id === nextUser.id)) users.unshift(nextUser);
    if (state.user && state.user.id && !users.some(item => item.id === state.user.id)) users.unshift(state.user);
    state.users = users;
    if (typeof fillUserProjectSelect === 'function') fillUserProjectSelect();
    if (typeof fillAssetProjectSelect === 'function') fillAssetProjectSelect();
    const documentSelect = document.getElementById('documentProjectId');
    if (documentSelect) {
      const currentValue = documentSelect.value;
      documentSelect.innerHTML = '<option value="">请选择关联项目</option>' + state.projects.map(item => {
        const label = `${item.customerName || '-'}/${item.name || '-'}`;
        return `<option value="${item.id}">${label}</option>`;
      }).join('');
      if (currentValue && state.projects.some(item => item.id === currentValue)) documentSelect.value = currentValue;
    }
  }, { project, user });
}

async function gotoWithRetry(page, url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await page.waitForTimeout(1000 * attempt);
      }
    }
  }
  throw lastError;
}

async function login(page, username, password) {
  await page.context().clearCookies();
  await gotoWithRetry(page, baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loginForm input[name="username"]', { state: 'visible', timeout: 120000 });
  await page.evaluate(() => {
    localStorage.removeItem('sessionTokenFallback');
    localStorage.removeItem('rememberedUsername');
  });
  logStep(`登录表单: 等待验证码 (${username})`);
  await page.waitForFunction(() => Boolean(window.__captchaToken) && document.querySelector('#captchaImg img'), null, { timeout: 30000 });
  logStep(`登录表单: 提交 (${username})`);
  await page.evaluate(() => { window.__DISABLE_WS_REFRESH = true; });
  const loginResponsePromise = page.waitForResponse(response => response.url().includes('/api/login') && response.request().method() === 'POST', { timeout: 30000 });
  const captchaSrc = await page.evaluate(() => {
    const img = document.querySelector('#captchaImg img');
    return img ? img.getAttribute('src') : '';
  });
  const captcha = decodeCaptchaFromSvg(captchaSrc);
  await page.evaluate(({ username: loginUsername, password: loginPassword, captcha: loginCaptcha }) => {
    document.getElementById('loginUsername').value = loginUsername;
    document.getElementById('loginPassword').value = loginPassword;
    document.getElementById('loginCaptchaInput').value = loginCaptcha;
    document.getElementById('loginForm').requestSubmit();
  }, { username, password, captcha });
  const loginResponse = await loginResponsePromise;
  if (!loginResponse.ok()) {
    const loginMessage = await page.locator('#loginMessage').textContent().then(text => String(text || '').trim()).catch(() => '');
    throw new Error(`表单登录接口失败 (${username}): ${loginResponse.status()} ${loginMessage}`);
  }
  try {
    await page.waitForFunction(() => Boolean(window.state && window.state.user && window.state.user.id), null, { timeout: 120000 });
  } catch (error) {
    const loginMessage = await page.locator('#loginMessage').textContent().then(text => String(text || '').trim()).catch(() => '');
    throw new Error(`表单登录后未进入系统 (${username}): ${loginMessage || error.message}`);
  }
  await page.evaluate(async () => {
    window.__DISABLE_WS_REFRESH = true;
    if (typeof showAppView === 'function') showAppView();
    const projectsResult = await api('/api/projects?pageSize=100&sortBy=createdAt&sortDirection=desc', { silent: true });
    const projectList = Array.isArray(projectsResult?.data) ? projectsResult.data : [];
    if (projectList.length) state.projects = projectList;
    const usersResult = await api('/api/users?pageSize=100&sortBy=createdAt&sortDirection=desc', { silent: true });
    const userList = Array.isArray(usersResult?.data) ? usersResult.data : [];
    if (userList.length) {
      const merged = userList.slice();
      (state.users || []).forEach(item => {
        if (item && item.id && !merged.some(existing => existing.id === item.id)) merged.push(item);
      });
      state.users = merged;
    }
  });
  await page.waitForFunction(() => {
    const appView = document.getElementById('appView');
    const projects = window.state?.projects;
    const list = Array.isArray(projects) ? projects : (Array.isArray(projects?.data) ? projects.data : []);
    return Boolean(appView) && !appView.classList.contains('hidden') && list.length > 0;
  }, null, { timeout: 30000 });
}

async function waitForTableRow(page, selector, keyword) {
  await page.waitForFunction(({ targetSelector, text }) => {
    const rows = Array.from(document.querySelectorAll(`${targetSelector} tr`));
    return rows.some(row => (row.textContent || '').includes(text));
  }, { targetSelector: selector, text: keyword }, { timeout: 60000 });
}

async function waitForMessageText(page, selector) {
  await page.waitForFunction(targetSelector => {
    const element = document.querySelector(targetSelector);
    return element && String(element.textContent || '').trim().length > 0;
  }, selector);
  return page.locator(selector).textContent().then(text => String(text || '').trim());
}

async function browserRequest(page, resource, options = {}) {
  return page.evaluate(async ({ resource, options }) => {
    const sessionTokenFallback = localStorage.getItem('sessionTokenFallback') || '';
    const response = await fetch(resource, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(!['GET', 'HEAD', 'OPTIONS'].includes(String(options.method || 'GET').toUpperCase()) ? { 'X-CSRF-Token': state.csrfToken || '' } : {}),
        ...(sessionTokenFallback ? { 'X-Session-Token': sessionTokenFallback } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
    }
    return { status: response.status, data };
  }, { resource, options });
}

async function waitForBrowserRequest(page, resource, predicate, attempts = 10, delayMs = 500) {
  let result = null;
  for (let index = 0; index < attempts; index += 1) {
    result = await browserRequest(page, resource);
    if (predicate(result)) {
      return result;
    }
    await page.waitForTimeout(delayMs);
  }
  return result;
}

async function captureExportDownload(page, buttonSelector, urlPart, destPath) {
  const text = await page.evaluate(async ({ buttonSelector: selector, urlPart: match }) => {
    const originalFetch = window.fetch;
    let captured = null;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = String(args[0] || '');
      if (url.includes(match) && captured === null) {
        captured = await response.clone().text();
      }
      return response;
    };
    try {
      const button = document.querySelector(selector);
      if (!button) throw new Error(`未找到导出按钮 ${selector}`);
      button.click();
      const started = Date.now();
      while (captured === null && Date.now() - started < 180000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (captured === null) throw new Error(`导出请求超时: ${match}`);
      return captured;
    } finally {
      window.fetch = originalFetch;
    }
  }, { buttonSelector, urlPart });
  fs.writeFileSync(destPath, text);
  return text;
}

async function logout(page) {
  await page.evaluate(() => {
    return fetch('/api/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken || '' },
      body: '{}'
    });
  });
  await gotoWithRetry(page, baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loginForm input[name="username"]', { state: 'visible', timeout: 120000 });
}

async function cleanupData(page, payload) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.removeItem('sessionTokenFallback'); } catch (error) {}
  }).catch(() => {});
  await gotoWithRetry(page, baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loginForm input[name="username"]', { state: 'visible', timeout: 120000 });
  await page.evaluate(async ({ data, glyphs }) => {
      const request = async (resource, options = {}) => {
        const response = await fetch(resource, {
          credentials: 'include',
          ...options,
          headers: { 'Content-Type': 'application/json', ...(!['GET', 'HEAD', 'OPTIONS'].includes(String(options.method || 'GET').toUpperCase()) ? { 'X-CSRF-Token': state.csrfToken || '' } : {}), ...(options.headers || {}) }
        });
      const text = await response.text();
      let parsed = [];
      try { parsed = text ? JSON.parse(text) : []; } catch (error) { parsed = []; }
      return { response, data: parsed };
    };
    await request('/api/logout', { method: 'POST', body: '{}' });
    const captchaResp = await request('/api/captcha');
    const decodeCaptchaFromSvg = (payload) => {
      const source = typeof payload === 'string' ? payload : String((payload && (payload.svg || payload.svgMarkup)) || '');
      let markup = source;
      const comma = source.indexOf(',');
      if (source.startsWith('data:') && comma >= 0) {
        try { markup = decodeURIComponent(source.slice(comma + 1)); } catch (_) { markup = source; }
      }
      const grouped = new Map();
      const re = /class="cg"[^>]*data-g="(\d+)"[^>]*data-r="(\d+)"[^>]*data-c="(\d+)"/g;
      let match = re.exec(markup);
      while (match) {
        const index = Number(match[1]);
        const cells = grouped.get(index) || [];
        cells.push(match[2] + ':' + match[3]);
        grouped.set(index, cells);
        match = re.exec(markup);
      }
      return Array.from(grouped.keys()).sort((a, b) => a - b).map(index => {
        const cells = new Set(grouped.get(index) || []);
        const signature = [];
        for (let row = 0; row < 7; row += 1) {
          let line = '';
          for (let col = 0; col < 5; col += 1) line += cells.has(row + ':' + col) ? '1' : '0';
          signature.push(line);
        }
        const key = signature.join('|');
        const found = Object.keys(glyphs).find(ch => glyphs[ch].join('|') === key);
        return found || '';
      }).join('');
    };
    const decodedCaptcha = decodeCaptchaFromSvg(captchaResp.data);
    const loginResp = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'Admin123!', captchaToken: captchaResp.data.token, captcha: decodedCaptcha }) });
    state.csrfToken = loginResp.data && loginResp.data.csrfToken ? loginResp.data.csrfToken : '';
    const getList = async (url) => {
      const result = await request(url);
      return Array.isArray(result.data && result.data.data) ? result.data.data : (Array.isArray(result.data) ? result.data : []);
    };
    const tasks = await getList('/api/ai-inspection/tasks');
    const task = tasks.find(item => item.title === data.taskTitle);
    if (task) await request(`/api/ai-inspection/tasks/${task.id}`, { method: 'DELETE', body: '{}' });
    const targets = await getList('/api/ai-inspection/targets');
    const target = targets.find(item => item.name === data.targetName);
    if (target) await request(`/api/ai-inspection/targets/${target.id}`, { method: 'DELETE', body: '{}' });
    const changes = await getList('/api/change-records');
    const change = changes.find(item => item.title === data.changeTitle);
    if (change) await request(`/api/change-records/${change.id}`, { method: 'DELETE', body: '{}' });
    const users = await getList('/api/users');
    const createdUser = users.find(item => item.username === data.customerUsername);
    if (createdUser) await request(`/api/users/${createdUser.id}`, { method: 'DELETE', body: '{}' });
    const projects = await getList('/api/projects');
    const createdProject = projects.find(item => item.name === data.projectName);
    if (createdProject) await request(`/api/projects/${createdProject.id}`, { method: 'DELETE', body: '{}' });
    const docs = await getList('/api/documents');
    for (const docTitle of (data.docTitles || [])) {
      const doc = docs.find(item => item.title === docTitle);
      if (doc) await request(`/api/documents/${doc.id}`, { method: 'DELETE', body: '{}' });
    }
  }, { data: payload, glyphs: CAPTCHA_GLYPHS });
}

async function main() {
  fs.mkdirSync(downloadDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const suffix = Date.now();
  const targetName = `E2E巡检对象-${suffix}`;
  const taskTitle = `E2E巡检任务-${suffix}`;
  const projectName = `E2E项目-${suffix}`;
  const customerName = `E2E客户-${suffix}`;
  const customerUsername = `e2e_customer_${suffix}`;
  const customerPassword = 'Customer-123';
  const changeTitle = `E2E变更-${suffix}`;
  const docTitle1 = `E2E设备-${suffix}`;
  const docTitle2 = `E2E合同-${suffix}`;
  const reportDay = String((Number(String(suffix).slice(-2)) % 28) + 1).padStart(2, '0');
  let reportDate = `2099-11-${reportDay}`;
  const reportSummary = `E2E工作汇报-${suffix}`;
  const weeklyReportDay = String(Math.min(Number(reportDay) + 1, 28)).padStart(2, '0');
  let weeklyReportDate = `2099-11-${weeklyReportDay}`;
  let weeklyReportRangeStart = getWeekRangeStart(weeklyReportDate);
  const weeklyReportSummary = `E2E周报-${suffix}`;
  const exportPath = path.join(downloadDir, `onsite-ops-export-${suffix}.json`);

  try {
    // === Login ===
    logStep('管理员首次登录');
    await login(page, 'admin', 'Admin123!');
    await page.evaluate(() => { window.__DISABLE_WS_REFRESH = true; });
    const initialProjects = await browserRequest(page, '/api/projects');
    assert(Array.isArray(initialProjects.data?.data) && initialProjects.data.data.length > 0, '登录后项目数据未加载');
    await page.waitForTimeout(1000);

    logStep('验证自动登出后可重新登录');
    const idleSettings = await browserRequest(page, '/api/system/settings', { method: 'POST', body: JSON.stringify({ webIdleLogoutMinutes: 1 }) });
    assert(idleSettings.status === 200 && Number(idleSettings.data.systemConfig?.webIdleLogoutMinutes) === 1, '设置自动登出时间失败');
    await page.evaluate(() => {
      state.systemConfig = { ...(state.systemConfig || {}), webIdleLogoutMinutes: 1 };
    });
    await page.evaluate(async () => {
      await performAutoLogout();
      if (typeof showLoginView === 'function') showLoginView();
    });
    await page.waitForFunction(() => {
      const loginView = document.getElementById('loginView');
      const appView = document.getElementById('appView');
      return Boolean(loginView && !loginView.classList.contains('hidden') && appView && appView.classList.contains('hidden'));
    }, { timeout: 30000 });
    await page.waitForSelector('#loginForm input[name="username"]', { state: 'visible', timeout: 30000 });
    const autoLogoutMessage = await page.locator('#loginMessage').textContent().then(text => String(text || '').trim());
    assert(autoLogoutMessage.includes('自动退出登录'), `自动登出提示不正确: ${autoLogoutMessage}`);
    await page.evaluate(() => localStorage.removeItem('sessionTokenFallback'));
    await login(page, 'admin', 'Admin123!');
    const reloginState = await page.evaluate(() => ({
      user: state.user?.username || '',
      fallbackToken: localStorage.getItem('sessionTokenFallback') || ''
    }));
    assert(reloginState.user === 'admin', '自动登出后重新登录未恢复管理员会话');
    assert(!reloginState.fallbackToken, '重新登录后不应再写入 localStorage sessionToken');
    const reloginSession = await browserRequest(page, '/api/session');
    assert(reloginSession.status === 200 && reloginSession.data.user?.username === 'admin', `自动登出后重新登录未恢复正常会话请求: ${JSON.stringify(reloginSession)}`);
    const restoreIdleSettings = await browserRequest(page, '/api/system/settings', { method: 'POST', body: JSON.stringify({ webIdleLogoutMinutes: 30 }) });
    assert(restoreIdleSettings.status === 200 && Number(restoreIdleSettings.data.systemConfig?.webIdleLogoutMinutes) === 30, '恢复自动登出时间失败');
    await page.evaluate(() => {
      state.systemConfig = { ...(state.systemConfig || {}), webIdleLogoutMinutes: 30 };
      if (typeof startIdleLogoutTracking === 'function') startIdleLogoutTracking();
    });

    // === Work Reports: Engineer Create/Submit, Admin Review ===
    logStep('进入工作汇报链路');
    const currentUsers = await browserRequest(page, '/api/users?pageSize=1000');
    const currentProjects = await browserRequest(page, '/api/projects');
    const engineerUser = (currentUsers.data?.data || []).find(item => item.username === 'engineer1') || {};
    const engineerProject = (currentProjects.data?.data || []).find(item => item.id === engineerUser.projectId) || {};
    const engineerProjectId = engineerUser.projectId || '';
    const engineerUserId = engineerUser.id || '';
    const engineerName = engineerUser.name || '';
    const engineerProjectName = engineerProject.name || '';
    assert(engineerProjectId, '未找到工程师项目');
    assert(engineerUserId, '未找到工程师 ID');
    assert(engineerName, '未找到工程师姓名');
    const existingWorkReports = await browserRequest(page, `/api/work-reports?projectId=${encodeURIComponent(engineerProjectId)}&userId=${encodeURIComponent(engineerUserId)}`);
    const existingWorkReportRows = existingWorkReports.data?.data || [];
    while (existingWorkReportRows.some(item => String(item.reportType) === 'daily' && String(item.rangeStart) === reportDate)) {
      reportDate = addDaysToDateKey(reportDate, 1);
    }
    while (existingWorkReportRows.some(item => String(item.reportType) === 'weekly' && String(item.rangeStart) === getWeekRangeStart(weeklyReportDate))) {
      weeklyReportDate = addDaysToDateKey(weeklyReportDate, 1);
      weeklyReportRangeStart = getWeekRangeStart(weeklyReportDate);
    }
    await openReportsSubtab(page, 'workload');
    await page.selectOption('#workloadPeriod', 'custom');
    await page.fill('#workloadStartDate', reportDate);
    await page.fill('#workloadEndDate', reportDate);
    await page.click('#refreshWorkloadBtn');
    await page.waitForFunction(date => {
      const hint = document.getElementById('workloadRangeHint');
      return hint && (hint.textContent || '').includes(date);
    }, reportDate);

    await logout(page);
    logStep('工程师创建日报与周报');
    await login(page, 'engineer1', 'Engineer123!');
    await openReportsSubtab(page, 'workload');
    await page.selectOption('#workloadPeriod', 'custom');
    await page.fill('#workloadStartDate', reportDate);
    await page.fill('#workloadEndDate', reportDate);
    await page.click('#refreshWorkloadBtn');
    await openReportsSubtab(page, 'workReports');
    await page.evaluate(({ projectId, projectName }) => {
      const select = document.getElementById('workReportProjectId');
      if (!select) return;
      if (!Array.from(select.options).some(option => option.value === projectId)) {
        select.innerHTML = `<option value="${projectId}">${projectName || projectId}</option>`;
      }
      select.value = projectId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, { projectId: engineerProjectId, projectName: engineerProjectName });
    const createLogResult = await browserRequest(page, '/api/logs', {
      method: 'POST',
      body: JSON.stringify({
        projectId: engineerProjectId,
        date: reportDate,
        ticketType: '事务工作',
        event: 'E2E工作汇报日志',
        relatedTarget: '核心交换机',
        result: '已完成',
        process: 'E2E 前端工作汇报回归',
        conclusion: '完成',
        durationHours: 1.5
      })
    });
    assert(createLogResult.status === 201, `创建 E2E 工作汇报日志失败: ${createLogResult.status} ${JSON.stringify(createLogResult.data)}`);
    await page.evaluate(({ reportDate, reportSummary, projectId, projectName }) => {
      const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const select = document.getElementById('workReportProjectId');
      if (select) {
        if (!Array.from(select.options).some(option => option.value === projectId)) {
          select.innerHTML = `<option value="${projectId}">${projectName || projectId}</option>`;
        }
        select.value = projectId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setValue('workReportAnchorDate', reportDate);
      setValue('workReportSummary', reportSummary);
      setValue('workReportCompletedWork', '完成前端工作汇报回归');
      setValue('workReportPendingWork', '等待管理员确认');
      setValue('workReportRisks', '无');
      setValue('workReportNextPlan', '继续执行 E2E 回归');
    }, { reportDate, reportSummary, projectId: engineerProjectId, projectName: engineerProjectName });
    await page.evaluate(() => document.getElementById('saveWorkReportBtn')?.click());
    const savedMessage = await waitForMessageText(page, '#workReportEditorMessage');
    assert(savedMessage.includes('工作汇报已保存'), `工作汇报保存失败: ${savedMessage}`);
    const dailyReportList = await waitForBrowserRequest(
      page,
      '/api/work-reports',
      result => Array.isArray(result.data?.data) && result.data.data.some(item => item.projectId === engineerProjectId && item.rangeStart === reportDate && item.userId === engineerUserId && item.reportType === 'daily'),
      20,
      1000
    );
    await page.evaluate(() => loadBaseData());
    const dailyReportId = (dailyReportList.data?.data || []).find(item => item.projectId === engineerProjectId && item.rangeStart === reportDate && item.userId === engineerUserId && item.reportType === 'daily')?.id || '';
    assert(dailyReportId, '未找到新建日报 ID');
    await page.evaluate(reportId => {
      renderWorkReportDetail(reportId);
    }, dailyReportId);
    await page.waitForFunction(text => {
      const el = document.getElementById('workReportDetail');
      return el && (el.textContent || '').includes(text);
    }, reportSummary);
    await page.evaluate(async reportId => {
      await api(`/api/work-reports/${reportId}/submit`, { method: 'POST', body: JSON.stringify({}) });
      await loadBaseData();
      await refreshReports();
      setMessage('workReportEditorMessage', '工作汇报已提交');
    }, dailyReportId);
    await page.waitForFunction(reportId => {
      return Array.isArray(state.workReports) && state.workReports.some(item => item.id === reportId && item.status === 'submitted');
    }, dailyReportId);
    await page.evaluate(({ weeklyReportDate, weeklyReportSummary, projectId, projectName }) => {
      const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const typeSelect = document.getElementById('workReportType');
      if (typeSelect) {
        typeSelect.value = 'weekly';
        typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const select = document.getElementById('workReportProjectId');
      if (select) {
        if (!Array.from(select.options).some(option => option.value === projectId)) {
          select.innerHTML = `<option value="${projectId}">${projectName || projectId}</option>`;
        }
        select.value = projectId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setValue('workReportAnchorDate', weeklyReportDate);
      setValue('workReportSummary', weeklyReportSummary);
      setValue('workReportCompletedWork', '完成周报初版');
      setValue('workReportPendingWork', '等待管理员退回');
      setValue('workReportRisks', '风险说明待补充');
      setValue('workReportNextPlan', '根据意见修改后再提');
    }, { weeklyReportDate, weeklyReportSummary, projectId: engineerProjectId, projectName: engineerProjectName });
    await page.evaluate(() => document.getElementById('submitWorkReportBtn')?.click());
    const submittedMessage = await waitForMessageText(page, '#workReportEditorMessage');
    assert(submittedMessage.includes('工作汇报已提交') || submittedMessage.includes('工作汇报已保存'), `工作汇报提交失败: ${submittedMessage}`);
    const weeklyReportList = await waitForBrowserRequest(
      page,
      '/api/work-reports',
      result => Array.isArray(result.data?.data) && result.data.data.some(item => item.projectId === engineerProjectId && item.rangeStart === weeklyReportRangeStart && item.userId === engineerUserId && item.reportType === 'weekly'),
      20,
      1000
    );
    await page.evaluate(() => loadBaseData());
    const weeklyReportId = (weeklyReportList.data?.data || []).find(item => item.projectId === engineerProjectId && item.rangeStart === weeklyReportRangeStart && item.userId === engineerUserId && item.reportType === 'weekly')?.id || '';
    assert(weeklyReportId, '未找到新建周报 ID');
    await page.waitForFunction(reportId => {
      return Array.isArray(state.workReports) && state.workReports.some(item => item.id === reportId && item.status === 'submitted');
    }, weeklyReportId);

    await logout(page);
    logStep('管理员审核日报并退回周报');
    await login(page, 'admin', 'Admin123!');
    await openReportsSubtab(page, 'workReports');
    await page.evaluate(async () => {
      if (typeof refreshReports === 'function') await refreshReports();
    });
    await page.selectOption('#workReportFilterProject', engineerProjectId);
    await page.waitForFunction(userId => {
      const select = document.getElementById('workReportFilterUser');
      return select && Array.from(select.options).some(option => option.value === userId);
    }, engineerUserId);
    await page.selectOption('#workReportFilterUser', engineerUserId);
    await page.selectOption('#workReportFilterStatus', 'submitted');
    await page.click('#refreshWorkReportListBtn');
    await page.waitForFunction(({ date, userId, reportId }) => {
      return Array.isArray(state.workReports) && state.workReports.some(item => item.id === reportId || (item.rangeStart === date && item.userId === userId && item.status === 'submitted' && item.reportType === 'daily'));
    }, { date: reportDate, userId: engineerUserId, reportId: dailyReportId }, { timeout: 60000 });
    await page.waitForFunction(({ userName, projectId }) => {
      const projectValue = document.getElementById('workReportFilterProject')?.value || '';
      const userValue = document.getElementById('workReportFilterUser')?.value || '';
      const rows = Array.from(document.querySelectorAll('#workReportTable tr'));
      return projectValue === projectId && userValue.length > 0 && rows.some(row => (row.textContent || '').includes(userName));
    }, { userName: engineerName, projectId: engineerProjectId });
    await page.waitForFunction(reportId => {
      return Array.isArray(state.workReports) && state.workReports.some(item => item.id === reportId && item.status === 'submitted');
    }, dailyReportId);
    await page.evaluate(async reportId => {
      const originalPrompt = window.prompt;
      window.prompt = () => '回归确认';
      try {
        await reviewWorkReport(reportId, 'approved');
      } finally {
        window.prompt = originalPrompt;
      }
    }, dailyReportId);
    await openReportsSubtab(page, 'workReports');
    await page.selectOption('#workReportFilterStatus', 'approved');
    await waitForBrowserRequest(
      page,
      `/api/work-reports?status=approved&projectId=${encodeURIComponent(engineerProjectId)}&userId=${encodeURIComponent(engineerUserId)}`,
      result => Array.isArray(result.data?.data) && result.data.data.some(item => item.id === dailyReportId)
    );
    await page.evaluate(async reportId => {
      const originalPrompt = window.prompt;
      window.prompt = () => '回归锁定';
      try {
        await reviewWorkReport(reportId, 'locked');
      } finally {
        window.prompt = originalPrompt;
      }
    }, dailyReportId);
    await page.selectOption('#workReportFilterStatus', 'locked');
    await waitForBrowserRequest(
      page,
      `/api/work-reports?status=locked&projectId=${encodeURIComponent(engineerProjectId)}&userId=${encodeURIComponent(engineerUserId)}`,
      result => Array.isArray(result.data?.data) && result.data.data.some(item => item.id === dailyReportId)
    );
    await page.selectOption('#workReportFilterStatus', 'submitted');
    await waitForBrowserRequest(
      page,
      `/api/work-reports?reportType=weekly&status=submitted&projectId=${engineerProjectId}&userId=${engineerUserId}`,
      result => Array.isArray(result.data?.data) && result.data.data.some(item => item.id === weeklyReportId)
    );
    await page.waitForFunction(reportId => {
      return Array.isArray(state.workReports) && state.workReports.some(item => item.id === reportId && item.status === 'submitted');
    }, weeklyReportId);
    await page.evaluate(async reportId => {
      const originalPrompt = window.prompt;
      window.prompt = () => '请补充本周风险说明';
      try {
        await reviewWorkReport(reportId, 'returned');
      } finally {
        window.prompt = originalPrompt;
      }
    }, weeklyReportId);
    await page.selectOption('#workReportFilterStatus', 'returned');
    await page.click('#refreshWorkReportListBtn');
    await page.waitForFunction(reportId => {
      return Array.isArray(state.workReports) && state.workReports.some(item => item.id === reportId && item.status === 'returned');
    }, weeklyReportId);

    await logout(page);
    logStep('工程师编辑退回周报并重新提交');
    await login(page, 'engineer1', 'Engineer123!');
    await openReportsSubtab(page, 'workReports');
    await page.selectOption('#workReportFilterProject', engineerProjectId);
    await page.selectOption('#workReportFilterStatus', 'returned');
    await page.waitForFunction(reportId => {
      return Array.isArray(state.workReports) && state.workReports.some(item => item.id === reportId && item.status === 'returned');
    }, weeklyReportId);
    await page.evaluate(reportId => {
      const report = state.workReports.find(item => item.id === reportId);
      if (!report) throw new Error('未找到目标周报');
      populateWorkReportForm(report);
      renderWorkReportDetail(report.id);
    }, weeklyReportId);
    await page.fill('#workReportRisks', '已补充本周风险说明');
    await page.fill('#workReportNextPlan', '重新提交管理员审核');
    await page.evaluate(() => saveWorkReport(true));
    await openReportsSubtab(page, 'workReports');
    await page.selectOption('#workReportFilterStatus', 'submitted');
    await page.click('#refreshWorkReportListBtn');
    const resubmittedWeeklyReport = await waitForBrowserRequest(
      page,
      `/api/work-reports?projectId=${encodeURIComponent(engineerProjectId)}&userId=${encodeURIComponent(engineerUserId)}`,
      result => Array.isArray(result.data?.data) && result.data.data.some(item => item.id === weeklyReportId && item.status === 'submitted')
    );
    assert(Array.isArray(resubmittedWeeklyReport?.data?.data) && resubmittedWeeklyReport.data.data.some(item => item.id === weeklyReportId && item.status === 'submitted'), '工程师重新提交周报后接口状态未更新');

    await logout(page);
    logStep('管理员验证工作汇报看板与导出并清理日志');
    await login(page, 'admin', 'Admin123!');
    await openReportsSubtab(page, 'workReports');
    await page.evaluate(async () => {
      if (typeof refreshReports === 'function') await refreshReports();
    });
    await page.selectOption('#workReportFilterProject', engineerProjectId);
    await page.waitForFunction(userId => {
      const select = document.getElementById('workReportFilterUser');
      return select && Array.from(select.options).some(option => option.value === userId);
    }, engineerUserId);
    await page.selectOption('#workReportFilterUser', engineerUserId);
    await page.selectOption('#workReportFilterType', 'weekly');
    await page.selectOption('#workReportFilterStatus', 'submitted');
    await openReportsSubtab(page, 'workload');
    await page.fill('#workloadAnchorDate', weeklyReportDate);
    await page.selectOption('#workloadPeriod', 'month');
    await openReportsSubtab(page, 'overview');
    await page.waitForSelector('#workReportOverviewCard:not(.hidden)', { timeout: 30000 });
    await page.selectOption('#workReportOverviewTrendUnit', 'week');
    await page.click('#refreshWorkReportOverviewBtn');
    const reportMonthRange = getMonthRange(weeklyReportDate);
    await page.waitForFunction(({ start, end }) => {
      const hint = document.getElementById('workReportOverviewRangeHint')?.textContent || '';
      return hint.includes(start) && hint.includes(end);
    }, { start: reportMonthRange.start, end: reportMonthRange.end });
    await page.waitForTimeout(1000);
    const overviewSnapshot = await page.evaluate(() => ({
      summary: document.getElementById('workReportOverviewSummary')?.textContent || '',
      pending: document.getElementById('workReportPendingSummary')?.textContent || '',
      pendingRows: document.getElementById('workReportPendingTable')?.textContent || '',
      userRanking: document.getElementById('workReportUserRankingTable')?.textContent || '',
      projectRanking: document.getElementById('workReportProjectRankingTable')?.textContent || '',
      trend: document.getElementById('workReportOverviewTrendTable')?.textContent || '',
      pendingIds: Array.isArray(state.workReportOverview?.pendingSummary?.items) ? state.workReportOverview.pendingSummary.items.map(item => item.id) : []
    }));
    assert(overviewSnapshot.summary.includes('汇报总数') && overviewSnapshot.summary.includes('待审核'), `工作汇报管理汇总摘要不正确: ${overviewSnapshot.summary}`);
    assert(overviewSnapshot.pending.includes('待审核'), `工作汇报待审核汇总不正确: ${overviewSnapshot.pending}`);
    assert(overviewSnapshot.pendingIds.includes(weeklyReportId) || overviewSnapshot.pendingRows.includes(engineerName), `工作汇报待审核列表未命中目标周报: ${overviewSnapshot.pendingRows}`);
    assert(overviewSnapshot.userRanking.includes(engineerName), `工作汇报人员排行不正确: ${overviewSnapshot.userRanking}`);
    assert(overviewSnapshot.projectRanking.includes(engineerProjectName), `工作汇报项目排行不正确: ${overviewSnapshot.projectRanking}`);
    assert(!overviewSnapshot.trend.includes('暂无趋势数据'), `工作汇报趋势数据不正确: ${overviewSnapshot.trend}`);
    const pendingRow = page.locator('#workReportPendingTable tr').filter({ hasText: engineerName }).first();
    await pendingRow.click();
    await page.waitForSelector('.subtab-panel[data-section="reports"][data-subtab="workReports"]:not(.hidden)', { timeout: 10000 });
    const linkedStatus = await page.locator('#workReportFilterStatus').inputValue();
    const linkedUser = await page.locator('#workReportFilterUser').inputValue();
    assert(linkedStatus === 'submitted', `待审核联动状态筛选不正确: ${linkedStatus}`);
    assert(linkedUser === engineerUserId, `待审核联动人员筛选不正确: ${linkedUser}`);
    const overviewExportPath = path.join(downloadDir, `work-report-overview-${suffix}.csv`);
    const overviewExported = await captureExportDownload(page, '#exportWorkReportOverviewBtn', '/api/reports/work-reports/overview/export', overviewExportPath);
    assert(overviewExported.includes('汇总指标') && overviewExported.includes('待审核汇报') && overviewExported.includes(engineerName), '工作汇报管理汇总导出内容不正确');
    await openReportsSubtab(page, 'workReports');
    const reportListExportPath = path.join(downloadDir, `work-report-list-${suffix}.csv`);
    const reportListExported = await captureExportDownload(page, '#exportWorkReportListBtn', '/api/reports/work-reports/export', reportListExportPath);
    assert(reportListExported.includes('周期开始') && reportListExported.includes(weeklyReportRangeStart) && reportListExported.includes(engineerName), '工作汇报列表导出内容不正确');
    await openReportsSubtab(page, 'workload');
    await page.fill('#workloadAnchorDate', reportDate);
    await page.selectOption('#workloadPeriod', 'day');
    await page.click('#refreshWorkloadBtn');
    await waitForBrowserRequest(
      page,
      `/api/reports/workload?period=day&anchorDate=${reportDate}`,
      result => Array.isArray(result.data?.data)
    );
    await page.selectOption('#workloadPeriod', 'week');
    await page.click('#refreshWorkloadBtn');
    await waitForBrowserRequest(
      page,
      `/api/reports/workload?period=week&anchorDate=${reportDate}`,
      result => Array.isArray(result.data?.data)
    );
    await page.selectOption('#workloadPeriod', 'month');
    await page.click('#refreshWorkloadBtn');
    await waitForBrowserRequest(
      page,
      `/api/reports/workload?period=month&anchorDate=${reportDate}`,
      result => Array.isArray(result.data?.data)
    );
    await page.selectOption('#workloadPeriod', 'custom');
    await page.fill('#workloadStartDate', reportDate);
    await page.fill('#workloadEndDate', reportDate);
    await page.click('#refreshWorkloadBtn');
    await page.waitForFunction(date => {
      const hint = document.getElementById('workloadRangeHint');
      return hint && (hint.textContent || '').includes(date);
    }, reportDate, { timeout: 30000 });
    const workloadExportPath = path.join(downloadDir, `workload-${suffix}.csv`);
    const workloadExported = await captureExportDownload(page, '#exportWorkloadBtn', '/api/reports/workload/export', workloadExportPath);
    assert(workloadExported.includes('工程师') && workloadExported.includes('1.5'), '工作量导出内容不正确');
    await openReportsSubtab(page, 'workReports');
    await page.selectOption('#workReportFilterProject', engineerProjectId);
    await page.waitForFunction(userId => {
      const select = document.getElementById('workReportFilterUser');
      return select && Array.from(select.options).some(option => option.value === userId);
    }, engineerUserId);
    await page.selectOption('#workReportFilterUser', engineerUserId);
    await page.selectOption('#workReportFilterStatus', 'locked');
    const lockedDailyReports = await browserRequest(page, `/api/work-reports?status=locked&reportType=daily&projectId=${encodeURIComponent(engineerProjectId)}&userId=${encodeURIComponent(engineerUserId)}`);
    assert(Array.isArray(lockedDailyReports.data?.data) && lockedDailyReports.data.data.some(item => item.rangeStart === reportDate && item.summary === reportSummary), '锁定后的日报未出现在列表中');
    const logId = await page.evaluate(() => (state.logs || []).find(item => item.event === 'E2E工作汇报日志')?.id || '');
    if (logId) {
      const deleteLogResult = await browserRequest(page, `/api/logs/${logId}`, { method: 'DELETE', body: '{}' });
      assert(deleteLogResult.status === 200, '清理 E2E 工作汇报日志失败');
    }

    // === AI Inspection: Create Target ===
    logStep('AI 巡检对象创建');
    await logout(page);
    await login(page, 'admin', 'Admin123!');
    await page.click('button[data-tab="aiInspection"]');
    await page.waitForSelector('section[data-tab="aiInspection"] .title', { state: 'visible' });
    await page.waitForFunction(() => Array.isArray(window.state?.assets) && window.state.assets.some(item => item && item.id && item.projectId), null, { timeout: 30000 });
    const projectWithAssets = await page.evaluate(() => {
      const asset = (window.state.assets || []).find(item => item && item.id && item.projectId);
      return asset ? asset.projectId : '';
    });
    assert(projectWithAssets, '未找到带资产的项目');
    await page.selectOption('#aiInspectionTargetProjectId', projectWithAssets);
    const selectedTargetAsset = await pickFirstNonEmptyOption(page, '#aiInspectionTargetAssetId');
    const selectedTargetAssetVersion = await page.evaluate(assetId => state.assets.find(item => item.id === assetId)?.version || '', selectedTargetAsset.value);
    await page.fill('#aiInspectionTargetForm input[name="name"]', targetName);
    await page.selectOption('#aiInspectionTargetCategory', 'server');
    await page.fill('#aiInspectionTargetForm input[name="address"]', '10.20.30.40');
    await page.selectOption('#aiInspectionTargetProtocol', 'ssh');
    await page.selectOption('#aiInspectionTargetAuthType', 'password');
    await page.fill('#aiInspectionTargetAccount', 'root');
    await page.fill('#aiInspectionTargetPassword', 'E2E-Password-123');
    await page.waitForFunction(expectedVersion => document.querySelector('#aiInspectionTargetSystemVersion')?.value === expectedVersion, selectedTargetAssetVersion);
    await page.click('#aiInspectionTargetForm button[type="submit"]');
    await waitForTableRow(page, '#aiInspectionTargetTable', targetName);
    await page.waitForTimeout(2000);

    // === AI Inspection: Create & Execute Task ===
    logStep('AI 巡检任务创建与执行');
    await page.click('section[data-tab="aiInspection"] button[data-subtab="tasks"]');
    await page.waitForSelector('.subtab-panel[data-section="aiInspection"][data-subtab="tasks"]:not(.hidden)', { state: 'visible', timeout: 15000 });
    await page.waitForSelector('#aiInspectionTaskForm', { state: 'visible', timeout: 15000 });
    await page.locator('#aiInspectionTaskTargetId').scrollIntoViewIfNeeded();
    await page.waitForFunction(name => {
      const select = document.getElementById('aiInspectionTaskTargetId');
      if (!select || select.offsetParent === null) return false;
      return Array.from(select.options).some(option => (option.textContent || '').includes(name));
    }, targetName, { timeout: 15000 });
    await pickOptionByText(page, '#aiInspectionTaskTargetId', targetName);
    await pickFirstNonEmptyOption(page, '#aiInspectionTaskTemplateId');
    await page.fill('#aiInspectionTaskForm input[name="title"]', taskTitle);
    await pickFirstNonEmptyOption(page, '#aiInspectionTaskExecutorId');
    await page.fill('#aiInspectionTaskForm input[name="executedAt"]', formatDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
    const metricInputs = page.locator('#aiInspectionTaskMetricTable input[type="number"]');
    const metricCount = await metricInputs.count();
    for (let i = 0; i < metricCount; i++) {
      await metricInputs.nth(i).fill('80');
    }
    const createTaskPromise = page.waitForResponse(response => response.url().includes('/api/ai-inspection/tasks') && response.request().method() === 'POST' && !response.url().includes('/execute'), { timeout: 30000 });
    await page.click('#aiInspectionTaskForm button[type="submit"]');
    const createTaskResponse = await createTaskPromise;
    assert(createTaskResponse.ok(), `AI 巡检任务创建接口失败: ${createTaskResponse.status()}`);
    const createdTask = await createTaskResponse.json();
    const createdTaskRecord = createdTask.task || createdTask;
    const aiTaskId = createdTaskRecord.id || '';
    assert(aiTaskId, '未找到 AI 巡检任务 ID');
    await page.evaluate(task => {
      const list = Array.isArray(state.aiInspectionTasks) ? state.aiInspectionTasks.slice() : [];
      if (task && task.id && !list.some(item => item.id === task.id)) list.unshift(task);
      state.aiInspectionTasks = list;
      if (typeof renderAiInspection === 'function') renderAiInspection();
    }, createdTaskRecord);
    await page.click('section[data-tab="aiInspection"] button[data-subtab="tasks"]');
    await waitForTableRow(page, '#aiInspectionTaskTable', taskTitle);

    const taskRow = page.locator('#aiInspectionTaskTable tr').filter({ hasText: taskTitle }).first();
    await taskRow.getByRole('button', { name: '执行' }).click();
    await page.waitForFunction(() => {
      const message = document.querySelector('#aiInspectionTaskMessage');
      return message && /探测失败|得分/.test(message.textContent || '');
    }, { timeout: 90000 });

    await page.click('section[data-tab="aiInspection"] button[data-subtab="reports"]');
    await waitForBrowserRequest(
      page,
      '/api/ai-inspection/results?pageSize=1000',
      result => Array.isArray(result.data?.data) && result.data.data.some(item => item.taskId === aiTaskId)
    );

    // === Create Project ===
    logStep('项目创建');
    await page.click('button[data-tab="projects"]');
    await page.waitForSelector('section[data-tab="projects"]:not(.hidden)', { state: 'visible', timeout: 10000 });
    await page.click('section[data-tab="projects"] button[data-subtab="form"]');
    await page.waitForSelector('#projectForm', { state: 'visible', timeout: 10000 });
    await page.fill('#projectForm input[name="customerName"]', customerName);
    await page.waitForSelector('#projectForm input[name="name"]', { state: 'visible' });
    await page.fill('#projectForm input[name="name"]', projectName);
    await page.fill('#projectForm input[name="projectStartDate"]', '2026-06-20');
    await page.fill('#projectForm input[name="projectEndDate"]', '2026-12-31');
    await page.selectOption('#projectForm select[name="notifyBefore"]', '提前1个月');
    await page.fill('#projectForm input[name="paymentMethod"]', '月付');
    await page.fill('#projectForm textarea[name="description"]', 'E2E 自动化项目');
    const createProjectPromise = page.waitForResponse(response => response.url().includes('/api/projects') && response.request().method() === 'POST', { timeout: 30000 });
    await page.click('#projectForm button[type="submit"]');
    const createProjectResponse = await createProjectPromise;
    assert(createProjectResponse.ok(), `项目创建接口失败: ${createProjectResponse.status()}`);
    const createdProject = await createProjectResponse.json();
    assert(createdProject && createdProject.id && createdProject.name === projectName, `项目创建返回异常: ${createdProject && createdProject.name}`);
    await page.waitForFunction(() => {
      const el = document.getElementById('projectMessage');
      return el && /成功/.test(el.textContent || '');
    }, null, { timeout: 30000 });
    await page.evaluate(project => {
      const list = Array.isArray(state.projects) ? state.projects.slice() : [];
      if (!list.some(item => item.id === project.id)) list.unshift(project);
      state.projects = list;
      const totalPages = Math.max(1, Math.ceil(state.projects.length / 10));
      state.projectPage = totalPages;
      renderProjects();
      if (typeof fillUserProjectSelect === 'function') fillUserProjectSelect();
    }, createdProject);
    await page.waitForSelector('.subtab-panel[data-section="projects"][data-subtab="list"]:not(.hidden)', { timeout: 120000 });
    await ensureCreatedProjectAndUser(page, createdProject, null);
    await page.click('button[data-tab="users"]');
    await page.waitForSelector('section[data-tab="users"]:not(.hidden)', { state: 'visible', timeout: 10000 });
    await page.click('section[data-tab="users"] button[data-subtab="form"]');
    await page.waitForFunction(name => {
      const select = document.getElementById('userProjectId');
      return select && Array.from(select.options).some(option => (option.textContent || '').includes(name));
    }, projectName, { timeout: 15000 });
    await page.waitForTimeout(2000);

    // === Create User ===
    logStep('客户账号创建');
    await page.waitForSelector('#userForm', { state: 'visible', timeout: 10000 });
    await page.fill('#userForm input[name="username"]', customerUsername);
    await page.fill('#userForm input[name="password"]', customerPassword);
    await page.fill('#userForm input[name="name"]', customerName);
    await page.fill('#userForm input[name="phone"]', '13800138000');
    await page.fill('#userForm input[name="securityQuestion"]', '您最喜欢的颜色是？');
    await page.fill('#userForm input[name="securityAnswer"]', '蓝色');
    await page.selectOption('#userForm select[name="role"]', 'customer');
    await pickOptionByText(page, '#userProjectId', projectName);
    await page.fill('#userForm input[name="startDate"]', '2026-06-20');
    await page.fill('#userForm input[name="endDate"]', '2026-12-31');
    const createUserPromise = page.waitForResponse(response => response.url().includes('/api/users') && response.request().method() === 'POST', { timeout: 30000 });
    await page.click('#userForm button[type="submit"]');
    const createUserResponse = await createUserPromise;
    assert(createUserResponse.ok(), `客户账号创建接口失败: ${createUserResponse.status()}`);
    const createdUser = await createUserResponse.json();
    assert(createdUser && createdUser.id && createdUser.username === customerUsername, `客户账号创建返回异常: ${createdUser && createdUser.username}`);
    await page.waitForFunction(() => {
      const el = document.getElementById('userMessage');
      return el && /成功/.test(el.textContent || '');
    }, null, { timeout: 30000 });
    await page.evaluate(user => {
      const list = Array.isArray(state.users) ? state.users.slice() : [];
      if (!list.some(item => item.id === user.id)) list.unshift(user);
      state.users = list;
      const totalPages = Math.max(1, Math.ceil(state.users.length / 10));
      state.userPage = totalPages;
      renderUsers();
    }, createdUser);
    await page.waitForSelector('.subtab-panel[data-section="users"][data-subtab="list"]:not(.hidden)', { timeout: 120000 });
    const customerUserId = createdUser.id;
    const adminUserId = await page.evaluate(() => window.state.user?.id || (window.state.users || []).find(item => item.username === 'admin')?.id || '');
    assert(customerUserId, '未找到新建客户账号 ID');
    assert(adminUserId, '未找到管理员账号 ID');
    await page.waitForTimeout(2000);

    // === Create Change Record ===
    logStep('变更记录创建');
    await page.click('button[data-tab="assetOps"]');
    await page.waitForSelector('section[data-tab="assetOps"]:not(.hidden)', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.click('section[data-tab="assetOps"] button[data-subtab="change"]');
    await page.waitForSelector('#changeRecordForm', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await ensureCreatedProjectAndUser(page, createdProject, createdUser);
    await pickOptionByText(page, '#changeProjectId', projectName);
    await page.evaluate(id => fillChangeApprovalUsers(id), createdProject.id);
    await page.waitForFunction(({ approverId, customerId }) => {
      const approverSelect = document.getElementById('changeCustomerId');
      const customerSelect = document.getElementById('changeApproverId');
      return approverSelect && customerSelect
        && Array.from(approverSelect.options).some(option => option.value === approverId)
        && Array.from(customerSelect.options).some(option => option.value === customerId);
    }, { approverId: adminUserId, customerId: customerUserId });
    await page.selectOption('#changeCustomerId', adminUserId);
    await page.selectOption('#changeApproverId', customerUserId);
    await page.fill('#changeRecordForm input[name="title"]', changeTitle);
    await page.fill('#changeRecordForm textarea[name="content"]', 'E2E 变更审批流程验证');
    await page.click('#changeRecordForm button[type="submit"]');
    await waitForTableRow(page, '#changeRecordTable', changeTitle);
    await page.waitForTimeout(2000);

    // === Approval Flow: Admin Approve ===
    logStep('管理员审批变更');
    await page.click('button[data-tab="governance"]');
    await waitForTableRow(page, '#approvalTable', changeTitle);
    const adminApprovalRow = page.locator('#approvalTable tr').filter({ hasText: changeTitle }).first();
    await adminApprovalRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const adminApproveBtn = adminApprovalRow.getByRole('button', { name: '通过' });
    await adminApproveBtn.click({ force: true });
    await page.waitForFunction(title => {
      const rows = Array.from(document.querySelectorAll('#approvalTable tr'));
      return rows.some(row => (row.textContent || '').includes(title) && (row.textContent || '').includes('待客户确认'));
    }, changeTitle, { timeout: 120000 });

    // === Approval Flow: Customer Approve ===
    logStep('客户确认变更');
    await logout(page);
    await login(page, customerUsername, customerPassword);
    await page.click('button[data-tab="governance"]');
    await waitForTableRow(page, '#approvalTable', changeTitle);
    const customerApprovalRow = page.locator('#approvalTable tr').filter({ hasText: changeTitle }).first();
    await customerApprovalRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const customerApproveBtn = customerApprovalRow.getByRole('button', { name: '通过' });
    await customerApproveBtn.click({ force: true });
    await page.waitForFunction(title => {
      const rows = Array.from(document.querySelectorAll('#approvalTable tr'));
      return rows.some(row => (row.textContent || '').includes(title) && (row.textContent || '').includes('已通过'));
    }, changeTitle, { timeout: 120000 });

    // === System: Backup & Export ===
    logStep('系统备份与导出');
    await logout(page);
    await login(page, 'admin', 'Admin123!');
    await page.click('button[data-tab="system"]');
    await page.click('section[data-tab="system"] button[data-subtab="upgrade"]');
    await page.click('#systemBackupBtn');
    await page.waitForFunction(() => {
      const message = document.querySelector('#systemBackupMessage');
      return message && /备份创建成功/.test(message.textContent || '');
    });

    page.setDefaultTimeout(180000);
    const exportedText = await captureExportDownload(page, '#systemExportBtn', '/api/system/export', exportPath);
    const exported = JSON.parse(exportedText);
    assert(Array.isArray(exported.projects) && exported.projects.some(item => item.name === projectName), '导出数据未包含新建项目');
    page.setDefaultTimeout(30000);

    // === Document Management: Create & Verify ===
    logStep('资料创建与校验');
    await page.click('button[data-tab="documents"]');
    await page.waitForSelector('section[data-tab="documents"]:not(.hidden)', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1000);

    await ensureCreatedProjectAndUser(page, createdProject, createdUser);
    await pickOptionByText(page, '#documentProjectId', projectName);
    await page.selectOption('#documentForm select[name="type"]', 'device');
    await page.fill('#documentForm input[name="title"]', docTitle1);
    await page.fill('#documentForm input[name="brand"]', '新华三');
    await page.fill('#documentForm input[name="model"]', 'S12500X-AF');
    await page.fill('#documentForm input[name="serialNumber"]', 'E2E-SN-001');
    await page.fill('#documentForm input[name="managementIp"]', '10.10.10.1');
    await page.fill('#documentForm input[name="loginAccount"]', 'root');
    await page.fill('#documentForm input[name="loginPassword"]', 'E2E-Login-123');
    await page.fill('#documentForm input[name="purchaseDate"]', '2026-03-01');
    await page.fill('#documentForm input[name="warrantyExpiryDate"]', '2029-03-01');
    await page.selectOption('#documentForm select[name="managementMethod"]', 'ssh');
    await page.fill('#documentForm input[name="accessPassword"]', 'E2E-Doc-123');
    await page.click('#documentForm button[type="submit"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('documentMessage');
      return el && /成功/.test(el.textContent || '');
    });
    await page.waitForTimeout(1500);

    await page.click('section[data-tab="documents"] button[data-subtab="form"]');
    await page.waitForTimeout(500);
    await ensureCreatedProjectAndUser(page, createdProject, createdUser);
    await pickOptionByText(page, '#documentProjectId', projectName);
    await page.selectOption('#documentForm select[name="type"]', 'contract');
    await page.fill('#documentForm input[name="title"]', docTitle2);
    await page.fill('#documentForm input[name="accessPassword"]', 'E2E-Doc-456');
    await page.setInputFiles('#documentForm input[name="attachment"]', {
      name: 'e2e-contract.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('E2E测试合同内容')
    });
    await page.click('#documentForm button[type="submit"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('documentMessage');
      return el && /成功/.test(el.textContent || '');
    });
    await page.waitForTimeout(1500);

    await page.click('section[data-tab="documents"] button[data-subtab="list"]');
    await waitForTableRow(page, '#documentTable', docTitle1);
    await waitForTableRow(page, '#documentTable', docTitle2);

    const deviceRow = page.locator('#documentTable tr').filter({ hasText: docTitle1 }).first();
    const deviceViewBtn = deviceRow.getByRole('button', { name: '查看' });
    await deviceViewBtn.click();
    await page.waitForSelector('#documentPasswordModal:not(.hidden)', { state: 'visible', timeout: 15000 });
    await page.fill('#documentPasswordInput', 'E2E-Doc-123');
    await page.click('#documentPasswordConfirmBtn');
    await page.waitForSelector('#documentDetailModal:not(.hidden)', { state: 'visible', timeout: 15000 });
    await page.evaluate(() => closeModal('documentDetailModal'));
    await page.waitForTimeout(1000);

    const contractRow = page.locator('#documentTable tr').filter({ hasText: docTitle2 }).first();
    const contractDownloadBtn = contractRow.getByRole('button', { name: '下载' });
    await contractDownloadBtn.click();
    await page.waitForSelector('#documentPasswordModal:not(.hidden)', { state: 'visible', timeout: 15000 });
    await page.fill('#documentPasswordInput', 'E2E-Doc-456');
    await page.click('#documentPasswordConfirmBtn');
    await page.waitForTimeout(2000);

    await contractRow.getByRole('button', { name: '删除' }).click();
    await page.waitForSelector('#confirmOkBtn', { state: 'visible', timeout: 3000 });
    await page.click('#confirmOkBtn');
    await page.waitForTimeout(1000);
    await deviceRow.getByRole('button', { name: '删除' }).click();
    await page.waitForSelector('#confirmOkBtn', { state: 'visible', timeout: 3000 });
    await page.click('#confirmOkBtn');
    await page.waitForTimeout(1000);

    await cleanupData(page, { targetName, taskTitle, projectName, customerUsername, changeTitle, docTitles: [docTitle1, docTitle2] });
    process.stdout.write('E2E passed\n');
  } finally {
    try {
      await cleanupData(page, { targetName, taskTitle, projectName, customerUsername, changeTitle, docTitles: [docTitle1, docTitle2] });
    } catch (error) {
    }
    try {
      await context.close();
    } catch (error) {
    }
    try {
      await browser.close();
    } catch (error) {
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
