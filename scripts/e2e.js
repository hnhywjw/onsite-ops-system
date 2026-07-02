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
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const downloadDir = '/tmp/opencode/e2e-downloads';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
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

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('#loginForm input[name="username"]', username);
  await page.fill('#loginForm input[name="password"]', password);
  await page.click('#loginForm button[type="submit"]');
  try {
    await page.waitForSelector('#appView:not(.hidden)', { timeout: 30000 });
  } catch(e) {
    const msg = await page.textContent('#loginMessage').catch(() => '');
    throw new Error('Login failed: ' + msg);
  }
}

async function waitForTableRow(page, selector, keyword) {
  await page.waitForFunction(({ targetSelector, text }) => {
    const rows = Array.from(document.querySelectorAll(`${targetSelector} tr`));
    return rows.some(row => (row.textContent || '').includes(text));
  }, { targetSelector: selector, text: keyword });
}

async function logout(page) {
  await page.evaluate(() => {
    return fetch('/api/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': state.sessionToken || '' },
      body: '{}'
    });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
}

async function cleanupData(page, payload) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(async data => {
    const request = async (resource, options = {}) => {
      const response = await fetch(resource, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': state.sessionToken || '', ...(options.headers || {}) },
        ...options
      });
      const text = await response.text();
      let parsed = [];
      try { parsed = text ? JSON.parse(text) : []; } catch (error) { parsed = []; }
      return { response, data: parsed };
    };
    await request('/api/logout', { method: 'POST', body: '{}' });
    const loginResp = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    state.sessionToken = loginResp.data && loginResp.data.token ? loginResp.data.token : '';
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
  }, payload);
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
  const exportPath = path.join(downloadDir, `onsite-ops-export-${suffix}.json`);

  try {
    // === Login ===
    await login(page, 'admin', 'admin123');
    await page.evaluate(() => { window.__DISABLE_WS_REFRESH = true; });
    await page.waitForFunction(() => {
      return typeof state !== 'undefined' && state.projects && Array.isArray(state.projects) && state.projects.length > 0;
    }, { timeout: 30000 });
    await page.waitForTimeout(1000);

    // === AI Inspection: Create Target ===
    await page.click('button[data-tab="aiInspection"]');
    await page.waitForSelector('section[data-tab="aiInspection"] .title', { state: 'visible' });
    await pickFirstNonEmptyOption(page, '#aiInspectionTargetProjectId');
    await pickFirstNonEmptyOption(page, '#aiInspectionTargetAssetId');
    await page.fill('#aiInspectionTargetForm input[name="name"]', targetName);
    await page.selectOption('#aiInspectionTargetCategory', 'server');
    await page.fill('#aiInspectionTargetForm input[name="address"]', '10.20.30.40');
    await page.selectOption('#aiInspectionTargetProtocol', 'ssh');
    await page.selectOption('#aiInspectionTargetAuthType', 'password');
    await page.fill('#aiInspectionTargetAccount', 'root');
    await page.fill('#aiInspectionTargetPassword', 'E2E-Password-123');
    await page.fill('#aiInspectionTargetForm input[name="systemVersion"]', 'Rocky Linux 9');
    await page.click('#aiInspectionTargetForm button[type="submit"]');
    await waitForTableRow(page, '#aiInspectionTargetTable', targetName);
    await page.waitForTimeout(2000);

    // === AI Inspection: Create & Execute Task ===
    await page.click('section[data-tab="aiInspection"] button[data-subtab="tasks"]');
    await page.waitForSelector('#aiInspectionTaskTargetId', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);
    await pickOptionByText(page, '#aiInspectionTaskTargetId', targetName);
    await pickFirstNonEmptyOption(page, '#aiInspectionTaskTemplateId');
    await page.fill('#aiInspectionTaskForm input[name="title"]', taskTitle);
    await page.fill('#aiInspectionTaskForm input[name="executor"]', 'admin');
    await page.fill('#aiInspectionTaskForm input[name="executedAt"]', formatDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
    const metricInputs = page.locator('#aiInspectionTaskMetricTable input[type="number"]');
    const metricCount = await metricInputs.count();
    for (let i = 0; i < metricCount; i++) {
      await metricInputs.nth(i).fill('80');
    }
    await page.click('#aiInspectionTaskForm button[type="submit"]');
    await waitForTableRow(page, '#aiInspectionTaskTable', taskTitle);

    const taskRow = page.locator('#aiInspectionTaskTable tr').filter({ hasText: taskTitle }).first();
    await taskRow.getByRole('button', { name: '执行' }).click();
    await page.waitForFunction(() => {
      const message = document.querySelector('#aiInspectionTaskMessage');
      return message && /得分/.test(message.textContent || '');
    }, { timeout: 90000 });

    await page.click('section[data-tab="aiInspection"] button[data-subtab="reports"]');
    await page.waitForFunction(title => {
      const rows = Array.from(document.querySelectorAll('#aiInspectionReportTable tr'));
      return rows.some(row => (row.textContent || '').includes(title) && (row.textContent || '').includes('查看HTML'));
    }, taskTitle);

    // === Create Project ===
    await page.evaluate(() => { switchTab('projects'); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const formPanel = document.querySelector('.subtab-panel[data-section="projects"][data-subtab="form"]');
      if (formPanel) formPanel.classList.remove('hidden');
      const tabPanel = document.querySelector('.tab-panel[data-tab="projects"]');
      if (tabPanel) tabPanel.classList.remove('hidden');
    });
    await page.waitForSelector('#projectForm', { state: 'visible', timeout: 10000 });
    await page.fill('#projectForm input[name="customerName"]', customerName);
    await page.waitForSelector('#projectForm input[name="name"]', { state: 'visible' });
    await page.fill('#projectForm input[name="name"]', projectName);
    await page.fill('#projectForm input[name="projectStartDate"]', '2026-06-20');
    await page.fill('#projectForm input[name="projectEndDate"]', '2026-12-31');
    await page.selectOption('#projectForm select[name="notifyBefore"]', '提前1个月');
    await page.fill('#projectForm input[name="paymentMethod"]', '月付');
    await page.fill('#projectForm textarea[name="description"]', 'E2E 自动化项目');
    await page.click('#projectForm button[type="submit"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('projectMessage');
      return el && /保存成功/.test(el.textContent || '');
    }, { timeout: 30000 });
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      const totalPages = Math.max(1, Math.ceil(state.projects.length / 10));
      state.projectPage = totalPages;
      renderProjects();
    });
    await waitForTableRow(page, '#projectTable', projectName);
    await page.waitForTimeout(2000);

    // === Create User ===
    await page.evaluate(() => { switchTab('users'); });
    await page.waitForTimeout(2000);
    await page.waitForSelector('#userForm', { state: 'visible', timeout: 10000 });
    await page.fill('#userForm input[name="username"]', customerUsername);
    await page.fill('#userForm input[name="password"]', customerPassword);
    await page.fill('#userForm input[name="name"]', customerName);
    await page.selectOption('#userForm select[name="role"]', 'customer');
    await pickOptionByText(page, '#userProjectId', projectName);
    await page.click('#userForm button[type="submit"]');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      const totalPages = Math.max(1, Math.ceil(state.users.length / 10));
      state.userPage = totalPages;
      renderUsers();
    });
    await waitForTableRow(page, '#userTable', customerUsername);
    await page.waitForTimeout(2000);

    // === Create Change Record ===
    await page.click('button[data-tab="assetOps"]');
    await page.waitForSelector('section[data-tab="assetOps"]:not(.hidden)', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.click('section[data-tab="assetOps"] button[data-subtab="change"]');
    await page.waitForSelector('#changeRecordForm', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await pickOptionByText(page, '#changeProjectId', projectName);
    await pickOptionByText(page, '#changeApproverId', '系统管理员');
    await pickOptionByText(page, '#changeCustomerId', customerName);
    await page.fill('#changeRecordForm input[name="title"]', changeTitle);
    await page.fill('#changeRecordForm textarea[name="content"]', 'E2E 变更审批流程验证');
    await page.click('#changeRecordForm button[type="submit"]');
    await waitForTableRow(page, '#changeRecordTable', changeTitle);
    await page.waitForTimeout(2000);

    // === Approval Flow: Admin Approve ===
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
    }, changeTitle);

    // === Approval Flow: Customer Approve ===
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
    }, changeTitle);

    // === System: Backup & Export ===
    await logout(page);
    await login(page, 'admin', 'admin123');
    await page.click('button[data-tab="system"]');
    await page.click('section[data-tab="system"] button[data-subtab="upgrade"]');
    await page.click('#systemBackupBtn');
    await page.waitForFunction(() => {
      const message = document.querySelector('#systemBackupMessage');
      return message && /备份创建成功/.test(message.textContent || '');
    });

    const downloadPromise = page.waitForEvent('download');
    await page.click('#systemExportBtn');
    const download = await downloadPromise;
    await download.saveAs(exportPath);
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert(Array.isArray(exported.projects) && exported.projects.some(item => item.name === projectName), '导出数据未包含新建项目');

    await cleanupData(page, { targetName, taskTitle, projectName, customerUsername, changeTitle });
    process.stdout.write('E2E passed\n');
  } finally {
    try {
      await cleanupData(page, { targetName, taskTitle, projectName, customerUsername, changeTitle });
    } catch (error) {
    }
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
