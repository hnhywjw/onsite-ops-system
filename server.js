const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const tls = require('tls');
const { URL } = require('url');
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const dns = require('dns').promises;
const mysql = require('mysql2/promise');
const { WebSocketServer } = require('ws');
const packageInfo = require('./package.json');
const { CAPTCHA_GLYPHS } = require('./scripts/captcha-glyphs');

const root = __dirname;
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const dbPath = path.join(dataDir, 'db.json');
const backupDir = path.join(dataDir, 'backups');
const archiveDir = path.join(dataDir, 'archive');
const auditArchiveDir = path.join(archiveDir, 'audit');
const backupArchiveDir = path.join(archiveDir, 'backups');
const notificationArchiveDir = path.join(archiveDir, 'notifications');
const monitorHistoryDir = path.join(dataDir, 'monitor-history');
const httpsCertDir = path.join(dataDir, 'https');
const httpsCertPath = path.join(httpsCertDir, 'login-cert.pem');
const httpsKeyPath = path.join(httpsCertDir, 'login-key.pem');
const pptxTemplatePath = path.join(root, 'pptx-template.json');
const uploadsDir = path.join(dataDir, 'uploads');
const documentsUploadDir = path.join(uploadsDir, 'documents');
const sessionMaxAgeSeconds = parseInt(process.env.SESSION_MAX_AGE_SECONDS, 10) || 7 * 24 * 60 * 60;
const defaultWebIdleLogoutMinutes = parseInt(process.env.WEB_IDLE_LOGOUT_MINUTES, 10) || 30;
const defaultHttpsPort = Number(process.env.HTTPS_PORT || 3443);
const sessionActivityPersistIntervalMs = parseInt(process.env.SESSION_ACTIVITY_PERSIST_INTERVAL_MS, 10) || 30 * 1000;
let lastSessionActivityPersistMs = 0;
let sessionActivityPersistQueue = Promise.resolve();
const maintenanceIntervalMs = parseInt(process.env.MAINTENANCE_INTERVAL_MS, 10) || 60 * 1000;
let systemTimezoneOffsetMinutes = 480;
const defaultDailyReportReminderHour = 12;
const defaultWeeklyReportReminderDays = 7;
const defaultMonthlyReportReminderDays = 15;
const defaultDailyLowHoursThreshold = 1;
const defaultDailyHighHoursThreshold = 12;
const defaultNoLogStreakDays = 3;
const defaultProjectInactiveDays = 7;
const defaultMonitorSampleIntervalMinutes = 5;
const defaultMonitorHistoryRetentionDays = 30;
const defaultMonitorConsecutiveFailures = 3;
const defaultMonitorCpuThreshold = 90;
const defaultMonitorMemoryThreshold = 90;
const defaultMonitorDiskThreshold = 90;
const auditArchiveRetentionDays = parseInt(process.env.AUDIT_ARCHIVE_RETENTION_DAYS, 10) || 180;
const notificationArchiveRetentionDays = parseInt(process.env.NOTIFICATION_ARCHIVE_RETENTION_DAYS, 10) || 180;
const localBackupRetentionDays = parseInt(process.env.LOCAL_BACKUP_RETENTION_DAYS, 10) || 180;
const generalNotificationRetentionDays = parseInt(process.env.GENERAL_NOTIFICATION_RETENTION_DAYS, 10) || 30;
const importantNotificationRetentionDays = parseInt(process.env.IMPORTANT_NOTIFICATION_RETENTION_DAYS, 10) || 90;
const dbConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'onsite_ops',
  password: process.env.MYSQL_PASSWORD || 'onsite_ops_password',
  database: process.env.MYSQL_DATABASE || 'onsite_ops_system'
};
const dbCollectionKeys = ['users', 'projects', 'contracts', 'contractSettlements', 'assets', 'assetRelations', 'assetLifecycles', 'assetCheckouts', 'assetInventoryTasks', 'topologyLayouts', 'logs', 'inspectionPlans', 'inspectionExecutions', 'spareParts', 'sparePartMovements', 'sparePartVendors', 'sparePartPurchases', 'sparePartInventoryTasks', 'changeRecords', 'incidentRecords', 'tickets', 'dutyShifts', 'approvals', 'notifications', 'notificationChannels', 'monitorAlerts', 'monitorMaintenanceWindows', 'auditLogs', 'upgradeLogs', 'knowledgeBase', 'kbRevisions', 'documents', 'workReports', 'aiInspectionTargets', 'aiInspectionTemplates', 'aiInspectionTasks', 'aiInspectionResults', 'configBackupPlans', 'configBackupRecords', 'sessions', 'systemConfig', 'runtimeState'];
const objectCollectionKeys = ['topologyLayouts', 'systemConfig', 'runtimeState'];
const OBJECT_ROOT_ID = '__root__';

function collectionTableName(key) {
  return `col_${key.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`)}`;
}

function isObjectCollection(key) {
  return objectCollectionKeys.includes(key);
}

function cloneDbSnapshot(db) {
  const snap = {};
  for (const key of dbCollectionKeys) {
    const value = db[key];
    if (Array.isArray(value)) {
      snap[key] = (key === 'aiInspectionResults' || key === 'notifications')
        ? value.slice()
        : value.map(item => (item && typeof item === 'object' ? { ...item } : item));
    } else if (value && typeof value === 'object') {
      snap[key] = { ...value };
    } else {
      snap[key] = value;
    }
  }
  return snap;
}

function pickDbCollections(db) {
  const snap = {};
  for (const key of dbCollectionKeys) snap[key] = db[key];
  return snap;
}

function rememberLiveDb(db) {
  latestFileDbCache = pickDbCollections(db);
}

function arrayHasDirtyItems(items) {
  if (!Array.isArray(items)) return false;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] && items[i]._dirty) return true;
  }
  return false;
}

function clearCollectionDirtyFlags(value) {
  if (!Array.isArray(value)) return;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] && value[i]._dirty) delete value[i]._dirty;
  }
}

function collectionChanged(previous, next, key) {
  const prev = previous ? previous[key] : undefined;
  const curr = next ? next[key] : undefined;
  if (prev === curr) return arrayHasDirtyItems(curr);
  if (isObjectCollection(key)) {
    return JSON.stringify(prev ?? null) !== JSON.stringify(curr ?? null);
  }
  if (!Array.isArray(prev) || !Array.isArray(curr)) return true;
  if (prev.length !== curr.length) return true;
  if (curr.length > 500) {
    for (let i = 0; i < curr.length; i += 1) {
      if (prev[i] !== curr[i]) return true;
      if (curr[i] && curr[i]._dirty) return true;
    }
    return false;
  }
  // notifications/aiInspectionResults 在 cloneDbSnapshot 中只做数组浅拷贝，元素对象与缓存共享引用，
  // 原地修改（如标记已读）后两侧 JSON 完全相同，无法靠字符串比较发现，需依赖元素上的 _dirty 标记。
  if (arrayHasDirtyItems(curr)) return true;
  return JSON.stringify(prev) !== JSON.stringify(curr);
}

function parseJsonPayload(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function changedCollectionKeys(previous, next) {
  if (!previous) return dbCollectionKeys.slice();
  return dbCollectionKeys.filter(key => collectionChanged(previous, next, key));
}
const importCollectionLimit = parseInt(process.env.IMPORT_COLLECTION_LIMIT, 10) || 50000;
const importUserLimit = parseInt(process.env.IMPORT_USER_LIMIT, 10) || 10000;
const importBodyLimitBytes = parseInt(process.env.IMPORT_BODY_LIMIT_BYTES, 10) || 50 * 1024 * 1024;
// 附件上传在内存中解析 multipart，故通过上限约束单请求内存占用（默认 10MB，可用环境变量调整）。
const documentAttachmentLimitBytes = parseInt(process.env.DOCUMENT_ATTACHMENT_LIMIT_BYTES, 10) || 10 * 1024 * 1024;
const documentAttachmentLimitMb = Math.round(documentAttachmentLimitBytes / (1024 * 1024));
// 附件配额按「个人 + 项目」双维度累计，避免单个账号或单个项目占满磁盘。
const documentQuotaPerUserBytes = parseInt(process.env.DOCUMENT_QUOTA_PER_USER_BYTES, 10) || 200 * 1024 * 1024;
const documentQuotaPerProjectBytes = parseInt(process.env.DOCUMENT_QUOTA_PER_PROJECT_BYTES, 10) || 2 * 1024 * 1024 * 1024;
// 巡检附件以 base64 内联在数据库中，同样需要限制个人与项目累计体积。
const inspectionAttachmentQuotaPerUserBytes = parseInt(process.env.INSPECTION_ATTACHMENT_QUOTA_PER_USER_BYTES, 10) || 100 * 1024 * 1024;
const inspectionAttachmentQuotaPerProjectBytes = parseInt(process.env.INSPECTION_ATTACHMENT_QUOTA_PER_PROJECT_BYTES, 10) || 1024 * 1024 * 1024;
// 巡检执行附件以 base64 dataURL 内联在 JSON 中，体积约为原文件的 4/3，请求体上限需留足余量。
const inspectionAttachmentBodyLimitBytes = 20 * 1024 * 1024;
// 运维日志现场取证附件同样内联存储，客户端已压缩，限制单请求与累计配额避免撑大数据库。
const logAttachmentQuotaPerUserBytes = parseInt(process.env.LOG_ATTACHMENT_QUOTA_PER_USER_BYTES, 10) || 100 * 1024 * 1024;
const logAttachmentQuotaPerProjectBytes = parseInt(process.env.LOG_ATTACHMENT_QUOTA_PER_PROJECT_BYTES, 10) || 1024 * 1024 * 1024;
const logAttachmentBodyLimitBytes = 20 * 1024 * 1024;
// 单条日志最多 6 张现场取证图，单张压缩后不超过 3MB，避免异常客户端写入超大 base64。
const logAttachmentMaxCount = 6;
const logAttachmentMaxBytes = 3 * 1024 * 1024;
const allowFileDbFallback = process.env.ALLOW_FILE_DB_FALLBACK === 'true';
const loginRateLimitWindowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000;
const loginRateLimitLockMs = parseInt(process.env.LOGIN_RATE_LIMIT_LOCK_MS, 10) || 15 * 60 * 1000;
const loginRateLimitMaxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 10) || 5;
const webSocketHeartbeatIntervalMs = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS, 10) || 30000;
const isProduction = process.env.NODE_ENV === 'production';
// 仅用于验证写失败回滚：非生产环境下，若 FORCE_DB_WRITE_FAILURE_FILE 指向的文件存在，则落库尝试抛错。
// 用文件而非计数，便于精确控制：创建文件即注入失败，移走文件即恢复，不受后台定时写库干扰。
const forcedDbWriteFailureFile = isProduction ? '' : String(process.env.FORCE_DB_WRITE_FAILURE_FILE || '').trim();
function shouldInjectDbWriteFailure() {
  if (!forcedDbWriteFailureFile) return false;
  try {
    return fs.existsSync(forcedDbWriteFailureFile);
  } catch (_) {
    return false;
  }
}
const allowedUserRoles = ['admin', 'engineer', 'viewer', 'auditor', 'customer'];
const incidentStatusOptions = ['处理中', '已恢复', '已关闭'];
const incidentSlaStatusOptions = ['正常', '预警', '超时'];
const incidentSeverityOptions = ['低', '中', '高'];
const ticketStatusOptions = ['待接单', '处理中', '待客户确认', '已完成', '已关闭'];
const ticketPriorityOptions = ['低', '中', '高', '紧急'];
const ticketCategoryOptions = ['故障', '巡检异常', '变更', '服务请求', '其他'];
const ticketSlaHoursByPriority = { 紧急: 2, 高: 4, 中: 8, 低: 24 };
// 达到 SLA 时限的 75% 先预警，超时后再升级为超时提醒，避免临期才发现。
const ticketSlaWarningRatio = 0.75;
const dutyShiftStatusOptions = ['待开始', '值班中', '已交接'];
const notificationLevelOptions = ['info', 'warning', 'error'];
// 外发通道按事件组订阅，站内通知的细分分类统一归并到组，避免新增分类后漏配。
const notificationEventOptions = [
  { value: 'monitor-alert', label: '监控告警' },
  { value: 'ticket', label: '工单流转' },
  { value: 'incident', label: '故障与 SLA' },
  { value: 'approval', label: '变更审批' },
  { value: 'inspection', label: '巡检与复查' },
  { value: 'inventory', label: '备件库存' },
  { value: 'project-expiry', label: '项目到期' },
  { value: 'maintenance-expiry', label: '维保到期' },
  { value: 'work-report', label: '工作汇报提醒' },
  { value: 'duty-handover', label: '值班交接' },
  { value: 'config-backup', label: '配置备份' },
  { value: 'manual', label: '手动通知' }
];
const notificationEventGroups = {
  'ticket': 'ticket',
  'ticket-created': 'ticket',
  'ticket-transfer': 'ticket',
  'ticket-resolve': 'ticket',
  'incident': 'incident',
  'approval': 'approval',
  'change': 'approval',
  'ai-inspection': 'inspection',
  'inspection': 'inspection',
  'inspection-overdue': 'inspection',
  'inspection-recheck': 'inspection',
  'inventory': 'inventory',
  'project-expiry': 'project-expiry',
  'maintenance-expiry': 'maintenance-expiry',
  'work-report': 'work-report',
  'work-report-daily-missing': 'work-report',
  'work-report-weekly-deadline': 'work-report',
  'work-report-monthly-deadline': 'work-report',
  'work-log-hours-low': 'work-report',
  'work-log-hours-high': 'work-report',
  'work-log-streak-missing': 'work-report',
  'project-report-inactive': 'work-report',
  'duty-handover': 'duty-handover',
  'config-backup': 'config-backup',
  'monitor-alert': 'monitor-alert',
  'manual': 'manual'
};
const MONITOR_ALERT_METRICS = ['availability', 'cpu', 'memory', 'disk'];
const upgradeSigningKeyEnv = String(process.env.UPGRADE_SIGNING_KEY || '').trim();
const allowedBackupCommands = (process.env.CONFIG_BACKUP_ALLOWED_COMMANDS || 'show running-config,show startup-config,display current-configuration,cat /etc/os-release')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);
// 反向代理不在本机时，需显式声明其出口地址/CIDR，才会信任 X-Forwarded-* 与 X-Real-IP。
const trustedProxyEntries = String(process.env.TRUSTED_PROXY_IPS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);
let mysqlPool = null;
let mysqlReadyPromise = null;
let mysqlUnavailableUntil = 0;
let mysqlAppStateMigrated = false;
let mysqlReadyFailures = 0;
let shuttingDown = false;
let upgradeApplyScheduled = false;
let httpsServer = null;
let httpsServerMutex = Promise.resolve();
let httpsServerStatus = {
  status: 'stopped',
  detail: 'HTTPS 登录未启用',
  port: defaultHttpsPort,
  checkedAt: now()
};

let httpsLazyInitDone = false;

async function tryLazyInitHttps(db) {
  if (httpsLazyInitDone) return;
  const enabled = !!(db && db.systemConfig && db.systemConfig.httpsLoginEnabled);
  if (!enabled) { httpsLazyInitDone = true; return; }
  if (httpsServer) { httpsLazyInitDone = true; return; }
  httpsLazyInitDone = true;
  try {
    await applyHttpsServerConfig(db.systemConfig);
  } catch (error) {
    console.error('Lazy HTTPS init failed:', error.message);
  }
}

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync(archiveDir, { recursive: true });
fs.mkdirSync(auditArchiveDir, { recursive: true });
fs.mkdirSync(backupArchiveDir, { recursive: true });
fs.mkdirSync(notificationArchiveDir, { recursive: true });
fs.mkdirSync(monitorHistoryDir, { recursive: true });
fs.mkdirSync(httpsCertDir, { recursive: true });
fs.mkdirSync(documentsUploadDir, { recursive: true });

// 升级目录必须由应用自己创建：全新部署只挂了 data 目录，缺少 upgrades 会让页面升级入口直接不可用。
const upgradesDirPath = path.join(dataDir, 'upgrades');
fs.mkdirSync(upgradesDirPath, { recursive: true });
// 解压或写包过程中进程被重启会留下暂存目录与临时包，超过一小时即可安全清理。
try {
  const staleCutoff = Date.now() - 60 * 60 * 1000;
  for (const entry of fs.readdirSync(upgradesDirPath)) {
    if (!/^(pending-|temp-upgrade-)/.test(entry)) continue;
    const abs = path.join(upgradesDirPath, entry);
    try {
      if (fs.statSync(abs).mtimeMs < staleCutoff) fs.rmSync(abs, { recursive: true, force: true });
    } catch (_) {}
  }
} catch (_) {}

function resolveRuntimeUpgradeSigningKey() {
  if (upgradeSigningKeyEnv.length >= 32) return upgradeSigningKeyEnv;
  if (isProduction) return upgradeSigningKeyEnv;
  const keyPath = path.join(dataDir, 'upgrade-signing.key');
  try {
    if (fs.existsSync(keyPath)) {
      const stored = String(fs.readFileSync(keyPath, 'utf8') || '').trim();
      if (stored.length >= 32) return stored;
    }
  } catch (error) {
    console.warn('读取 upgrade-signing.key 失败:', error.message);
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(keyPath, generated, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.warn('写入 upgrade-signing.key 失败:', error.message);
  }
  return generated;
}

const upgradeSigningKey = resolveRuntimeUpgradeSigningKey();
if (!upgradeSigningKeyEnv && !isProduction) {
  console.warn('WARNING: UPGRADE_SIGNING_KEY 环境变量未设置，已使用 data/upgrade-signing.key。生产环境请显式设置 UPGRADE_SIGNING_KEY。');
}

function validateProductionConfiguration() {
  if (!isProduction) return;
  const problems = [];
  if (!process.env.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD === 'onsite_ops_password') problems.push('MYSQL_PASSWORD 必须设置为生产强密码');
  if (!process.env.INITIAL_ADMIN_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD === 'Admin123!') problems.push('INITIAL_ADMIN_PASSWORD 必须设置为生产强密码');
  if (!process.env.INITIAL_ENGINEER_PASSWORD || process.env.INITIAL_ENGINEER_PASSWORD === 'Engineer123!') problems.push('INITIAL_ENGINEER_PASSWORD 必须设置为生产强密码');
  if (!process.env.INITIAL_ADMIN_SECURITY_ANSWER || process.env.INITIAL_ADMIN_SECURITY_ANSWER === 'admin') problems.push('INITIAL_ADMIN_SECURITY_ANSWER 必须设置为生产安全答案');
  if (!process.env.INITIAL_ENGINEER_SECURITY_ANSWER || process.env.INITIAL_ENGINEER_SECURITY_ANSWER === 'blue') problems.push('INITIAL_ENGINEER_SECURITY_ANSWER 必须设置为生产安全答案');
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) problems.push('ENCRYPTION_KEY 必须设置且长度不少于 32 位');
  if (!process.env.DOCUMENT_TOKEN_SECRET || process.env.DOCUMENT_TOKEN_SECRET.length < 32) problems.push('DOCUMENT_TOKEN_SECRET 必须设置且长度不少于 32 位');
  if (!upgradeSigningKeyEnv || upgradeSigningKeyEnv.length < 32) problems.push('UPGRADE_SIGNING_KEY 必须设置且长度不少于 32 位');
  if (problems.length) {
    throw new Error(`生产配置不安全：${problems.join('；')}`);
  }
}

validateProductionConfiguration();

function now() {
  return getSystemNow();
}

function nowMs() {
  return Date.now();
}

function getSystemTimezoneOffsetMs() {
  return systemTimezoneOffsetMinutes * 60000;
}

function getSystemNow() {
  const offsetMs = getSystemTimezoneOffsetMs();
  const adjusted = new Date(Date.now() + offsetMs);
  const sign = offsetMs >= 0 ? '+' : '-';
  const absMin = Math.abs(systemTimezoneOffsetMinutes);
  const h = String(Math.floor(absMin / 60)).padStart(2, '0');
  const m = String(absMin % 60).padStart(2, '0');
  return adjusted.toISOString().replace('Z', `${sign}${h}:${m}`);
}

function getSystemNowMs() {
  return Date.now();
}

function hash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(value), salt, 64);
  return `$scrypt$${salt}$${derived.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !password) return false;
  if (storedHash.startsWith('$scrypt$')) {
    const parts = storedHash.split('$');
    const salt = parts[2];
    const expected = parts[3];
    if (!salt || !expected) return false;
    const derived = crypto.scryptSync(String(password), salt, 64);
    const derivedHex = derived.toString('hex');
    if (derivedHex.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(derivedHex), Buffer.from(expected));
  }
  const legacyHash = crypto.createHash('sha256').update(String(password)).digest('hex');
  if (legacyHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(storedHash));
}

// 用于账号不存在时执行等价的哈希校验，避免通过响应耗时枚举有效用户名。
const LOGIN_DUMMY_PASSWORD_HASH = hash('monkeycode-login-timing-guard');

function encryptLoginPassword(plaintext, accessPassword) {
  if (!plaintext || !accessPassword) return '';
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(accessPassword, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `$aes256gcm$${salt.toString('hex')}$${iv.toString('hex')}$${authTag.toString('hex')}$${encrypted.toString('hex')}`;
}

function decryptLoginPassword(encrypted, accessPassword) {
  if (!encrypted || !accessPassword) return '';
  if (!encrypted.startsWith('$aes256gcm$')) return '';
  const parts = encrypted.split('$');
  const salt = Buffer.from(parts[2] || '', 'hex');
  const iv = Buffer.from(parts[3] || '', 'hex');
  const authTag = Buffer.from(parts[4] || '', 'hex');
  const ciphertext = Buffer.from(parts[5] || '', 'hex');
  if (!salt.length || !iv.length || !authTag.length || !ciphertext.length) return '';
  const key = crypto.pbkdf2Sync(accessPassword, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function getOidcConfig() {
  return {
    issuer: process.env.OIDC_ISSUER || '',
    clientId: process.env.OIDC_CLIENT_ID || '',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    redirectUri: process.env.OIDC_REDIRECT_URI || ''
  };
}

function getLdapConfig() {
  return {
    ldapUrl: process.env.LDAP_URL || '',
    ldapBaseDn: process.env.LDAP_BASE_DN || '',
    ldapBindDn: process.env.LDAP_BIND_DN || '',
    ldapBindPassword: process.env.LDAP_BIND_PASSWORD || ''
  };
}

function parseJwtPayload(token) {
  if (!token) return {};
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return {};
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_) {
    return {};
  }
}

function parseJwtHeader(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return {};
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (_) {
    return {};
  }
}

let _jwksCache = null;
let _jwksCacheTime = 0;
// 外部请求统一加超时；IdP 不可达或丢包时避免请求长时间挂起、占用连接与内存。
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function fetchJwks(jwksUri) {
  const current = nowMs();
  if (_jwksCache && current - _jwksCacheTime < 3600000) return _jwksCache;
  const res = await fetchWithTimeout(jwksUri);
  if (!res.ok) throw new Error('JWKS unavailable');
  _jwksCache = await res.json();
  _jwksCacheTime = current;
  return _jwksCache;
}

async function verifyOidcIdToken(idToken, oidcConfig, expected = {}) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token');
  const header = parseJwtHeader(idToken);
  const payload = parseJwtPayload(idToken);
  if (!header.kid || !header.alg || !String(header.alg).startsWith('RS')) throw new Error('Unsupported ID token alg');
  const jwks = await fetchJwks(oidcConfig.jwks_uri);
  const jwk = (jwks.keys || []).find(item => item.kid === header.kid);
  if (!jwk) throw new Error('ID token key not found');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const ok = verifier.verify(crypto.createPublicKey({ key: jwk, format: 'jwk' }), parts[2], 'base64url');
  if (!ok) throw new Error('Invalid ID token signature');
  if (payload.iss !== expected.issuer) throw new Error('Invalid ID token issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(expected.clientId)) throw new Error('Invalid ID token audience');
  if (!payload.exp || Number(payload.exp) * 1000 <= nowMs()) throw new Error('ID token expired');
  if (expected.nonce && payload.nonce !== expected.nonce) throw new Error('Invalid ID token nonce');
  return payload;
}

let _oidcConfigCache = null;
let _oidcConfigCacheTime = 0;
async function fetchOidcConfig(issuer) {
  const now = nowMs();
  if (_oidcConfigCache && (now - _oidcConfigCacheTime) < 3600000) return _oidcConfigCache;
  try {
    const url = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    _oidcConfigCache = await res.json();
    _oidcConfigCacheTime = now;
    return _oidcConfigCache;
  } catch (_) {
    return null;
  }
}

async function ldapAuthenticate(ldapUrlStr, baseDn, bindDn, bindPassword, username, password) {
  const net = require('net');
  const tls = require('tls');
  const url = new URL(ldapUrlStr);
  const isTls = url.protocol === 'ldaps:';
  const host = url.hostname;
  const port = Number(url.port) || (isTls ? 636 : 389);
  const userDn = `cn=${escapeLdapDn(username)},${baseDn}`;

  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let messageId = 0;
    const conn = isTls ? tls.connect(port, host, { rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false' }) : net.connect(port, host);

    function sendLdapMessage(id, op) {
      const ber = encodeLdapMessage(id, op);
      conn.write(ber);
    }

    function readLdapMessage() {
      while (buffer.length >= 2) {
        if (buffer[0] !== 0x30) {
          const errIdx = buffer.indexOf(0x30);
          if (errIdx > 0) buffer = buffer.slice(errIdx);
          else { buffer = Buffer.alloc(0); return; }
          if (buffer.length < 2) return;
        }
        const len = buffer[1] < 0x80 ? buffer[1] : parseLongLength(buffer);
        if (len < 0 || buffer.length < 2 + (buffer[1] < 0x80 ? 0 : (buffer[1] & 0x7f)) + len) return;
        const totalLen = 2 + (buffer[1] < 0x80 ? 0 : (buffer[1] & 0x7f)) + len;
        const msg = buffer.slice(0, totalLen);
        buffer = buffer.slice(totalLen);
        try {
          const result = parseLdapResult(msg);
          conn.emit('ldap_result', result);
        } catch (_) {}
      }
    }

    function parseLongLength(buf) {
      const numOctets = buf[1] & 0x7f;
      let len = 0;
      for (let i = 0; i < numOctets; i++) len = (len << 8) | buf[2 + i];
      return len;
    }

    function encodeLdapMessage(id, op) {
      const msgId = encodeInt(id);
      const opBer = encodeLdapOp(op);
      const content = Buffer.concat([msgId, opBer]);
      const len = encodeLength(content.length);
      return Buffer.concat([Buffer.from([0x30]), len, content]);
    }

    function encodeInt(val) {
      const buf = Buffer.alloc(4);
      buf.writeInt32BE(val);
      let start = 0;
      while (start < 3 && buf[start] === 0 && !(buf[start + 1] & 0x80)) start++;
      const trimmed = buf.slice(start);
      return Buffer.concat([Buffer.from([0x02]), encodeLength(trimmed.length), trimmed]);
    }

    function encodeLength(len) {
      if (len < 128) return Buffer.from([len]);
      const temp = Buffer.alloc(4);
      temp.writeUInt32BE(len);
      let start = 0;
      while (start < 3 && temp[start] === 0) start++;
      const bytes = temp.slice(start);
      return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
    }

    function encodeLdapOp(op) {
      const parts = [];
      if (op.type === 'bind') {
        parts.push(Buffer.from([0x60]));
        const ver = Buffer.from([0x02, 0x01, op.version || 3]);
        const name = encodeOctetString(0x04, op.name || '');
        const pwdVal = encodeOctetString(0x80, op.password || '');
        const body = Buffer.concat([ver, name, pwdVal]);
        parts.push(encodeLength(body.length));
        parts.push(body);
      } else if (op.type === 'search') {
        parts.push(Buffer.from([0x63]));
        const baseObj = encodeOctetString(0x04, op.baseObject || '');
        const scope = Buffer.from([0x0a, 0x01, op.scope || 0]);
        const deref = Buffer.from([0x0a, 0x01, 0]);
        const sizeLimit = Buffer.from([0x02, 0x01, 0]);
        const timeLimit = Buffer.from([0x02, 0x01, 0]);
        const typesOnly = Buffer.from([0x01, 0x01, 0x00]);
        let filter;
        if (op.filter) {
          filter = op.filter;
        } else {
          const eqParts = [];
          eqParts.push(encodeOctetString(0x04, op.attribute || 'cn'));
          // RFC 4515：过滤值中的 * ( ) \ NUL 必须转义，否则账号名可篡改搜索条件语义。
          eqParts.push(encodeOctetString(0x04, escapeLdapFilterValue(op.value || '')));
          filter = Buffer.concat([Buffer.from([0xa3]), encodeLength(Buffer.concat(eqParts).length), ...eqParts]);
        }
        const body = Buffer.concat([baseObj, scope, deref, sizeLimit, timeLimit, typesOnly, filter]);
        parts.push(encodeLength(body.length));
        parts.push(body);
      }
      return Buffer.concat(parts);
    }

    function encodeOctetString(tag, str) {
      const buf = Buffer.from(str, 'utf8');
      return Buffer.concat([Buffer.from([tag]), encodeLength(buf.length), buf]);
    }

    function parseLdapResult(msg) {
      let pos = 2;
      if (msg[1] >= 0x80) pos += msg[1] & 0x7f;
      const msgId = readInt(msg, pos); pos = skipTag(msg, pos);
      const opTag = msg[pos]; pos++;
      const opEnd = pos + readLength(msg, pos - 1);
      pos++;
      const resultCode = readInt(msg, pos); pos = skipTag(msg, pos);
      let matchedDn = '';
      if (pos < opEnd && msg[pos] === 0x04) { pos++; const len = readLength(msg, pos - 1); pos++; matchedDn = msg.slice(pos, pos + len).toString('utf8'); pos += len; }
      let diagnosticMsg = '';
      if (pos < opEnd && msg[pos] === 0x04) { pos++; const len = readLength(msg, pos - 1); pos++; diagnosticMsg = msg.slice(pos, pos + len).toString('utf8'); pos += len; }
      const entries = [];
      while (pos < msg.length) {
        const entriesEnd = pos + readLength(msg, pos - 1);
        entries.push(parseLdapEntry(msg.slice(pos - 1, entriesEnd + pos - pos + 1)));
        pos = entriesEnd + 1;
        if (pos >= msg.length) break;
      }
      return { messageId: msgId, resultCode, matchedDn, diagnosticMsg, entries };
    }

    function parseLdapEntry(buf) {
      const attrs = {};
      let pos = 2;
      if (buf[1] >= 0x80) pos += buf[1] & 0x7f;
      if (buf[pos] === 0x04) { pos++; const len = readLength(buf, pos - 1); pos++; const dn = buf.slice(pos, pos + len).toString('utf8'); pos += len; attrs._dn = dn; }
      while (pos < buf.length) {
        if (buf[pos] === 0x30) { pos++; const end = pos + readLength(buf, pos - 1); pos++; let attrName = ''; pos = skipTag(buf, pos);
        if (buf[pos] === 0x04) { pos++; const len = readLength(buf, pos - 1); pos++; attrName = buf.slice(pos, pos + len).toString('utf8'); pos += len; }
        pos++;
        const vals = [];
        if (buf[pos] === 0x04) { pos++; const len = readLength(buf, pos - 1); pos++; vals.push(buf.slice(pos, pos + len).toString('utf8')); pos += len; }
        if (attrName) attrs[attrName] = vals; pos = end; }
        else break;
      }
      return attrs;
    }

    function readInt(buf, pos) {
      const tag = buf[pos]; pos++;
      const len = readLength(buf, pos - 1); pos++;
      let val = 0;
      for (let i = 0; i < len; i++) val = (val << 8) | buf[pos + i];
      return val;
    }

    function readLength(buf, pos) {
      const first = buf[pos];
      if (first < 128) return first;
      const numOctets = first & 0x7f;
      let len = 0;
      for (let i = 0; i < numOctets; i++) len = (len << 8) | buf[pos + 1 + i];
      return len;
    }

    function skipTag(buf, pos) {
      pos++;
      const len = readLength(buf, pos - 1);
      return pos + 1 + len;
    }

    function escapeLdapDn(val) {
      let escaped = String(val)
        .replace(/[,+\"\\<>;=#\u0000]/g, ch => (ch === '\u0000' ? '\\00' : `\\${ch}`));
      // RFC 4514：首尾空格与首个 # 需要转义，否则会被 DN 解析器忽略或误判。
      if (escaped.startsWith(' ')) escaped = `\\ ${escaped.slice(1)}`;
      if (escaped.endsWith(' ')) escaped = `${escaped.slice(0, -1)}\\ `;
      if (escaped.startsWith('#')) escaped = `\\#${escaped.slice(1)}`;
      return escaped;
    }

    function escapeLdapFilterValue(val) {
      return String(val).replace(/[\u0000()*\\]/g, ch => `\\${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
    }

    conn.on('connect', () => {
      messageId = 1;
      sendLdapMessage(messageId, { type: 'bind', version: 3, name: bindDn || userDn, password: bindDn ? bindPassword : password });
    });

    if (!password) {
      conn.end();
      return resolve(null);
    }
    let ldapPhase = 'bind';
    let pendingLdapEntry = null;
    conn.on('ldap_result', (result) => {
      if (ldapPhase === 'bind') {
        if (result.resultCode !== 0) {
          conn.end();
          return resolve(null);
        }
        if (!bindDn) {
          conn.end();
          return resolve({ displayName: username, email: '', phone: '' });
        }
        ldapPhase = 'search';
        messageId = 2;
        sendLdapMessage(messageId, { type: 'search', baseObject: baseDn, scope: 2, attribute: 'cn', value: username });
        return;
      }
      if (ldapPhase === 'search') {
        if (!result.entries || result.entries.length === 0) {
          conn.end();
          return resolve(null);
        }
        pendingLdapEntry = result.entries[0];
        const targetDn = pendingLdapEntry._dn || userDn;
        ldapPhase = 'userbind';
        messageId = 3;
        sendLdapMessage(messageId, { type: 'bind', version: 3, name: targetDn, password });
        return;
      }
      conn.end();
      if (result.resultCode !== 0 || !pendingLdapEntry) return resolve(null);
      const entry = pendingLdapEntry;
      return resolve({
        displayName: (entry.cn && entry.cn[0]) || username,
        email: (entry.mail && entry.mail[0]) || '',
        phone: (entry.telephoneNumber && entry.telephoneNumber[0]) || (entry.mobile && entry.mobile[0]) || ''
      });
    });

    conn.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      readLdapMessage();
    });

    conn.on('error', () => { resolve(null); });
    conn.on('end', () => {});
    setTimeout(() => { conn.end(); resolve(null); }, 10000);
  });
}

const captchaLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const captchaDigits = '23456789';
const captchaCharset = `${captchaLetters}${captchaDigits}`;
const captchaSecret = crypto.randomBytes(32).toString('hex');
const captchaChallenges = new Map();
const CAPTCHA_CHALLENGE_LIMIT = 5000;
// 验证码签发按来源 IP 限流，避免匿名请求无限生成挑战挤出他人验证码。
const captchaRequestWindows = new Map();
const CAPTCHA_REQUEST_LIMIT = 200;
const CAPTCHA_REQUEST_WINDOW_MS = 5 * 60 * 1000;

function checkCaptchaRequestRate(req) {
  const clientIp = getRequestClientIp(req);
  const current = nowMs();
  const entry = captchaRequestWindows.get(clientIp);
  if (!entry || current - entry.windowStart > CAPTCHA_REQUEST_WINDOW_MS) {
    captchaRequestWindows.set(clientIp, { windowStart: current, count: 1 });
    if (captchaRequestWindows.size > 10000) {
      for (const [key, value] of captchaRequestWindows) {
        if (current - value.windowStart > CAPTCHA_REQUEST_WINDOW_MS) captchaRequestWindows.delete(key);
      }
    }
    return { limited: false, retryAfterMs: 0 };
  }
  entry.count += 1;
  if (entry.count > CAPTCHA_REQUEST_LIMIT) {
    return { limited: true, retryAfterMs: CAPTCHA_REQUEST_WINDOW_MS - (current - entry.windowStart) };
  }
  return { limited: false, retryAfterMs: 0 };
}

// 忘记密码流程的短时票据：仅在 verify 校验通过后签发，绑定账号，防止跳过第一步直接调用 reset。
const forgotPasswordTickets = new Map();
const FORGOT_TICKET_TTL_MS = 300000;

function createForgotPasswordTicket(username) {
  const nowMs = Date.now();
  for (const [key, entry] of forgotPasswordTickets) {
    if (!entry || entry.expiresAt <= nowMs) forgotPasswordTickets.delete(key);
  }
  const ticket = crypto.randomBytes(24).toString('hex');
  forgotPasswordTickets.set(ticket, {
    usernameHash: hashCaptchaAnswer(username),
    expiresAt: nowMs + FORGOT_TICKET_TTL_MS,
  });
  return ticket;
}

function consumeForgotPasswordTicket(ticket, username) {
  const key = String(ticket || '').trim();
  const entry = forgotPasswordTickets.get(key);
  if (!entry) return false;
  forgotPasswordTickets.delete(key);
  if (entry.expiresAt <= Date.now()) return false;
  const received = Buffer.from(hashCaptchaAnswer(username));
  const expected = Buffer.from(entry.usernameHash);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function hashCaptchaAnswer(answer) {
  return crypto.createHmac('sha256', captchaSecret).update(String(answer || '').trim().toUpperCase()).digest('hex');
}

function pruneCaptchaChallenges() {
  const nowMs = Date.now();
  for (const [token, entry] of captchaChallenges) {
    if (!entry || entry.expiresAt <= nowMs) captchaChallenges.delete(token);
  }
  // 未过期的挑战在 TTL 窗口内也会累积，容量超限时按插入顺序淘汰最旧条目。
  while (captchaChallenges.size > CAPTCHA_CHALLENGE_LIMIT) {
    const oldest = captchaChallenges.keys().next();
    if (oldest.done) break;
    captchaChallenges.delete(oldest.value);
  }
}

function generateCaptchaCode() {
  const chars = [
    captchaLetters[crypto.randomInt(0, captchaLetters.length)],
    captchaDigits[crypto.randomInt(0, captchaDigits.length)]
  ];
  while (chars.length < 4) {
    chars.push(captchaCharset[crypto.randomInt(0, captchaCharset.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function renderCaptchaGlyph(ch, originX, originY, color, groupIndex, exposeMeta) {
  const pattern = CAPTCHA_GLYPHS[ch];
  if (!pattern) return '';
  const cell = 3.2;
  let out = '';
  for (let row = 0; row < pattern.length; row += 1) {
    for (let col = 0; col < pattern[row].length; col += 1) {
      if (pattern[row][col] !== '1') continue;
      // 生产环境不输出字形序号与点阵坐标，避免客户端直接还原验证码字符。
      const meta = exposeMeta ? ` data-g="${groupIndex}" data-r="${row}" data-c="${col}"` : '';
      out += `<rect class="cg"${meta} x="${(originX + col * cell).toFixed(2)}" y="${(originY + row * cell).toFixed(2)}" width="${(cell - 0.5).toFixed(2)}" height="${(cell - 0.5).toFixed(2)}" fill="${color}"/>`;
    }
  }
  if (!exposeMeta) {
    const angle = ((Math.random() - 0.5) * 30).toFixed(1);
    return `<g transform="rotate(${angle} ${(originX + 8).toFixed(1)} ${(originY + 11).toFixed(1)})">${out}</g>`;
  }
  return out;
}

function renderCaptchaSvg(code, exposeMeta = false) {
  const w = 140, h = 44;
  let paths = '';
  for (let i = 0; i < 6; i++) {
    const x1 = Math.random() * w, y1 = Math.random() * h;
    const x2 = Math.random() * w, y2 = Math.random() * h;
    paths += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="hsl(${200 + Math.random() * 60}, 70%, ${60 + Math.random() * 20}%)" stroke-width="${0.8 + Math.random()}" opacity="0.5"/>`;
  }
  let dots = '';
  for (let i = 0; i < 30; i++) {
    dots += `<circle cx="${Math.random() * w}" cy="${Math.random() * h}" r="${0.5 + Math.random()}" fill="hsl(${220 + Math.random() * 40}, 60%, 60%)" opacity="${0.3 + Math.random() * 0.4}"/>`;
  }
  let letters = '';
  const chars = String(code || '');
  for (let i = 0; i < chars.length; i++) {
    const x = 12 + i * 32 + (Math.random() - 0.5) * 4;
    const y = 10 + (Math.random() - 0.5) * 4;
    const color = `hsl(${210 + Math.random() * 30}, 60%, ${30 + Math.random() * 25}%)`;
    letters += renderCaptchaGlyph(chars[i], x, y, color, i, exposeMeta);
  }
  // 生产环境在字符之上再叠加干扰线，增加分割字形的难度。
  let overlay = '';
  if (!exposeMeta) {
    for (let i = 0; i < 3; i++) {
      overlay += `<line x1="${Math.random() * w}" y1="${Math.random() * h}" x2="${Math.random() * w}" y2="${Math.random() * h}" stroke="hsl(${200 + Math.random() * 60}, 70%, ${55 + Math.random() * 20}%)" stroke-width="1" opacity="0.6"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#f8fafc" rx="4"/><rect width="${w}" height="${h}" fill="none" stroke="#e2e8f0" rx="4"/>${paths}${dots}${letters}${overlay}</svg>`;
}

function createCaptchaToken(code) {
  pruneCaptchaChallenges();
  const token = crypto.randomBytes(24).toString('hex');
  captchaChallenges.set(token, { hash: hashCaptchaAnswer(code), expiresAt: Date.now() + 300000 });
  return token;
}

function verifyCaptchaToken(token, answer) {
  const key = String(token || '').trim();
  const entry = captchaChallenges.get(key);
  if (!entry) return false;
  captchaChallenges.delete(key);
  if (entry.expiresAt <= Date.now()) return false;
  const received = hashCaptchaAnswer(answer);
  return received.length === entry.hash.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(entry.hash));
}

function seed() {
  const projectId = id('project');
  const adminId = id('user');
  const engineerId = id('user');
  return {
    users: [
      {
        id: adminId,
        username: 'admin',
        passwordHash: hash(process.env.INITIAL_ADMIN_PASSWORD || 'Admin123!'),
        role: 'admin',
        name: '系统管理员',
        phone: '13800000000',
        idCard: '440101199001010000',
        email: 'admin@example.com',
        wechat: 'admin-wechat',
        projectId,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        securityQuestion: process.env.INITIAL_ADMIN_SECURITY_QUESTION || '您母亲的名字是？',
        securityAnswerHash: hash(process.env.INITIAL_ADMIN_SECURITY_ANSWER || 'admin'),
        status: 'active',
        createdAt: now()
      },
      {
        id: engineerId,
        username: 'engineer1',
        passwordHash: hash(process.env.INITIAL_ENGINEER_PASSWORD || 'Engineer123!'),
        role: 'engineer',
        name: '驻场工程师',
        phone: '13900000000',
        idCard: '440101199202020000',
        email: 'engineer1@example.com',
        wechat: 'engineer-wechat',
        projectId,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        securityQuestion: process.env.INITIAL_ENGINEER_SECURITY_QUESTION || '您最喜欢的颜色是？',
        securityAnswerHash: hash(process.env.INITIAL_ENGINEER_SECURITY_ANSWER || 'blue'),
        status: 'active',
        createdAt: now()
      }
    ],
    projects: [
      {
        id: projectId,
        name: '示例客户A',
        customerName: '示例客户A',
        projectStartDate: '',
        projectEndDate: '',
        notifyBefore: '',
        paymentMethod: '',
        description: '默认演示项目',
        createdAt: now()
      }
    ],
    assets: [
      {
        id: id('asset'),
        projectId,
        type: '设备',
        name: '防火墙-01',
        brand: '深信服',
        model: 'AF-1000-B1300',
        owner: '网络部',
        version: 'v1.0.0',
        serialNumber: 'FW-2026-001',
        status: '使用中',
        installationLocation: 'A区机房-01号机柜-4U',
        notes: '默认资产',
        createdAt: now()
      }
    ],
    logs: [
      {
        id: id('log'),
        userId: engineerId,
        projectId,
        assetId: '',
        date: '2026-06-15',
        event: '日常巡检',
        relatedTarget: '核心交换机',
        process: '检查接口状态、CPU、内存和告警信息',
        conclusion: '运行正常',
        durationHours: 1,
        createdAt: now()
      }
    ],
    inspectionPlans: [],
    inspectionExecutions: [],
    spareParts: [],
    sparePartMovements: [],
    changeRecords: [],
    incidentRecords: [],
    tickets: [],
    dutyShifts: [],
    approvals: [],
    notifications: [],
    notificationChannels: [],
    monitorAlerts: [],
    monitorMaintenanceWindows: [],
    auditLogs: [],
    upgradeLogs: [],
    workReports: [],
    sessions: [],
    systemConfig: {
      webIdleLogoutMinutes: defaultWebIdleLogoutMinutes,
      dailyReportReminderHour: defaultDailyReportReminderHour,
      weeklyReportReminderDays: defaultWeeklyReportReminderDays,
      monthlyReportReminderDays: defaultMonthlyReportReminderDays,
      dailyLowHoursThreshold: defaultDailyLowHoursThreshold,
      dailyHighHoursThreshold: defaultDailyHighHoursThreshold,
      noLogStreakDays: defaultNoLogStreakDays,
      projectInactiveDays: defaultProjectInactiveDays
    },
    runtimeState: {
      loginRateLimits: [],
      maintenance: {}
    },
    knowledgeBase: [
      {
        id: id('kb'),
        title: '设备巡检告警清理流程',
        keywords: '巡检,告警,设备',
        problem: '设备存在历史告警影响排查效率',
        solution: '确认告警源已恢复后在维护窗口统一清理，并记录日志',
        createdBy: engineerId,
        createdAt: now()
      }
    ],
    aiInspectionTargets: [],
    aiInspectionTemplates: [],
    aiInspectionTasks: [],
    aiInspectionResults: [],
    configBackupPlans: [],
    configBackupRecords: [],
    documents: [],
    assetRelations: [],
    assetLifecycles: [],
    assetCheckouts: [],
    assetInventoryTasks: [],
    topologyLayouts: { positions: {} }
  };
}

function normalizeSystemConfig(rawSystemConfig = {}) {
  const webIdleLogoutMinutes = Number(rawSystemConfig.webIdleLogoutMinutes);
  const httpsPort = Number(rawSystemConfig.httpsPort);
  const httpsLoginEnabled = rawSystemConfig.httpsLoginEnabled === true || rawSystemConfig.httpsLoginEnabled === 'true';
  const timezoneOffset = Number(rawSystemConfig.timezoneOffset);
  const dailyReportReminderHour = Number(rawSystemConfig.dailyReportReminderHour);
  const weeklyReportReminderDays = Number(rawSystemConfig.weeklyReportReminderDays);
  const monthlyReportReminderDays = Number(rawSystemConfig.monthlyReportReminderDays);
  const dailyLowHoursThreshold = Number(rawSystemConfig.dailyLowHoursThreshold);
  const dailyHighHoursThreshold = Number(rawSystemConfig.dailyHighHoursThreshold);
  const noLogStreakDays = Number(rawSystemConfig.noLogStreakDays);
  const projectInactiveDays = Number(rawSystemConfig.projectInactiveDays);
  const monitorSampleIntervalMinutes = Number(rawSystemConfig.monitorSampleIntervalMinutes);
  const monitorHistoryRetentionDays = Number(rawSystemConfig.monitorHistoryRetentionDays);
  const monitorConsecutiveFailures = Number(rawSystemConfig.monitorConsecutiveFailures);
  const monitorCpuThreshold = Number(rawSystemConfig.monitorCpuThreshold);
  const monitorMemoryThreshold = Number(rawSystemConfig.monitorMemoryThreshold);
  const monitorDiskThreshold = Number(rawSystemConfig.monitorDiskThreshold);
  return {
    webIdleLogoutMinutes: Number.isFinite(webIdleLogoutMinutes)
      ? Math.min(1440, Math.max(1, Math.round(webIdleLogoutMinutes)))
      : defaultWebIdleLogoutMinutes,
    httpsLoginEnabled,
    httpsPort: Number.isFinite(httpsPort)
      ? Math.min(65535, Math.max(1, Math.round(httpsPort)))
      : defaultHttpsPort,
    httpsCertFilename: String(rawSystemConfig.httpsCertFilename || '').trim(),
    httpsKeyFilename: String(rawSystemConfig.httpsKeyFilename || '').trim(),
    httpsCertUploadedAt: String(rawSystemConfig.httpsCertUploadedAt || '').trim(),
    httpsKeyUploadedAt: String(rawSystemConfig.httpsKeyUploadedAt || '').trim(),
    httpsCertSubject: String(rawSystemConfig.httpsCertSubject || '').trim(),
    httpsCertIssuer: String(rawSystemConfig.httpsCertIssuer || '').trim(),
    httpsCertValidFrom: String(rawSystemConfig.httpsCertValidFrom || '').trim(),
    httpsCertValidTo: String(rawSystemConfig.httpsCertValidTo || '').trim(),
    httpsCertFingerprint256: String(rawSystemConfig.httpsCertFingerprint256 || '').trim(),
    allowRegistration: rawSystemConfig.allowRegistration === true || rawSystemConfig.allowRegistration === 'true',
    httpLoginDisabled: rawSystemConfig.httpLoginDisabled === true || rawSystemConfig.httpLoginDisabled === 'true',
    loginRateLimitMaxAttempts: Number.isFinite(Number(rawSystemConfig.loginRateLimitMaxAttempts)) && Number(rawSystemConfig.loginRateLimitMaxAttempts) >= 1 ? Number(rawSystemConfig.loginRateLimitMaxAttempts) : loginRateLimitMaxAttempts,
    loginRateLimitWindowMinutes: Number.isFinite(Number(rawSystemConfig.loginRateLimitWindowMinutes)) && Number(rawSystemConfig.loginRateLimitWindowMinutes) >= 1 ? Number(rawSystemConfig.loginRateLimitWindowMinutes) : Math.round(loginRateLimitWindowMs / 60000),
    loginRateLimitLockMinutes: Number.isFinite(Number(rawSystemConfig.loginRateLimitLockMinutes)) && Number(rawSystemConfig.loginRateLimitLockMinutes) >= 1 ? Number(rawSystemConfig.loginRateLimitLockMinutes) : Math.round(loginRateLimitLockMs / 60000),
    // 时区偏移限制在 UTC-12:00 ~ UTC+14:00（-720 ~ 840 分钟），避免异常值影响日期统计。
    timezoneOffset: Number.isFinite(timezoneOffset) ? Math.min(840, Math.max(-720, Math.round(timezoneOffset))) : 480,
    dailyReportReminderHour: Number.isFinite(dailyReportReminderHour) ? Math.min(23, Math.max(0, Math.round(dailyReportReminderHour))) : defaultDailyReportReminderHour,
    weeklyReportReminderDays: Number.isFinite(weeklyReportReminderDays) ? Math.min(30, Math.max(0, Math.round(weeklyReportReminderDays))) : defaultWeeklyReportReminderDays,
    monthlyReportReminderDays: Number.isFinite(monthlyReportReminderDays) ? Math.min(31, Math.max(0, Math.round(monthlyReportReminderDays))) : defaultMonthlyReportReminderDays,
    dailyLowHoursThreshold: Number.isFinite(dailyLowHoursThreshold) ? Math.min(24, Math.max(0, Math.round(dailyLowHoursThreshold * 10) / 10)) : defaultDailyLowHoursThreshold,
    dailyHighHoursThreshold: Number.isFinite(dailyHighHoursThreshold) ? Math.min(24, Math.max(0, Math.round(dailyHighHoursThreshold * 10) / 10)) : defaultDailyHighHoursThreshold,
    noLogStreakDays: Number.isFinite(noLogStreakDays) ? Math.min(30, Math.max(1, Math.round(noLogStreakDays))) : defaultNoLogStreakDays,
    projectInactiveDays: Number.isFinite(projectInactiveDays) ? Math.min(90, Math.max(1, Math.round(projectInactiveDays))) : defaultProjectInactiveDays,
    // 监控历史按固定采样间隔落盘，保留天数与连续失败阈值共同决定告警灵敏度与磁盘占用。
    monitorSampleIntervalMinutes: Number.isFinite(monitorSampleIntervalMinutes) ? Math.min(60, Math.max(1, Math.round(monitorSampleIntervalMinutes))) : defaultMonitorSampleIntervalMinutes,
    monitorHistoryRetentionDays: Number.isFinite(monitorHistoryRetentionDays) ? Math.min(365, Math.max(1, Math.round(monitorHistoryRetentionDays))) : defaultMonitorHistoryRetentionDays,
    monitorConsecutiveFailures: Number.isFinite(monitorConsecutiveFailures) ? Math.min(10, Math.max(1, Math.round(monitorConsecutiveFailures))) : defaultMonitorConsecutiveFailures,
    monitorCpuThreshold: Number.isFinite(monitorCpuThreshold) ? Math.min(100, Math.max(1, Math.round(monitorCpuThreshold))) : defaultMonitorCpuThreshold,
    monitorMemoryThreshold: Number.isFinite(monitorMemoryThreshold) ? Math.min(100, Math.max(1, Math.round(monitorMemoryThreshold))) : defaultMonitorMemoryThreshold,
    monitorDiskThreshold: Number.isFinite(monitorDiskThreshold) ? Math.min(100, Math.max(1, Math.round(monitorDiskThreshold))) : defaultMonitorDiskThreshold,
    monitorTargetAllowlist: String(rawSystemConfig.monitorTargetAllowlist || '').trim().slice(0, 4096),
    ssoAutoApproveAllowlist: String(rawSystemConfig.ssoAutoApproveAllowlist || '').trim().slice(0, 4096),
    ssoDefaultProjectId: String(rawSystemConfig.ssoDefaultProjectId || '').trim()
  };
}

function presentSystemConfig(user, config) {
  const normalized = normalizeSystemConfig(config || {});
  if (user && user.role === 'admin') {
    // 历史证书上传时未记录有效期，管理端展示前从磁盘证书补齐。
    const validity = resolveHttpsCertificateValidity(normalized);
    return { ...normalized, httpsCertValidFrom: validity.validFrom, httpsCertValidTo: validity.validTo };
  }
  return {
    webIdleLogoutMinutes: normalized.webIdleLogoutMinutes,
    timezoneOffset: normalized.timezoneOffset,
    allowRegistration: normalized.allowRegistration,
    httpsLoginEnabled: normalized.httpsLoginEnabled,
    httpLoginDisabled: normalized.httpLoginDisabled,
    monitorTargetAllowlist: normalized.monitorTargetAllowlist
  };
}

function normalizeRuntimeState(rawRuntimeState = {}) {
  const loginRateLimits = Array.isArray(rawRuntimeState.loginRateLimits)
    ? rawRuntimeState.loginRateLimits.map(item => ({
      key: String(item?.key || '').trim(),
      count: Math.max(0, Number(item?.count || 0)),
      firstAttemptAt: Math.max(0, Number(item?.firstAttemptAt || 0)),
      lastAttemptAt: Math.max(0, Number(item?.lastAttemptAt || 0)),
      lockedUntil: Math.max(0, Number(item?.lockedUntil || 0))
    })).filter(item => item.key)
    : [];
  const maintenance = rawRuntimeState.maintenance && typeof rawRuntimeState.maintenance === 'object'
    ? rawRuntimeState.maintenance
    : {};
  // OIDC 授权状态会被写入 runtimeState 以便在回调阶段读取；归一化时必须保留，否则重载后被清空导致登录回调间歇失败。
  const oidcState = rawRuntimeState.oidcState && typeof rawRuntimeState.oidcState === 'object' && !Array.isArray(rawRuntimeState.oidcState)
    ? Object.fromEntries(Object.entries(rawRuntimeState.oidcState).map(([key, entry]) => [String(key), {
      codeVerifier: String(entry?.codeVerifier || ''),
      nonce: String(entry?.nonce || ''),
      createdAt: Math.max(0, Number(entry?.createdAt || 0))
    }]).filter(([, entry]) => entry.codeVerifier && entry.createdAt))
    : {};
  return {
    loginRateLimits,
    oidcState,
    monitoring: {
      lastRunAt: String(rawRuntimeState.monitoring?.lastRunAt || '').trim()
    },
    maintenance: {
      lastAuditArchiveDate: String(maintenance.lastAuditArchiveDate || '').trim(),
      lastBackupCleanupWeek: String(maintenance.lastBackupCleanupWeek || '').trim(),
      lastNotificationCleanupDate: String(maintenance.lastNotificationCleanupDate || '').trim()
    }
  };
}

function ensureRuntimeState(db) {
  db.runtimeState = normalizeRuntimeState(db.runtimeState);
  return db.runtimeState;
}

function hasHttpsCertificateFiles() {
  return fs.existsSync(httpsCertPath) && fs.existsSync(httpsKeyPath);
}

function parseCertificateSummary(cert) {
  const x509 = new crypto.X509Certificate(cert);
  return {
    subject: x509.subject,
    issuer: x509.issuer,
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
    fingerprint256: x509.fingerprint256
  };
}

function validateHttpsCertificatePair(cert, key) {
  tls.createSecureContext({ cert, key });
  const summary = parseCertificateSummary(cert);
  const validToMs = Date.parse(summary.validTo);
  if (Number.isFinite(validToMs) && validToMs <= nowMs()) {
    throw new Error(`HTTPS 证书已过期，过期时间 ${summary.validTo}`);
  }
  return summary;
}

function getHttpsCertificateSummary(config = {}) {
  if (!config.httpsCertUploadedAt || !config.httpsKeyUploadedAt) {
    return '未上传证书';
  }
  const { validFrom, validTo } = resolveHttpsCertificateValidity(config);
  const period = validFrom && validTo
    ? `，有效期 ${formatCertificateTime(validFrom)} 至 ${formatCertificateTime(validTo)}`
    : (validTo ? `，有效期至 ${formatCertificateTime(validTo)}` : '');
  return `${config.httpsCertFilename || 'login-cert.pem'} / ${config.httpsKeyFilename || 'login-key.pem'}，上传时间 ${config.httpsCertUploadedAt}${period}`;
}

const HTTPS_CERT_EXPIRY_WARNING_DAYS = 7;

function formatCertificateTime(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : String(value || '');
}

// 证书有效期优先取配置；历史数据缺少该字段时回读磁盘证书，避免升级后状态显示为空。
function resolveHttpsCertificateValidity(config = {}) {
  let validFrom = String(config.httpsCertValidFrom || '').trim();
  let validTo = String(config.httpsCertValidTo || '').trim();
  if ((!validFrom || !validTo) && hasHttpsCertificateFiles()) {
    try {
      const summary = parseCertificateSummary(fs.readFileSync(httpsCertPath, 'utf8'));
      validFrom = validFrom || summary.validFrom;
      validTo = validTo || summary.validTo;
    } catch (_) {
      // 证书文件损坏时保留已有字段，由上传校验负责拦截。
    }
  }
  return { validFrom, validTo };
}

function getHttpsCertificateExpiryNotice(config = {}) {
  if (!hasHttpsCertificateFiles()) return null;
  const { validFrom, validTo } = resolveHttpsCertificateValidity(config);
  const validToMs = Date.parse(validTo);
  if (!Number.isFinite(validToMs)) return null;
  const daysRemaining = Math.ceil((validToMs - nowMs()) / (24 * 60 * 60 * 1000));
  return {
    validFrom,
    validTo,
    enabled: config.httpsLoginEnabled === true,
    daysRemaining,
    expiring: daysRemaining <= HTTPS_CERT_EXPIRY_WARNING_DAYS,
    expired: validToMs <= nowMs()
  };
}

function getLoginRateLimitStateStore(db) {
  const runtimeState = ensureRuntimeState(db);
  const map = new Map();
  for (const item of runtimeState.loginRateLimits) {
    map.set(item.key, { ...item });
  }
  return map;
}

const LOGIN_RATE_LIMIT_MAX_ENTRIES = 5000;

function setLoginRateLimitStateStore(db, store) {
  const runtimeState = ensureRuntimeState(db);
  // 键包含客户端可控的 username，必须设容量上限并按最近活跃度保留，避免无界增长。
  let entries = Array.from(store.entries());
  if (entries.length > LOGIN_RATE_LIMIT_MAX_ENTRIES) {
    entries = entries
      .sort((a, b) => Number(b[1]?.lastAttemptAt || 0) - Number(a[1]?.lastAttemptAt || 0))
      .slice(0, LOGIN_RATE_LIMIT_MAX_ENTRIES);
  }
  runtimeState.loginRateLimits = entries.map(([key, value]) => ({
    key,
    count: Math.max(0, Number(value?.count || 0)),
    firstAttemptAt: Math.max(0, Number(value?.firstAttemptAt || 0)),
    lastAttemptAt: Math.max(0, Number(value?.lastAttemptAt || 0)),
    lockedUntil: Math.max(0, Number(value?.lockedUntil || 0))
  }));
}

function formatDateKey(date) {
  return new Date(date.getTime() + getSystemTimezoneOffsetMs()).toISOString().slice(0, 10);
}

function formatWeekKey(date) {
  const target = new Date(date);
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() - day + 1);
  return formatDateKey(target);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function archiveJsonLines(dirPath, name, items) {
  if (!items.length) return '';
  ensureDir(dirPath);
  const filePath = path.join(dirPath, name);
  const payload = items.map(item => JSON.stringify(item)).join('\n') + '\n';
  fs.appendFileSync(filePath, payload, 'utf8');
  return filePath;
}

function pruneArchiveFiles(dirPath, retentionDays) {
  const cutoff = nowMs() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dirPath)) {
    const filePath = path.join(dirPath, name);
    const stat = fs.statSync(filePath);
    if (stat.isFile() && stat.mtimeMs < cutoff) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

// 备份快照统一保留 localBackupRetentionDays 天（默认 180）：可恢复区与归档区中超期的备份都会被清理，
// 避免备份无限堆积占满磁盘（此前自动快照仅保留 7 天、归档区则从不清理，两处策略不一致）。
function cleanupExpiredBackupFiles() {
  const cutoff = nowMs() - localBackupRetentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const dirPath of [backupDir, backupArchiveDir]) {
    if (!fs.existsSync(dirPath)) continue;
    for (const name of fs.readdirSync(dirPath)) {
      if (!name.endsWith('.json')) continue;
      const filePath = path.join(dirPath, name);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.rmSync(filePath, { force: true });
        removed += 1;
      }
    }
  }
  return removed;
}

// 审计归档查询：仅允许读取归档目录下的 .jsonl 文件，避免路径穿越访问任意文件。
function listAuditArchiveFiles() {
  if (!fs.existsSync(auditArchiveDir)) return [];
  return fs.readdirSync(auditArchiveDir)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => {
      const stat = fs.statSync(path.join(auditArchiveDir, name));
      return { name, size: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

const auditArchiveMaxReadBytes = 64 * 1024 * 1024;

function resolveAuditArchiveFile(name) {
  const requested = String(name || '').trim();
  const base = path.basename(requested);
  if (!base || base !== requested || !base.endsWith('.jsonl')) return '';
  const filePath = path.join(auditArchiveDir, base);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return '';
  return filePath;
}

function readAuditArchiveEntries(filePath) {
  const entries = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (_) {}
  }
  return entries;
}

function cleanupLoginAttemptStoreFromDb(db) {
  const store = getLoginRateLimitStateStore(db);
  const { windowMs, lockMs } = getLoginRateLimitConfig(db);
  const cutoff = nowMs() - Math.max(windowMs, lockMs) * 2;
  let cleaned = false;
  for (const [key, value] of store.entries()) {
    if ((value.lastAttemptAt || 0) < cutoff && (value.lockedUntil || 0) < nowMs()) {
      store.delete(key);
      cleaned = true;
    }
  }
  setLoginRateLimitStateStore(db, store);
  return cleaned;
}

function runMaintenanceTasks(db) {
  let changed = false;
  const runtimeState = ensureRuntimeState(db);
  const currentDate = new Date();
  const todayKey = formatDateKey(currentDate);
  const weekKey = formatWeekKey(currentDate);

  if (runtimeState.maintenance.lastAuditArchiveDate !== todayKey) {
    // 审计日志按追加顺序存储（最新在尾部）：保留最近的 500 条，把更早的历史归档到文件。
    // 之前误用 slice(0, 500) 保留了最旧的记录、归档掉最新记录，会导致近期审计日志从接口消失。
    const allAuditLogs = db.auditLogs || [];
    const archivedLogs = allAuditLogs.slice(0, Math.max(0, allAuditLogs.length - 500));
    if (archivedLogs.length) {
      archiveJsonLines(auditArchiveDir, `${todayKey}.jsonl`, archivedLogs);
      db.auditLogs = allAuditLogs.slice(-500);
      changed = true;
    }
    runtimeState.maintenance.lastAuditArchiveDate = todayKey;
  }

  if (runtimeState.maintenance.lastBackupCleanupWeek !== weekKey) {
    // 备份统一保留 localBackupRetentionDays 天（默认 180），超期直接清理，不再移入归档区堆积。
    cleanupExpiredBackupFiles();
    runtimeState.maintenance.lastBackupCleanupWeek = weekKey;
  }

  if (runtimeState.maintenance.lastNotificationCleanupDate !== todayKey) {
    const notifications = db.notifications || [];
    // 通知可见范围：全部管理员 + 同项目成员。仅当所有可见用户都已读或已隐藏时才可归档。
    // 已禁用/已驳回账号无法登录，不计入收件人，否则相关通知永远无法归档。
    const canReceiveNotifications = item => item.status !== 'disabled' && item.status !== 'rejected';
    const adminUserIds = (db.users || []).filter(item => item.role === 'admin' && canReceiveNotifications(item)).map(item => item.id);
    const projectUserIds = new Map();
    for (const item of db.users || []) {
      if (!canReceiveNotifications(item)) continue;
      for (const projectId of userProjectIds(item)) {
        if (!projectUserIds.has(projectId)) projectUserIds.set(projectId, []);
        if (!projectUserIds.get(projectId).includes(item.id)) projectUserIds.get(projectId).push(item.id);
      }
    }
    const isReadByAllRecipients = item => {
      const readBy = item.readBy && typeof item.readBy === 'object' ? item.readBy : {};
      const hiddenBy = item.hiddenBy && typeof item.hiddenBy === 'object' ? item.hiddenBy : {};
      const recipients = adminUserIds.concat(projectUserIds.get(item.projectId) || []);
      if (!recipients.length) return false;
      return recipients.every(userId => Boolean(readBy[userId] || hiddenBy[userId]));
    };
    const retained = [];
    const archived = [];
    for (const item of notifications) {
      const createdAtMs = Date.parse(item.createdAt || '') || nowMs();
      const isRead = isReadByAllRecipients(item);
      const important = ['ai-inspection', 'approval', 'system-upgrade'].includes(String(item.category || ''));
      const retentionDays = important ? importantNotificationRetentionDays : generalNotificationRetentionDays;
      const expired = createdAtMs < nowMs() - retentionDays * 24 * 60 * 60 * 1000;
      if (isRead && expired) {
        archived.push({ ...item, archivedAt: now() });
      } else {
        retained.push(item);
      }
    }
    if (archived.length) {
      archiveJsonLines(notificationArchiveDir, `${todayKey}.jsonl`, archived);
      db.notifications = retained;
      changed = true;
    }
    runtimeState.maintenance.lastNotificationCleanupDate = todayKey;
  }

  const loginCleanupChanged = cleanupLoginAttemptStoreFromDb(db);
  if (loginCleanupChanged) changed = true;

  const expiredSessions = (db.sessions || []).filter(item => Date.parse(item.expiresAt) <= nowMs());
  if (expiredSessions.length) {
    db.sessions = (db.sessions || []).filter(item => Date.parse(item.expiresAt) > nowMs());
    changed = true;
  }

  pruneArchiveFiles(auditArchiveDir, auditArchiveRetentionDays);
  pruneArchiveFiles(notificationArchiveDir, notificationArchiveRetentionDays);
  if (checkExpiryNotifications(db)) changed = true;
  return changed;
}

function stopHttpsServer() {
  return new Promise(resolve => {
    if (!httpsServer) {
      resolve();
      return;
    }
    const activeServer = httpsServer;
    httpsServer = null;
    const timeout = setTimeout(() => {
      console.error('HTTPS server close timed out, forcing resolution');
      resolve();
    }, 10000);
    activeServer.close(() => {
      clearTimeout(timeout);
      resolve();
    });
    if (typeof activeServer.closeAllConnections === 'function') {
      activeServer.closeAllConnections();
    }
  });
}

async function applyHttpsServerConfig(config = {}) {
  const previous = httpsServerMutex;
  let release;
  httpsServerMutex = new Promise(resolve => { release = resolve; });
  await previous;
  try {
  const normalized = normalizeSystemConfig(config);
  if (!normalized.httpsLoginEnabled) {
    await stopHttpsServer();
    httpsServerStatus = {
      status: 'stopped',
      detail: 'HTTPS 登录未启用',
      port: normalized.httpsPort,
      checkedAt: now()
    };
    return httpsServerStatus;
  }
  if (!hasHttpsCertificateFiles()) {
    await stopHttpsServer();
    httpsServerStatus = {
      status: 'stopped',
      detail: '已启用 HTTPS 登录，但证书或私钥未上传',
      port: normalized.httpsPort,
      checkedAt: now()
    };
    return httpsServerStatus;
  }
  const cert = fs.readFileSync(httpsCertPath, 'utf8');
  const key = fs.readFileSync(httpsKeyPath, 'utf8');
  validateHttpsCertificatePair(cert, key);
  await stopHttpsServer();
  const secureServer = https.createServer({ cert, key }, requestHandler);
  attachWsUpgradeHandler(secureServer);
  await new Promise((resolve, reject) => {
    secureServer.once('error', reject);
    secureServer.listen(normalized.httpsPort, () => resolve());
  });
  httpsServer = secureServer;
  secureServer.on('error', error => {
    console.error(`HTTPS server error: ${error.message}`);
    httpsServerStatus = { status: 'error', detail: error.message, port: normalized.httpsPort, checkedAt: now() };
  });
  httpsServerStatus = {
    status: 'running',
    detail: `HTTPS 登录已启用，监听端口 ${normalized.httpsPort}，证书 ${normalized.httpsCertFilename || 'login-cert.pem'}`,
    port: normalized.httpsPort,
    checkedAt: now()
  };
  return httpsServerStatus;
  } finally {
    release();
  }
}

function getAiMetricCatalog(category) {
  const catalog = {
    server: [
      { key: 'cpuUsage', label: 'CPU使用率', unit: '%', warn: 70, critical: 90, direction: 'high', description: '持续高负载可能影响系统响应' },
      { key: 'memoryUsage', label: '内存使用率', unit: '%', warn: 75, critical: 90, direction: 'high', description: '内存使用率持续升高可能导致服务抖动' },
      { key: 'diskUsage', label: '磁盘使用率', unit: '%', warn: 80, critical: 95, direction: 'high', description: '磁盘容量不足可能影响日志和业务写入' },
      { key: 'inodeUsage', label: 'inode使用率', unit: '%', warn: 75, critical: 90, direction: 'high', description: 'inode 耗尽会导致文件无法继续创建' },
      { key: 'loadValue', label: '系统负载', unit: '', warn: 4, critical: 8, direction: 'high', description: '负载持续偏高说明系统资源紧张' },
      { key: 'serviceHealth', label: '关键服务异常数', unit: '个', warn: 1, critical: 3, direction: 'high', description: '关键服务异常会直接影响业务连续性' }
    ],
    network: [
      { key: 'cpuUsage', label: 'CPU使用率', unit: '%', warn: 70, critical: 90, direction: 'high', description: '高 CPU 使用率可能导致转发性能下降' },
      { key: 'memoryUsage', label: '内存使用率', unit: '%', warn: 75, critical: 90, direction: 'high', description: '内存紧张可能影响路由和会话处理' },
      { key: 'portErrorCount', label: '接口异常数', unit: '个', warn: 1, critical: 3, direction: 'high', description: '端口异常数量反映链路健康度' },
      { key: 'packetLossRate', label: '丢包率', unit: '%', warn: 1, critical: 5, direction: 'high', description: '持续丢包说明链路质量下降' },
      { key: 'crcErrorCount', label: 'CRC错误数', unit: '个', warn: 1, critical: 10, direction: 'high', description: 'CRC 错误通常意味着物理层问题' },
      { key: 'haStatus', label: '主备异常数', unit: '个', warn: 1, critical: 1, direction: 'high', description: '主备异常会降低设备高可用能力' }
    ],
    security: [
      { key: 'cpuUsage', label: 'CPU使用率', unit: '%', warn: 70, critical: 90, direction: 'high', description: '高 CPU 使用率可能影响安全策略处理效率' },
      { key: 'memoryUsage', label: '内存使用率', unit: '%', warn: 75, critical: 90, direction: 'high', description: '内存不足会影响会话保持和威胁检测' },
      { key: 'sessionUsage', label: '会话使用率', unit: '%', warn: 70, critical: 90, direction: 'high', description: '会话容量过高会引发转发表压力' },
      { key: 'policyHitAnomaly', label: '策略异常数', unit: '个', warn: 1, critical: 5, direction: 'high', description: '异常策略命中说明访问行为需要排查' },
      { key: 'signatureAge', label: '特征库滞后天数', unit: '天', warn: 7, critical: 30, direction: 'high', description: '特征库过旧会降低威胁识别能力' },
      { key: 'licenseDaysLeft', label: '授权剩余天数', unit: '天', warn: 30, critical: 7, direction: 'low', description: '授权临近到期会影响持续防护能力' }
    ]
  };
  return (catalog[category] || catalog.server).map(item => ({ ...item }));
}

function getDefaultAiInspectionTemplates() {
  return [
    { id: 'ai_tpl_server_default', projectId: '', name: '服务器智能巡检模板', category: 'server', description: '适用于 Linux 或 Windows 服务器的基础资源与服务巡检', metrics: getAiMetricCatalog('server'), createdBy: 'system', createdAt: now() },
    { id: 'ai_tpl_network_default', projectId: '', name: '网络设备智能巡检模板', category: 'network', description: '适用于交换机、路由器等网络设备的基础健康巡检', metrics: getAiMetricCatalog('network'), createdBy: 'system', createdAt: now() },
    { id: 'ai_tpl_security_default', projectId: '', name: '安全设备智能巡检模板', category: 'security', description: '适用于防火墙、WAF、上网行为管理等安全设备巡检', metrics: getAiMetricCatalog('security'), createdBy: 'system', createdAt: now() }
  ];
}

// 指标文本会进入 HTML 报表、PPTX(XML) 与 CSV，统一去除可破坏标记的字符并限制长度。
function sanitizeMetricText(value, fallback, maxLength) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizeAiInspectionMetrics(metrics, category = 'server') {
  const fallback = getAiMetricCatalog(category);
  const source = Array.isArray(metrics) && metrics.length ? metrics : fallback;
  return source.map((item, index) => ({
    key: item.key || `metric_${index + 1}`,
    label: sanitizeMetricText(item.label, `指标${index + 1}`, 60),
    unit: sanitizeMetricText(item.unit, '', 24),
    warn: Number(item.warn || 0),
    critical: Number(item.critical || 0),
    direction: item.direction === 'low' ? 'low' : 'high',
    description: sanitizeMetricText(item.description, '', 200)
  }));
}

function normalizeAiInspectionValues(metrics) {
  return (Array.isArray(metrics) ? metrics : []).map((item, index) => ({
    key: item.key || `metric_${index + 1}`,
    label: sanitizeMetricText(item.label, `指标${index + 1}`, 60),
    unit: sanitizeMetricText(item.unit, '', 24),
    warn: Number(item.warn || 0),
    critical: Number(item.critical || 0),
    direction: item.direction === 'low' ? 'low' : 'high',
    description: sanitizeMetricText(item.description, '', 200),
    value: item.value === '' || item.value === null || item.value === undefined ? '' : Number(item.value)
  }));
}

function hasInvalidAiInspectionMetricValue(metrics) {
  return (Array.isArray(metrics) ? metrics : []).some(item => item.value !== '' && item.value !== null && item.value !== undefined && Number.isNaN(Number(item.value)));
}

function normalizeAiInspectionProtocol(protocol, category = 'server') {
  const allowed = {
    server: ['ssh', 'winrm', 'wmi', 'http', 'https', 'agent'],
    network: ['ssh', 'snmp', 'http', 'https', 'agent'],
    security: ['ssh', 'snmp', 'http', 'https', 'agent']
  };
  const value = String(protocol || '').trim().toLowerCase();
  return (allowed[category] || allowed.server).includes(value) ? value : allowed[category]?.[0] || 'ssh';
}

function normalizeAiInspectionAuthType(authType, protocol = 'ssh') {
  const allowed = {
    ssh: ['password', 'key'],
    winrm: ['password'],
    wmi: ['password'],
    snmp: ['community', 'password'],
    http: ['token', 'password', 'key'],
    https: ['token', 'password', 'key'],
    agent: ['token']
  };
  const value = String(authType || '').trim().toLowerCase();
  return (allowed[protocol] || allowed.ssh).includes(value) ? value : allowed[protocol]?.[0] || 'password';
}

function sanitizeUploadFilename(filename) {
  const base = String(filename || '')
    .replace(/[/\\]/g, '_')
    .replace(/[^\x20-\x7E\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, '')
    .trim()
    || `upload-${Date.now()}`;
  if (base === '.' || base === '..') return `upload-${Date.now()}`;
  // 文件名过长会触发 ENAMETOOLONG，落盘失败后返回 500；截断时保留扩展名。
  const MAX_UPLOAD_FILENAME_LENGTH = 180;
  if (base.length > MAX_UPLOAD_FILENAME_LENGTH) {
    const ext = path.extname(base).slice(0, 16);
    return base.slice(0, MAX_UPLOAD_FILENAME_LENGTH - ext.length) + ext;
  }
  return base;
}

function sanitizeAiInspectionTarget(item) {
  const { password, privateKey, accessToken, community, ...safe } = item;
  const result = {
    ...safe,
    credential: '***',
    hasPassword: Boolean(password),
    hasPrivateKey: Boolean(privateKey),
    hasAccessToken: Boolean(accessToken),
    hasCommunity: Boolean(community)
  };
  return result;
}

function sanitizeAiInspectionTargetForViewer(item, viewer) {
  const result = sanitizeAiInspectionTarget(item);
  if (viewer && viewer.role === 'customer') {
    delete result.backupCommand;
    delete result.account;
    delete result.webBackupPath;
    delete result.webBackupMethod;
    delete result.webLoginPath;
    delete result.address;
  }
  return result;
}

function sanitizeUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    securityQuestion,
    securityAnswerHash,
    twoFactorSecret,
    twoFactorPendingSecret,
    twoFactorRecoveryCodeHashes,
    ...safe
  } = user;
  return { ...safe, projectIds: userProjectIds(user) };
}

// 工程师可兼多个驻场点：projectId 仍是主项目（用于默认归属），projectIds 是参与权限判断的完整项目集。
function userProjectIds(user) {
  if (!user) return [];
  const ids = [];
  const primary = String(user.projectId || '').trim();
  if (primary) ids.push(primary);
  if (Array.isArray(user.projectIds)) {
    for (const value of user.projectIds) {
      const projectId = String(value || '').trim();
      if (projectId && !ids.includes(projectId)) ids.push(projectId);
    }
  }
  return ids;
}

function userHasProject(user, projectId) {
  if (!user || !projectId) return false;
  return userProjectIds(user).includes(String(projectId));
}

// 创建类接口的项目归属：管理员可自由指定，工程师只能落到自己的项目集内。
function resolveWriteProjectId(user, requestedProjectId) {
  if (!user) return '';
  if (user.role === 'admin') return String(requestedProjectId || '').trim();
  const requested = String(requestedProjectId || '').trim();
  if (requested && userHasProject(user, requested)) return requested;
  return String(user.projectId || '').trim() || userProjectIds(user)[0] || '';
}

// 人员可关联多个项目：主项目必填，项目集自动包含主项目并去重。
function normalizeUserProjectSelection(db, primaryProjectId, rawProjectIds) {
  const projectId = String(primaryProjectId || '').trim();
  const projectIds = [];
  const pushId = value => {
    const id = String(value || '').trim();
    if (!id || projectIds.includes(id)) return;
    projectIds.push(id);
  };
  pushId(projectId);
  if (Array.isArray(rawProjectIds)) rawProjectIds.forEach(pushId);
  const invalid = projectIds.find(id => !requireExistingProject(id, db));
  if (invalid) return { error: '关联项目不存在' };
  return { projectId, projectIds };
}

// oidc_/ldap_ 前缀由 SSO/LDAP 自动开通流程占用；若允许普通账号使用，
// 预注册同名账号后会与外部身份登录映射到同一记录，造成账号接管。
const RESERVED_USERNAME_PREFIXES = ['oidc_', 'ldap_'];
function isReservedUsername(username) {
  const lowered = String(username || '').trim().toLowerCase();
  return RESERVED_USERNAME_PREFIXES.some(prefix => lowered.startsWith(prefix));
}

function sanitizeUserForViewer(user, viewer) {
  const safe = sanitizeUser(user);
  if (!safe) return null;
  if (!viewer || viewer.role === 'admin' || viewer.id === user.id) return safe;
  return { ...safe, idCard: '', phone: '', email: '', username: '', wechat: '' };
}

function sanitizeAiInspectionResultForViewer(result, viewer) {
  if (!result) return result;
  // _dirty 是内部落库标记，任何角色都不应看到。
  const { _dirty, ...source } = result;
  // 原始探测输出（CLI 回显、配置片段）只对管理员与工程师可见。
  const privileged = Boolean(viewer) && (viewer.role === 'admin' || viewer.role === 'engineer');
  if (privileged) return source;
  const {
    probeError,
    rawOutput,
    stdout,
    stderr,
    ...safe
  } = source;
  return {
    ...safe,
    probeError: Boolean(probeError),
    suggestion: redactNetworkDetails(safe.suggestion),
    summary: redactNetworkDetails(safe.summary),
    risk: redactNetworkDetails(safe.risk)
  };
}

function redactNetworkDetails(text) {
  return String(text ?? '')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[已隐藏]')
    .replace(/\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d{1,5})?\b/g, '[已隐藏]');
}

function sanitizeAssetForApi(asset, viewer) {
  if (!asset) return asset;
  const { snmpCommunity, ...rest } = asset;
  const result = { ...rest, hasSnmpCommunity: Boolean(String(snmpCommunity || '').trim()) };
  if (viewer && viewer.role === 'customer') {
    delete result.monitorHost;
    delete result.installationLocation;
    delete result.serialNumber;
    delete result.notes;
    delete result.snmpPort;
    delete result.hasSnmpCommunity;
  }
  return result;
}

const RACK_UNIT_MIN = 1;
const RACK_UNIT_MAX = 48;
const DEFAULT_CABINET_UNITS = 42;
const UNASSIGNED_CABINET_NAME = '未分配机柜';

const snmpMetricCache = {};

function parseOptionalRackUnit(value, fieldLabel) {
  if (value === undefined || value === null || String(value).trim() === '') return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < RACK_UNIT_MIN || n > RACK_UNIT_MAX) {
    return { error: `${fieldLabel}须为 ${RACK_UNIT_MIN}-${RACK_UNIT_MAX} 的整数` };
  }
  return { value: n };
}

function readCabinetFields(body = {}) {
  const start = parseOptionalRackUnit(body.rackUnitStart, '起始U位');
  if (start.error) return start;
  const size = parseOptionalRackUnit(body.rackUnitSize, '占用U数');
  if (size.error) return size;
  const rackUnitStart = start.value;
  let rackUnitSize = size.value === null ? 1 : size.value;
  if (rackUnitStart === null && rackUnitSize > 1) {
    return { error: '填写占用U数时必须填写起始U位' };
  }
  if (rackUnitStart === null) rackUnitSize = 1;
  if (rackUnitStart !== null && rackUnitStart + rackUnitSize - 1 > RACK_UNIT_MAX) {
    return { error: '起始U位与占用U数合计不能超过48' };
  }
  return {
    cabinetName: String(body.cabinetName || '').trim(),
    rackUnitStart,
    rackUnitSize
  };
}

const ASSET_TYPE_OPTIONS = ['网络设备', '安全设备', '服务器', '存储', '监控', 'UPS配电', '空调系统', '其它'];
const ASSET_MONITOR_TYPES = ['ping', 'tcp', 'snmp'];
const ASSET_RELATION_TYPES = ['connected', 'depends_on', 'hosts', 'monitors', 'backup', 'powers'];
const ASSET_STATUS_OPTIONS = ['使用中', '闲置', '维修中', '借出', '待报废', '已报废', '已退役'];
const ASSET_LIFECYCLE_ACTIONS = ['create', 'update', 'status', 'transfer', 'checkout', 'return', 'retire', 'scrap', 'inventory'];

// 历史数据里的自由文本状态统一收敛到枚举，避免状态机出现不可判定的值。
function normalizeAssetStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return '使用中';
  if (raw === '运行中') return '使用中';
  return ASSET_STATUS_OPTIONS.includes(raw) ? raw : '使用中';
}

function appendAssetLifecycle(db, asset, action, user, detail, extra = {}) {
  db.assetLifecycles = db.assetLifecycles || [];
  db.assetLifecycles.push({
    id: id('assetLife'),
    projectId: asset.projectId || '',
    assetId: asset.id,
    assetName: asset.name || '',
    action: ASSET_LIFECYCLE_ACTIONS.includes(action) ? action : 'update',
    detail: String(detail || ''),
    operatorId: user ? user.id : '',
    operatorName: user ? (user.name || user.username || '') : '',
    ...extra,
    createdAt: now()
  });
}

function canManageAssetProject(user, asset) {
  if (!user || !asset) return false;
  if (user.role === 'admin') return true;
  return user.role === 'engineer' && userHasProject(user, asset.projectId);
}

// 统一文本长度上限校验：超长输入直接拒绝，避免异常大字段破坏展示与存储。
function checkTextLength(value, max, label) {
  if (value === undefined || value === null) return null;
  if (String(value).length > max) return `${label}长度不能超过 ${max} 个字符`;
  return null;
}

const LOGIN_USERNAME_MAX_LENGTH = 64;
// 登录与找回密码会把用户名拼进限流键并写入 runtimeState，超长输入会成倍放大落库体积。
function normalizeLoginUsername(value) {
  const username = String(value || '').trim();
  return username.length > LOGIN_USERNAME_MAX_LENGTH ? '' : username;
}
const ASSET_RESERVED_IDS = new Set(['import', 'cabinet-layout', 'topology-layout', 'topology', 'monitor-status']);
const ASSET_IMPORT_MAX_ROWS = 500;

// 资产类型为固定枚举，新增与修改必须共用同一套校验，避免写入列表外类型。
function readAssetTypeField(rawType) {
  const type = String(rawType || '').trim();
  if (!ASSET_TYPE_OPTIONS.includes(type)) return { error: '资产类型无效' };
  return { type };
}

function parseAssetIdFromPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'assets') return '';
  const assetId = parts[2];
  if (!assetId || ASSET_RESERVED_IDS.has(assetId)) return '';
  return assetId;
}

function readMonitorFields(body = {}, existing = null) {
  const monitorEnabled = body.monitorEnabled !== undefined
    ? (body.monitorEnabled === true || body.monitorEnabled === 'true')
    : Boolean(existing && existing.monitorEnabled);
  let monitorType = String(body.monitorType || existing?.monitorType || 'ping').trim().toLowerCase();
  if (!ASSET_MONITOR_TYPES.includes(monitorType)) monitorType = 'ping';
  const monitorHost = body.monitorHost !== undefined
    ? String(body.monitorHost || '').trim()
    : String(existing?.monitorHost || '').trim();
  if (monitorHost && !validateHost(monitorHost)) return { error: '监控地址格式无效' };
  if (monitorEnabled && !monitorHost) return { error: '启用监控时必须填写监控地址' };
  const monitorPortRaw = body.monitorPort !== undefined ? body.monitorPort : existing?.monitorPort;
  const monitorPort = monitorPortRaw === undefined || monitorPortRaw === null ? '' : String(monitorPortRaw).trim();
  if (monitorPort && !validatePort(monitorPort)) return { error: '监控端口无效' };
  if (monitorEnabled && monitorType === 'tcp' && !validatePort(monitorPort)) return { error: 'TCP 监测必须填写有效端口' };
  let snmpCommunity = existing ? String(existing.snmpCommunity || '') : '';
  // 留空表示保持原值；需要清空时必须显式传 clearSnmpCommunity，避免误清已保存团体字。
  if (body.clearSnmpCommunity === true || body.clearSnmpCommunity === 'true') {
    snmpCommunity = '';
  } else if (body.snmpCommunity !== undefined) {
    const nextCommunity = String(body.snmpCommunity || '').trim();
    if (nextCommunity) snmpCommunity = nextCommunity;
  }
  const snmpPortRaw = body.snmpPort !== undefined ? body.snmpPort : (existing?.snmpPort || '161');
  const snmpPort = String(snmpPortRaw || '').trim() || '161';
  if (snmpPort && !validatePort(snmpPort)) return { error: 'SNMP 端口无效' };
  return { monitorEnabled, monitorType, monitorHost, monitorPort, snmpCommunity, snmpPort };
}

function readImportedMonitorFields(row = {}) {
  const enabledRaw = String(row.monitorEnabled ?? row['启用监控'] ?? '').trim().toLowerCase();
  const monitorTypeRaw = String(row.monitorType || row['监控方式'] || '').trim().toLowerCase();
  const monitorHost = String(row.monitorHost || row['监控地址/IP'] || row['监控地址'] || '').trim();
  const monitorPort = String(row.monitorPort || row['端口号'] || '').trim();
  let snmpCommunity = String(row.snmpCommunity || row['SNMP团体字'] || '').trim();
  // 导出模板用「已配置」占位隐藏真实团体字，回导时按未提供处理，避免占位符覆盖真实值。
  if (snmpCommunity === '已配置' || snmpCommunity === '未配置') snmpCommunity = '';
  const snmpPort = String(row.snmpPort || row['SNMP端口'] || '').trim();
  const monitorType = ASSET_MONITOR_TYPES.includes(monitorTypeRaw) ? monitorTypeRaw : 'ping';
  const monitorEnabled = ['true', '1', 'yes', '是', '启用'].includes(enabledRaw) || Boolean(monitorHost);
  return readMonitorFields({
    monitorEnabled,
    monitorType,
    monitorHost,
    monitorPort,
    snmpCommunity,
    snmpPort
  });
}

// 资产表单/接口的维保日期统一规范化并校验真实日期，避免写入 2026-13-45 之类无效值。
function normalizeAssetDateField(value, fieldLabel) {
  if (value === undefined || value === null || String(value).trim() === '') return { value: '' };
  const match = String(value).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return { error: `${fieldLabel}格式无效，请使用YYYY-MM-DD格式` };
  const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  if (!parseDateOnly(normalized)) return { error: `${fieldLabel}不是有效日期` };
  return { value: normalized };
}

function sanitizeTopologyPositions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: '布局数据格式无效' };
  const keys = Object.keys(raw);
  if (keys.length > 2000) return { error: '拓扑节点数量超出限制' };
  const positions = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !key || key.length > 80) continue;
    const pos = raw[key];
    if (!pos || typeof pos !== 'object') continue;
    const x = Number(pos.x);
    const y = Number(pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    positions[key] = {
      x: Math.min(100, Math.max(0, x)),
      y: Math.min(100, Math.max(0, y))
    };
  }
  return { positions };
}

function collectAssetDeleteBlockers(db, assetId) {
  const warnings = [];
  const pushIf = (count, text) => { if (count) warnings.push(`有 ${count} ${text}`); };
  pushIf((db.assetCheckouts || []).filter(item => item.assetId === assetId && item.status === 'checked_out').length, '条进行中的借出记录引用了该资产');
  pushIf((db.aiInspectionTargets || []).filter(item => item.assetId === assetId).length, '个巡检对象引用了该资产');
  pushIf((db.spareParts || []).filter(item => item.assetId === assetId).length, '条备件记录引用了该资产');
  pushIf((db.sparePartMovements || []).filter(item => item.assetId === assetId).length, '条备件出入库记录引用了该资产');
  pushIf((db.changeRecords || []).filter(item => item.assetId === assetId).length, '条变更记录引用了该资产');
  pushIf((db.inspectionPlans || []).filter(item => item.assetId === assetId).length, '条巡检计划引用了该资产');
  pushIf((db.inspectionExecutions || []).filter(item => item.assetId === assetId).length, '条巡检执行记录引用了该资产');
  pushIf((db.incidentRecords || []).filter(item => item.assetId === assetId).length, '条故障记录引用了该资产');
  pushIf((db.logs || []).filter(item => item.assetId === assetId).length, '条运维日志引用了该资产');
  // 智能巡检任务/结果与配置备份计划/记录通过巡检对象间接引用资产，需一并提示。
  const linkedTargetIds = (db.aiInspectionTargets || []).filter(item => item.assetId === assetId).map(item => item.id);
  pushIf((db.aiInspectionTasks || []).filter(item => linkedTargetIds.includes(item.targetId)).length, '个智能巡检任务引用了该资产的巡检对象');
  pushIf((db.aiInspectionResults || []).filter(item => linkedTargetIds.includes(item.targetId)).length, '条智能巡检结果引用了该资产的巡检对象');
  pushIf((db.configBackupPlans || []).filter(item => linkedTargetIds.includes(item.targetId)).length, '个配置备份计划引用了该资产的巡检对象');
  pushIf((db.configBackupRecords || []).filter(item => linkedTargetIds.includes(item.targetId)).length, '条配置备份记录引用了该资产的巡检对象');
  return warnings;
}

// 管理员强制删除资产时，级联清理所有直接引用该资产的记录及其派生通知，避免产生孤儿数据。
function cascadeDeleteAsset(db, assetId) {
  const removed = {
    assets: 0, relations: 0, targets: 0, spareParts: 0, sparePartMovements: 0,
    changeRecords: 0, approvals: 0, inspectionPlans: 0, inspectionExecutions: 0,
    incidents: 0, logs: 0, notifications: 0, aiTasks: 0, aiResults: 0,
    configBackupPlans: 0, configBackupRecords: 0, assetLifecycles: 0,
    assetCheckouts: 0, assetInventoryItems: 0, monitorAlerts: 0, monitorMaintenanceWindowEntries: 0
  };
  const beforeNotifications = (db.notifications || []).length;

  const beforeLifecycles = (db.assetLifecycles || []).length;
  db.assetLifecycles = (db.assetLifecycles || []).filter(item => item.assetId !== assetId);
  removed.assetLifecycles = beforeLifecycles - db.assetLifecycles.length;
  const beforeCheckouts = (db.assetCheckouts || []).length;
  db.assetCheckouts = (db.assetCheckouts || []).filter(item => item.assetId !== assetId);
  removed.assetCheckouts = beforeCheckouts - db.assetCheckouts.length;
  const beforeAlerts = (db.monitorAlerts || []).length;
  db.monitorAlerts = (db.monitorAlerts || []).filter(item => item.assetId !== assetId);
  removed.monitorAlerts = beforeAlerts - db.monitorAlerts.length;
  // 维护窗口可覆盖整个项目，资产删除时只移除对该资产的定向绑定。
  for (const item of db.monitorMaintenanceWindows || []) {
    if (!Array.isArray(item.assetIds) || !item.assetIds.includes(assetId)) continue;
    const before = item.assetIds.length;
    item.assetIds = item.assetIds.filter(entry => entry !== assetId);
    removed.monitorMaintenanceWindowEntries += before - item.assetIds.length;
  }
  // 盘点任务保留历史，只移除已删资产的快照项。
  for (const task of db.assetInventoryTasks || []) {
    if (!Array.isArray(task.items)) continue;
    const beforeItems = task.items.length;
    task.items = task.items.filter(item => item.assetId !== assetId);
    removed.assetInventoryItems += beforeItems - task.items.length;
  }

  const linkedChangeRecords = (db.changeRecords || []).filter(item => item.assetId === assetId);
  const changeIds = linkedChangeRecords.map(item => item.id);
  const changeApprovalIds = linkedChangeRecords.map(item => item.approvalId).filter(Boolean);
  db.changeRecords = (db.changeRecords || []).filter(item => item.assetId !== assetId);
  removed.changeRecords = changeIds.length;
  const beforeApprovals = (db.approvals || []).length;
  db.approvals = (db.approvals || []).filter(item => !changeApprovalIds.includes(item.id));
  removed.approvals = beforeApprovals - db.approvals.length;
  changeIds.forEach(id => removeNotificationsBySource(db, 'changeRecord', id));
  changeApprovalIds.forEach(id => removeNotificationsBySource(db, 'approval', id));

  const incidentIds = (db.incidentRecords || []).filter(item => item.assetId === assetId).map(item => item.id);
  db.incidentRecords = (db.incidentRecords || []).filter(item => item.assetId !== assetId);
  removed.incidents = incidentIds.length;
  incidentIds.forEach(id => removeNotificationsBySource(db, 'incident', id));

  const spareIds = (db.spareParts || []).filter(item => item.assetId === assetId).map(item => item.id);
  db.spareParts = (db.spareParts || []).filter(item => item.assetId !== assetId);
  removed.spareParts = spareIds.length;
  const beforeMovements = (db.sparePartMovements || []).length;
  db.sparePartMovements = (db.sparePartMovements || []).filter(item => item.assetId !== assetId && !spareIds.includes(item.sparePartId));
  removed.sparePartMovements = beforeMovements - db.sparePartMovements.length;

  const beforeTargets = (db.aiInspectionTargets || []).length;
  const removedTargetIds = (db.aiInspectionTargets || []).filter(item => item.assetId === assetId).map(item => item.id);
  db.aiInspectionTargets = (db.aiInspectionTargets || []).filter(item => item.assetId !== assetId);
  removed.targets = beforeTargets - db.aiInspectionTargets.length;
  // 巡检对象被删除后，其派生的智能巡检任务/结果与配置备份计划/记录会成为孤儿，需同步清理。
  const beforeAiTasks = (db.aiInspectionTasks || []).length;
  const removedAiTaskIds = (db.aiInspectionTasks || []).filter(item => removedTargetIds.includes(item.targetId)).map(item => item.id);
  db.aiInspectionTasks = (db.aiInspectionTasks || []).filter(item => !removedTargetIds.includes(item.targetId));
  const beforeAiResults = (db.aiInspectionResults || []).length;
  db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => !removedTargetIds.includes(item.targetId));
  const beforeConfigPlans = (db.configBackupPlans || []).length;
  const removedConfigPlanIds = (db.configBackupPlans || []).filter(item => removedTargetIds.includes(item.targetId)).map(item => item.id);
  db.configBackupPlans = (db.configBackupPlans || []).filter(item => !removedTargetIds.includes(item.targetId));
  const beforeConfigRecords = (db.configBackupRecords || []).length;
  db.configBackupRecords = (db.configBackupRecords || []).filter(item => !removedTargetIds.includes(item.targetId));
  removedAiTaskIds.forEach(id => removeNotificationsBySource(db, 'aiInspectionTask', id));
  removedConfigPlanIds.forEach(id => removeNotificationsBySource(db, 'configBackupPlan', id));
  removed.aiTasks = beforeAiTasks - db.aiInspectionTasks.length;
  removed.aiResults = beforeAiResults - db.aiInspectionResults.length;
  removed.configBackupPlans = beforeConfigPlans - db.configBackupPlans.length;
  removed.configBackupRecords = beforeConfigRecords - db.configBackupRecords.length;

  const beforePlans = (db.inspectionPlans || []).length;
  const removedPlanIds = (db.inspectionPlans || []).filter(item => item.assetId === assetId).map(item => item.id);
  db.inspectionPlans = (db.inspectionPlans || []).filter(item => item.assetId !== assetId);
  removed.inspectionPlans = beforePlans - db.inspectionPlans.length;
  // 巡检计划删除后同步清理其到期提醒通知，避免通知中心残留指向已删计划的记录。
  removedPlanIds.forEach(id => removeNotificationsBySource(db, 'inspectionPlan', id));

  const beforeExecutions = (db.inspectionExecutions || []).length;
  db.inspectionExecutions = (db.inspectionExecutions || []).filter(item => item.assetId !== assetId);
  removed.inspectionExecutions = beforeExecutions - db.inspectionExecutions.length;

  const beforeLogs = (db.logs || []).length;
  db.logs = (db.logs || []).filter(item => item.assetId !== assetId);
  removed.logs = beforeLogs - db.logs.length;

  const beforeRelations = (db.assetRelations || []).length;
  const removedRelationIds = (db.assetRelations || [])
    .filter(item => item.sourceAssetId === assetId || item.targetAssetId === assetId)
    .map(item => item.id);
  db.assetRelations = (db.assetRelations || []).filter(item => item.sourceAssetId !== assetId && item.targetAssetId !== assetId);
  removed.relations = beforeRelations - db.assetRelations.length;
  removedRelationIds.forEach(invalidateRelationRuntimeState);

  const beforeAssets = (db.assets || []).length;
  db.assets = (db.assets || []).filter(item => item.id !== assetId);
  removed.assets = beforeAssets - db.assets.length;

  if (db.topologyLayouts && db.topologyLayouts.positions) {
    for (const key of Object.keys(db.topologyLayouts.positions)) {
      const positions = db.topologyLayouts.positions[key];
      if (positions && positions[assetId]) delete positions[assetId];
    }
  }
  invalidateAssetRuntimeState(assetId);
  // 资产维保到期、离线告警等通知标记了 sourceType='asset'，随资产删除一并清理。
  removeNotificationsBySource(db, 'asset', assetId);
  removed.notifications = beforeNotifications - (db.notifications || []).length;
  return removed;
}

// 资产/关系变更后清理运行态监控缓存，避免删除或改配置后仍展示旧主机、旧端口状态。
function invalidateAssetRuntimeState(assetId) {
  if (!assetId) return;
  if (monitorRuntimeState.statuses) delete monitorRuntimeState.statuses[assetId];
  if (monitorRuntimeState.consecutive) {
    for (const key of Object.keys(monitorRuntimeState.consecutive)) {
      if (key === assetId || key.startsWith(`${assetId}:`)) delete monitorRuntimeState.consecutive[key];
    }
  }
  delete snmpMetricCache[assetId];
  delete portStatusCache[assetId];
  const rates = trafficMonitorState.rates || {};
  const prefix = `${assetId}_`;
  for (const key of Object.keys(rates)) {
    if (key === assetId || key.startsWith(prefix)) delete rates[key];
  }
}

function invalidateRelationRuntimeState(relationId) {
  if (!relationId) return;
  delete trafficMonitorState.lastCounters[relationId];
  if (trafficMonitorState.portStatus) delete trafficMonitorState.portStatus[relationId];
}

function resolveCabinetName(asset) {
  const named = String(asset.cabinetName || '').trim();
  if (named) return named;
  const location = String(asset.installationLocation || '').trim();
  if (!location) return '';
  const match = location.match(/([^-\n]*机柜[^-\n]*)/);
  return match ? match[1].trim() : '';
}

function emptySnmpMetrics() {
  return {
    uptimeSeconds: null,
    cpuPercent: null,
    memoryPercent: null,
    diskPercent: null,
    trafficInBps: null,
    trafficOutBps: null,
    collectedAt: null
  };
}

function publicSnmpMetrics(asset) {
  if (!asset || !asset.monitorEnabled || asset.monitorType !== 'snmp') return emptySnmpMetrics();
  const cached = snmpMetricCache[asset.id];
  if (!cached) return emptySnmpMetrics();
  return {
    uptimeSeconds: cached.uptimeSeconds ?? null,
    cpuPercent: cached.cpuPercent ?? null,
    memoryPercent: cached.memoryPercent ?? null,
    diskPercent: cached.diskPercent ?? null,
    trafficInBps: cached.trafficInBps ?? null,
    trafficOutBps: cached.trafficOutBps ?? null,
    collectedAt: cached.collectedAt ?? null
  };
}

function layoutDeviceFromAsset(asset, cabinetName = '') {
  const hasRackSlot = Number.isInteger(asset.rackUnitStart);
  const start = hasRackSlot ? asset.rackUnitStart : 1;
  const size = Number.isInteger(asset.rackUnitSize) && asset.rackUnitSize > 0 ? asset.rackUnitSize : 1;
  const monitor = getMonitorStatus(asset.id);
  return {
    assetId: asset.id,
    name: asset.name || '',
    type: asset.type || '',
    brand: asset.brand || '',
    model: asset.model || '',
    owner: asset.owner || '',
    serialNumber: asset.serialNumber || '',
    maintainExpiryDate: asset.maintainExpiryDate || '',
    installationLocation: asset.installationLocation || '',
    cabinetName,
    hasRackSlot,
    rackUnitStart: start,
    rackUnitSize: size,
    conflict: false,
    conflictColumn: 0,
    conflictCount: 1,
    monitorStatus: asset.monitorEnabled ? ((monitor && monitor.status) || 'unknown') : 'unknown',
    metrics: publicSnmpMetrics(asset)
  };
}

function markLayoutConflicts(devices) {
  // 按起始 U 位扫描出互相重叠的设备簇，再对每个簇做区间分列，
  // 让部分重叠和 3 台以上同区间重叠都能各自占一列。
  const sorted = devices.slice().sort((a, b) => a.rackUnitStart - b.rackUnitStart || a.rackUnitSize - b.rackUnitSize);
  const clusters = [];
  let cluster = null;
  let clusterEnd = -Infinity;
  for (const device of sorted) {
    const end = device.rackUnitStart + device.rackUnitSize - 1;
    if (cluster && device.rackUnitStart <= clusterEnd) {
      cluster.push(device);
      clusterEnd = Math.max(clusterEnd, end);
    } else {
      cluster = [device];
      clusters.push(cluster);
      clusterEnd = end;
    }
  }
  for (const group of clusters) {
    if (group.length < 2) continue;
    const columnEnds = [];
    for (const device of group) {
      const end = device.rackUnitStart + device.rackUnitSize - 1;
      let column = columnEnds.findIndex(columnEnd => columnEnd < device.rackUnitStart);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(end);
      } else {
        columnEnds[column] = end;
      }
      device.conflict = true;
      device.conflictColumn = column;
    }
    group.forEach(device => { device.conflictCount = columnEnds.length; });
  }
}

function buildCabinetLayoutPayload(assets, projectNames = new Map()) {
  const groups = new Map();
  const unassigned = [];
  for (const asset of assets) {
    const cabinet = resolveCabinetName(asset);
    const device = layoutDeviceFromAsset(asset, cabinet);
    if (!cabinet) {
      unassigned.push(device);
      continue;
    }
    // 不同项目可能存在同名机柜，按项目 + 机柜名分组，避免管理员视角被合并。
    const key = `${asset.projectId || ''}\u0000${cabinet}`;
    if (!groups.has(key)) groups.set(key, { name: cabinet, projectId: asset.projectId || '', devices: [] });
    groups.get(key).devices.push(device);
  }
  const entries = [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh', { numeric: true }) || String(a.projectId).localeCompare(String(b.projectId)));
  const multiProject = new Set(entries.map(entry => entry.projectId)).size > 1;
  const cabinets = entries
    .map(entry => {
      const { devices } = entry;
      markLayoutConflicts(devices);
      const maxUnit = devices.reduce((max, item) => Math.max(max, item.rackUnitStart + item.rackUnitSize - 1), 0);
      devices.sort((a, b) => b.rackUnitStart - a.rackUnitStart || a.name.localeCompare(b.name, 'zh', { numeric: true }));
      const projectName = projectNames.get(entry.projectId) || '';
      const label = multiProject && projectName ? `${entry.name} · ${projectName}` : entry.name;
      return {
        name: entry.name,
        label,
        projectId: entry.projectId,
        projectName,
        unitCount: Math.max(DEFAULT_CABINET_UNITS, maxUnit),
        devices
      };
    });
  unassigned.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }));
  return {
    cabinets,
    unassigned,
    monitoring: { lastRunAt: monitorRuntimeState.lastRunAt || null }
  };
}

function sanitizeInspectionPlanForViewer(plan, viewer) {
  if (!plan) return plan;
  if (!viewer || viewer.role !== 'customer') return plan;
  return {
    id: plan.id,
    title: plan.title,
    cycle: plan.cycle,
    nextDate: plan.nextDate,
    status: plan.status,
    projectId: plan.projectId,
    createdAt: plan.createdAt
  };
}

function sanitizeInspectionExecutionForViewer(item, viewer) {
  if (!item) return item;
  if (!viewer || viewer.role !== 'customer') return item;
  return {
    id: item.id,
    planId: item.planId,
    projectId: item.projectId,
    executedAt: item.executedAt,
    result: item.result,
    nextDate: item.nextDate,
    createdAt: item.createdAt
  };
}

function sanitizeChangeRecordForViewer(item, viewer) {
  if (!item) return item;
  if (!viewer || viewer.role !== 'customer') return item;
  return {
    ...item,
    title: '',
    content: '',
    assetId: '',
    rejectionReason: ''
  };
}

// 报表导出复用各列表接口的客户脱敏规则，避免因绕过工具接口而泄露内部字段。
function sanitizeOperationalReportForViewer(report, viewer) {
  if (!report || !viewer || viewer.role !== 'customer') return report;
  return {
    ...report,
    logs: [],
    spareParts: [],
    assets: (report.assets || []).map(item => sanitizeAssetForApi(item, viewer)),
    plans: (report.plans || []).map(item => sanitizeInspectionPlanForViewer(item, viewer)),
    executions: (report.executions || []).map(item => sanitizeInspectionExecutionForViewer(item, viewer)),
    changes: (report.changes || []).map(item => sanitizeChangeRecordForViewer(item, viewer)),
    incidents: (report.incidents || []).map(item => ({ ...item, description: '', resolution: '' })),
    kb: (report.kb || []).map(item => ({
      id: item.id,
      title: item.title,
      category: item.category || '',
      tags: item.tags || '',
      projectId: item.projectId,
      createdAt: item.createdAt,
      createdBy: item.createdBy
    }))
  };
}

const DOCUMENT_SECRET_FIELDS = ['accessPasswordHash', 'loginPasswordHash', 'loginPasswordEncrypted', 'attachmentPath'];
const DOCUMENT_PROTECTED_FIELDS = ['serialNumber', 'managementIp', 'managementPort', 'loginAccount', 'managementMethod'];

function readDocumentAccessToken(req) {
  return String(req.headers['x-document-access-token'] || '').trim();
}

function verifyDocumentAccessToken(rawToken, docId, userId) {
  if (!rawToken) return { ok: false, message: '访问令牌无效' };
  try {
    const decoded = Buffer.from(rawToken, 'base64url').toString('utf8');
    const lastColon = decoded.lastIndexOf(':');
    if (lastColon === -1) return { ok: false, message: '访问令牌无效' };
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expectedSig = crypto.createHmac('sha256', DOCUMENT_TOKEN_SECRET).update(payload).digest('hex');
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return { ok: false, message: '访问令牌无效' };
    }
    const parts = payload.split(':');
    if (parts[0] !== docId || parts[1] !== userId) return { ok: false, message: '访问令牌与资料不匹配' };
    const tokenTime = parseInt(parts[2], 10);
    if (nowMs() - tokenTime > 10 * 60 * 1000) return { ok: false, message: '访问链接已过期，请重新验证密码' };
    return { ok: true };
  } catch (_) {
    return { ok: false, message: '访问令牌无效' };
  }
}

function sanitizeDocumentForApi(doc, revealProtected = false) {
  const sanitized = { ...doc };
  DOCUMENT_SECRET_FIELDS.forEach(key => { delete sanitized[key]; });
  if (!revealProtected) {
    DOCUMENT_PROTECTED_FIELDS.forEach(key => { delete sanitized[key]; });
  }
  return sanitized;
}

function getNotificationReadAtForUser(item, userId) {
  const map = item && item.readBy && typeof item.readBy === 'object' ? item.readBy : {};
  return map[userId] || '';
}

// 知识库每次内容变更都留一份不可变快照，用于版本对比与回滚展示。
function snapshotKbRevision(db, item, action, user, note = '') {
  db.kbRevisions = db.kbRevisions || [];
  const revision = {
    id: id('kbRev'),
    kbId: item.id,
    projectId: item.projectId || '',
    version: Math.max(1, Number(item.version || 1)),
    action,
    title: item.title || '',
    keywords: item.keywords || '',
    problem: item.problem || '',
    solution: item.solution || '',
    content: item.content || '',
    category: item.category || '',
    tags: Array.isArray(item.tags) ? item.tags.slice() : (item.tags || ''),
    note: String(note || '').slice(0, 500),
    operatorId: user ? user.id : '',
    operatorName: user ? (user.name || user.username || '') : '',
    createdAt: now()
  };
  db.kbRevisions.push(revision);
  return revision;
}

// 合同维度汇总：签约额、已开票、已回款、成本与毛利均按结算明细累计。
function summarizeContract(contract, settlements) {
  const rows = (settlements || []).filter(item => item.contractId === contract.id);
  const invoiceAmount = rows.reduce((sum, item) => sum + normalizeMoney(item.invoiceAmount), 0);
  const receivedAmount = rows.reduce((sum, item) => sum + normalizeMoney(item.receivedAmount), 0);
  const costAmount = rows.reduce((sum, item) => sum + normalizeMoney(item.costAmount), 0);
  const contractAmount = normalizeMoney(contract.amount);
  const grossProfit = normalizeMoney(receivedAmount - costAmount);
  return {
    contractAmount,
    invoiceAmount: normalizeMoney(invoiceAmount),
    receivedAmount: normalizeMoney(receivedAmount),
    costAmount: normalizeMoney(costAmount),
    grossProfit,
    grossMargin: receivedAmount > 0 ? Math.round((grossProfit / receivedAmount) * 1000) / 10 : 0,
    uninvoicedAmount: normalizeMoney(contractAmount - invoiceAmount),
    unreceivedAmount: normalizeMoney(invoiceAmount - receivedAmount),
    settlementCount: rows.length
  };
}

// 通知的已读/隐藏状态是按用户 id 存储的映射，归一化时只保留合法的字符串键值。
function sanitizeNotificationUserStampMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const result = {};
  for (const [key, value] of Object.entries(map)) {
    if (!key || typeof value !== 'string') continue;
    result[key] = value;
  }
  return result;
}

function markNotificationReadForUser(item, userId) {
  item.readBy = item.readBy && typeof item.readBy === 'object' ? item.readBy : {};
  if (!item.readBy[userId]) item.readBy[userId] = now();
  item._dirty = true;
  return item.readBy[userId];
}

function presentNotification(item, user) {
  const userId = user && typeof user === 'object' ? user.id : user;
  const { readBy, hiddenBy, _dirty, ...rest } = item;
  const presented = { ...rest, readAt: getNotificationReadAtForUser(item, userId) };
  if (user && typeof user === 'object' && user.role === 'customer') {
    presented.content = redactNetworkDetails(String(presented.content || '').replace(/\s*\([^)]*\)/, ''));
  }
  return presented;
}

function buildAiInspectionAnalysis(category, metrics, realData = null) {
  let score = 100;
  const abnormalItems = [];
  let level = '正常';
  for (const item of metrics) {
    const value = (realData && realData[item.label] !== undefined && Number.isFinite(realData[item.label])) ? realData[item.label] : item.value;
    if (!Number.isFinite(value)) {
      score -= 10;
      if (level === '正常') level = '关注';
      abnormalItems.push(`${item.label} 缺少有效数值`);
      continue;
    }
    const criticalHit = item.direction === 'low' ? value <= item.critical : value >= item.critical;
    const warnHit = item.direction === 'low' ? value <= item.warn : value >= item.warn;
    if (criticalHit) {
      score -= 35;
      level = '严重';
      abnormalItems.push(`${item.label}=${value}${item.unit} 已达到严重阈值`);
      continue;
    }
    if (warnHit) {
      score -= 20;
      if (level !== '严重') level = '异常';
      abnormalItems.push(`${item.label}=${value}${item.unit} 已达到告警阈值`);
    }
  }
  score = Math.max(0, score);
  const summaryMap = {
    server: '系统资源与关键服务状态已完成分析',
    network: '网络设备转发与接口健康状态已完成分析',
    security: '安全设备会话与防护能力状态已完成分析'
  };
  const riskMap = {
    正常: '当前巡检对象运行平稳，短期内未见明显风险。',
    关注: '当前巡检对象存在轻微波动，建议持续关注趋势变化。',
    异常: '当前巡检对象存在可见异常，建议尽快安排排查和复检。',
    严重: '当前巡检对象存在高风险异常，建议立即处理并启动升级通报。'
  };
  const suggestionMap = {
    server: '建议检查系统资源占用、清理无效进程、核对关键服务与日志状态。',
    network: '建议检查接口质量、链路丢包、主备状态与近期配置变更。',
    security: '建议检查会话容量、策略命中、特征库更新和授权有效期。'
  };
  const summary = abnormalItems.length
    ? `${summaryMap[category] || summaryMap.server}，发现 ${abnormalItems.length} 项关注点。`
    : `${summaryMap[category] || summaryMap.server}，所有关键指标处于正常范围。`;
  return {
    score,
    level,
    abnormalItems,
    summary,
    risk: riskMap[level],
    suggestion: suggestionMap[category] || suggestionMap.server
  };
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
function resolveRuntimeEncryptionKey() {
  const fromEnv = String(process.env.ENCRYPTION_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const keyPath = path.join(dataDir, 'encryption.key');
  try {
    if (fs.existsSync(keyPath)) {
      const stored = String(fs.readFileSync(keyPath, 'utf8') || '').trim();
      if (stored.length >= 32) return stored;
    }
  } catch (error) {
    console.warn('读取 encryption.key 失败:', error.message);
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(keyPath, generated, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.warn('写入 encryption.key 失败:', error.message);
  }
  return generated;
}
const RUNTIME_ENCRYPTION_KEY = resolveRuntimeEncryptionKey();
// 文档令牌密钥与凭据加密密钥分开：未显式配置时从运行时密钥派生独立子密钥，
// 避免同一密钥同时用于加密和签名，且不影响启动（已有令牌会失效，需重新打开文档）。
const DOCUMENT_TOKEN_SECRET = (() => {
  const fromEnv = String(process.env.DOCUMENT_TOKEN_SECRET || '').trim();
  if (fromEnv.length >= 32) return fromEnv;
  if (fromEnv) console.warn('WARNING: DOCUMENT_TOKEN_SECRET 长度不足 32 位，已改用派生密钥。');
  return crypto.pbkdf2Sync(RUNTIME_ENCRYPTION_KEY, 'document-token-static-salt', 100000, 32, 'sha256').toString('hex');
})();
const DOCUMENT_TYPES = ['device', 'topology', 'layout', 'proposal', 'config', 'contract', 'acceptance'];
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY) {
  console.warn('WARNING: ENCRYPTION_KEY 环境变量未设置，已使用 data/encryption.key 持久化运行时密钥。生产环境请显式设置 ENCRYPTION_KEY。');
}

function getEncryptionKey() {
  return crypto.pbkdf2Sync(RUNTIME_ENCRYPTION_KEY, 'aes-gcm-static-salt', 100000, 32, 'sha256');
}

function encryptCredential(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptCredential(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext || '';
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---- TOTP 动态令牌（RFC 6238，零外部依赖）----
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW_STEPS = 1;
const TOTP_SECRET_BYTES = 20;
const TOTP_RECOVERY_CODE_COUNT = 10;
const TOTP_LABEL = '驻场运维管理系统';
const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TWO_FACTOR_CHALLENGE_MAX_ATTEMPTS = 5;
const TWO_FACTOR_CHALLENGE_LIMIT = 2000;
const twoFactorChallenges = new Map();
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// 恢复码本身是 80 位随机串，用 HMAC 做不可逆摘要即可，避免每次校验跑多轮 scrypt。
const RECOVERY_CODE_HASH_KEY = crypto.pbkdf2Sync(RUNTIME_ENCRYPTION_KEY, 'totp-recovery-static-salt', 100000, 32, 'sha256');

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const cleaned = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

function buildTotpAt(secret, counter) {
  const key = base32Decode(secret);
  if (!key.length) return '';
  const movingFactor = Buffer.alloc(8);
  movingFactor.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  movingFactor.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', key).update(movingFactor).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

function matchTotpCounter(secret, code, atMs = nowMs()) {
  const candidate = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  // 允许前后各一个时间步，容忍客户端与服务端之间的时钟漂移。
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const expected = buildTotpAt(secret, counter + offset);
    if (expected.length === candidate.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
      return counter + offset;
    }
  }
  return null;
}

// 同一用途下，同一时间步的动态码只允许成功使用一次，避免被截获后在有效窗口内重放。
// 按用途分桶：启用 2FA 后立刻登录、登录后立刻关闭 2FA 都会复用同一个 30 秒动态码，
// 跨用途共用计数会让这类正常操作失败。
const totpLastUsedCounter = new Map();

function consumeTotpCode(user, secret, code, scope = 'default') {
  const counter = matchTotpCounter(secret, code);
  if (counter === null) return false;
  const key = `${scope}:${user && user.id ? user.id : 'anonymous'}:${String(secret).slice(-8)}`;
  const lastUsed = totpLastUsedCounter.get(key);
  if (Number.isFinite(lastUsed) && counter <= lastUsed) return false;
  totpLastUsedCounter.set(key, counter);
  if (totpLastUsedCounter.size > 5000) {
    const cutoff = Math.floor(nowMs() / 1000 / TOTP_STEP_SECONDS) - 10;
    for (const [entryKey, value] of totpLastUsedCounter) {
      if (value < cutoff) totpLastUsedCounter.delete(entryKey);
    }
  }
  return true;
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function hashRecoveryCode(code) {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return '';
  return crypto.createHmac('sha256', RECOVERY_CODE_HASH_KEY).update(`totp-recovery:${normalized}`).digest('hex');
}

function generateRecoveryCodes(count = TOTP_RECOVERY_CODE_COUNT) {
  const codes = [];
  for (let index = 0; index < count; index += 1) {
    const raw = base32Encode(crypto.randomBytes(10));
    codes.push(`${raw.slice(0, 8)}-${raw.slice(8, 16)}`);
  }
  return codes;
}

function buildTotpOtpauthUrl(username, secret) {
  const label = encodeURIComponent(`${TOTP_LABEL}:${username || 'user'}`);
  const issuer = encodeURIComponent(TOTP_LABEL);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

function readUserTotpSecret(user) {
  if (!user || !user.twoFactorSecret) return '';
  try {
    return decryptCredential(user.twoFactorSecret);
  } catch (error) {
    // 加密密钥轮换后旧密文无法解密，必须按失败处理而不是放行登录。
    console.warn('动态令牌密钥解密失败:', error.message);
    return '';
  }
}

function readPendingTotpSecret(user) {
  if (!user || !user.twoFactorPendingSecret) return '';
  try {
    return decryptCredential(user.twoFactorPendingSecret);
  } catch (error) {
    console.warn('待确认动态令牌密钥解密失败:', error.message);
    return '';
  }
}

// LDAP 账号的本地密码是系统随机生成的占位值，二次确认必须回到 LDAP 服务器校验域账号密码。
async function verifyTwoFactorPassword(user, password) {
  const username = String(user?.username || '');
  if (username.startsWith('ldap_')) {
    const ldapUsername = username.slice('ldap_'.length);
    const { ldapUrl, ldapBaseDn, ldapBindDn, ldapBindPassword } = getLdapConfig();
    if (!ldapUrl || !ldapUsername || !password) return false;
    try {
      const result = await ldapAuthenticate(ldapUrl, ldapBaseDn, ldapBindDn, ldapBindPassword, ldapUsername, String(password));
      return Boolean(result);
    } catch (error) {
      console.warn('LDAP 二次确认失败:', error.message);
      return false;
    }
  }
  return verifyPassword(String(password || ''), user?.passwordHash);
}

function consumeRecoveryCode(user, code) {
  const hashes = Array.isArray(user?.twoFactorRecoveryCodeHashes) ? user.twoFactorRecoveryCodeHashes : [];
  const candidate = hashRecoveryCode(code);
  if (!candidate) return false;
  const index = hashes.findIndex(item => {
    const stored = String(item || '');
    return stored.length === candidate.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(candidate));
  });
  if (index < 0) return false;
  // 恢复码一次性使用，命中后立即从列表移除。
  hashes.splice(index, 1);
  user.twoFactorRecoveryCodeHashes = hashes;
  return true;
}

function pruneTwoFactorChallenges() {
  const current = nowMs();
  for (const [token, entry] of twoFactorChallenges) {
    if (!entry || entry.expiresAt <= current) twoFactorChallenges.delete(token);
  }
  while (twoFactorChallenges.size > TWO_FACTOR_CHALLENGE_LIMIT) {
    const oldest = twoFactorChallenges.keys().next();
    if (oldest.done) break;
    twoFactorChallenges.delete(oldest.value);
  }
}

function createTwoFactorChallenge(userId, req) {
  pruneTwoFactorChallenges();
  const challengeToken = crypto.randomBytes(24).toString('hex');
  twoFactorChallenges.set(challengeToken, {
    userId,
    clientIp: getRequestClientIp(req),
    expiresAt: nowMs() + TWO_FACTOR_CHALLENGE_TTL_MS,
    attempts: 0
  });
  return challengeToken;
}

function getTwoFactorChallenge(challengeToken, req) {
  const token = String(challengeToken || '').trim();
  if (!token) return null;
  const entry = twoFactorChallenges.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs() || entry.clientIp !== getRequestClientIp(req)) {
    twoFactorChallenges.delete(token);
    return null;
  }
  return entry;
}

function clearTwoFactorFields(user) {
  user.twoFactorEnabled = false;
  user.twoFactorSecret = '';
  user.twoFactorPendingSecret = '';
  user.twoFactorRecoveryCodeHashes = [];
  user.twoFactorEnabledAt = '';
}

// 关闭 2FA、重生成恢复码等自助操作此前可无限次尝试 6 位动态码，
// LDAP 账号还会跳过密码复核，必须按账号限制失败次数。
const twoFactorVerifyFailures = new Map();
const TWO_FACTOR_VERIFY_MAX_FAILURES = 5;
const TWO_FACTOR_VERIFY_LOCK_MS = 5 * 60 * 1000;

function getTwoFactorVerifyLockState(user) {
  const entry = twoFactorVerifyFailures.get(user && user.id);
  if (!entry || !entry.lockedUntil) return { locked: false, retryAfterMs: 0 };
  if (entry.lockedUntil <= nowMs()) {
    twoFactorVerifyFailures.delete(user.id);
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - nowMs() };
}

function recordTwoFactorVerifyFailure(user) {
  if (!user || !user.id) return;
  const current = nowMs();
  const entry = twoFactorVerifyFailures.get(user.id) || { count: 0, firstAt: current, lockedUntil: 0 };
  if (current - entry.firstAt > TWO_FACTOR_VERIFY_LOCK_MS) {
    entry.count = 0;
    entry.firstAt = current;
  }
  entry.count += 1;
  if (entry.count >= TWO_FACTOR_VERIFY_MAX_FAILURES) entry.lockedUntil = current + TWO_FACTOR_VERIFY_LOCK_MS;
  twoFactorVerifyFailures.set(user.id, entry);
}

function clearTwoFactorVerifyFailures(user) {
  if (user && user.id) twoFactorVerifyFailures.delete(user.id);
}

// 已登录会话仍可能被他人接管；改密与动态令牌管理在复核当前密码时同样需要失败次数限制。
const passwordReauthFailures = new Map();
const PASSWORD_REAUTH_MAX_FAILURES = 5;
const PASSWORD_REAUTH_WINDOW_MS = 15 * 60 * 1000;

function getPasswordReauthLockState(user) {
  const entry = passwordReauthFailures.get(user && user.id);
  if (!entry || !entry.lockedUntil) return { locked: false, retryAfterMs: 0 };
  if (entry.lockedUntil <= nowMs()) {
    passwordReauthFailures.delete(user.id);
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - nowMs() };
}

function recordPasswordReauthFailure(user) {
  if (!user || !user.id) return;
  const current = nowMs();
  const entry = passwordReauthFailures.get(user.id) || { count: 0, firstAt: current, lockedUntil: 0 };
  if (current - entry.firstAt > PASSWORD_REAUTH_WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = current;
  }
  entry.count += 1;
  if (entry.count >= PASSWORD_REAUTH_MAX_FAILURES) entry.lockedUntil = current + PASSWORD_REAUTH_WINDOW_MS;
  passwordReauthFailures.set(user.id, entry);
}

function clearPasswordReauthFailures(user) {
  if (user && user.id) passwordReauthFailures.delete(user.id);
}

function validateHost(host) {
  if (!host || typeof host !== 'string') return false;
  return /^[a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9]$/.test(host) || /^[a-fA-F0-9:]+$/.test(host);
}

function validatePort(port) {
  const num = Number(port);
  return Number.isInteger(num) && num >= 1 && num <= 65535;
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((sum, part) => (sum << 8) + Number(part), 0) >>> 0;
}

function extractIpv4FromMapped(ip) {
  const raw = String(ip || '').trim().toLowerCase();
  if (!raw.startsWith('::ffff:')) return '';
  const rest = raw.slice(7);
  if (net.isIP(rest) === 4) return rest;
  const parts = rest.split(':');
  if (parts.length === 2 && parts.every(part => /^[0-9a-f]{1,4}$/.test(part))) {
    const hi = parseInt(parts[0], 16);
    const lo = parseInt(parts[1], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return '';
}

function isPrivateOrReservedIp(ip) {
  const mappedV4 = extractIpv4FromMapped(ip);
  if (mappedV4) return isPrivateOrReservedIp(mappedV4);
  if (net.isIP(ip) === 4) {
    const value = ipv4ToInt(ip);
    const ranges = [
      ['0.0.0.0', '0.255.255.255'],
      ['10.0.0.0', '10.255.255.255'],
      ['100.64.0.0', '100.127.255.255'],
      ['127.0.0.0', '127.255.255.255'],
      ['169.254.0.0', '169.254.255.255'],
      ['172.16.0.0', '172.31.255.255'],
      ['192.0.0.0', '192.0.0.255'],
      ['192.0.2.0', '192.0.2.255'],
      ['192.168.0.0', '192.168.255.255'],
      ['198.18.0.0', '198.19.255.255'],
      ['198.51.100.0', '198.51.100.255'],
      ['203.0.113.0', '203.0.113.255'],
      ['224.0.0.0', '239.255.255.255'],
      ['240.0.0.0', '255.255.255.255']
    ];
    return ranges.some(([start, end]) => value >= ipv4ToInt(start) && value <= ipv4ToInt(end));
  }
  if (net.isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('ff')
      || normalized.startsWith('2001:db8:')
      || normalized.startsWith('2001:0db8:')
      || normalized.startsWith('2001::')
      || normalized.startsWith('2001:0:')
      || normalized.startsWith('2002:')
      || normalized === '64:ff9b::'
      || normalized.startsWith('64:ff9b::');
  }
  return true;
}

function isBlockedSsrfIp(ip) {
  const mappedV4 = extractIpv4FromMapped(ip);
  if (mappedV4) return isBlockedSsrfIp(mappedV4);
  if (net.isIP(ip) === 4) {
    const value = ipv4ToInt(ip);
    const ranges = [
      ['0.0.0.0', '0.255.255.255'],
      ['100.64.0.0', '100.127.255.255'],
      ['127.0.0.0', '127.255.255.255'],
      ['169.254.0.0', '169.254.255.255'],
      ['192.0.0.0', '192.0.0.255'],
      ['192.0.2.0', '192.0.2.255'],
      ['198.18.0.0', '198.19.255.255'],
      ['198.51.100.0', '198.51.100.255'],
      ['203.0.113.0', '203.0.113.255'],
      ['224.0.0.0', '239.255.255.255'],
      ['240.0.0.0', '255.255.255.255']
    ];
    return ranges.some(([start, end]) => value >= ipv4ToInt(start) && value <= ipv4ToInt(end));
  }
  if (net.isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('ff')
      || normalized.startsWith('2001:db8:')
      || normalized.startsWith('2001:0db8:');
  }
  return true;
}

function isLoopbackIp(ip) {
  const mapped = extractIpv4FromMapped(ip);
  if (mapped) return isLoopbackIp(mapped);
  if (net.isIP(ip) === 4) {
    const value = ipv4ToInt(ip);
    return value >= ipv4ToInt('127.0.0.1') && value <= ipv4ToInt('127.255.255.255');
  }
  if (net.isIP(ip) === 6) return String(ip).trim().toLowerCase() === '::1';
  return false;
}

function ipv6ToBuffer(ip) {
  const raw = String(ip || '').trim().toLowerCase().split('%')[0];
  if (net.isIP(raw) !== 6) return null;
  const buffer = Buffer.alloc(16);
  const doubleIndex = raw.indexOf('::');
  const head = doubleIndex === -1 ? raw : raw.slice(0, doubleIndex);
  const tail = doubleIndex === -1 ? '' : raw.slice(doubleIndex + 2);
  const parseGroups = segment => {
    const groups = [];
    if (!segment) return groups;
    for (const part of segment.split(':')) {
      if (!part) return null;
      if (part.includes('.')) {
        if (net.isIP(part) !== 4) return null;
        const value = ipv4ToInt(part);
        groups.push(value >>> 16, value & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        groups.push(parseInt(part, 16));
      }
    }
    return groups;
  };
  const headGroups = parseGroups(head);
  const tailGroups = parseGroups(tail);
  if (!headGroups || !tailGroups) return null;
  if (doubleIndex === -1) {
    if (headGroups.length !== 8) return null;
    headGroups.forEach((value, index) => buffer.writeUInt16BE(value, index * 2));
    return buffer;
  }
  if (headGroups.length + tailGroups.length > 7) return null;
  headGroups.forEach((value, index) => buffer.writeUInt16BE(value, index * 2));
  tailGroups.forEach((value, index) => buffer.writeUInt16BE(value, 16 - (tailGroups.length - index) * 2));
  return buffer;
}

function isValidMonitorAllowlistEntry(entry) {
  if (!entry) return false;
  if (net.isIP(entry)) return true;
  const slash = entry.indexOf('/');
  if (slash !== -1) {
    const base = entry.slice(0, slash);
    const family = net.isIP(base);
    const prefix = Number(entry.slice(slash + 1));
    if (family === 4) return Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
    if (family === 6) return Number.isInteger(prefix) && prefix >= 0 && prefix <= 128;
    return false;
  }
  return /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(entry);
}

// 解析管理员配置的巡检目标白名单：支持 IP、CIDR 与主机名（可用 *.example.com 通配子域）。
function parseMonitorAllowlist(raw) {
  const source = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[\n,;]+/);
  const entries = [];
  const seen = new Set();
  for (const item of source) {
    const entry = String(item || '').trim().toLowerCase().replace(/\.$/, '');
    if (!entry || seen.has(entry) || !isValidMonitorAllowlistEntry(entry)) continue;
    seen.add(entry);
    entries.push(entry);
  }
  return entries;
}

// 保存配置时校验：返回首个无法识别的白名单条目，供接口直接拒绝并提示。
function findInvalidMonitorAllowlistEntry(raw) {
  const source = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[\n,;]+/);
  for (const item of source) {
    const entry = String(item || '').trim().toLowerCase().replace(/\.$/, '');
    if (!entry) continue;
    if (!isValidMonitorAllowlistEntry(entry)) return entry;
  }
  return '';
}

function ipMatchesAllowlistEntry(ip, entry) {
  const target = extractIpv4FromMapped(ip) || String(ip || '').trim().toLowerCase();
  const raw = String(entry || '').trim().toLowerCase();
  if (!target || !raw) return false;
  const slash = raw.indexOf('/');
  if (slash === -1) {
    const family = net.isIP(raw);
    if (family === 4) return net.isIP(target) === 4 && ipv4ToInt(target) === ipv4ToInt(raw);
    if (family === 6) {
      const a = ipv6ToBuffer(target);
      const b = ipv6ToBuffer(raw);
      return Boolean(a && b && a.equals(b));
    }
    return false;
  }
  const base = raw.slice(0, slash);
  const prefix = Number(raw.slice(slash + 1));
  const family = net.isIP(base);
  if (family === 4) {
    if (net.isIP(target) !== 4) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((ipv4ToInt(target) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  }
  if (family === 6) {
    if (net.isIP(target) !== 6) return false;
    const targetBuffer = ipv6ToBuffer(target);
    const baseBuffer = ipv6ToBuffer(base);
    if (!targetBuffer || !baseBuffer) return false;
    let bits = prefix;
    for (let i = 0; i < 16 && bits > 0; i += 1) {
      const take = Math.min(8, bits);
      const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff;
      if ((targetBuffer[i] & mask) !== (baseBuffer[i] & mask)) return false;
      bits -= take;
    }
    return true;
  }
  return false;
}

function hostMatchesAllowlistEntry(host, entry) {
  const name = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  const raw = String(entry || '').trim().toLowerCase().replace(/\.$/, '');
  if (!name || !raw) return false;
  if (raw.startsWith('*.')) return name.endsWith(raw.slice(1)) && name.length > raw.length - 1;
  return name === raw;
}

// 单项目标判定：先封禁特殊地址，再按白名单收窄（白名单为空表示内网私网默认放行）。
function evaluateMonitorTarget(host, ip, entries, allowLoopback) {
  if (allowLoopback && isLoopbackIp(ip)) return { allowed: true };
  if (isBlockedSsrfIp(ip)) {
    return { allowed: false, message: `目标地址 ${ip} 属于禁止探测的特殊地址（回环、链路本地、组播或保留段）` };
  }
  if (!entries.length) return { allowed: true };
  const matched = entries.some(entry => (net.isIP(entry) || entry.includes('/'))
    ? ipMatchesAllowlistEntry(ip, entry)
    : hostMatchesAllowlistEntry(host, entry));
  if (!matched) {
    return { allowed: false, message: `目标地址 ${host} 不在巡检目标白名单内，请先在系统设置中放行` };
  }
  return { allowed: true };
}

let monitorTargetPolicy = { entries: [], allowLoopback: !isProduction };

function refreshMonitorTargetPolicy(systemConfig) {
  const normalized = normalizeSystemConfig(systemConfig || {});
  monitorTargetPolicy = {
    entries: parseMonitorAllowlist(normalized.monitorTargetAllowlist),
    allowLoopback: !isProduction
  };
}

// 解析目标地址并校验每个解析结果；连接前调用可防 DNS rebinding 与配置绕过。
async function resolveMonitorTargetAddress(host) {
  const raw = String(host || '').trim();
  if (!validateHost(raw)) return { ok: false, message: '目标地址格式无效' };
  const literalFamily = net.isIP(raw);
  let ips = [];
  if (literalFamily) {
    ips = [raw];
  } else {
    try {
      const records = await dns.lookup(raw, { all: true });
      ips = records.map(record => record.address);
    } catch (_) {
      return { ok: false, message: '目标地址无法解析' };
    }
  }
  if (!ips.length) return { ok: false, message: '目标地址无法解析' };
  for (const ip of ips) {
    const verdict = evaluateMonitorTarget(raw, ip, monitorTargetPolicy.entries, monitorTargetPolicy.allowLoopback);
    if (!verdict.allowed) return { ok: false, message: verdict.message };
  }
  return { ok: true, ips, address: ips[0] };
}

// 出站请求前的目标校验：仅允许 HTTP/HTTPS、禁止内嵌凭据、要求地址与巡检对象一致，
// 并封禁回环、链路本地/云元数据、组播、保留段与 IPv6 ULA 等特殊地址。
// 返回已校验的 DNS 解析结果，供连接阶段固定使用，避免校验后再解析导致的 rebinding。
async function resolveValidatedHttpTarget(url, expectedHost) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许 HTTP/HTTPS 地址');
  if (url.username || url.password) throw new Error('备份地址禁止包含用户名或密码');
  if (url.hostname !== expectedHost) throw new Error('Web 备份地址必须与巡检对象地址一致');
  const literalFamily = net.isIP(url.hostname);
  const records = literalFamily ? [{ address: url.hostname, family: literalFamily }] : await dns.lookup(url.hostname, { all: true });
  const allowLocalTestTarget = !isProduction && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!allowLocalTestTarget && (!records.length || records.some(record => isBlockedSsrfIp(record.address)))) {
    throw new Error('Web 备份地址指向受限网络');
  }
  if (!allowLocalTestTarget) {
    for (const record of records) {
      const verdict = evaluateMonitorTarget(url.hostname, record.address, monitorTargetPolicy.entries, monitorTargetPolicy.allowLoopback);
      if (!verdict.allowed) throw new Error(verdict.message || 'Web 备份地址不在巡检目标白名单内');
    }
  }
  return records[0];
}

function pinnedLookup(pinned) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (typeof done === 'function') done(null, pinned.address, pinned.family);
  };
}

// 使用已固定的解析结果发起请求，不自动跟随重定向，并按上限截断响应体。
function requestPinnedUrl(url, pinned, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const maxBytes = options.maxBytes || 1024 * 1024;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      lookup: pinnedLookup(pinned),
      timeout: options.timeoutMs || 10000
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers || {}, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function probeHostReachable(host) {
  const gate = await resolveMonitorTargetAddress(host);
  if (!gate.ok) return { reachable: false, latency: null };
  return new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', '2', gate.address], { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve({ reachable: false, latency: null });
      const match = stdout.match(/time=([\d.]+)\s*ms/);
      const latency = match ? parseFloat(match[1]) : null;
      resolve({ reachable: true, latency });
    });
  });
}

async function probePortOpen(host, port) {
  if (!validatePort(port)) return { open: false };
  const gate = await resolveMonitorTargetAddress(host);
  if (!gate.ok) return { open: false };
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: gate.address, port: Number(port), timeout: 3000 });
    let settled = false;
    const finish = open => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ open });
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function sshRuntimeDir() {
  const dir = path.join(dataDir, 'ssh-runtime');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
  return dir;
}

function sshKnownHostsPath() {
  return path.join(sshRuntimeDir(), 'known_hosts');
}

function hostKeyAlreadyKnown(host, port) {
  try {
    const text = fs.readFileSync(sshKnownHostsPath(), 'utf8');
    const marker = Number(port) === 22 ? host : `[${host}]:${port}`;
    return text.includes(marker);
  } catch (_) {
    return false;
  }
}

function sshMinimalEnv(extra = {}) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: sshRuntimeDir(),
    LANG: process.env.LANG || 'C',
    ...extra
  };
}

function ensureSshKnownHost(host, port) {
  return new Promise((resolve, reject) => {
    if (hostKeyAlreadyKnown(host, port)) return resolve();
    if (isProduction) {
      return reject(new Error('目标主机指纹未登记，请先将主机公钥写入 data/ssh-runtime/known_hosts'));
    }
    execFile('ssh-keyscan', ['-p', String(port), '-T', '4', host], { timeout: 8000, maxBuffer: 1024 * 1024, env: sshMinimalEnv() }, (error, stdout) => {
      if (!error && stdout && String(stdout).trim()) {
        fs.appendFileSync(sshKnownHostsPath(), stdout.endsWith('\n') ? stdout : `${stdout}\n`, { mode: 0o600 });
      }
      resolve();
    });
  });
}

function executeSSHCheck(host, port, username, secret, options = {}) {
  if (!validateHost(host) || !validatePort(port)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid host or port' });
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(username)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid username' });
  // 连接前再次校验目标地址，避免白名单配置被绕过或出现 DNS rebinding。
  const gate = resolveMonitorTargetAddress(host).then(result => result.ok
    ? null
    : { success: false, stdout: '', stderr: result.message || '目标地址不允许探测' });
  return gate.then(blocked => {
    if (blocked) return blocked;
    return runSshCheck(host, port, username, secret, options);
  });
}

function runSshCheck(host, port, username, secret, options = {}) {
  return new Promise(resolve => {
    const keyFile = path.join(sshRuntimeDir(), `key-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
    const knownHosts = sshKnownHostsPath();
    const cleanup = () => { fs.unlink(keyFile, () => {}); };
    const run = () => {
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=yes',
        '-o', `UserKnownHostsFile=${knownHosts}`,
        '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=5',
        '-p', String(port),
        `${username}@${host}`,
        'uptime && df -h && free'
      ];
      let executable = 'ssh';
      let args = sshArgs;
      const execEnv = sshMinimalEnv();
      if (options.privateKey) {
        fs.writeFileSync(keyFile, secret || '', { mode: 0o600 });
        args = ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', keyFile, ...sshArgs];
      } else {
        executable = 'sshpass';
        execEnv.SSHPASS = secret || '';
        args = ['-e', 'ssh', '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no', ...sshArgs];
      }
      execFile(executable, args, { timeout: 15000, maxBuffer: 1024 * 1024, env: execEnv }, (error, stdout, stderr) => {
        cleanup();
        if (error) return resolve({ success: false, stdout: '', stderr: stderr || error.message });
        resolve({ success: true, stdout: stdout || '', stderr: '' });
      });
    };
    ensureSshKnownHost(host, port).then(run).catch(error => resolve({ success: false, stdout: '', stderr: error.message || '主机指纹未登记' }));
  });
}

let snmpNativeModule = undefined;
function loadSnmpNative() {
  if (snmpNativeModule !== undefined) return snmpNativeModule;
  try {
    snmpNativeModule = require('snmp-native');
  } catch (_) {
    snmpNativeModule = null;
  }
  return snmpNativeModule;
}

function berEncodeLength(len) {
  if (len < 128) return Buffer.from([len]);
  if (len < 256) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function berTlv(tag, value) {
  const v = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([Buffer.from([tag]), berEncodeLength(v.length), v]);
}

function berInt(n) {
  let value = Number(n) || 0;
  if (value === 0) return berTlv(0x02, Buffer.from([0]));
  const bytes = [];
  let remaining = value < 0 ? value >>> 0 : value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return berTlv(0x02, Buffer.from(bytes));
}

function berOid(oid) {
  const ids = oid.map(n => Number(n));
  const out = [40 * ids[0] + ids[1]];
  for (let i = 2; i < ids.length; i += 1) {
    let n = ids[i];
    const stack = [n & 0x7f];
    n = Math.floor(n / 128);
    while (n > 0) {
      stack.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    while (stack.length) out.push(stack.pop());
  }
  return berTlv(0x06, Buffer.from(out));
}

function encodeSnmpPdu(community, requestId, oid, pduTag) {
  const varbind = berTlv(0x30, Buffer.concat([berOid(oid), Buffer.from([0x05, 0x00])]));
  const varbindList = berTlv(0x30, varbind);
  const pdu = berTlv(pduTag, Buffer.concat([berInt(requestId), berInt(0), berInt(0), varbindList]));
  const body = Buffer.concat([berInt(1), berTlv(0x04, Buffer.from(String(community || 'public'), 'latin1')), pdu]);
  return berTlv(0x30, body);
}

function encodeSnmpGetNext(community, requestId, oid) {
  return encodeSnmpPdu(community, requestId, oid, 0xa1);
}

function encodeSnmpGet(community, requestId, oid) {
  return encodeSnmpPdu(community, requestId, oid, 0xa0);
}

function decodeBerLength(buf, offset) {
  const first = buf[offset];
  if (first < 128) return { length: first, size: 1 };
  const count = first & 0x7f;
  let length = 0;
  for (let i = 0; i < count; i += 1) length = (length << 8) + buf[offset + 1 + i];
  return { length, size: 1 + count };
}

function decodeBerOid(buf) {
  if (!buf.length) return [];
  const first = buf[0];
  const oid = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let i = 1; i < buf.length; i += 1) {
    value = (value << 7) + (buf[i] & 0x7f);
    if ((buf[i] & 0x80) === 0) {
      oid.push(value);
      value = 0;
    }
  }
  return oid;
}

function oidStartsWith(oid, prefix) {
  return prefix.every((part, index) => oid[index] === part);
}

function parseSnmpVarBind(buf) {
  const result = { oid: [], value: undefined };
  const walk = (offset, end) => {
    while (offset < end) {
      const tag = buf[offset];
      const lenInfo = decodeBerLength(buf, offset + 1);
      const start = offset + 1 + lenInfo.size;
      const next = start + lenInfo.length;
      if (tag === 0x06) {
        const decoded = decodeBerOid(buf.slice(start, next));
        if (!result.oid.length) result.oid = decoded;
        else result.value = decoded;
      } else if (tag === 0x04 || tag === 0x44) result.value = buf.slice(start, next).toString('utf8');
      else if (tag === 0x02 || tag === 0x41 || tag === 0x42 || tag === 0x43 || tag === 0x46 || tag === 0x47) {
        let n = 0;
        for (let i = start; i < next; i += 1) n = n * 256 + buf[i];
        result.value = n;
      } else if (tag === 0x30 || tag === 0xa2) walk(start, next);
      offset = next;
    }
  };
  walk(0, buf.length);
  return result;
}

async function snmpUdpRequest(host, port, community, oid, timeoutMs, encodeFn) {
  if (!validatePort(port) || !String(community || '').trim()) return null;
  const gate = await resolveMonitorTargetAddress(host);
  if (!gate.ok) return null;
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const requestId = crypto.randomInt(1, 0x7fffffff);
    const packet = encodeFn(community, requestId, oid);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (_) {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    socket.on('message', msg => {
      clearTimeout(timer);
      finish(parseSnmpVarBind(msg));
    });
    socket.send(packet, Number(port) || 161, gate.address, error => {
      if (error) {
        clearTimeout(timer);
        finish(null);
      }
    });
  });
}

function snmpGetNextUdp(host, port, community, oid, timeoutMs = 3000) {
  return snmpUdpRequest(host, port, community, oid, timeoutMs, encodeSnmpGetNext);
}

function snmpGetUdp(host, port, community, oid, timeoutMs = 3000) {
  return snmpUdpRequest(host, port, community, oid, timeoutMs, encodeSnmpGet);
}

async function snmpWalkSubtreeUdp(host, port, community, baseOid, timeoutMs = 4000, maxItems = 128) {
  const items = [];
  let current = baseOid.slice();
  for (let i = 0; i < maxItems; i += 1) {
    const vb = await snmpGetNextUdp(host, port, community, current, timeoutMs);
    if (!vb || !Array.isArray(vb.oid) || !oidStartsWith(vb.oid, baseOid)) break;
    items.push({ oid: vb.oid, value: vb.value, index: vb.oid[vb.oid.length - 1] });
    current = vb.oid;
  }
  return items;
}

async function snmpWalkSubtreeNative(host, port, community, oid, timeoutMs = 4000) {
  const gate = await resolveMonitorTargetAddress(host);
  if (!gate.ok) throw new Error(gate.message || '目标地址不允许探测');
  const snmp = loadSnmpNative();
  if (!snmp) return Promise.reject(new Error('snmp-native unavailable'));
  return new Promise((resolve, reject) => {
    const session = new snmp.Session({ host: gate.address, community, port: Number(port) || 161, timeouts: [Math.min(timeoutMs, 3000)] });
    const timer = setTimeout(() => {
      try { session.close(); } catch (_) {}
      reject(new Error('SNMP timeout'));
    }, timeoutMs + 1000);
    session.getSubtree({ oid, communities: [community] }, (err, varbinds) => {
      clearTimeout(timer);
      try { session.close(); } catch (_) {}
      if (err) return reject(err);
      resolve((varbinds || []).filter(vb => vb && vb.value !== undefined && vb.value !== null).map(vb => ({
        oid: vb.oid,
        value: vb.value,
        index: vb.oid[vb.oid.length - 1]
      })));
    });
  });
}

async function snmpWalkSubtree(host, port, community, oid, timeoutMs = 4000) {
  if (loadSnmpNative()) {
    try {
      return await snmpWalkSubtreeNative(host, port, community, oid, timeoutMs);
    } catch (_) {}
  }
  return snmpWalkSubtreeUdp(host, port, community, oid, timeoutMs);
}

function isDocumentAttachmentPathSafe(filePath) {
  if (!filePath) return false;
  return isPathInsideDirectory(documentsUploadDir, filePath);
}

function normalizeDocumentAttachmentPath(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  return isDocumentAttachmentPathSafe(raw) ? path.resolve(raw) : '';
}

function normalizeDb(raw = {}) {
  const currentTime = Date.now();
  const projects = (raw.projects || []).map(project => ({
    id: project.id || id('project'),
    name: project.name || '',
    customerName: project.customerName || project.name || '',
    projectStartDate: project.projectStartDate || '',
    projectEndDate: project.projectEndDate || '',
    notifyBefore: project.notifyBefore || '',
    paymentMethod: project.paymentMethod || '',
    // 客户查看服务过程日志由项目级开关控制，默认关闭。
    customerLogVisible: project.customerLogVisible === true,
    description: project.description || '',
    createdAt: project.createdAt || now()
  }));
  // 合同金额与结算记录分开存放：合同承载签约与开票口径，结算承载分期回款与成本。
  const contracts = (raw.contracts || []).map(item => ({
    id: item.id || id('contract'),
    projectId: item.projectId || '',
    contractNo: item.contractNo || '',
    name: item.name || '',
    partyA: item.partyA || '',
    partyB: item.partyB || '',
    amount: normalizeMoney(item.amount),
    taxRate: normalizeMoney(item.taxRate),
    settlementCycle: ['monthly', 'quarterly', 'milestone', 'once'].includes(item.settlementCycle) ? item.settlementCycle : 'monthly',
    signDate: item.signDate || '',
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    status: ['draft', 'active', 'completed', 'terminated'].includes(item.status) ? item.status : 'active',
    notes: item.notes || '',
    createdBy: item.createdBy || '',
    createdAt: item.createdAt || now(),
    updatedAt: item.updatedAt || item.createdAt || now()
  }));
  const contractSettlements = (raw.contractSettlements || []).map(item => ({
    id: item.id || id('settlement'),
    contractId: item.contractId || '',
    projectId: item.projectId || '',
    periodKey: item.periodKey || '',
    title: item.title || '',
    invoiceAmount: normalizeMoney(item.invoiceAmount),
    receivedAmount: normalizeMoney(item.receivedAmount),
    costAmount: normalizeMoney(item.costAmount),
    invoiceNo: item.invoiceNo || '',
    invoicedAt: item.invoicedAt || '',
    receivedAt: item.receivedAt || '',
    status: ['pending', 'invoiced', 'received'].includes(item.status) ? item.status : 'pending',
    notes: item.notes || '',
    createdBy: item.createdBy || '',
    createdAt: item.createdAt || now(),
    updatedAt: item.updatedAt || item.createdAt || now()
  }));
  const users = (raw.users || []).map(user => {
    const twoFactorSecret = typeof user.twoFactorSecret === 'string' ? user.twoFactorSecret : '';
    const twoFactorPendingSecret = typeof user.twoFactorPendingSecret === 'string' ? user.twoFactorPendingSecret : '';
    return {
      id: user.id || id('user'),
      username: user.username || '',
      passwordHash: user.passwordHash || hash(crypto.randomUUID()),
      role: allowedUserRoles.includes(user.role) ? user.role : 'engineer',
      name: user.name || user.username || '',
      phone: user.phone || '',
      idCard: user.idCard || '',
      email: user.email || '',
      wechat: user.wechat || '',
      projectId: user.projectId || '',
      // 项目集用于一人多驻场点：主项目仍在 projectId，projectIds 参与权限判断。
      projectIds: Array.isArray(user.projectIds)
        ? [...new Set(user.projectIds.map(item => String(item || '').trim()).filter(Boolean))]
        : [],
      startDate: user.startDate || '',
      endDate: user.endDate || '',
      securityQuestion: user.securityQuestion || '',
      securityAnswerHash: user.securityAnswerHash || '',
      status: user.status || 'active',
      // 动态令牌配置必须跨重启保留，否则升级重启后所有已启用二步验证的账号会被静默关闭。
      // secret 缺失时不能维持 enabled，否则登录会因无法解密而直接拒绝，等于把账号锁死。
      twoFactorSecret,
      twoFactorPendingSecret,
      twoFactorRecoveryCodeHashes: Array.isArray(user.twoFactorRecoveryCodeHashes)
        ? user.twoFactorRecoveryCodeHashes.filter(item => typeof item === 'string' && item)
        : [],
      twoFactorEnabled: Boolean(twoFactorSecret) && (user.twoFactorEnabled === true || user.twoFactorEnabled === 'true'),
      twoFactorEnabledAt: user.twoFactorEnabledAt || '',
      twoFactorEnforced: user.twoFactorEnforced === true || user.twoFactorEnforced === 'true',
      createdAt: user.createdAt || now()
    };
  });
  const userProjectMap = new Map(users.map(user => [user.id, user.projectId || '']));
  const resolveInspectionExecutionCreatedBy = item => {
    const existing = String(item.createdBy || '').trim();
    if (existing) return existing;
    const executor = String(item.executor || '').trim();
    if (executor) {
      const idMatch = users.find(user => user.id === executor);
      if (idMatch?.id) return idMatch.id;
      const usernameMatches = users.filter(user => user.username === executor);
      if (usernameMatches.length === 1) return usernameMatches[0].id;
      const nameMatches = users.filter(user => user.name === executor);
      if (nameMatches.length === 1) return nameMatches[0].id;
    }
    return '';
  };
  return {
    users,
    projects,
    contracts,
    contractSettlements,
    assets: (raw.assets || []).map(asset => ({
      id: asset.id || id('asset'),
      projectId: asset.projectId || '',
      // 资产类型已收紧为固定枚举，历史遗留的非枚举值在归一化时回落默认类型。
      type: ASSET_TYPE_OPTIONS.includes(asset.type) ? asset.type : '其它',
      name: asset.name || '',
      brand: asset.brand || '',
      model: asset.model || '',
      owner: asset.owner || '',
      version: asset.version || '',
      serialNumber: asset.serialNumber || '',
      status: normalizeAssetStatus(asset.status),
      // 报废/退役后停止采集，避免无效监控持续产生告警。
      retiredAt: asset.retiredAt || '',
      retiredReason: asset.retiredReason || '',
      maintainExpiryDate: asset.maintainExpiryDate || '',
      installationLocation: asset.installationLocation || asset.location || '',
      notes: asset.notes || '',
      cabinetName: String(asset.cabinetName || '').trim(),
      rackUnitStart: parseOptionalRackUnit(asset.rackUnitStart, '起始U位').value ?? null,
      rackUnitSize: parseOptionalRackUnit(asset.rackUnitSize, '占用U数').value || 1,
      monitorEnabled: asset.monitorEnabled === true || asset.monitorEnabled === 'true',
      monitorType: asset.monitorType || 'ping',
      monitorHost: asset.monitorHost || '',
      monitorPort: asset.monitorPort || '',
      snmpCommunity: asset.snmpCommunity || '',
      snmpPort: asset.snmpPort || '161',
      // createdBy 用于非管理员的所有权校验，归一化时必须保留，否则重启后普通工程师将永久无法修改/删除自己创建的资产。
      createdBy: asset.createdBy || '',
      createdAt: asset.createdAt || now()
    })),
    assetRelations: (raw.assetRelations || []).map(rel => ({
      id: rel.id || id('rel'),
      sourceAssetId: rel.sourceAssetId || '',
      targetAssetId: rel.targetAssetId || '',
      relationType: rel.relationType || 'connected',
      label: rel.label || '',
      sourcePort: rel.sourcePort || '',
      targetPort: rel.targetPort || '',
      createdAt: rel.createdAt || now()
    })),
    assetLifecycles: (raw.assetLifecycles || []).map(item => ({
      id: item.id || id('assetLife'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      assetName: item.assetName || '',
      action: ASSET_LIFECYCLE_ACTIONS.includes(item.action) ? item.action : 'update',
      detail: item.detail || '',
      fromProjectId: item.fromProjectId || '',
      toProjectId: item.toProjectId || '',
      fromStatus: item.fromStatus || '',
      toStatus: item.toStatus || '',
      operatorId: item.operatorId || '',
      operatorName: item.operatorName || '',
      createdAt: item.createdAt || now()
    })),
    assetCheckouts: (raw.assetCheckouts || []).map(item => ({
      id: item.id || id('assetCheckout'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      borrowerId: item.borrowerId || '',
      borrowerName: item.borrowerName || '',
      quantity: Number(item.quantity || 1),
      purpose: item.purpose || '',
      checkoutAt: item.checkoutAt || item.createdAt || now(),
      dueAt: item.dueAt || '',
      returnedAt: item.returnedAt || '',
      returnCondition: item.returnCondition || '',
      status: item.status === 'returned' ? 'returned' : 'checked_out',
      operatorId: item.operatorId || '',
      operatorName: item.operatorName || '',
      createdAt: item.createdAt || now()
    })),
    assetInventoryTasks: (raw.assetInventoryTasks || []).map(item => ({
      id: item.id || id('assetInv'),
      projectId: item.projectId || '',
      name: item.name || '',
      status: ['pending', 'running', 'completed'].includes(item.status) ? item.status : 'pending',
      createdBy: item.createdBy || '',
      createdByName: item.createdByName || '',
      startedAt: item.startedAt || '',
      completedAt: item.completedAt || '',
      items: Array.isArray(item.items) ? item.items.map(entry => ({
        assetId: entry.assetId || '',
        assetName: entry.assetName || '',
        expectedStatus: entry.expectedStatus || '',
        actualStatus: entry.actualStatus || '',
        location: entry.location || '',
        result: ['match', 'mismatch', 'missing'].includes(entry.result) ? entry.result : '',
        note: entry.note || '',
        checkedAt: entry.checkedAt || ''
      })) : [],
      createdAt: item.createdAt || now()
    })),
    logs: (raw.logs || []).map(log => ({
      id: log.id || id('log'),
      userId: log.userId || '',
      projectId: log.projectId || '',
      assetId: log.assetId || '',
      date: log.date || '',
      event: log.event || '',
      title: log.title || '',
      relatedTarget: log.relatedTarget || '',
      dispatcher: log.dispatcher || '',
      dispatchDepartment: log.dispatchDepartment || '',
      ticketType: log.ticketType || '',
      workloadCategory: resolveWorkloadCategory(log.workloadCategory, log.ticketType),
      assignee: log.assignee || '',
      process: log.process || '',
      result: log.result || '已完成',
      conclusion: log.conclusion || '',
      remark: log.remark || '',
      durationHours: Number(log.durationHours || 0),
      attachments: normalizeLogAttachments(log.attachments),
      createdAt: log.createdAt || now()
    })),
    inspectionPlans: (raw.inspectionPlans || []).map(item => ({
      id: item.id || id('inspection'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      title: item.title || '',
      cycle: item.cycle || 'monthly',
      nextDate: item.nextDate || '',
      owner: item.owner || '',
      status: item.status || '待执行',
      description: item.description || '',
      checklistTemplate: normalizeInspectionChecklistTemplate(item.checklistTemplate),
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    inspectionExecutions: (raw.inspectionExecutions || []).map(item => ({
      id: item.id || id('inspectionExec'),
      planId: item.planId || '',
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      executedAt: item.executedAt || '',
      executor: item.executor || '',
      checklist: item.checklist || '',
      checklistItems: normalizeInspectionChecklistItems(item.checklistItems),
      result: item.result || '正常',
      issue: item.issue || '',
      suggestion: item.suggestion || '',
      ticketId: item.ticketId || '',
      recheckStatus: ['待复查', '已复查'].includes(item.recheckStatus) ? item.recheckStatus : '',
      recheckAt: item.recheckAt || '',
      recheckBy: item.recheckBy || '',
      recheckResult: item.recheckResult || '',
      attachment: normalizeInspectionAttachment(item.attachment),
      nextDate: item.nextDate || '',
      createdBy: resolveInspectionExecutionCreatedBy(item),
      createdAt: item.createdAt || now()
    })),
    spareParts: (raw.spareParts || []).map(item => ({
      id: item.id || id('spare'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      name: item.name || '',
      model: item.model || '',
      quantity: Number(item.quantity || 0),
      safeStock: Number(item.safeStock || 0),
      unit: item.unit || '',
      location: item.location || '',
      notes: item.notes || '',
      createdAt: item.createdAt || now()
    })),
    sparePartMovements: (raw.sparePartMovements || []).map(item => ({
      id: item.id || id('spareMove'),
      sparePartId: item.sparePartId || '',
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      type: ['inbound', 'outbound', 'adjust'].includes(item.type) ? item.type : 'outbound',
      quantity: Number(item.quantity || 0),
      reason: item.reason || '',
      operatorId: item.operatorId || '',
      operatorName: item.operatorName || '',
      createdAt: item.createdAt || now()
    })),
    // 供应商为项目级主数据，采购申请引用供应商与备件，盘点任务冻结当时的账面数量用于差异核对。
    sparePartVendors: (raw.sparePartVendors || []).map(item => ({
      id: item.id || id('spareVendor'),
      projectId: item.projectId || '',
      name: item.name || '',
      contactName: item.contactName || '',
      contactPhone: item.contactPhone || '',
      email: item.email || '',
      address: item.address || '',
      status: ['active', 'inactive'].includes(item.status) ? item.status : 'active',
      notes: item.notes || '',
      createdAt: item.createdAt || now()
    })),
    sparePartPurchases: (raw.sparePartPurchases || []).map(item => ({
      id: item.id || id('sparePurchase'),
      purchaseNo: item.purchaseNo || '',
      projectId: item.projectId || '',
      sparePartId: item.sparePartId || '',
      vendorId: item.vendorId || '',
      quantity: Math.max(0, Number(item.quantity || 0)),
      unitPrice: normalizeMoney(item.unitPrice),
      totalAmount: normalizeMoney(item.totalAmount),
      requestedAt: item.requestedAt || item.createdAt || now(),
      expectedAt: item.expectedAt || '',
      receivedAt: item.receivedAt || '',
      status: ['pending', 'approved', 'received', 'cancelled'].includes(item.status) ? item.status : 'pending',
      applicantId: item.applicantId || '',
      applicantName: item.applicantName || '',
      approverId: item.approverId || '',
      approverName: item.approverName || '',
      approvalNote: item.approvalNote || '',
      notes: item.notes || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || item.createdAt || now()
    })),
    sparePartInventoryTasks: (raw.sparePartInventoryTasks || []).map(item => ({
      id: item.id || id('spareInv'),
      projectId: item.projectId || '',
      name: item.name || '',
      status: ['pending', 'running', 'completed'].includes(item.status) ? item.status : 'pending',
      createdBy: item.createdBy || '',
      createdByName: item.createdByName || '',
      completedAt: item.completedAt || '',
      items: Array.isArray(item.items) ? item.items.map(entry => ({
        sparePartId: entry.sparePartId || '',
        name: entry.name || '',
        expectedQuantity: Number(entry.expectedQuantity || 0),
        actualQuantity: entry.actualQuantity === undefined || entry.actualQuantity === null || entry.actualQuantity === ''
          ? null
          : Number(entry.actualQuantity),
        difference: Number(entry.difference || 0),
        result: ['match', 'mismatch', 'unchecked'].includes(entry.result) ? entry.result : 'unchecked',
        note: entry.note || '',
        checkedAt: entry.checkedAt || ''
      })) : [],
      createdAt: item.createdAt || now()
    })),
    changeRecords: (raw.changeRecords || []).map(item => ({
      id: item.id || id('change'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      title: item.title || '',
      content: item.content || '',
      riskLevel: item.riskLevel || '中',
      status: item.status === '待审批' ? '待运维审批' : (item.status || '待运维审批'),
      approverId: item.approverId || '',
      approverName: item.approverName || '',
      customerId: item.customerId || '',
      customerName: item.customerName || '',
      approvalId: item.approvalId || '',
      createdBy: item.createdBy || '',
      rejectionReason: item.rejectionReason || '',
      createdAt: item.createdAt || now()
    })),
    incidentRecords: (raw.incidentRecords || []).map(item => ({
      id: item.id || id('incident'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      title: item.title || '',
      faultType: item.faultType || '',
      severity: item.severity || '中',
      slaStatus: item.slaStatus || '正常',
      status: item.status || '处理中',
      occurredAt: item.occurredAt || '',
      resolution: item.resolution || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    tickets: (raw.tickets || []).map(item => ({
      id: item.id || id('ticket'),
      ticketNo: String(item.ticketNo || '').trim(),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      title: item.title || '',
      description: item.description || '',
      category: ticketCategoryOptions.includes(item.category) ? item.category : '其他',
      priority: ticketPriorityOptions.includes(item.priority) ? item.priority : '中',
      status: ticketStatusOptions.includes(item.status) ? item.status : '待接单',
      assigneeId: item.assigneeId || '',
      assigneeName: item.assigneeName || '',
      dispatcherId: item.dispatcherId || '',
      sourceType: item.sourceType || '',
      sourceId: item.sourceId || '',
      slaHours: Number(item.slaHours || ticketSlaHoursByPriority[item.priority] || ticketSlaHoursByPriority['中']),
      slaDeadline: item.slaDeadline || '',
      slaStatus: incidentSlaStatusOptions.includes(item.slaStatus) ? item.slaStatus : '正常',
      acceptedAt: item.acceptedAt || '',
      respondedAt: item.respondedAt || '',
      closedAt: item.closedAt || '',
      resolution: item.resolution || '',
      customerConfirmedAt: item.customerConfirmedAt || '',
      customerComment: item.customerComment || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || item.createdAt || now()
    })),
    dutyShifts: (raw.dutyShifts || []).map(item => ({
      id: item.id || id('dutyShift'),
      projectId: item.projectId || '',
      title: item.title || '',
      dutyDate: String(item.dutyDate || '').slice(0, 10),
      startTime: String(item.startTime || '').slice(0, 5),
      endTime: String(item.endTime || '').slice(0, 5),
      shiftType: item.shiftType || '白班',
      primaryUserId: item.primaryUserId || '',
      backupUserId: item.backupUserId || '',
      status: dutyShiftStatusOptions.includes(item.status) ? item.status : '待开始',
      handoverContent: item.handoverContent || '',
      handoverIssue: item.handoverIssue || '',
      handoverAt: item.handoverAt || '',
      handoverBy: item.handoverBy || '',
      receivedBy: item.receivedBy || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || item.createdAt || now()
    })),
    approvals: (raw.approvals || []).map(item => ({
      id: item.id || id('approval'),
      projectId: item.projectId || '',
      category: item.category || '',
      title: item.title || '',
      content: item.content || '',
      status: item.status === '待审批' ? '待运维审批' : (item.status || '待运维审批'),
      requestedBy: item.requestedBy || '',
      approvedBy: item.approvedBy || '',
      approverId: item.approverId || '',
      customerId: item.customerId || '',
      currentStage: item.currentStage || ((item.status === '待客户确认') ? 'customer' : ((item.status === '已通过' || item.status === '已驳回') ? 'completed' : 'approver')),
      relatedId: item.relatedId || '',
      rejectionReason: item.rejectionReason || '',
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || item.createdAt || now()
    })),
    notifications: (raw.notifications || []).map(item => ({
      id: item.id || id('notification'),
      projectId: item.projectId || '',
      title: item.title || '',
      content: item.content || '',
      level: item.level || 'info',
      category: item.category || '',
      // 来源类型/来源 ID 用于在删除业务记录时级联清理其通知。
      sourceType: item.sourceType || '',
      sourceId: item.sourceId || '',
      readAt: item.readAt || '',
      archivedAt: item.archivedAt || '',
      // 已读/隐藏按用户维度存储，必须随通知一起持久化，否则重启后状态丢失。
      readBy: sanitizeNotificationUserStampMap(item.readBy),
      hiddenBy: sanitizeNotificationUserStampMap(item.hiddenBy),
      createdAt: item.createdAt || now()
    })),
    // 外发通道配置（Webhook / 邮件），凭据仅管理员可见，序列化时统一脱敏。
    notificationChannels: (raw.notificationChannels || []).map(item => ({
      id: item.id || id('notifyChannel'),
      projectId: item.projectId || '',
      name: item.name || '',
      type: ['webhook', 'email'].includes(item.type) ? item.type : 'webhook',
      enabled: item.enabled !== false,
      events: Array.isArray(item.events) ? item.events.map(entry => String(entry || '')).filter(Boolean) : [],
      webhookUrl: item.webhookUrl || '',
      webhookSecret: item.webhookSecret || '',
      smtpHost: item.smtpHost || '',
      smtpPort: item.smtpPort || '',
      smtpSecure: item.smtpSecure === true,
      smtpUser: item.smtpUser || '',
      smtpPassword: item.smtpPassword || '',
      fromAddress: item.fromAddress || '',
      toAddresses: Array.isArray(item.toAddresses) ? item.toAddresses.map(entry => String(entry || '')).filter(Boolean) : [],
      lastSentAt: item.lastSentAt || '',
      lastError: item.lastError || '',
      createdAt: item.createdAt || now()
    })),
    monitorAlerts: (raw.monitorAlerts || []).map(item => ({
      id: item.id || id('monitorAlert'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      assetName: item.assetName || '',
      metric: MONITOR_ALERT_METRICS.includes(item.metric) ? item.metric : 'availability',
      level: notificationLevelOptions.includes(item.level) ? item.level : 'warning',
      title: item.title || '',
      content: item.content || '',
      status: ['open', 'acknowledged', 'resolved'].includes(item.status) ? item.status : 'open',
      occurrences: Math.max(1, Number(item.occurrences || 1)),
      firstTriggeredAt: item.firstTriggeredAt || item.createdAt || now(),
      lastTriggeredAt: item.lastTriggeredAt || item.createdAt || now(),
      acknowledgedAt: item.acknowledgedAt || '',
      acknowledgedBy: item.acknowledgedBy || '',
      acknowledgedByName: item.acknowledgedByName || '',
      acknowledgeNote: item.acknowledgeNote || '',
      resolvedAt: item.resolvedAt || '',
      resolvedReason: item.resolvedReason || '',
      silencedUntil: item.silencedUntil || '',
      silencedBy: item.silencedBy || '',
      createdAt: item.createdAt || now()
    })),
    monitorMaintenanceWindows: (raw.monitorMaintenanceWindows || []).map(item => ({
      id: item.id || id('monitorWindow'),
      projectId: item.projectId || '',
      name: item.name || '',
      assetIds: Array.isArray(item.assetIds) ? item.assetIds.map(entry => String(entry || '')).filter(Boolean) : [],
      startAt: item.startAt || '',
      endAt: item.endAt || '',
      enabled: item.enabled !== false,
      notes: item.notes || '',
      createdBy: item.createdBy || '',
      createdByName: item.createdByName || '',
      createdAt: item.createdAt || now()
    })),
    auditLogs: (raw.auditLogs || []).map(item => ({
      id: item.id || id('audit'),
      projectId: item.projectId || '',
      action: item.action || '',
      targetType: item.targetType || '',
      targetId: item.targetId || '',
      operatorId: item.operatorId || '',
      operatorName: item.operatorName || '',
      detail: item.detail || '',
      ip: item.ip || '',
      userAgent: item.userAgent || '',
      createdAt: item.createdAt || now()
    })),
    upgradeLogs: (raw.upgradeLogs || []).map(item => ({
      id: item.id || id('upgrade-log'),
      operatorId: item.operatorId || '',
      operatorName: item.operatorName || '',
      filename: item.filename || '',
      fromVersion: item.fromVersion || '',
      toVersion: item.toVersion || '',
      status: item.status === 'accepted' ? 'accepted' : 'failed',
      message: item.message || '',
      createdAt: item.createdAt || now()
    })),
    knowledgeBase: (raw.knowledgeBase || []).map(item => ({
      id: item.id || id('kb'),
      title: item.title || '',
      keywords: item.keywords || '',
      problem: item.problem || '',
      solution: item.solution || '',
      content: item.content || '',
      category: item.category || '',
      // tags 既可能来自接口的字符串，也可能来自历史数据/导入的数组，归一化时原样保留，避免被强制清空。
      tags: Array.isArray(item.tags) ? item.tags : (item.tags || ''),
      // 审核状态与版本号：draft 草稿、pending 待审核、published 已发布、rejected 已驳回。
      status: ['draft', 'pending', 'published', 'rejected'].includes(item.status) ? item.status : 'published',
      version: Math.max(1, Number(item.version || 1)),
      reviewNote: item.reviewNote || '',
      reviewedBy: item.reviewedBy || '',
      reviewedAt: item.reviewedAt || '',
      publishedAt: item.publishedAt || item.createdAt || now(),
      createdBy: item.createdBy || '',
      projectId: item.projectId || userProjectMap.get(item.createdBy) || '',
      createdAt: item.createdAt || now()
    })),
    kbRevisions: (raw.kbRevisions || []).map(item => ({
      id: item.id || id('kbRev'),
      kbId: item.kbId || '',
      projectId: item.projectId || '',
      version: Math.max(1, Number(item.version || 1)),
      action: ['create', 'update', 'submit', 'publish', 'reject'].includes(item.action) ? item.action : 'update',
      title: item.title || '',
      keywords: item.keywords || '',
      problem: item.problem || '',
      solution: item.solution || '',
      content: item.content || '',
      category: item.category || '',
      tags: Array.isArray(item.tags) ? item.tags : (item.tags || ''),
      note: item.note || '',
      operatorId: item.operatorId || '',
      operatorName: item.operatorName || '',
      createdAt: item.createdAt || now()
    })),
    documents: (raw.documents || []).map(item => ({
      id: item.id || id('doc'),
      projectId: item.projectId || '',
      type: item.type || 'device',
      title: item.title || '',
      brand: item.brand || '',
      model: item.model || '',
      serialNumber: item.serialNumber || '',
      purchaseDate: item.purchaseDate || '',
      warrantyExpiryDate: item.warrantyExpiryDate || '',
      managementMethod: item.managementMethod || '',
      managementIp: item.managementIp || '',
      managementPort: item.managementPort || '',
      loginAccount: item.loginAccount || '',
      loginPasswordHash: item.loginPasswordHash || '',
      loginPasswordEncrypted: item.loginPasswordEncrypted || '',
      attachmentName: item.attachmentName || '',
      attachmentPath: normalizeDocumentAttachmentPath(item.attachmentPath || ''),
      attachmentSize: item.attachmentSize || 0,
      accessPasswordHash: item.accessPasswordHash || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || now()
    })),
    workReports: (raw.workReports || []).map(item => ({
      id: item.id || id('workReport'),
      reportType: ['daily', 'weekly', 'monthly'].includes(item.reportType) ? item.reportType : 'daily',
      projectId: item.projectId || '',
      userId: item.userId || '',
      periodKey: String(item.periodKey || '').trim(),
      rangeStart: String(item.rangeStart || '').slice(0, 10),
      rangeEnd: String(item.rangeEnd || '').slice(0, 10),
      status: ['draft', 'submitted', 'returned', 'approved', 'locked'].includes(item.status) ? item.status : 'draft',
      summary: item.summary || '',
      completedWork: item.completedWork || '',
      pendingWork: item.pendingWork || '',
      risks: item.risks || '',
      nextPlan: item.nextPlan || '',
      metricsSnapshot: normalizeWorkMetricsSnapshot(item.metricsSnapshot),
      submittedAt: item.submittedAt || '',
      reviewedAt: item.reviewedAt || '',
      reviewedBy: item.reviewedBy || '',
      reviewComment: item.reviewComment || '',
      lockedAt: item.lockedAt || '',
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || now()
    })),
    aiInspectionTargets: (raw.aiInspectionTargets || []).map(item => ({
      id: item.id || id('aiTarget'),
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      name: item.name || '',
      category: item.category || 'server',
      address: item.address || '',
      protocol: normalizeAiInspectionProtocol(item.protocol, item.category || 'server'),
      port: Number(item.port || 0),
      authType: normalizeAiInspectionAuthType(item.authType, normalizeAiInspectionProtocol(item.protocol, item.category || 'server')),
      account: item.account || '',
      credentialDomain: item.credentialDomain || '',
      password: item.password || '',
      privateKey: item.privateKey || '',
      accessToken: item.accessToken || '',
      community: item.community || '',
      systemVersion: item.systemVersion || '',
      backupMode: ['cli', 'web'].includes(item.backupMode) ? item.backupMode : 'cli',
      backupCommand: item.backupCommand || '',
      webBackupPath: item.webBackupPath || '',
      webBackupMethod: String(item.webBackupMethod || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
      webLoginPath: item.webLoginPath || '',
      webUsernameSelector: item.webUsernameSelector || '',
      webPasswordSelector: item.webPasswordSelector || '',
      webBackupButtonSelector: item.webBackupButtonSelector || '',
      location: item.location || '',
      notes: item.notes || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    aiInspectionTemplates: ((raw.aiInspectionTemplates || []).length ? raw.aiInspectionTemplates : getDefaultAiInspectionTemplates()).map(item => ({
      id: item.id || id('aiTpl'),
      projectId: item.projectId || '',
      name: item.name || '',
      category: item.category || 'server',
      description: item.description || '',
      metrics: normalizeAiInspectionMetrics(item.metrics, item.category || 'server'),
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    aiInspectionTasks: (raw.aiInspectionTasks || []).map(item => ({
      id: item.id || id('aiTask'),
      projectId: item.projectId || '',
      targetId: item.targetId || '',
      templateId: item.templateId || '',
      title: item.title || '',
      executor: item.executor || '',
      cycle: item.cycle || '',
      executedAt: item.executedAt || '',
      metrics: normalizeAiInspectionValues(item.metrics),
      status: item.status || '待执行',
      completedAt: item.completedAt || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    aiInspectionResults: (raw.aiInspectionResults || []).map(item => ({
      id: item.id || id('aiResult'),
      projectId: item.projectId || '',
      taskId: item.taskId || '',
      targetId: item.targetId || '',
      templateId: item.templateId || '',
      score: Number(item.score || 0),
      level: item.level || '正常',
      summary: item.summary || '',
      risk: item.risk || '',
      suggestion: item.suggestion || '',
      abnormalItems: Array.isArray(item.abnormalItems) ? item.abnormalItems.map(entry => String(entry || '')) : [],
      realData: (item.realData && typeof item.realData === 'object' && !Array.isArray(item.realData)) ? item.realData : {},
      probeError: item.probeError || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    configBackupPlans: (raw.configBackupPlans || []).map(item => ({
      id: item.id || id('cfgPlan'),
      projectId: item.projectId || '',
      targetId: item.targetId || '',
      name: item.name || '',
      cycle: item.cycle || '',
      executedAt: item.executedAt || '',
      status: item.status || '待执行',
      lastBackupAt: item.lastBackupAt || '',
      lastStatus: item.lastStatus || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    configBackupRecords: (raw.configBackupRecords || []).map(item => ({
      id: item.id || id('cfgRecord'),
      planId: item.planId || '',
      projectId: item.projectId || '',
      targetId: item.targetId || '',
      assetId: item.assetId || '',
      status: item.status || '成功',
      filename: item.filename || '',
      content: item.content || '',
      size: Number(item.size || 0),
      message: item.message || '',
      createdBy: item.createdBy || '',
      createdAt: item.createdAt || now()
    })),
    // 会话以 token 为唯一键，历史并发写入曾产生重复 token，读取时按 token 去重并保留最新活跃记录。
    sessions: (() => {
      const byToken = new Map();
      for (const item of raw.sessions || []) {
        const session = {
          token: item.token || '',
          userId: item.userId || '',
          createdAt: item.createdAt || now(),
          lastActivityAt: item.lastActivityAt || item.createdAt || now(),
          expiresAt: item.expiresAt || new Date(currentTime + sessionMaxAgeSeconds * 1000).toISOString()
        };
        if (!session.token || !session.userId || !(Date.parse(session.expiresAt) > currentTime)) continue;
        const existing = byToken.get(session.token);
        if (!existing || String(session.lastActivityAt) > String(existing.lastActivityAt)) byToken.set(session.token, session);
      }
      return [...byToken.values()];
    })(),
    topologyLayouts: (raw.topologyLayouts && typeof raw.topologyLayouts === 'object' && !Array.isArray(raw.topologyLayouts))
      ? { positions: (raw.topologyLayouts.positions && typeof raw.topologyLayouts.positions === 'object' && !Array.isArray(raw.topologyLayouts.positions)) ? raw.topologyLayouts.positions : {} }
      : { positions: {} },
    systemConfig: normalizeSystemConfig(raw.systemConfig),
    runtimeState: normalizeRuntimeState(raw.runtimeState)
  };
}

function normalizeWorkMetricsSnapshot(snapshot = {}) {
  const categoryCounts = snapshot.categoryCounts && typeof snapshot.categoryCounts === 'object' ? snapshot.categoryCounts : {};
  const categoryHours = snapshot.categoryHours && typeof snapshot.categoryHours === 'object' ? snapshot.categoryHours : {};
  return {
    logCount: Number(snapshot.logCount || 0),
    totalHours: Number(Number(snapshot.totalHours || 0).toFixed(2)),
    inspectionCount: Number(snapshot.inspectionCount || 0),
    incidentCount: Number(snapshot.incidentCount || 0),
    changeCount: Number(snapshot.changeCount || 0),
    knowledgeCount: Number(snapshot.knowledgeCount || 0),
    documentCount: Number(snapshot.documentCount || 0),
    resolvedIncidentCount: Number(snapshot.resolvedIncidentCount || 0),
    categoryCounts: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, Number(categoryCounts[key] || 0)])),
    categoryHours: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, Number(Number(categoryHours[key] || 0).toFixed(2))]))
  };
}

// 金额统一保留两位小数并容忍空值/字符串输入，避免浮点误差随汇总链路放大。
function normalizeMoney(value) {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function normalizeInspectionAttachment(attachment) {
  if (!attachment) return '';
  if (typeof attachment === 'string') return attachment;
  if (typeof attachment !== 'object') return '';
  return {
    name: attachment.name || '',
    mimeType: attachment.mimeType || '',
    size: Number(attachment.size || 0),
    dataUrl: attachment.dataUrl || ''
  };
}

// 日志附件为现场取证图，附带拍摄时间与定位元数据；客户端已按需压缩并叠加水印。
function normalizeLogAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const dataUrl = String(attachment.dataUrl || '');
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(dataUrl)) return null;
  const name = String(attachment.name || '').trim().slice(0, 200) || '现场取证图片';
  const location = attachment.location && typeof attachment.location === 'object'
    ? {
        latitude: Number.isFinite(Number(attachment.location.latitude)) ? Number(attachment.location.latitude) : null,
        longitude: Number.isFinite(Number(attachment.location.longitude)) ? Number(attachment.location.longitude) : null,
        address: String(attachment.location.address || '').trim().slice(0, 200)
      }
    : null;
  return {
    id: String(attachment.id || id('logAttachment')).slice(0, 80),
    name,
    mimeType: String(attachment.mimeType || 'image/jpeg').slice(0, 100),
    size: Math.max(Number(attachment.size) || 0, dataUrlByteLength(dataUrl)),
    dataUrl,
    capturedAt: String(attachment.capturedAt || '').trim().slice(0, 40),
    location,
    watermark: String(attachment.watermark || '').trim().slice(0, 300)
  };
}

function normalizeLogAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map(normalizeLogAttachment).filter(Boolean).slice(0, logAttachmentMaxCount);
}

function logAttachmentBytes(attachment) {
  if (!attachment || typeof attachment !== 'object') return 0;
  return Math.max(Number(attachment.size) || 0, dataUrlByteLength(attachment.dataUrl));
}

function validateLogAttachments(input) {
  if (input === undefined) return { attachments: [] };
  if (!Array.isArray(input)) return { error: '现场取证附件格式无效' };
  if (input.length > logAttachmentMaxCount) return { error: `现场取证图片最多 ${logAttachmentMaxCount} 张` };
  const attachments = [];
  for (const item of input) {
    const attachment = normalizeLogAttachment(item);
    if (!attachment) return { error: '现场取证图片仅支持 PNG/JPEG/WebP 格式' };
    if (logAttachmentBytes(attachment) > logAttachmentMaxBytes) {
      return { error: `单张现场取证图片不能超过 ${Math.round(logAttachmentMaxBytes / (1024 * 1024))}MB` };
    }
    attachments.push(attachment);
  }
  return { attachments };
}

// 检查项模板是一组可复用的巡检条目，执行时展开为逐项结果。
function normalizeInspectionChecklistTemplate(template) {
  if (!Array.isArray(template)) return [];
  return template
    .map(item => {
      if (typeof item === 'string') return { id: id('checkItem'), name: item.trim(), required: true };
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name || '').trim();
      if (!name) return null;
      return { id: item.id || id('checkItem'), name: name.slice(0, 200), required: item.required !== false };
    })
    .filter(Boolean);
}

function normalizeInspectionChecklistItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name || '').trim();
      if (!name) return null;
      return {
        id: item.id || id('checkItem'),
        name: name.slice(0, 200),
        result: ['正常', '异常', '未检查'].includes(item.result) ? item.result : '未检查',
        remark: String(item.remark || '').slice(0, 500)
      };
    })
    .filter(Boolean);
}

function formatQuotaSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${Number((value / (1024 * 1024 * 1024)).toFixed(1))}GB`;
  return `${Math.max(1, Math.round(value / (1024 * 1024)))}MB`;
}

// dataURL 体积按 base64 长度反推，避免客户端上报的 size 被伪造后绕过配额。
function dataUrlByteLength(dataUrl) {
  const value = String(dataUrl || '');
  const commaIndex = value.indexOf(',');
  if (commaIndex === -1) return 0;
  const payload = value.slice(commaIndex + 1);
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
}

function inspectionAttachmentBytes(attachment) {
  if (!attachment || typeof attachment !== 'object') return 0;
  return Math.max(Number(attachment.size) || 0, dataUrlByteLength(attachment.dataUrl));
}

// 统一校验附件配额：调用方提供条目集合、归属与体积取值方式，避免各接口重复实现。
function findAttachmentQuotaExceeded({ items, userId, projectId, incomingBytes, excludeId, getOwnerId, getProjectId, getBytes, perUserBytes, perProjectBytes, label }) {
  const bytes = Number(incomingBytes) || 0;
  if (bytes <= 0) return '';
  let userUsed = 0;
  let projectUsed = 0;
  for (const item of items || []) {
    if (!item || (excludeId && item.id === excludeId)) continue;
    const itemBytes = Number(getBytes(item)) || 0;
    if (itemBytes <= 0) continue;
    if (userId && getOwnerId(item) === userId) userUsed += itemBytes;
    if (projectId && getProjectId(item) === projectId) projectUsed += itemBytes;
  }
  if (perProjectBytes && projectId && projectUsed + bytes > perProjectBytes) {
    return `${label}超出项目配额（上限 ${formatQuotaSize(perProjectBytes)}，已用 ${formatQuotaSize(projectUsed)}）`;
  }
  if (perUserBytes && userId && userUsed + bytes > perUserBytes) {
    return `${label}超出个人配额（上限 ${formatQuotaSize(perUserBytes)}，已用 ${formatQuotaSize(userUsed)}）`;
  }
  return '';
}

async function serializeDbSnapshot(db) {
  const normalized = normalizeDb(db);
  return {
    ...normalized,
    sessions: [],
    runtimeState: { loginRateLimits: [] },
    documentAttachments: await collectDocumentAttachments(normalized.documents || [])
  };
}

function fillMissingSecretFields(incoming = [], current = [], fields = []) {
  const byId = new Map((current || []).map(item => [item && item.id, item]));
  return (incoming || []).map(item => {
    const source = byId.get(item && item.id);
    if (!source) return item;
    const next = { ...item };
    fields.forEach(field => {
      if (next[field] == null || next[field] === '') {
        if (source[field] != null && source[field] !== '') next[field] = source[field];
      }
    });
    return next;
  });
}

function fillMissingSnapshotSecrets(raw, currentDb) {
  const next = { ...(raw || {}) };
  next.users = fillMissingSecretFields(raw.users, currentDb.users, ['passwordHash', 'securityQuestion', 'securityAnswerHash']);
  next.assets = fillMissingSecretFields(raw.assets, currentDb.assets, ['snmpCommunity']);
  next.documents = fillMissingSecretFields(raw.documents, currentDb.documents, DOCUMENT_SECRET_FIELDS);
  next.aiInspectionTargets = fillMissingSecretFields(raw.aiInspectionTargets, currentDb.aiInspectionTargets, ['password', 'privateKey', 'accessToken', 'community']);
  return next;
}

  function buildResetDbForNewEnvironment(currentUser, currentSessionToken, currentSession) {
    const preservedUser = {
    ...currentUser,
    projectId: '',
    startDate: '',
    endDate: ''
  };
  const nextDb = normalizeDb({
    users: [preservedUser],
    sessions: currentSessionToken && currentSession ? [{
      token: currentSessionToken,
      userId: preservedUser.id,
      createdAt: currentSession.createdAt || now(),
      lastActivityAt: currentSession.lastActivityAt || now(),
      expiresAt: currentSession.expiresAt || new Date(Date.now() + sessionMaxAgeSeconds * 1000).toISOString()
    }] : []
  });
  appendAuditLog(nextDb, preservedUser, 'reset', 'system', '', '初始化数据库，保留当前管理员账号');
  return nextDb;
}

// 导入/恢复的快照可能来自手工编辑或外部环境，引用与枚举不一定合法。
// 这里只做清洗（非法引用置空、非法枚举回落默认值），不拒绝整份快照。
function sanitizeImportedData(db) {
  const projectIds = new Set((db.projects || []).map(item => item.id).filter(Boolean));
  const userIds = new Set((db.users || []).map(item => item.id).filter(Boolean));
  const assetIds = new Set((db.assets || []).map(item => item.id).filter(Boolean));
  const planIds = new Set((db.inspectionPlans || []).map(item => item.id).filter(Boolean));
  const sparePartIds = new Set((db.spareParts || []).map(item => item.id).filter(Boolean));
  const targetIds = new Set((db.aiInspectionTargets || []).map(item => item.id).filter(Boolean));
  const templateIds = new Set((db.aiInspectionTemplates || []).map(item => item.id).filter(Boolean));
  const taskIds = new Set((db.aiInspectionTasks || []).map(item => item.id).filter(Boolean));
  const approvalIds = new Set((db.approvals || []).map(item => item.id).filter(Boolean));
  const cfgPlanIds = new Set((db.configBackupPlans || []).map(item => item.id).filter(Boolean));

  const clearRef = (list, fields, idSet) => {
    for (const item of list || []) {
      if (!item || typeof item !== 'object') continue;
      for (const field of fields) {
        // 'system' 是内置巡检模板等系统内置数据的保留标识，不属于用户集合，不能按无效引用清空。
        if (item[field] && item[field] !== 'system' && !idSet.has(item[field])) item[field] = '';
      }
    }
  };
  const coerceEnum = (list, field, options, fallback) => {
    for (const item of list || []) {
      if (!item || typeof item !== 'object') continue;
      if (!options.includes(item[field])) item[field] = fallback;
    }
  };

  clearRef(db.users, ['projectId'], projectIds);
  coerceEnum(db.users, 'role', allowedUserRoles, 'engineer');
  coerceEnum(db.users, 'status', ['active', 'pending', 'disabled', 'rejected'], 'active');

  const contractIds = new Set((db.contracts || []).map(item => item.id).filter(Boolean));
  clearRef(db.contracts, ['projectId'], projectIds);
  clearRef(db.contracts, ['createdBy'], userIds);
  coerceEnum(db.contracts, 'status', ['draft', 'active', 'completed', 'terminated'], 'active');
  coerceEnum(db.contracts, 'settlementCycle', ['monthly', 'quarterly', 'milestone', 'once'], 'monthly');
  clearRef(db.contractSettlements, ['contractId'], contractIds);
  clearRef(db.contractSettlements, ['projectId'], projectIds);
  clearRef(db.contractSettlements, ['createdBy'], userIds);
  coerceEnum(db.contractSettlements, 'status', ['pending', 'invoiced', 'received'], 'pending');

  clearRef(db.assets, ['projectId'], projectIds);
  coerceEnum(db.assets, 'type', ASSET_TYPE_OPTIONS, '其它');
  coerceEnum(db.assets, 'monitorType', ASSET_MONITOR_TYPES, 'ping');

  clearRef(db.assetRelations, ['sourceAssetId', 'targetAssetId'], assetIds);
  clearRef(db.assetLifecycles, ['projectId'], projectIds);
  clearRef(db.assetLifecycles, ['assetId'], assetIds);
  clearRef(db.assetLifecycles, ['operatorId'], userIds);
  clearRef(db.assetCheckouts, ['projectId'], projectIds);
  clearRef(db.assetCheckouts, ['assetId'], assetIds);
  clearRef(db.assetCheckouts, ['borrowerId', 'operatorId'], userIds);
  clearRef(db.assetInventoryTasks, ['projectId'], projectIds);
  clearRef(db.assetInventoryTasks, ['createdBy'], userIds);
  clearRef(db.logs, ['userId'], userIds);
  clearRef(db.logs, ['projectId'], projectIds);
  clearRef(db.logs, ['assetId'], assetIds);
  for (const log of db.logs || []) {
    if (log && typeof log === 'object') log.attachments = normalizeLogAttachments(log.attachments);
  }

  clearRef(db.inspectionPlans, ['projectId'], projectIds);
  clearRef(db.inspectionPlans, ['assetId'], assetIds);
  clearRef(db.inspectionPlans, ['createdBy'], userIds);
  coerceEnum(db.inspectionPlans, 'status', ['待执行', '执行中', '已完成', '已执行', '异常待处理', '已停用'], '待执行');

  clearRef(db.inspectionExecutions, ['planId'], planIds);
  clearRef(db.inspectionExecutions, ['projectId'], projectIds);
  clearRef(db.inspectionExecutions, ['assetId'], assetIds);
  clearRef(db.inspectionExecutions, ['createdBy'], userIds);
  coerceEnum(db.inspectionExecutions, 'result', ['正常', '异常'], '正常');

  clearRef(db.spareParts, ['projectId'], projectIds);
  clearRef(db.spareParts, ['assetId'], assetIds);
  clearRef(db.sparePartMovements, ['sparePartId'], sparePartIds);
  clearRef(db.sparePartMovements, ['projectId'], projectIds);
  clearRef(db.sparePartMovements, ['assetId'], assetIds);
  clearRef(db.sparePartMovements, ['operatorId'], userIds);
  // 'adjust' 是盘点调整流水，响应组装与前端均按独立类型渲染，导入清洗时不能回落为 'outbound'，否则流水语义被篡改。
  coerceEnum(db.sparePartMovements, 'type', ['inbound', 'outbound', 'adjust'], 'outbound');
  const vendorIds = new Set((db.sparePartVendors || []).map(item => item.id).filter(Boolean));
  const purchaseIds = new Set((db.sparePartPurchases || []).map(item => item.id).filter(Boolean));
  clearRef(db.sparePartVendors, ['projectId'], projectIds);
  coerceEnum(db.sparePartVendors, 'status', ['active', 'inactive'], 'active');
  clearRef(db.sparePartPurchases, ['projectId'], projectIds);
  clearRef(db.sparePartPurchases, ['sparePartId'], sparePartIds);
  clearRef(db.sparePartPurchases, ['vendorId'], vendorIds);
  clearRef(db.sparePartPurchases, ['createdBy'], userIds);
  coerceEnum(db.sparePartPurchases, 'status', ['pending', 'approved', 'received', 'cancelled'], 'pending');
  clearRef(db.sparePartInventoryTasks, ['projectId'], projectIds);
  clearRef(db.sparePartInventoryTasks, ['createdBy'], userIds);
  coerceEnum(db.sparePartInventoryTasks, 'status', ['pending', 'running', 'completed'], 'pending');

  clearRef(db.changeRecords, ['projectId'], projectIds);
  clearRef(db.changeRecords, ['assetId'], assetIds);
  clearRef(db.changeRecords, ['approverId', 'customerId', 'createdBy'], userIds);
  clearRef(db.changeRecords, ['approvalId'], approvalIds);
  coerceEnum(db.changeRecords, 'status', ['待运维审批', '待客户确认', '已通过', '已驳回'], '待运维审批');
  coerceEnum(db.changeRecords, 'riskLevel', ['低', '中', '高'], '中');

  clearRef(db.incidentRecords, ['projectId'], projectIds);
  clearRef(db.incidentRecords, ['assetId'], assetIds);
  clearRef(db.incidentRecords, ['createdBy'], userIds);
  coerceEnum(db.incidentRecords, 'severity', incidentSeverityOptions, '中');
  coerceEnum(db.incidentRecords, 'status', incidentStatusOptions, '处理中');
  coerceEnum(db.incidentRecords, 'slaStatus', incidentSlaStatusOptions, '正常');

  clearRef(db.tickets, ['projectId'], projectIds);
  clearRef(db.tickets, ['assetId'], assetIds);
  clearRef(db.tickets, ['assigneeId', 'dispatcherId', 'createdBy'], userIds);
  coerceEnum(db.tickets, 'priority', ticketPriorityOptions, '中');
  coerceEnum(db.tickets, 'status', ticketStatusOptions, '待接单');
  coerceEnum(db.tickets, 'category', ticketCategoryOptions, '其他');
  coerceEnum(db.tickets, 'slaStatus', incidentSlaStatusOptions, '正常');

  clearRef(db.dutyShifts, ['projectId'], projectIds);
  clearRef(db.dutyShifts, ['primaryUserId', 'backupUserId', 'handoverBy', 'receivedBy', 'createdBy'], userIds);
  coerceEnum(db.dutyShifts, 'status', dutyShiftStatusOptions, '待开始');

  clearRef(db.approvals, ['projectId'], projectIds);
  clearRef(db.approvals, ['requestedBy', 'approvedBy', 'approverId', 'customerId'], userIds);
  coerceEnum(db.approvals, 'status', ['待运维审批', '待客户确认', '已通过', '已驳回'], '待运维审批');
  coerceEnum(db.approvals, 'currentStage', ['approver', 'customer', 'completed'], 'approver');

  clearRef(db.notifications, ['projectId'], projectIds);
  coerceEnum(db.notifications, 'level', notificationLevelOptions, 'info');

  clearRef(db.monitorAlerts, ['projectId'], projectIds);
  clearRef(db.monitorAlerts, ['assetId'], assetIds);
  clearRef(db.monitorAlerts, ['acknowledgedBy', 'silencedBy'], userIds);
  coerceEnum(db.monitorAlerts, 'metric', MONITOR_ALERT_METRICS, 'availability');
  coerceEnum(db.monitorAlerts, 'level', notificationLevelOptions, 'warning');
  coerceEnum(db.monitorAlerts, 'status', ['open', 'acknowledged', 'resolved'], 'open');
  // 资产不存在时清空 assetId 会导致告警变成跨项目残留；直接剔除失效告警更符合引用完整性。
  db.monitorAlerts = (db.monitorAlerts || []).filter(item => item && assetIds.has(item.assetId));

  clearRef(db.monitorMaintenanceWindows, ['projectId'], projectIds);
  clearRef(db.monitorMaintenanceWindows, ['createdBy'], userIds);
  for (const item of db.monitorMaintenanceWindows || []) {
    if (!item || typeof item !== 'object') continue;
    item.assetIds = (Array.isArray(item.assetIds) ? item.assetIds : []).filter(assetId => assetIds.has(assetId));
  }

  clearRef(db.notificationChannels, ['projectId'], projectIds);
  for (const item of db.notificationChannels || []) {
    if (!item || typeof item !== 'object') continue;
    item.events = (Array.isArray(item.events) ? item.events : []).filter(event => notificationEventOptions.some(option => option.value === event));
    item.toAddresses = (Array.isArray(item.toAddresses) ? item.toAddresses : []).filter(Boolean);
  }

  clearRef(db.knowledgeBase, ['projectId'], projectIds);
  clearRef(db.knowledgeBase, ['createdBy'], userIds);

  clearRef(db.documents, ['projectId'], projectIds);
  clearRef(db.documents, ['createdBy'], userIds);
  coerceEnum(db.documents, 'type', DOCUMENT_TYPES, 'device');

  clearRef(db.workReports, ['projectId'], projectIds);
  clearRef(db.workReports, ['userId', 'reviewedBy'], userIds);

  clearRef(db.aiInspectionTargets, ['projectId'], projectIds);
  clearRef(db.aiInspectionTargets, ['assetId'], assetIds);
  clearRef(db.aiInspectionTargets, ['createdBy'], userIds);
  clearRef(db.aiInspectionTemplates, ['projectId'], projectIds);
  clearRef(db.aiInspectionTemplates, ['createdBy'], userIds);
  clearRef(db.aiInspectionTasks, ['projectId'], projectIds);
  clearRef(db.aiInspectionTasks, ['targetId'], targetIds);
  clearRef(db.aiInspectionTasks, ['templateId'], templateIds);
  clearRef(db.aiInspectionTasks, ['createdBy'], userIds);
  coerceEnum(db.aiInspectionTasks, 'status', ['待执行', '执行中', '已完成', '失败', '已停用'], '待执行');

  clearRef(db.aiInspectionResults, ['projectId'], projectIds);
  clearRef(db.aiInspectionResults, ['taskId'], taskIds);
  clearRef(db.aiInspectionResults, ['targetId'], targetIds);
  clearRef(db.aiInspectionResults, ['templateId'], templateIds);
  coerceEnum(db.aiInspectionResults, 'level', ['正常', '关注', '异常', '严重'], '正常');

  clearRef(db.configBackupPlans, ['projectId'], projectIds);
  clearRef(db.configBackupPlans, ['targetId'], targetIds);
  clearRef(db.configBackupPlans, ['createdBy'], userIds);
  clearRef(db.configBackupRecords, ['planId'], cfgPlanIds);
  clearRef(db.configBackupRecords, ['projectId'], projectIds);
  clearRef(db.configBackupRecords, ['targetId'], targetIds);
  clearRef(db.configBackupRecords, ['assetId'], assetIds);
  clearRef(db.configBackupRecords, ['createdBy'], userIds);

  clearRef(db.sessions, ['userId'], userIds);

  if (db.topologyLayouts && db.topologyLayouts.positions && typeof db.topologyLayouts.positions === 'object') {
    for (const projectId of Object.keys(db.topologyLayouts.positions)) {
      if (!projectIds.has(projectId)) {
        delete db.topologyLayouts.positions[projectId];
        continue;
      }
      const positions = db.topologyLayouts.positions[projectId];
      if (!positions || typeof positions !== 'object') continue;
      for (const assetId of Object.keys(positions)) {
        if (!assetIds.has(assetId)) delete positions[assetId];
      }
    }
  }
  return db;
}

function buildImportedDbPreservingCurrentSession(raw, currentUser, currentSessionToken, currentSession) {
  const nextDb = normalizeDb(raw);
  if (currentUser) {
    // 导入快照可能含同 ID 但被停用/降权的账号，强制以当前登录账号覆盖，避免导入后把自己锁在系统外。
    nextDb.users = [...(nextDb.users || []).filter(item => item.id !== currentUser.id), currentUser];
  }
  nextDb.sessions = currentSessionToken && currentSession && currentUser ? [{
    token: currentSessionToken,
    userId: currentUser.id,
    createdAt: currentSession.createdAt || now(),
    lastActivityAt: currentSession.lastActivityAt || now(),
    expiresAt: currentSession.expiresAt || new Date(Date.now() + sessionMaxAgeSeconds * 1000).toISOString()
  }] : [];
  sanitizeImportedData(nextDb);
  return nextDb;
}

async function collectDocumentAttachments(documents) {
  const collected = [];
  for (const doc of documents || []) {
    if (!doc.attachmentPath || !isDocumentAttachmentPathSafe(doc.attachmentPath)) continue;
    let content;
    try {
      content = await fs.promises.readFile(doc.attachmentPath);
    } catch (_) {
      continue;
    }
    collected.push({
      documentId: doc.id,
      attachmentName: doc.attachmentName || path.basename(doc.attachmentPath),
      dataBase64: content.toString('base64')
    });
  }
  return collected;
}

async function restoreDocumentAttachments(db, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return;
  for (const item of attachments) {
    const target = (db.documents || []).find(doc => doc.id === item.documentId);
    if (!target || !item.dataBase64) continue;
    const attachmentName = sanitizeUploadFilename(item.attachmentName || target.attachmentName || 'attachment');
    const docDir = path.join(documentsUploadDir, target.id);
    await fs.promises.mkdir(docDir, { recursive: true });
    const attachmentPath = resolveSafeChildPath(docDir, attachmentName);
    const content = Buffer.from(String(item.dataBase64), 'base64');
    await fs.promises.writeFile(attachmentPath, content);
    target.attachmentName = attachmentName;
    target.attachmentPath = attachmentPath;
    target.attachmentSize = content.length;
  }
}

// 导入会整体替换 documents 数据集，需清理残留自旧数据集、已不被引用的资料附件目录，
// 否则磁盘会长期保留不可达文件。仅在落库成功后调用，避免写库失败时误删旧数据附件。
function pruneDocumentAttachmentDirs(db) {
  const keep = new Set((db.documents || []).map(doc => doc.id));
  let names = [];
  try { names = fs.readdirSync(documentsUploadDir); } catch (_) { return; }
  for (const name of names) {
    if (keep.has(name)) continue;
    try { fs.rmSync(path.join(documentsUploadDir, name), { recursive: true, force: true }); } catch (_) {}
  }
}

function collectBackupFiles(dirPath, archived) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const stat = fs.statSync(path.join(dirPath, name));
      return {
        name,
        archived,
        size: stat.size,
        createdAt: stat.mtime.toISOString().replace('T', ' '),
        href: `/api/system/backups/${encodeURIComponent(name)}${archived ? '?archived=1' : ''}`
      };
    });
}

// 备份文件分布在「可恢复区」(backupDir) 与「归档区」(backupArchiveDir)。
// 归档区文件之前对用户完全不可见、不可恢复，这里一并列出，前端按 archived 标记区分展示。
function listBackupFiles() {
  return collectBackupFiles(backupDir, false)
    .concat(collectBackupFiles(backupArchiveDir, true))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// 解析备份文件名到磁盘路径，archived 决定去可恢复区还是归档区查找，
// 统一做 basename 与目录越界校验，避免 path traversal。
function resolveBackupFilePath(rawFilename, archived) {
  const decoded = decodeURIComponent(String(rawFilename || ''));
  const filename = path.basename(decoded);
  if (!filename || filename !== decoded || !filename.endsWith('.json')) return '';
  const dir = archived ? backupArchiveDir : backupDir;
  const filePath = path.join(dir, filename);
  if (!filePath.startsWith(dir + path.sep) || !fs.existsSync(filePath)) return '';
  return filePath;
}

// 清空目录内容但保留目录本身（用于数据库初始化时清掉已失效的资料附件）。
function clearDirectoryContents(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const name of fs.readdirSync(dirPath)) {
    fs.rmSync(path.join(dirPath, name), { recursive: true, force: true });
  }
}

// 连接级故障才值得立即重试；语义错误（约束冲突、SQL 写错）重试没有意义。
const transientStorageErrorCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'ER_CON_COUNT_ERROR',
  'ER_LOCK_WAIT_TIMEOUT', 'ER_SERVER_SHUTDOWN'
]);

function isTransientStorageError(error) {
  if (!error) return false;
  if (error.code === 'STORAGE_BACKOFF' || error.code === 'STORAGE_UNAVAILABLE') return true;
  if (transientStorageErrorCodes.has(String(error.code || ''))) return true;
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection lost|Server shutdown in progress|Cannot enqueue/i
    .test(String(error.message || ''));
}

// 单条连接失效可以立刻重试；数据库整体不可达则直接失败，让调用方走退避与降级。
function isRetryableInPlace(error) {
  return /PROTOCOL_CONNECTION_LOST|ECONNRESET|EPIPE|Cannot enqueue|Connection lost/i
    .test(`${error && error.code || ''} ${error && error.message || ''}`);
}

// 并发请求可能刚好在别的请求重建连接池的窗口内访问；此时按连接级故障处理，走重连而非 500。
function requireMySqlPool() {
  if (!mysqlPool) {
    const error = new Error('MySQL 连接池尚未就绪');
    error.code = 'PROTOCOL_CONNECTION_LOST';
    throw error;
  }
  return mysqlPool;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 有些故障表现为「TCP 已连上但不再响应」，此时连接超时不会生效，需要请求级兜底。
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 数据库短暂不可用时，后台任务每个周期都会失败；合并日志避免刷屏误导运维。
const storageFailureLogState = { lastAt: 0, suppressed: 0 };
function logStorageFailure(context, error) {
  if (!isTransientStorageError(error)) {
    console.error(`${context}: ${error.message}`);
    return;
  }
  const nowTs = Date.now();
  if (nowTs - storageFailureLogState.lastAt < 60000) {
    storageFailureLogState.suppressed += 1;
    return;
  }
  const suppressed = storageFailureLogState.suppressed;
  storageFailureLogState.lastAt = nowTs;
  storageFailureLogState.suppressed = 0;
  const suffix = suppressed ? `（已合并 ${suppressed} 条同类日志）` : '';
  console.warn(`${context}: 数据存储暂时不可用（${error.message}），将在后续周期自动重试${suffix}`);
}

const mysqlPoolOptions = {
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // 数据库不可达时默认会等满 10 秒，期间请求一直挂起；5 秒内失败交给上层降级。
  connectTimeout: 5000,
  // MySQL 或中间网关会清理长时间空闲连接，保活可避免第一次请求必定踩到断连。
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 10,
  idleTimeout: 60000
};

// 连接已建立但对端不响应时，connectTimeout 不会生效；每条语句都需要独立兜底。
const MYSQL_QUERY_TIMEOUT_MS = 15000;
const MYSQL_TX_TIMEOUT_MS = 60000;

async function ensureMySqlReady() {
  if (mysqlReadyPromise) return mysqlReadyPromise;
  // 失败后短时间内直接拒绝，避免数据库宕机时每个请求都排队等 connectTimeout。
  const backoffMs = mysqlUnavailableUntil - Date.now();
  if (backoffMs > 0) {
    const error = new Error(`数据存储暂时不可用，${Math.ceil(backoffMs / 1000)} 秒后重试`);
    error.code = 'STORAGE_BACKOFF';
    throw error;
  }
  const promise = (async () => {
    // 建库阶段目标库可能还不存在，连接必须不带 database。
    const bootstrapPool = mysql.createPool({ ...mysqlPoolOptions, database: undefined });
    try {
      await withTimeout(
        bootstrapPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`),
        MYSQL_QUERY_TIMEOUT_MS,
        'MySQL 建库超时'
      );
    } finally {
      await bootstrapPool.end().catch(() => {});
    }
    mysqlPool = mysql.createPool({ ...mysqlPoolOptions, charset: 'utf8mb4' });
    await withTimeout(mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS app_state (
          state_key VARCHAR(64) PRIMARY KEY,
          state_json LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `), MYSQL_QUERY_TIMEOUT_MS, 'MySQL 建表超时');
    for (const key of dbCollectionKeys) {
      const table = collectionTableName(key);
      await withTimeout(mysqlPool.query(`
          CREATE TABLE IF NOT EXISTS \`${table}\` (
            id VARCHAR(191) NOT NULL,
            payload LONGTEXT NOT NULL,
            batch_id BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `), MYSQL_QUERY_TIMEOUT_MS, 'MySQL 建表超时');
    }
    mysqlAppStateMigrated = false;
    mysqlReadyFailures = 0;
    mysqlUnavailableUntil = 0;
  })();
  mysqlReadyPromise = promise;
  try {
    await promise;
  } catch (error) {
    // 共享同一个 promise 的调用方都会收到拒绝，只允许最先到达的一方回收连接池，
    // 否则可能误关其它请求随后刚重建的新池。
    if (mysqlReadyPromise === promise) {
      mysqlReadyPromise = null;
      // 建表阶段失败时 mysqlPool 已创建但不可用，必须回收，否则下次重建会泄漏连接。
      const failedPool = mysqlPool;
      mysqlPool = null;
      if (failedPool) failedPool.end().catch(() => {});
      mysqlReadyFailures += 1;
      // 指数退避，避免长时间宕机时每个写请求都反复等待连接超时。
      const backoffMs = Math.min(30000, 3000 * 2 ** (mysqlReadyFailures - 1));
      mysqlUnavailableUntil = Date.now() + backoffMs;
    }
    throw error;
  }
  return promise;
}

function readDbFromFile() {
  if (!fs.existsSync(dbPath)) {
    const initial = seed();
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2), { mode: 0o600 });
    return initial;
  }
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const normalized = normalizeDb(raw);
  const current = JSON.stringify(raw);
  const next = JSON.stringify(normalized);
  if (current !== next) {
    fs.writeFileSync(dbPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  }
  return normalized;
}

function writeDbToFile(db) {
  rememberLiveDb(db);
  if (allowFileDbFallback || fileDbNeedsSyncToMySql) {
    // 快照包含口令哈希与加密凭据，文件权限限制为仅运行用户可读写。
    fs.writeFileSync(dbPath, JSON.stringify(pickDbCollections(db), null, 2), { mode: 0o600 });
  }
}

let latestFileDbCache = null;
let fileDbNeedsSyncToMySql = false;

function readDbInternalSync() {
  if (latestFileDbCache) return latestFileDbCache;
  // 启动阶段同步读取（WebSocket 鉴权、自动备份等）可能早于异步 readDb() 完成 MySQL 加载。
  // 此时按需读取本地文件作为临时快照，但不写入 latestFileDbCache，避免用陈旧的
  // data/db.json 遮蔽 MySQL 中的权威数据（否则每次重启都会回滚到旧快照）。
  if (!fs.existsSync(dbPath)) {
    return seed();
  }
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  return normalizeDb(raw);
}

let mysqlResetMutex = Promise.resolve();

function snapshotFromCache() {
  const cached = cloneDbSnapshot(latestFileDbCache);
  cached._seq = dbSequence;
  cached._normalized = true;
  // 读取时的状态引用；后续写入会替换缓存对象而非原地改写，因此可用于计算增量。
  cached._base = latestFileDbCache;
  return cached;
}

async function readDbOnce() {
  // 已加载权威快照后，读请求直接走内存：MySQL 短暂故障期间查询与页面仍可用，
  // 写操作会在 writeDb 明确失败并返回 503，避免一次存储抖动让整站不可用。
  if (latestFileDbCache && !fileDbNeedsSyncToMySql) return snapshotFromCache();
  await ensureMySqlReady();
  await syncFileDbToMySqlIfNeeded();
  // 迁移检查只在新连接池上做一次，否则每个读请求都要多跑一条 COUNT 查询。
  if (!mysqlAppStateMigrated) {
    await migrateAppStateToCollectionTablesIfNeeded();
    mysqlAppStateMigrated = true;
  }
  if (latestFileDbCache) return snapshotFromCache();
  const raw = await readCollectionsFromMySql();
  const hasCollectionData = dbCollectionKeys.some(key => {
    const value = raw[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value && Object.keys(value).length);
  });
  if (!hasCollectionData) {
    const initial = readDbFromFile();
    const initialBase = cloneDbSnapshot(initial);
    await writeDb(initial, { silent: true });
    fileDbNeedsSyncToMySql = false;
    initial._seq = dbSequence;
    initial._normalized = true;
    initial._base = initialBase;
    return initial;
  }
  const normalized = normalizeDb(raw);
  rememberLiveDb(normalized);
  const snapshot = cloneDbSnapshot(normalized);
  snapshot._seq = dbSequence;
  snapshot._normalized = true;
  snapshot._base = cloneDbSnapshot(normalized);
  return snapshot;
}

async function readDb() {
  try {
    return await readDbOnce();
  } catch (error) {
    // 只有连接级故障才回收连接池；语义错误保留现有连接，避免无谓重建。
    const failedPool = isTransientStorageError(error) ? mysqlPool : null;
    if (failedPool) await resetMySqlConnection(failedPool);
    if (allowFileDbFallback) {
      const fallback = readDbFromFile();
      rememberLiveDb(fallback);
      // 文件快照被当作权威数据使用，数据库恢复后必须回写，否则后续读取会一直停留在旧快照。
      fileDbNeedsSyncToMySql = true;
      const fallbackBase = cloneDbSnapshot(fallback);
      fallback._seq = dbSequence;
      fallback._normalized = true;
      fallback._base = fallbackBase;
      return fallback;
    }
    // 已进入退避窗口时直接失败，避免重试把 5 秒连接超时再叠加一次。
    if (error.code === 'STORAGE_BACKOFF' || !isRetryableInPlace(error)) throw error;
    return await readDbOnce();
  }
}

async function resetMySqlConnection(expectedPool = null) {
  let release;
  const lock = new Promise(resolve => { release = resolve; });
  const previous = mysqlResetMutex;
  mysqlResetMutex = lock;
  await previous;
  try {
    // 并发失败时只允许回收真正出错的那一个连接池，避免把其它请求刚重建的池一起关掉。
    if (expectedPool && mysqlPool && mysqlPool !== expectedPool) return;
    const pool = mysqlPool;
    mysqlPool = null;
    mysqlReadyPromise = null;
    mysqlAppStateMigrated = false;
    if (pool) {
      // end() 在数据库无响应时可能长时间不回调，回收本身不能阻塞请求。
      await Promise.race([pool.end().catch(() => {}), sleep(3000)]);
    }
  } finally {
    release();
  }
}

async function writeCollectionRows(connection, key, value) {
  const table = collectionTableName(key);
  const batchId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  if (isObjectCollection(key)) {
    await connection.query(
      `INSERT INTO \`${table}\` (id, payload, batch_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), batch_id = VALUES(batch_id)`,
      [OBJECT_ROOT_ID, JSON.stringify(value && typeof value === 'object' ? value : {}), batchId]
    );
    await connection.query(`DELETE FROM \`${table}\` WHERE batch_id <> ?`, [batchId]);
    return;
  }
  const items = Array.isArray(value) ? value : [];
  if (!items.length) {
    await connection.query(`DELETE FROM \`${table}\``);
    return;
  }
  // 巡检附件以 base64 内联在记录里，按条数分批可能拼出超过 max_allowed_packet 的单条 SQL。
  // 同时按累计 JSON 字节数切分，保证单条 INSERT 远低于默认 64MB 上限。
  const MAX_INSERT_BYTES = 4 * 1024 * 1024;
  const MAX_INSERT_ROWS = 200;
  let chunk = [];
  let chunkBytes = 0;
  const flushChunk = async () => {
    if (!chunk.length) return;
    const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
    const params = [];
    chunk.forEach(entry => {
      params.push(entry.id, entry.payload, batchId);
    });
    await connection.query(
      `INSERT INTO \`${table}\` (id, payload, batch_id) VALUES ${placeholders} ON DUPLICATE KEY UPDATE payload = VALUES(payload), batch_id = VALUES(batch_id)`,
      params
    );
    chunk = [];
    chunkBytes = 0;
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const payload = JSON.stringify(item);
    const size = Buffer.byteLength(payload) + 64;
    if (chunk.length && (chunkBytes + size > MAX_INSERT_BYTES || chunk.length >= MAX_INSERT_ROWS)) {
      await flushChunk();
    }
    chunk.push({
      // 会话没有 id，用 token 作为稳定主键，避免重复批次行在主键自增时无限累积。
      id: item && item.id ? String(item.id) : (key === 'sessions' && item && item.token ? `token_${item.token}` : `__idx_${index}`),
      payload
    });
    chunkBytes += size;
  }
  await flushChunk();
  await connection.query(`DELETE FROM \`${table}\` WHERE batch_id <> ?`, [batchId]);
}

async function readCollectionFromMySql(key) {
  const table = collectionTableName(key);
  const [rows] = await withTimeout(
    requireMySqlPool().query(`SELECT id, payload FROM \`${table}\``),
    MYSQL_QUERY_TIMEOUT_MS,
    `读取 ${key} 超时`
  );
  if (isObjectCollection(key)) {
    const root = rows.find(row => row.id === OBJECT_ROOT_ID);
    return root ? parseJsonPayload(root.payload, {}) : {};
  }
  return rows
    .filter(row => row.id !== OBJECT_ROOT_ID)
    .map(row => parseJsonPayload(row.payload, null))
    .filter(item => item && typeof item === 'object');
}

async function readCollectionsFromMySql() {
  const raw = {};
  await Promise.all(dbCollectionKeys.map(async key => {
    raw[key] = await readCollectionFromMySql(key);
  }));
  return raw;
}

async function migrateAppStateToCollectionTablesIfNeeded() {
  const pool = requireMySqlPool();
  const usersTable = collectionTableName('users');
  const [countRows] = await withTimeout(
    pool.query(`SELECT COUNT(*) AS c FROM \`${usersTable}\``),
    MYSQL_QUERY_TIMEOUT_MS,
    '检查集合表迁移状态超时'
  );
  if (Number(countRows[0]?.c || 0) > 0) return;
  const [stateRows] = await withTimeout(
    pool.query('SELECT state_key, state_json FROM app_state'),
    MYSQL_QUERY_TIMEOUT_MS,
    '读取旧版状态表超时'
  );
  if (!stateRows.length) return;
  const raw = {};
  for (const row of stateRows) {
    raw[row.state_key] = parseJsonPayload(row.state_json, isObjectCollection(row.state_key) ? {} : []);
  }
  const normalized = normalizeDb(raw);
  await writeNormalizedDbToMySql(normalized, dbCollectionKeys);
}

async function writeNormalizedDbToMySql(normalized, keys = dbCollectionKeys) {
  const connection = await withTimeout(
    requireMySqlPool().getConnection(),
    10000,
    'MySQL 连接获取超时'
  );
  let destroyed = false;
  try {
    await withTimeout((async () => {
      await connection.beginTransaction();
      const targetKeys = keys.length ? keys : dbCollectionKeys;
      for (const key of targetKeys) {
        const value = normalized[key] !== undefined ? normalized[key] : (isObjectCollection(key) ? {} : []);
        await writeCollectionRows(connection, key, value);
      }
      await connection.commit();
    })(), MYSQL_TX_TIMEOUT_MS, 'MySQL 事务超时');
  } catch (error) {
    if (error.code === 'ETIMEDOUT') {
      // 语句仍在服务端执行时不能归还连接，直接销毁让 MySQL 回滚未提交事务。
      destroyed = true;
      try { connection.destroy(); } catch (_) {}
    } else {
      try { await connection.rollback(); } catch (_) {}
    }
    throw error;
  } finally {
    if (!destroyed) connection.release();
  }
}

async function syncFileDbToMySqlIfNeeded() {
  if (!fileDbNeedsSyncToMySql) return;
  const normalized = normalizeDb(readDbInternalSync());
  await writeNormalizedDbToMySql(normalized);
  writeDbToFile(normalized);
  fileDbNeedsSyncToMySql = false;
}

let dbWriteLock = Promise.resolve();
let dbSequence = 0;

// 串行化「读取最新状态 → 校验 → 修改 → 落库」这类临界区（库存、用户名唯一性、登录失败计数），
// 避免并发请求基于同一旧快照各自写入造成丢失更新。锁内必须重新 readDb() 以拿到最新状态。
let dbMutationLock = Promise.resolve();
async function withDbMutationLock(fn) {
  const previous = dbMutationLock;
  let release;
  dbMutationLock = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function sameJsonValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// 只把相对读取时快照真正发生变化的字段写回，避免用旧值覆盖并发请求写入的新数据。
function applyStaleRecordDelta(targetItem, baseItem, curItem) {
  if (baseItem === curItem) {
    // 浅拷贝集合（通知、AI 结果）原地修改了共享记录，按目标与当前值差异回填。
    for (const field of Object.keys(curItem)) {
      if (field === '_dirty') continue;
      if (!sameJsonValue(targetItem[field], curItem[field])) targetItem[field] = curItem[field];
    }
    return;
  }
  for (const field of Object.keys(curItem)) {
    if (field === '_dirty') continue;
    if (!sameJsonValue(baseItem[field], curItem[field])) targetItem[field] = curItem[field];
  }
  for (const field of Object.keys(baseItem)) {
    if (!(field in curItem) && field in targetItem) delete targetItem[field];
  }
}

// 陈旧快照的数组集合并：在最新状态上补齐新增、按字段更新、并让本请求的删除真正生效。
// 返回新数组（已变化）或 null（无变化），避免原地改写缓存记录而干扰脏检测。
function mergeStaleArrayCollection(target, baseList, curList) {
  const curById = new Map();
  curList.forEach(item => { if (item && item.id) curById.set(item.id, item); });
  const baseById = new Map();
  baseList.forEach(item => { if (item && item.id) baseById.set(item.id, item); });
  const result = [];
  const seenIds = new Set();
  let changed = false;
  for (const item of target) {
    if (!item || !item.id) { result.push(item); continue; }
    if (!curById.has(item.id)) {
      // 本请求删除了该记录；其他请求新增的记录不在 base 中，需保留。
      if (baseById.has(item.id)) { changed = true; continue; }
      result.push(item);
      continue;
    }
    seenIds.add(item.id);
    const baseItem = baseById.get(item.id);
    const curItem = curById.get(item.id);
    if (baseItem && (baseItem === curItem || !sameJsonValue(baseItem, curItem))) {
      const copy = { ...item };
      applyStaleRecordDelta(copy, baseItem, curItem);
      result.push(copy);
      changed = true;
    } else {
      result.push(item);
    }
  }
  for (const item of curList) {
    if (!item || !item.id) { result.push(item); changed = true; continue; }
    if (seenIds.has(item.id)) continue;
    // 读取时已存在、但已被并发请求删除的记录不再补回，尊重删除结果。
    if (baseById.has(item.id)) continue;
    result.push(item);
    changed = true;
  }
  return changed ? result : null;
}

// 会话集合没有 id，以 token 为键做增量合并：在最新会话表上应用本请求的「新增/删除」，
// 避免并发登录或登出时用整表覆盖把彼此刚建立的会话删掉。
function mergeStaleSessions(targetList, baseList, curList) {
  const baseTokens = new Set((baseList || []).map(item => item && item.token).filter(Boolean));
  const targetTokens = new Set((curList || []).map(item => item && item.token).filter(Boolean));
  const result = [];
  const seen = new Set();
  for (const item of targetList || []) {
    if (!item || !item.token) { result.push(item); continue; }
    // 本请求读取时存在、且本请求已删除的会话不再保留。
    if (baseTokens.has(item.token) && !targetTokens.has(item.token)) continue;
    // 同一 token 只保留一条，重复记录会让会话表行数随登录次数持续膨胀。
    if (seen.has(item.token)) continue;
    result.push(item);
    seen.add(item.token);
  }
  for (const item of curList || []) {
    if (!item || !item.token) continue;
    if (seen.has(item.token)) continue;
    result.push(item);
    seen.add(item.token);
  }
  return result;
}

// 无读取基线时退回按 id 合并，保证不会用旧记录整体覆盖新记录。
function mergeLegacyArrayCollection(target, curList) {
  const result = target.slice();
  const indexById = new Map();
  result.forEach((item, index) => { if (item && item.id) indexById.set(item.id, index); });
  let changed = false;
  for (const item of curList) {
    if (!item || !item.id) { result.push(item); changed = true; continue; }
    const index = indexById.get(item.id);
    if (index === undefined) {
      indexById.set(item.id, result.length);
      result.push(item);
      changed = true;
      continue;
    }
    result[index] = { ...result[index], ...item };
    changed = true;
  }
  return changed ? result : null;
}

// 对象型集合（systemConfig / runtimeState / topologyLayouts）同样按字段增量合并。
function mergeStaleObjectCollection(targetRoot, key, base, cur) {
  const curVal = cur[key];
  if (!curVal || typeof curVal !== 'object') return false;
  const baseVal = base ? base[key] : undefined;
  if (!baseVal || typeof baseVal !== 'object' || baseVal === curVal) {
    targetRoot[key] = curVal;
    return true;
  }
  const targetVal = targetRoot[key] && typeof targetRoot[key] === 'object' ? { ...targetRoot[key] } : {};
  let changed = false;
  for (const field of Object.keys(curVal)) {
    if (!sameJsonValue(baseVal[field], curVal[field])) {
      targetVal[field] = curVal[field];
      changed = true;
    }
  }
  for (const field of Object.keys(baseVal)) {
    if (!(field in curVal) && field in targetVal) {
      delete targetVal[field];
      changed = true;
    }
  }
  if (!changed) return false;
  targetRoot[key] = targetVal;
  return true;
}

async function writeDb(db, options = {}) {
  // 会话活跃度只携带增量时间戳，冷启动时没有权威基线，落库会把整个 data/db.json 覆盖进 MySQL。
  if (options.sessionActivityByToken instanceof Map && !latestFileDbCache) return;
  const previousLock = dbWriteLock;
  let releaseLock;
  dbWriteLock = new Promise(resolve => { releaseLock = resolve; });
  await previousLock;
  try {
    let writeTarget = db;
    const forcedDirtyKeys = new Set();
    if (options.sessionActivityByToken instanceof Map) {
      writeTarget = readDbInternalSync();
      for (const session of writeTarget.sessions || []) {
        const activity = options.sessionActivityByToken.get(session.token);
        if (activity && String(activity) > String(session.lastActivityAt || '')) {
          session.lastActivityAt = activity;
        }
      }
      writeTarget._normalized = true;
      forcedDirtyKeys.add('sessions');
    } else if (db._seq !== undefined && db._seq < dbSequence) {
      const latest = readDbInternalSync();
      const replaceCollections = new Set(options.replaceCollections || []);
      const base = db._base && typeof db._base === 'object' ? db._base : null;
      // 在最新状态的浅拷贝上合并，保证缓存记录不被原地改写从而影响脏检测与其他请求的基线。
      const merged = { ...latest };
      for (const key of dbCollectionKeys) {
        if (replaceCollections.has(key)) {
          if (key === 'sessions') {
            const baseSessions = base && Array.isArray(base.sessions) ? base.sessions : [];
            merged.sessions = mergeStaleSessions(
              Array.isArray(latest.sessions) ? latest.sessions : [],
              baseSessions,
              Array.isArray(writeTarget.sessions) ? writeTarget.sessions : []
            );
            forcedDirtyKeys.add('sessions');
            continue;
          }
          merged[key] = Array.isArray(writeTarget[key]) ? [...writeTarget[key]] : writeTarget[key];
          forcedDirtyKeys.add(key);
          continue;
        }
        if (isObjectCollection(key)) {
          if (base && base[key] && typeof base[key] === 'object') {
            if (mergeStaleObjectCollection(merged, key, base, writeTarget)) forcedDirtyKeys.add(key);
          } else if (writeTarget[key] !== undefined) {
            merged[key] = writeTarget[key];
            forcedDirtyKeys.add(key);
          }
          continue;
        }
        if (Array.isArray(latest[key]) && Array.isArray(writeTarget[key])) {
          if (base && Array.isArray(base[key])) {
            const nextList = mergeStaleArrayCollection(latest[key], base[key], writeTarget[key]);
            if (nextList) {
              merged[key] = nextList;
              forcedDirtyKeys.add(key);
            }
          } else {
            const nextList = mergeLegacyArrayCollection(latest[key], writeTarget[key]);
            if (nextList) {
              merged[key] = nextList;
              forcedDirtyKeys.add(key);
            }
          }
        }
      }
      merged._normalized = true;
      writeTarget = merged;
    }
    const normalized = writeTarget._normalized ? pickDbCollections(writeTarget) : normalizeDb(writeTarget);
    // 先同步计算脏集合并发布新状态，再执行异步落库；否则 await 期间序号已推进但缓存仍是旧数据，
    // 会让并发读取拿到「新序号 + 旧快照」并走非陈旧分支覆盖掉刚写入的数据。
    const dirtyKeys = changedCollectionKeys(latestFileDbCache, normalized);
    for (const key of forcedDirtyKeys) {
      if (!dirtyKeys.includes(key)) dirtyKeys.push(key);
    }
    // 记录发布前的内存状态与序号，落库失败时用于回滚。
    const previousLiveDb = latestFileDbCache;
    const previousSequence = dbSequence;
    dbSequence++;
    writeTarget._seq = dbSequence;
    rememberLiveDb(normalized);
    let activePool = null;
    try {
      await ensureMySqlReady();
      activePool = mysqlPool;
      await syncFileDbToMySqlIfNeeded();
      if (shouldInjectDbWriteFailure()) {
        throw new Error('injected database write failure (FORCE_DB_WRITE_FAILURE_FILE)');
      }
      if (dirtyKeys.length) {
        await writeNormalizedDbToMySql(normalized, dirtyKeys);
        dirtyKeys.forEach(key => clearCollectionDirtyFlags(normalized[key]));
      }
      writeDbToFile(normalized);
      fileDbNeedsSyncToMySql = false;
    } catch (error) {
      // 语义错误（如 SQL 约束）保留连接池；只有实际用到的池发生连接级故障才需要重建。
      if (activePool && isTransientStorageError(error)) await resetMySqlConnection(activePool);
      if (allowFileDbFallback) {
        writeDbToFile(normalized);
        fileDbNeedsSyncToMySql = true;
      } else {
        // 落库失败：回滚内存快照与序号，避免接口显示已保存但持久层没有该数据。
        latestFileDbCache = previousLiveDb;
        dbSequence = previousSequence;
        throw error;
      }
    }
    if (!options.silent) broadcastChange('database', {});
  } finally {
    releaseLock();
  }
}

// 导入/恢复快照时校验集合内 ID 字符集，避免可注入 HTML 属性的 ID 进入前端渲染。
const SAFE_RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
function findUnsafeSnapshotId(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  for (const key of dbCollectionKeys) {
    const list = snapshot[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      if (item.id !== undefined && !SAFE_RECORD_ID_PATTERN.test(String(item.id))) {
        return `集合 ${key} 中存在非法 ID`;
      }
    }
  }
  return '';
}

// 解析 multipart/form-data 的 boundary，兼容引号包裹与后续参数（如 charset）。
function parseMultipartBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  return match ? (match[1] || match[2] || '') : '';
}

async function runAiInspectionScheduler() {
  if (shuttingDown) return;
  if (aiInspectionSchedulerRunning) return;
  aiInspectionSchedulerRunning = true;
  try {
    const db = await readDb();
    systemTimezoneOffsetMinutes = db.systemConfig?.timezoneOffset ?? 480;
    refreshMonitorTargetPolicy(db.systemConfig);
    const pendingTaskChanged = await processPendingAiInspectionTasks(db);
    const pendingConfigBackupChanged = await processPendingConfigBackupPlans(db);
    const maintenanceChanged = runMaintenanceTasks(db);
    if (pendingTaskChanged || pendingConfigBackupChanged || maintenanceChanged) {
      await writeDb(db);
    }
  } catch (error) {
    logStorageFailure('AI inspection scheduler failed', error);
  } finally {
    aiInspectionSchedulerRunning = false;
  }
}

let pptxTemplateCache = null;
let aiInspectionSchedulerRunning = false;

// 进程在任务执行中途被中断时，状态会永久停留在「执行中」并阻断后续调度；启动时统一复位一次。
let interruptedRunsRecovered = false;
let interruptedRunsRetryTimer = null;
async function recoverInterruptedRunsOnce() {
  if (interruptedRunsRecovered) return;
  try {
    const db = await readDb();
    let changed = false;
    for (const task of db.aiInspectionTasks || []) {
      if (task.status === '执行中') {
        task.status = task.cycle ? '待执行' : '失败';
        changed = true;
      }
    }
    for (const plan of db.configBackupPlans || []) {
      if (plan.status === '执行中') {
        plan.status = plan.cycle ? '待执行' : '已完成';
        changed = true;
      }
    }
    if (changed) await writeDb(db);
    interruptedRunsRecovered = true;
  } catch (error) {
    logStorageFailure('Interrupted run recovery failed', error);
    // 启动瞬间数据库可能还没就绪，此时不能永久放弃复原，否则任务会一直卡在「执行中」。
    if (isTransientStorageError(error) && !interruptedRunsRetryTimer) {
      const delay = Math.max(5000, (mysqlUnavailableUntil || 0) - Date.now());
      interruptedRunsRetryTimer = setTimeout(() => {
        interruptedRunsRetryTimer = null;
        recoverInterruptedRunsOnce().catch(() => {});
      }, delay);
      interruptedRunsRetryTimer.unref?.();
    }
  }
}

function readPptxTemplate() {
  if (!pptxTemplateCache) {
    pptxTemplateCache = JSON.parse(fs.readFileSync(pptxTemplatePath, 'utf8'));
  }
  return pptxTemplateCache;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
}

function readNetworkStats() {
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2);
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of lines) {
      const [nameRaw, dataRaw] = line.split(':');
      const name = String(nameRaw || '').trim();
      if (!name || name === 'lo') continue;
      const values = String(dataRaw || '').trim().split(/\s+/).map(Number);
      rxBytes += Number(values[0] || 0);
      txBytes += Number(values[8] || 0);
    }
    return { rxBytes, txBytes };
  } catch (error) {
    return { rxBytes: 0, txBytes: 0 };
  }
}

function getSystemLoad() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuCount = os.cpus().length || 1;
  const loadavg = os.loadavg();
  const networkInterfaces = os.networkInterfaces();
  const addresses = Object.entries(networkInterfaces)
    .flatMap(([name, infos]) => (infos || []).filter(info => info && info.family === 'IPv4' && !info.internal).map(info => `${name}: ${info.address}`));
  const networkStats = readNetworkStats();
  let diskTotal = 0;
  let diskFree = 0;
  try {
    const stat = fs.statfsSync(root);
    diskTotal = Number(stat.bsize || stat.frsize || 0) * Number(stat.blocks || 0);
    diskFree = Number(stat.bsize || stat.frsize || 0) * Number(stat.bavail || stat.bfree || 0);
  } catch (error) {
    diskTotal = 0;
    diskFree = 0;
  }
  const diskUsed = Math.max(0, diskTotal - diskFree);
  return {
    checkedAt: now(),
    cpu: {
      count: cpuCount,
      load1: Number(loadavg[0].toFixed(2)),
      load5: Number(loadavg[1].toFixed(2)),
      load15: Number(loadavg[2].toFixed(2)),
      usagePercent: Number(Math.min(100, (loadavg[0] / cpuCount) * 100).toFixed(2))
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      freeBytes: freeMem,
      usagePercent: Number(((usedMem / Math.max(totalMem, 1)) * 100).toFixed(2)),
      totalLabel: formatBytes(totalMem),
      usedLabel: formatBytes(usedMem),
      freeLabel: formatBytes(freeMem)
    },
    disk: {
      totalBytes: diskTotal,
      usedBytes: diskUsed,
      freeBytes: diskFree,
      usagePercent: Number((diskTotal ? (diskUsed / diskTotal) * 100 : 0).toFixed(2)),
      totalLabel: formatBytes(diskTotal),
      usedLabel: formatBytes(diskUsed),
      freeLabel: formatBytes(diskFree)
    },
    network: {
      interfaceCount: addresses.length,
      addresses,
      receivedBytes: networkStats.rxBytes,
      transmittedBytes: networkStats.txBytes,
      receivedLabel: formatBytes(networkStats.rxBytes),
      transmittedLabel: formatBytes(networkStats.txBytes)
    },
    system: {
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(os.uptime()),
      platform: `${os.platform()} ${os.release()}`
    }
  };
}

async function getSystemServicesStatus(db) {
  const checkedAt = now();
  const services = [
    {
      key: 'app',
      name: '平台 Web 服务',
      status: 'running',
      detail: `Node.js 进程运行中，已启动 ${Math.floor(process.uptime())} 秒`,
      checkedAt
    }
  ];
  let pool = null;
  try {
    await ensureMySqlReady();
    pool = requireMySqlPool();
    await withTimeout(pool.query('SELECT 1'), MYSQL_QUERY_TIMEOUT_MS, 'MySQL 健康检查超时');
    services.push({
      key: 'mysql',
      name: 'MySQL 数据库',
      status: 'running',
      // 不返回连接串，避免管理员页面成为内网拓扑与账号信息的泄露点。
      detail: `已连接（数据库 ${dbConfig.database}）`,
      checkedAt
    });
  } catch (error) {
    if (pool && isTransientStorageError(error)) await resetMySqlConnection(pool);
    if (allowFileDbFallback) {
      services.push({
        key: 'mysql',
        name: 'MySQL 数据库',
        status: 'running',
        detail: '文件存储模式（内置数据引擎）',
        checkedAt
      });
    } else {
      services.push({
        key: 'mysql',
        name: 'MySQL 数据库',
        status: 'stopped',
        detail: '数据库连接失败，请检查服务状态与配置',
        checkedAt
      });
    }
  }
  try {
    fs.accessSync(backupDir, fs.constants.R_OK | fs.constants.W_OK);
    services.push({
      key: 'backup-dir',
      name: '备份目录',
      status: 'running',
      detail: '备份目录可读写',
      checkedAt
    });
  } catch (error) {
    services.push({
      key: 'backup-dir',
      name: '备份目录',
      status: 'stopped',
      detail: error.message,
      checkedAt
    });
  }
  const systemConfig = normalizeSystemConfig(db?.systemConfig || {});
  services.push({
    key: 'https-login',
    name: 'HTTPS 登录服务',
    status: systemConfig.httpsLoginEnabled ? httpsServerStatus.status : 'disabled',
    detail: systemConfig.httpsLoginEnabled
      ? `${httpsServerStatus.detail}；${getHttpsCertificateSummary(systemConfig)}`
      : `未启用；${getHttpsCertificateSummary(systemConfig)}`,
    checkedAt
  });
  return services;
}

function createNonce() {
  return crypto.randomBytes(16).toString('base64');
}

function buildNonceHeaderValue(nonce) {
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'`;
}

function buildSecurityHeaders(extraHeaders = {}, nonce = '') {
  // 脚本只允许同源文件与携带本次 nonce 的内联块；样式保留 unsafe-inline 以支持大量行内 style。
  const csp = nonce ? buildNonceHeaderValue(nonce) : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'";
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    // 现场取证需要浏览器定位写入水印，仅允许同源页面使用。
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Content-Security-Policy': csp,
    ...extraHeaders
  };
  if (isProduction) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function json(res, status, data, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  // 接口响应可能包含用户资料、CSRF token、审计日志等，禁止浏览器与中间代理缓存。
  res.writeHead(status, buildSecurityHeaders({
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  }));
  res.end(JSON.stringify(data));
}

function text(res, status, data, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, buildSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders }));
  res.end(data);
}

function createChunkWriter(target) {
  return chunk => new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeListener('drain', onDrain);
      target.removeListener('close', onClose);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('写入目标已关闭')); };
    target.once('close', onClose);
    if (target.write(chunk)) {
      cleanup();
      resolve();
    } else {
      target.once('drain', onDrain);
    }
  });
}

// 按顶层字段与数组元素逐段序列化，避免备份/导出一次性构造完整 JSON 字符串占用大量内存。
async function writeJsonDocument(writeChunk, data) {
  const source = data && typeof data === 'object' ? data : {};
  const keys = Object.keys(source);
  await writeChunk('{');
  for (let i = 0; i < keys.length; i += 1) {
    const value = source[keys[i]];
    await writeChunk(`${i ? ',' : ''}${JSON.stringify(keys[i])}:`);
    if (Array.isArray(value)) {
      await writeChunk('[');
      for (let j = 0; j < value.length; j += 1) {
        await writeChunk(`${j ? ',' : ''}${JSON.stringify(value[j])}`);
      }
      await writeChunk(']');
    } else {
      await writeChunk(JSON.stringify(value));
    }
  }
  await writeChunk('}');
}

async function respondJsonDocument(res, extraHeaders, data) {
  res.writeHead(200, buildSecurityHeaders(extraHeaders));
  try {
    await writeJsonDocument(createChunkWriter(res), data);
    res.end();
  } catch (error) {
    if (!res.writableEnded) res.end();
    throw error;
  }
}

async function writeJsonFileStreaming(filePath, data) {
  // 备份包含完整数据快照与附件，仅允许运行用户读取。
  const stream = fs.createWriteStream(filePath, { mode: 0o600 });
  const finished = new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
  });
  try {
    await writeJsonDocument(createChunkWriter(stream), data);
    stream.end();
    await finished;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function paginateResult(items, query, user) {
  // 单次全量返回仅限管理员，其他角色即使传入 all/unpaged 也退回常规分页，避免一次拉取整库数据。
  const unpagedRequested = query.all === '1' || query.unpaged === '1' || String(query.pageSize || '').toLowerCase() === 'all';
  const unpaged = unpagedRequested && Boolean(user) && user.role === 'admin';
  if (unpaged) {
    const data = Array.isArray(items) ? items : [];
    return { data, page: 1, pageSize: data.length || 0, total: data.length, totalPages: 1, all: true };
  }
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 50));
  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);
  return { data, page, pageSize, total, totalPages };
}

function parseSortQuery(query, items, defaultSort) {
  const sortBy = query.sortBy || defaultSort;
  const direction = query.sortDirection === 'desc' ? -1 : 1;
  if (!sortBy) return items;
  return [...items].sort((a, b) => {
    const va = a[sortBy] ?? '', vb = b[sortBy] ?? '';
    if (typeof va === 'number') return (va - vb) * direction;
    return String(va).localeCompare(String(vb)) * direction;
  });
}

function parseCookies(req) {
  const cookie = req.headers.cookie || '';
  return Object.fromEntries(
    cookie
      .split(';')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        const index = item.indexOf('=');
        const key = item.slice(0, index);
        const raw = item.slice(index + 1);
        let value = raw;
        try {
          value = decodeURIComponent(raw);
        } catch (_) {}
        return [key, value];
      })
  );
}

function readBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    // 按 Buffer 分片收集、结束前统一解码：既避免重复展平字符串造成 O(n^2)，
    // 也避免 Buffer 直接被逐片 toString 时把多字节 UTF-8 字符切坏。
    let receivedBytes = 0;
    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > maxBytes) {
        settled = true;
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(Object.assign(new Error('请求体格式无效'), { status: 400, cause: error }));
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

// 读取 multipart 请求体：按累计字节数限制大小，超限立即销毁连接，
// 避免 Buffer.concat 反复全量拷贝造成 O(n^2) CPU 与内存膨胀。
function readMultipartBody(req, maxBytes, sizeMessage) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
      req.destroy();
    };
    req.on('data', chunk => {
      if (settled) return;
      totalLength += chunk.length;
      if (totalLength > maxBytes) {
        fail({ status: 413, message: sizeMessage || '上传内容过大' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', error => fail(error));
    req.on('aborted', () => fail({ status: 400, message: '上传已中断' }));
  });
}

function getSessionCsrfToken(token) {
  if (!token) return '';
  return crypto.createHmac('sha256', DOCUMENT_TOKEN_SECRET).update(String(token)).digest('hex');
}

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function isCsrfExemptPath(pathname) {
  return pathname === '/api/login'
    || pathname === '/api/login/2fa'
    || pathname === '/api/forgot-password/verify'
    || pathname === '/api/forgot-password/reset'
    || pathname.startsWith('/api/auth/oidc/');
}

// 强制绑定动态令牌期间仍需访问的接口：绑定/关闭、会话信息、退出、健康检查与验证码。
function isTwoFactorEnrollmentExemptPath(pathname) {
  return pathname === '/api/health'
    || pathname === '/api/ready'
    || pathname === '/api/captcha'
    || pathname === '/api/session'
    || pathname === '/api/login'
    || pathname === '/api/login/2fa'
    || pathname === '/api/logout'
    || pathname === '/api/https-certificate/notice'
    || pathname.startsWith('/api/account/2fa')
    || pathname.startsWith('/api/auth/');
}

function validateCsrf(req, res, db, pathname) {
  if (!isUnsafeMethod(req.method) || isCsrfExemptPath(pathname)) return true;
  const sessionToken = getSessionToken(req);
  const session = (db.sessions || []).find(item => item.token === sessionToken);
  if (!session) {
    if (pathname === '/api/register' || pathname === '/api/auth/ldap') {
      const captchaToken = String(req.headers['x-captcha-token'] || '').trim();
      const expected = captchaToken ? getSessionCsrfToken(captchaToken) : '';
      const received = String(req.headers['x-csrf-token'] || '');
      const valid = expected && received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
      if (!valid) {
        json(res, 403, { message: 'CSRF 校验失败，请刷新验证码后重试' });
        return false;
      }
    }
    return true;
  }
  const expected = getSessionCsrfToken(sessionToken);
  const received = String(req.headers['x-csrf-token'] || '');
  const valid = received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid) {
    json(res, 403, { message: 'CSRF 校验失败，请刷新页面后重试' });
    return false;
  }
  return true;
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  return String(cookies.sessionToken || '').trim();
}

function getIdleLimitMs(db) {
  const minutes = Number(db?.systemConfig?.webIdleLogoutMinutes);
  const resolved = Number.isFinite(minutes) && minutes >= 1 ? minutes : defaultWebIdleLogoutMinutes;
  return resolved * 60 * 1000;
}

function persistSessionActivity(db) {
  // 冷启动阶段权威快照尚未从 MySQL 载入，此时落库会用本地文件覆盖数据库，直接跳过本轮活跃度写入。
  if (!latestFileDbCache) return;
  const ts = Date.now();
  if (ts - lastSessionActivityPersistMs < sessionActivityPersistIntervalMs) return;
  lastSessionActivityPersistMs = ts;
  const activityByToken = new Map();
  for (const item of db.sessions || []) {
    if (item && item.token && item.lastActivityAt) activityByToken.set(item.token, item.lastActivityAt);
  }
  sessionActivityPersistQueue = sessionActivityPersistQueue
    .then(() => writeDb(db, { silent: true, sessionActivityByToken: activityByToken }))
    .catch(() => {});
}

function getAuthUser(req, db) {
  const token = getSessionToken(req);
  if (!token) {
    return null;
  }
  const session = (db.sessions || []).find(item => item.token === token);
  if (!session) {
    return null;
  }
  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return null;
  }
  const lastActivityMs = Date.parse(session.lastActivityAt || session.createdAt);
  if (Number.isFinite(lastActivityMs) && Date.now() - lastActivityMs > getIdleLimitMs(db)) {
    return null;
  }
  const user = db.users.find(item => item.id === session.userId) || null;
  if (!user || user.status === 'disabled' || user.status === 'pending' || user.status === 'rejected') return null;
  session.lastActivityAt = new Date().toISOString();
  persistSessionActivity(db);
  return user;
}

function requireAuth(req, res, db) {
  const user = getAuthUser(req, db);
  if (!user) {
    json(res, 401, { message: '请先登录' });
    return null;
  }
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireAuth(req, res, db);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { message: '需要管理员权限' });
    return null;
  }
  return user;
}

function requireAuditReader(req, res, db) {
  const user = requireAuth(req, res, db);
  if (!user) return null;
  if (user.role !== 'admin' && user.role !== 'auditor') {
    json(res, 403, { message: '需要审计权限' });
    return null;
  }
  return user;
}

// 管理员二次验证按「账号 + 来源 IP」限流，避免会话被窃取后无限尝试管理员密码。
const adminStepUpFailures = new Map();
const ADMIN_STEP_UP_MAX_FAILURES = 5;
const ADMIN_STEP_UP_LOCK_MS = 5 * 60 * 1000;
const ADMIN_STEP_UP_WINDOW_MS = 15 * 60 * 1000;

function adminStepUpKey(userId, req) {
  return `${userId || ''}:${req ? getRequestClientIp(req) : ''}`;
}

function isAdminStepUpLocked(user, req) {
  const entry = adminStepUpFailures.get(adminStepUpKey(user && user.id, req));
  return Boolean(entry && entry.lockedUntil > nowMs());
}

function verifyAdminStepUp(user, password, req) {
  if (!user) return false;
  const key = adminStepUpKey(user.id, req);
  const entry = adminStepUpFailures.get(key);
  if (entry && entry.lockedUntil > nowMs()) return false;
  if (entry && entry.lockedUntil && entry.lockedUntil <= nowMs()) adminStepUpFailures.delete(key);
  if (Boolean(password) && verifyPassword(String(password), user.passwordHash)) {
    adminStepUpFailures.delete(key);
    return true;
  }
  const current = adminStepUpFailures.get(key) || { count: 0, firstAt: nowMs(), lockedUntil: 0 };
  if (nowMs() - current.firstAt > ADMIN_STEP_UP_WINDOW_MS) {
    current.count = 0;
    current.firstAt = nowMs();
    current.lockedUntil = 0;
  }
  current.count += 1;
  if (current.count >= ADMIN_STEP_UP_MAX_FAILURES) current.lockedUntil = nowMs() + ADMIN_STEP_UP_LOCK_MS;
  adminStepUpFailures.set(key, current);
  return false;
}

function requireEditor(req, res, db) {
  const user = requireAuth(req, res, db);
  if (!user) return null;
  if (user.role !== 'admin' && user.role !== 'engineer') {
    json(res, 403, { message: '当前账号仅支持查看数据' });
    return null;
  }
  return user;
}

function canViewProject(user, projectId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return userHasProject(user, projectId);
}

// 客户日志可见性由项目开关决定，默认关闭；关闭的项目一律不下发服务过程日志。
function customerVisibleLogProjects(db, user) {
  if (!user) return [];
  return (db.projects || [])
    .filter(project => project.customerLogVisible === true && canViewProject(user, project.id))
    .map(project => project.id);
}

function filterByProjectScope(list, user, getProjectId) {
  if (!user) return [];
  if (user.role === 'admin') return list;
  const projectIds = userProjectIds(user);
  if (!projectIds.length) return [];
  return list.filter(item => {
    const projectId = getProjectId(item);
    return Boolean(projectId) && projectIds.includes(String(projectId));
  });
}

// 列表「只看我的 / 项目全部」：scope=mine 时在项目可见范围内再按记录归属人收窄。
// 未传 scope 时保持项目级全量，避免影响报表、仪表盘等依赖完整数据的调用方。
function filterByRecordScope(list, user, query, getOwnerId) {
  const scoped = filterByProjectScope(list, user, item => item.projectId);
  if (String(query?.scope || '') !== 'mine') return scoped;
  return scoped.filter(item => getOwnerId(item) === user.id);
}

// 无归属项目的模板（内置或管理员创建）对所有项目可见，带 projectId 的自建模板仅在所属项目内可见。
function canUseAiInspectionTemplate(user, item) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  if (!item.projectId) return true;
  return userHasProject(user, item.projectId);
}

function appendAuditLog(db, user, action, targetType, targetId, detail, projectId = '', meta = null) {
  db.auditLogs = db.auditLogs || [];
  const entry = {
    id: id('audit'),
    projectId: projectId || (user && user.projectId) || '',
    action,
    targetType,
    targetId,
    operatorId: user.id,
    operatorName: user.name,
    detail,
    createdAt: now()
  };
  if (meta) {
    entry.ip = String(meta.ip || '').slice(0, 64);
    entry.userAgent = String(meta.userAgent || '').slice(0, 200);
  }
  db.auditLogs.push(entry);
  if (db.auditLogs.length > 10000) {
    // 超限时先归档被裁剪的历史记录，避免审计数据被静默丢弃。
    const overflow = db.auditLogs.slice(0, db.auditLogs.length - 5000);
    if (overflow.length) {
      try {
        archiveJsonLines(auditArchiveDir, `overflow-${formatDateKey(new Date())}.jsonl`, overflow);
        db.auditLogs = db.auditLogs.slice(-5000);
      } catch (error) {
        // 归档失败时保留全部记录，下一轮继续尝试；此时裁剪会直接丢掉未归档的审计数据。
        console.error('archive audit overflow failed, keeping audit logs for retry:', error.message);
      }
    }
  }
}

function sanitizeUpgradeFilename(filename) {
  const base = path.basename(String(filename || '').replace(/\\/g, '/'));
  return base.slice(0, 180);
}

async function appendUpgradeLog(db, user, fields = {}) {
  db.upgradeLogs = db.upgradeLogs || [];
  db.upgradeLogs.push({
    id: id('upgrade-log'),
    operatorId: user.id || '',
    operatorName: user.name || user.username || '',
    filename: sanitizeUpgradeFilename(fields.filename),
    fromVersion: String(fields.fromVersion || packageInfo.version || ''),
    toVersion: String(fields.toVersion || ''),
    status: fields.status === 'accepted' ? 'accepted' : 'failed',
    message: String(fields.message || '').slice(0, 500),
    createdAt: now()
  });
  if (db.upgradeLogs.length > 200) {
    db.upgradeLogs = db.upgradeLogs.slice(-200);
  }
  await writeDb(db);
}

async function rejectUpgradeUpload(res, db, user, filename, message, extra = {}) {
  await appendUpgradeLog(db, user, {
    filename,
    status: 'failed',
    message,
    toVersion: extra.toVersion || ''
  });
  return json(res, extra.status || 400, { message });
}

function createNotification(db, projectId, title, content, level = 'info', category = '', sourceType = '', sourceId = '') {
  db.notifications = db.notifications || [];
  const notification = {
    id: id('notification'),
    projectId,
    title,
    content,
    level,
    category,
    sourceType,
    sourceId,
    readAt: '',
    archivedAt: '',
    createdAt: now()
  };
      db.notifications.unshift(notification);
  queueExternalNotification(notification);
  return notification;
}

function notificationEventGroup(category) {
  const key = String(category || '').trim();
  if (!key) return '';
  return notificationEventGroups[key] || key;
}

function readChannelSecret(stored) {
  const value = String(stored || '');
  if (!value) return '';
  if (!value.startsWith('enc:')) return value;
  try {
    return decryptCredential(value.slice(4));
  } catch (_) {
    return '';
  }
}

function writeChannelSecret(plaintext, previous) {
  const value = String(plaintext === undefined ? '' : plaintext);
  // 未提交该字段时保留原密文，避免编辑其他参数导致凭据被清空。
  if (plaintext === undefined) return previous || '';
  if (!value) return '';
  return `enc:${encryptCredential(value)}`;
}

function sanitizeNotificationChannel(channel) {
  const { webhookSecret, smtpPassword, ...rest } = channel;
  return {
    ...rest,
    hasWebhookSecret: Boolean(readChannelSecret(webhookSecret)),
    hasSmtpPassword: Boolean(readChannelSecret(smtpPassword))
  };
}

function normalizeNotificationChannelInput(body, previous = null) {
  const type = body.type === 'email' ? 'email' : 'webhook';
  const name = String(body.name || previous?.name || '').trim();
  if (!name) return { error: '请填写通道名称' };
  const projectId = body.projectId !== undefined ? String(body.projectId || '').trim() : String(previous?.projectId || '');
  const validEvents = new Set(notificationEventOptions.map(item => item.value));
  const events = Array.isArray(body.events)
    ? body.events.map(item => String(item || '').trim()).filter(item => validEvents.has(item))
    : Array.isArray(previous?.events) ? previous.events : [];
  const channel = {
    id: previous?.id || id('notifyChannel'),
    projectId,
    name: name.slice(0, 60),
    type,
    enabled: body.enabled === undefined ? (previous ? previous.enabled !== false : true) : body.enabled !== false,
    events,
    webhookUrl: body.webhookUrl !== undefined ? String(body.webhookUrl || '').trim().slice(0, 2048) : String(previous?.webhookUrl || ''),
    webhookSecret: writeChannelSecret(body.webhookSecret, previous?.webhookSecret),
    smtpHost: body.smtpHost !== undefined ? String(body.smtpHost || '').trim().slice(0, 255) : String(previous?.smtpHost || ''),
    smtpPort: body.smtpPort !== undefined ? String(body.smtpPort || '').trim().slice(0, 10) : String(previous?.smtpPort || ''),
    smtpSecure: body.smtpSecure === undefined ? Boolean(previous?.smtpSecure) : body.smtpSecure === true || body.smtpSecure === 'true',
    smtpUser: body.smtpUser !== undefined ? String(body.smtpUser || '').trim().slice(0, 255) : String(previous?.smtpUser || ''),
    smtpPassword: writeChannelSecret(body.smtpPassword, previous?.smtpPassword),
    fromAddress: body.fromAddress !== undefined ? String(body.fromAddress || '').trim().slice(0, 255) : String(previous?.fromAddress || ''),
    toAddresses: body.toAddresses !== undefined
      ? (Array.isArray(body.toAddresses) ? body.toAddresses : String(body.toAddresses || '').split(/[,;\s]+/))
        .map(item => String(item || '').trim()).filter(Boolean).slice(0, 20)
      : (Array.isArray(previous?.toAddresses) ? previous.toAddresses : []),
    lastSentAt: previous?.lastSentAt || '',
    lastError: previous?.lastError || '',
    createdAt: previous?.createdAt || now()
  };
  if (type === 'webhook') {
    if (!channel.webhookUrl) return { error: '请填写 Webhook 地址' };
    let parsed = null;
    try { parsed = new URL(channel.webhookUrl); } catch (_) {}
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return { error: 'Webhook 地址必须是 http(s) URL' };
    if (parsed.username || parsed.password) return { error: 'Webhook 地址不能包含账号信息' };
    channel.toAddresses = [];
    channel.fromAddress = '';
  } else {
    if (!channel.smtpHost) return { error: '请填写 SMTP 服务器地址' };
    const port = Number(channel.smtpPort || (channel.smtpSecure ? 465 : 587));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'SMTP 端口无效' };
    channel.smtpPort = String(port);
    if (!channel.fromAddress) return { error: '请填写发件人地址' };
    if (!channel.toAddresses.length) return { error: '请填写至少一个收件人地址' };
    channel.webhookUrl = '';
  }
  return { channel };
}

// 通道投递在落库之外异步执行，失败只记录到通道状态，不能影响站内通知与业务事务。
function queueExternalNotification(notification) {
  if (!notification || !notification.category) return;
  setImmediate(() => {
    deliverNotificationExternally(notification).catch(error => {
      logStorageFailure('External notification delivery failed', error);
    });
  });
}

async function deliverNotificationExternally(notification) {
  const group = notificationEventGroup(notification.category);
  if (!group) return;
  const db = await readDb();
  const channels = (db.notificationChannels || []).filter(channel => channel.enabled !== false
    && (!channel.projectId || !notification.projectId || channel.projectId === notification.projectId)
    && (channel.events || []).includes(group));
  if (!channels.length) return;
  let changed = false;
  for (const channel of channels) {
    const outcome = await deliverToChannel(channel, notification);
    channel.lastSentAt = outcome.ok ? now() : channel.lastSentAt;
    channel.lastError = outcome.ok ? '' : String(outcome.message || '发送失败').slice(0, 500);
    changed = true;
  }
  if (changed) {
    try {
      await writeDb(db, { replaceCollections: ['notificationChannels'], silent: true });
    } catch (error) {
      logStorageFailure('Notification channel status write failed', error);
    }
  }
}

async function deliverToChannel(channel, notification) {
  try {
    if (channel.type === 'email') return await deliverEmailNotification(channel, notification);
    return await deliverWebhookNotification(channel, notification);
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

// Webhook 目标同样按监控目标策略校验，避免把内网探测能力通过通道配置变成任意出站请求。
async function assertOutboundUrlAllowed(rawUrl) {
  const parsed = new URL(String(rawUrl || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http(s) 地址');
  const verdict = await resolveMonitorTargetAddress(parsed.hostname);
  if (!verdict.ok) throw new Error(verdict.message);
}

async function deliverWebhookNotification(channel, notification) {
  await assertOutboundUrlAllowed(channel.webhookUrl);
  const payload = {
    msgtype: 'text',
    text: {
      content: `[${notification.level === 'error' ? '严重' : notification.level === 'warning' ? '警告' : '通知'}] ${notification.title}\n${notification.content || ''}`.trim()
    },
    event: notificationEventGroup(notification.category),
    title: notification.title,
    content: notification.content || '',
    level: notification.level || 'info',
    projectId: notification.projectId || '',
    notificationId: notification.id,
    createdAt: notification.createdAt || now()
  };
  const bodyText = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  const secret = readChannelSecret(channel.webhookSecret);
  if (secret) {
    headers['X-Onsite-Signature'] = crypto.createHmac('sha256', secret).update(bodyText).digest('hex');
    headers['X-Onsite-Timestamp'] = String(Date.now());
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(channel.webhookUrl, {
      method: 'POST',
      headers,
      body: bodyText,
      redirect: 'manual',
      signal: controller.signal
    });
    const preview = (await response.text()).slice(0, 200);
    if (!response.ok) throw new Error(`Webhook 返回 ${response.status} ${preview}`.trim());
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

// 最小 SMTP 客户端：仅发送纯文本通知，支持隐式 TLS、STARTTLS 与 AUTH LOGIN/PLAIN。
function createSmtpReader(socket) {
  let buffer = '';
  const pending = [];
  const replies = [];
  let closedError = null;
  let current = '';
  const dispatch = () => {
    while (pending.length && replies.length) pending.shift().resolve(replies.shift());
  };
  const flushLines = () => {
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index + 1).replace(/\r?\n$/, '');
      buffer = buffer.slice(index + 1);
      if (!/^\d{3}[ -]/.test(line) && !current) continue;
      current = current ? `${current}\n${line}` : line;
      // "250-" 是续行，只有 "250 " 才表示多行响应结束。
      if (/^\d{3} /.test(line)) {
        replies.push(current);
        current = '';
      }
    }
    dispatch();
  };
  const onData = chunk => {
    buffer += chunk.toString('utf8');
    flushLines();
  };
  const onError = error => {
    closedError = error;
    while (pending.length) pending.shift().reject(closedError);
  };
  const onClose = () => {
    closedError = closedError || new Error('SMTP 连接已关闭');
    while (pending.length) pending.shift().reject(closedError);
  };
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
  return {
    read() {
      return new Promise((resolve, reject) => {
        if (closedError) return reject(closedError);
        pending.push({ resolve, reject });
        dispatch();
      });
    },
    dispose() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
  };
}

function smtpCommand(socket, reader, command, expect = [250]) {
  socket.write(`${command}\r\n`);
  return reader.read().then(line => {
    const code = Number(line.slice(0, 3));
    if (!expect.includes(code)) throw new Error(`SMTP 拒绝 ${command.split(' ')[0]}: ${line}`);
    return line;
  });
}

function encodeSmtpHeader(value) {
  const text = String(value || '').replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7E]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function connectSmtpSocket(host, port, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
      : net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP 连接超时'));
    }, 10000);
    const onReady = () => {
      clearTimeout(timer);
      socket.off('error', onFail);
      resolve(socket);
    };
    const onFail = error => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.once(secure ? 'secureConnect' : 'connect', onReady);
    socket.once('error', onFail);
  });
}

async function deliverEmailNotification(channel, notification) {
  const port = Number(channel.smtpPort || (channel.smtpSecure ? 465 : 587));
  const verdict = await resolveMonitorTargetAddress(channel.smtpHost);
  if (!verdict.ok) throw new Error(verdict.message);
  let socket = await connectSmtpSocket(channel.smtpHost, port, channel.smtpSecure === true);
  let reader = createSmtpReader(socket);
  const timeout = setTimeout(() => socket.destroy(new Error('SMTP 会话超时')), 20000);
  try {
    const greeting = await reader.read();
    if (Number(greeting.slice(0, 3)) !== 220) throw new Error(`SMTP 未就绪: ${greeting}`);
    const capabilities = await smtpCommand(socket, reader, `EHLO ${os.hostname() || 'localhost'}`, [250]);
    // 明文连接优先升级为 STARTTLS；服务器不支持时保持原会话，兼容内网中继。
    if (!channel.smtpSecure && /STARTTLS/i.test(capabilities)) {
      await smtpCommand(socket, reader, 'STARTTLS', [220]);
      reader.dispose();
      const upgraded = await new Promise((resolve, reject) => {
        const secureSocket = tls.connect({ socket, servername: channel.smtpHost, rejectUnauthorized: true }, () => resolve(secureSocket));
        secureSocket.once('error', reject);
      });
      socket = upgraded;
      reader = createSmtpReader(socket);
      await smtpCommand(socket, reader, `EHLO ${os.hostname() || 'localhost'}`, [250]);
    }
    await sendSmtpSession(socket, reader, channel, notification);
    return { ok: true };
  } finally {
    clearTimeout(timeout);
    reader.dispose();
    if (!socket.destroyed) socket.end();
  }
}

async function sendSmtpSession(socket, reader, channel, notification) {
  const user = String(channel.smtpUser || '');
  const password = readChannelSecret(channel.smtpPassword);
  if (user && password) {
    // 优先 AUTH PLAIN；不支持时退回 AUTH LOGIN 两步挑战。
    try {
      const token = Buffer.from(`\u0000${user}\u0000${password}`, 'utf8').toString('base64');
      await smtpCommand(socket, reader, `AUTH PLAIN ${token}`, [235]);
    } catch (_) {
      await smtpCommand(socket, reader, 'AUTH LOGIN', [334]);
      await smtpCommand(socket, reader, Buffer.from(user, 'utf8').toString('base64'), [334]);
      await smtpCommand(socket, reader, Buffer.from(password, 'utf8').toString('base64'), [235]);
    }
  }
  const from = String(channel.fromAddress || '');
  await smtpCommand(socket, reader, `MAIL FROM:<${from}>`, [250]);
  for (const recipient of channel.toAddresses || []) {
    await smtpCommand(socket, reader, `RCPT TO:<${recipient}>`, [250, 251]);
  }
  await smtpCommand(socket, reader, 'DATA', [354]);
  const text = `${notification.title}\n\n${notification.content || ''}\n\n事件：${notificationEventGroup(notification.category)}\n时间：${notification.createdAt || now()}`;
  const message = [
    `From: ${encodeSmtpHeader(from)}`,
    `To: ${(channel.toAddresses || []).map(encodeSmtpHeader).join(', ')}`,
    `Subject: ${encodeSmtpHeader(notification.title)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')
  ].join('\r\n');
  await smtpCommand(socket, reader, `${message}\r\n.`, [250]);
  await smtpCommand(socket, reader, 'QUIT', [221]).catch(() => {});
}

// 删除业务记录时同步清理其产生的通知，避免遗留指向已删除数据的空通知。
function removeNotificationsBySource(db, sourceType, sourceId) {
  if (!sourceType || !sourceId || !Array.isArray(db.notifications)) return 0;
  const before = db.notifications.length;
  db.notifications = db.notifications.filter(item => !(item.sourceType === sourceType && item.sourceId === sourceId));
  return before - db.notifications.length;
}

// 在同一项目内按内容前缀匹配最长的候选标题/名称，避免短名误配到长名记录。
function pickLongestTitleMatch(items, projectId, keyOf, predicate) {
  let best = null;
  for (const item of items || []) {
    if (!item || item.projectId !== projectId) continue;
    const key = String(keyOf(item) || '');
    if (!key || !predicate(key)) continue;
    if (!best || key.length > best.keyLength) best = { item, keyLength: key.length };
  }
  return best ? best.item : null;
}

// 依据通知类别与内容特征，在同一项目内匹配到产生该通知的业务实体。
// 仅用于历史通知来源回填，属尽力匹配（历史内容不含实体 id，同名记录存在歧义）。
function matchNotificationSource(db, notification) {
  const category = String(notification.category || '');
  const title = String(notification.title || '');
  const content = String(notification.content || '');
  const projectId = notification.projectId || '';
  if (!content) return null;
  if (category === 'ai-inspection') {
    const task = pickLongestTitleMatch(db.aiInspectionTasks, projectId, item => item.title, key => content.startsWith(`${key} `));
    return task ? { sourceType: 'aiInspectionTask', sourceId: task.id } : null;
  }
  if (category === 'config-backup') {
    const plan = pickLongestTitleMatch(db.configBackupPlans, projectId, item => item.name || '配置备份', key => content.startsWith(`${key} 失败`));
    return plan ? { sourceType: 'configBackupPlan', sourceId: plan.id } : null;
  }
  if (category === 'inspection-overdue') {
    const plan = pickLongestTitleMatch(db.inspectionPlans, projectId, item => item.title, key => content.startsWith(`巡检计划 ${key} 将于`));
    return plan ? { sourceType: 'inspectionPlan', sourceId: plan.id } : null;
  }
  if (category === 'inspection') {
    const plan = pickLongestTitleMatch(db.inspectionPlans, projectId, item => item.title, key => content.startsWith(`${key} 巡检发现异常`));
    return plan ? { sourceType: 'inspectionPlan', sourceId: plan.id } : null;
  }
  if (category === 'maintenance-expiry') {
    const asset = pickLongestTitleMatch(db.assets, projectId, item => item.name, key => content.startsWith(`资产 ${key}（`));
    return asset ? { sourceType: 'asset', sourceId: asset.id } : null;
  }
  if (category === 'monitor-alert') {
    const asset = pickLongestTitleMatch(db.assets, projectId, item => item.name, key => content.startsWith(`资产 "${key}"`));
    return asset ? { sourceType: 'asset', sourceId: asset.id } : null;
  }
  if (category === 'inventory') {
    const spare = pickLongestTitleMatch(db.spareParts, projectId, item => item.name, key => content.startsWith(`${key} 库存达到安全阈值`) || content.startsWith(`${key} 当前库存`));
    return spare ? { sourceType: 'sparePart', sourceId: spare.id } : null;
  }
  if (category === 'incident') {
    const incident = pickLongestTitleMatch(db.incidentRecords, projectId, item => item.title, key => content.startsWith(`${key} 已超时`));
    return incident ? { sourceType: 'incident', sourceId: incident.id } : null;
  }
  if (category === 'approval') {
    // 变更流程通知的标题为「变更待审批」，其余审批通知（待处理/流转/结果）对应审批记录。
    const isChange = title === '变更待审批' || content.includes('已提交给') || content.includes('已重新提交');
    if (isChange) {
      const change = pickLongestTitleMatch(db.changeRecords, projectId, item => item.title, key => content.startsWith(`${key} 已`));
      return change ? { sourceType: 'changeRecord', sourceId: change.id } : null;
    }
    const approval = pickLongestTitleMatch(db.approvals, projectId, item => item.title, key => content.startsWith(key));
    return approval ? { sourceType: 'approval', sourceId: approval.id } : null;
  }
  return null;
}

// 历史通知来源回填：早期通知未记录 sourceType/sourceId，删除业务实体时无法级联清理。
// 逐条按内容特征匹配业务实体并补齐来源标记；已被标记的通知跳过，保证幂等。
function backfillNotificationSources(db) {
  const stats = { scanned: 0, updated: 0, unmatched: 0, byType: {} };
  const notifications = Array.isArray(db.notifications) ? db.notifications : [];
  for (const notification of notifications) {
    if (!notification) continue;
    if (notification.sourceType && notification.sourceId) continue;
    stats.scanned += 1;
    const source = matchNotificationSource(db, notification);
    if (!source) { stats.unmatched += 1; continue; }
    notification.sourceType = source.sourceType;
    notification.sourceId = source.sourceId;
    notification._dirty = true;
    stats.updated += 1;
    stats.byType[source.sourceType] = (stats.byType[source.sourceType] || 0) + 1;
  }
  return stats;
}

function getActiveProjectEngineers(db, projectId) {
  return (db.users || []).filter(item => userHasProject(item, projectId) && item.role === 'engineer' && item.status !== 'disabled' && item.status !== 'rejected');
}

function getWorkReportReminderSettings(db) {
  const config = normalizeSystemConfig(db?.systemConfig || {});
  return {
    dailyReportReminderHour: config.dailyReportReminderHour,
    weeklyReportReminderDays: config.weeklyReportReminderDays,
    monthlyReportReminderDays: config.monthlyReportReminderDays,
    dailyLowHoursThreshold: config.dailyLowHoursThreshold,
    dailyHighHoursThreshold: config.dailyHighHoursThreshold,
    noLogStreakDays: config.noLogStreakDays,
    projectInactiveDays: config.projectInactiveDays
  };
}

function getNotificationCreatedAtMs(item) {
  const ts = Date.parse(String(item?.createdAt || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function hasRecentNotification(db, predicate, withinMs) {
  const threshold = nowMs() - withinMs;
  return (db.notifications || []).some(item => getNotificationCreatedAtMs(item) >= threshold && predicate(item));
}

function createNotificationOnce(db, { projectId, title, content, level = 'info', category = '', dedupeDays = 1 }) {
  const withinMs = dedupeDays * 24 * 60 * 60 * 1000;
  const exists = hasRecentNotification(db, item => item.category === category && item.projectId === projectId && item.content === content, withinMs);
  if (!exists) {
    createNotification(db, projectId, title, content, level, category);
    return true;
  }
  return false;
}

function sumLogHoursForUserOnDate(db, userId, projectId, dateKey) {
  return Number((db.logs || [])
    .filter(item => item.userId === userId && item.projectId === projectId && String(item.date || '').slice(0, 10) === dateKey)
    .reduce((sum, item) => sum + Number(item.durationHours || 0), 0)
    .toFixed(2));
}

function hasSubmittedWorkReport(db, { userId, projectId, reportType, periodKey }) {
  return (db.workReports || []).some(item => item.userId === userId
    && item.projectId === projectId
    && item.reportType === reportType
    && item.periodKey === periodKey
    && ['submitted', 'approved', 'locked'].includes(item.status));
}

function getRecentDateKeys(days) {
  const keys = [];
  const today = parseDateOnly(formatDateKey(new Date()));
  if (!today) return keys;
  for (let offset = 0; offset < days; offset += 1) {
    keys.push(dateToKey(addDays(today, -offset)));
  }
  return keys;
}

function getConsecutiveNoLogDays(db, userId, projectId, maxDays) {
  let streak = 0;
  for (const dateKey of getRecentDateKeys(maxDays)) {
    const hasLog = (db.logs || []).some(item => item.userId === userId && item.projectId === projectId && String(item.date || '').slice(0, 10) === dateKey);
    if (hasLog) break;
    streak += 1;
  }
  return streak;
}

function checkWorkReportReminderNotifications(db) {
  let changed = false;
  const settings = getWorkReportReminderSettings(db);
  const currentTime = new Date(Date.now() + getSystemTimezoneOffsetMs());
  const todayKey = currentTime.toISOString().slice(0, 10);
  const currentHour = currentTime.getUTCHours();
  const dailyMeta = getWorkReportPeriodMeta('daily', todayKey);
  const weeklyMeta = getWorkReportPeriodMeta('weekly', todayKey);
  const monthlyMeta = getWorkReportPeriodMeta('monthly', todayKey);
  const weeklyDaysLeft = weeklyMeta ? getInclusiveDayCount(todayKey, weeklyMeta.rangeEnd) - 1 : Infinity;
  const monthlyDaysLeft = monthlyMeta ? getInclusiveDayCount(todayKey, monthlyMeta.rangeEnd) - 1 : Infinity;

  for (const project of db.projects || []) {
    const engineers = getActiveProjectEngineers(db, project.id);
    if (!engineers.length) continue;

    if (currentHour >= settings.dailyReportReminderHour && dailyMeta) {
      for (const engineer of engineers) {
        const hasDailySubmitted = hasSubmittedWorkReport(db, { userId: engineer.id, projectId: project.id, reportType: 'daily', periodKey: dailyMeta.periodKey });
        if (!hasDailySubmitted) {
          changed = createNotificationOnce(db, {
            projectId: project.id,
            title: '日报漏填提醒',
            content: `${engineer.name} 于 ${todayKey} 尚未提交日报，请及时补充。`,
            level: 'warning',
            category: 'work-report-daily-missing'
          }) || changed;
        }
      }
    }

    if (weeklyMeta && weeklyDaysLeft >= 0 && weeklyDaysLeft <= settings.weeklyReportReminderDays) {
      for (const engineer of engineers) {
        const hasWeeklySubmitted = hasSubmittedWorkReport(db, { userId: engineer.id, projectId: project.id, reportType: 'weekly', periodKey: weeklyMeta.periodKey });
        if (!hasWeeklySubmitted) {
          changed = createNotificationOnce(db, {
            projectId: project.id,
            title: '周报截止提醒',
            content: `${engineer.name} 的周报截止日期为 ${weeklyMeta.rangeEnd}，当前尚未提交，请及时处理。`,
            level: weeklyDaysLeft <= 1 ? 'warning' : 'info',
            category: 'work-report-weekly-deadline'
          }) || changed;
        }
      }
    }

    if (monthlyMeta && monthlyDaysLeft >= 0 && monthlyDaysLeft <= settings.monthlyReportReminderDays) {
      for (const engineer of engineers) {
        const hasMonthlySubmitted = hasSubmittedWorkReport(db, { userId: engineer.id, projectId: project.id, reportType: 'monthly', periodKey: monthlyMeta.periodKey });
        if (!hasMonthlySubmitted) {
          changed = createNotificationOnce(db, {
            projectId: project.id,
            title: '月报截止提醒',
            content: `${engineer.name} 的月报截止日期为 ${monthlyMeta.rangeEnd}，当前尚未提交，请及时处理。`,
            level: monthlyDaysLeft <= 3 ? 'warning' : 'info',
            category: 'work-report-monthly-deadline'
          }) || changed;
        }
      }
    }

    if (currentHour >= settings.dailyReportReminderHour) {
      for (const engineer of engineers) {
        const totalHours = sumLogHoursForUserOnDate(db, engineer.id, project.id, todayKey);
        if (totalHours > 0 && totalHours < settings.dailyLowHoursThreshold) {
          changed = createNotificationOnce(db, {
            projectId: project.id,
            title: '工时偏低提醒',
            content: `${engineer.name} 于 ${todayKey} 的工时为 ${totalHours} 小时，低于阈值 ${settings.dailyLowHoursThreshold} 小时。`,
            level: 'warning',
            category: 'work-log-hours-low'
          }) || changed;
        }
        if (totalHours > settings.dailyHighHoursThreshold) {
          changed = createNotificationOnce(db, {
            projectId: project.id,
            title: '工时偏高提醒',
            content: `${engineer.name} 于 ${todayKey} 的工时为 ${totalHours} 小时，高于阈值 ${settings.dailyHighHoursThreshold} 小时。`,
            level: 'warning',
            category: 'work-log-hours-high'
          }) || changed;
        }
      }
    }

    for (const engineer of engineers) {
      const noLogStreak = getConsecutiveNoLogDays(db, engineer.id, project.id, settings.noLogStreakDays);
      if (noLogStreak >= settings.noLogStreakDays) {
        changed = createNotificationOnce(db, {
          projectId: project.id,
          title: '连续无记录提醒',
          content: `${engineer.name} 已连续 ${noLogStreak} 天无日志记录，请尽快补充。`,
          level: 'warning',
          category: 'work-log-streak-missing'
        }) || changed;
      }
    }

    const recentDateKeys = new Set(getRecentDateKeys(settings.projectInactiveDays));
    const hasRecentProjectLogs = (db.logs || []).some(item => item.projectId === project.id && recentDateKeys.has(String(item.date || '').slice(0, 10)));
    const hasRecentProjectReports = (db.workReports || []).some(item => item.projectId === project.id && ['submitted', 'approved', 'locked'].includes(item.status) && recentDateKeys.has(String(item.rangeEnd || '').slice(0, 10)));
    if (!hasRecentProjectLogs && !hasRecentProjectReports) {
      changed = createNotificationOnce(db, {
        projectId: project.id,
        title: '项目长期无人填报提醒',
        content: `${project.name} 已连续 ${settings.projectInactiveDays} 天无日志或已提交工作汇报，请尽快确认填报状态。`,
        level: 'warning',
        category: 'project-report-inactive'
      }) || changed;
    }
  }

  return changed;
}

function appendSystemAuditLog(db, action, targetType, targetId, detail, projectId = '') {
  db.auditLogs = db.auditLogs || [];
  // 审计日志统一追加到尾部（最新在尾），与 appendAuditLog 及维护归档逻辑保持一致。
  db.auditLogs.push({
    id: id('audit'),
    projectId,
    action,
    targetType,
    targetId,
    operatorId: 'system',
    operatorName: '系统调度器',
    detail,
    createdAt: now()
  });
}

function parseAiInspectionScheduleTime(executedAt) {
  const raw = String(executedAt || '').trim();
  if (!raw) return nowMs();
  const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, year, month, day, hour, minute, second = '0'] = localMatch;
    const offsetH = getSystemTimezoneOffsetMs() / 3600000;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - offsetH, Number(minute), Number(second));
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : nowMs();
}

// 严格校验计划执行时间，非法或为空返回 null（区别于 parseAiInspectionScheduleTime 的「非法即视为立即到期」）。
// 写入周期任务/备份计划前必须用它拦掉非法时间，否则调度器会因无法推进 executedAt 而每个周期重复执行。
function parseValidScheduleTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, year, month, day, hour, minute, second = '0'] = localMatch;
    const offsetH = getSystemTimezoneOffsetMs() / 3600000;
    const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - offsetH, Number(minute), Number(second));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function addAiTaskCycleOnce(task) {
  if (!task.cycle || !task.executedAt) return false;
  const parts = String(task.executedAt).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  let d;
  if (parts) {
    d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5] || '0'), Number(parts[6] || '0'));
  } else {
    // 兼容早期失败路径写入的带时区 ISO 时间，避免周期任务因计划格式异常而无法推进。
    const timestamp = Date.parse(task.executedAt);
    if (!Number.isFinite(timestamp)) return false;
    d = new Date(timestamp);
  }
  const pad = n => String(n).padStart(2, '0');
  const toLocalStr = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (task.cycle === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (task.cycle === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (task.cycle === 'monthly') {
    d.setMonth(d.getMonth() + 1);
  } else if (task.cycle === 'quarterly') {
    d.setMonth(d.getMonth() + 3);
  } else {
    return false;
  }
  task.executedAt = toLocalStr(d);
  return true;
}

function ensureAiTaskFutureExecution(task, referenceMs = Date.now()) {
  if (!task.cycle || !task.executedAt) return false;
  let changed = false;
  let guard = 0;
  while (parseAiInspectionScheduleTime(task.executedAt) <= referenceMs && guard < 120) {
    if (!addAiTaskCycleOnce(task)) break;
    changed = true;
    guard += 1;
  }
  return changed;
}

function advanceAiTaskNextExecution(task, referenceMs = Date.now()) {
  if (!addAiTaskCycleOnce(task)) return false;
  ensureAiTaskFutureExecution(task, referenceMs);
  return true;
}

// 判断周期任务是否已逾期超过一个完整周期（通常意味着服务停机期间漏跑）。
// 只有这种情况才允许在读取任务列表时顺延到下一个未来周期；仅逾期一个周期以内的
// 任务交由调度器补跑，读接口不得抢跑。
function isAiTaskOverdueBeyondCycle(task, referenceMs = Date.now()) {
  if (!task.cycle || !task.executedAt) return false;
  const next = { cycle: task.cycle, executedAt: task.executedAt };
  if (!addAiTaskCycleOnce(next)) return false;
  return parseAiInspectionScheduleTime(next.executedAt) <= referenceMs;
}

// 判断单个地址是否命中某条代理规则，支持精确 IP 与 IPv4/IPv6 CIDR。
function ipMatchesProxyEntry(ip, entry) {
  const rawAddress = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  const address = extractIpv4FromMapped(rawAddress) || rawAddress;
  const rule = String(entry || '').trim();
  if (!address || !rule || net.isIP(address) === 0) return false;
  const slashIndex = rule.indexOf('/');
  if (slashIndex === -1) {
    const ruleAddress = rule.replace(/^\[|\]$/g, '');
    return address.toLowerCase() === (extractIpv4FromMapped(ruleAddress) || ruleAddress).toLowerCase();
  }
  const rawBase = rule.slice(0, slashIndex).trim();
  const base = extractIpv4FromMapped(rawBase) || rawBase;
  const bits = Number(rule.slice(slashIndex + 1));
  if (!Number.isInteger(bits)) return false;
  const baseVersion = net.isIP(base);
  const addressVersion = net.isIP(address);
  if (baseVersion !== addressVersion) return false;
  if (baseVersion === 4 && bits >= 0 && bits <= 32) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipv4ToInt(address) & mask) === (ipv4ToInt(base) & mask);
  }
  if (baseVersion === 6 && bits >= 0 && bits <= 128) {
    const baseBuffer = ipv6ToBuffer(base);
    const addressBuffer = ipv6ToBuffer(address);
    if (!baseBuffer || !addressBuffer) return false;
    const fullBytes = Math.floor(bits / 8);
    if (fullBytes && baseBuffer.compare(addressBuffer, 0, fullBytes, 0, fullBytes) !== 0) return false;
    const remainingBits = bits % 8;
    if (!remainingBits) return true;
    const mask = (0xff << (8 - remainingBits)) & 0xff;
    return (baseBuffer[fullBytes] & mask) === (addressBuffer[fullBytes] & mask);
  }
  return false;
}

function isTrustedProxyAddress(address) {
  const ip = String(address || '').trim().replace(/^\[|\]$/g, '');
  if (!ip || net.isIP(ip) === 0) return false;
  // 本机反向代理默认可信；跨主机代理必须显式配置 TRUSTED_PROXY_IPS。
  if (isLoopbackIp(ip)) return true;
  return trustedProxyEntries.some(entry => ipMatchesProxyEntry(ip, entry));
}

// 仅当直连来源是可信代理时才信任转发头，避免客户端伪造 X-Forwarded-*。
function isTrustedProxyRequest(req) {
  return isTrustedProxyAddress(req.socket?.remoteAddress || '');
}

function getRequestClientIp(req) {
  const remoteAddress = String(req.socket?.remoteAddress || '').trim();
  if (!isTrustedProxyAddress(remoteAddress)) return remoteAddress || 'unknown';
  // 从右往左跳过可信代理，第一个不可信地址才是真实客户端，避免伪造首段绕过限流。
  const forwardedChain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map(item => item.trim().replace(/^\[|\]$/g, ''))
    .filter(item => net.isIP(item) > 0);
  for (let index = forwardedChain.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxyAddress(forwardedChain[index])) return forwardedChain[index];
  }
  const realIp = String(req.headers['x-real-ip'] || '').trim().replace(/^\[|\]$/g, '');
  if (net.isIP(realIp) > 0) return realIp;
  return forwardedChain[0] || remoteAddress || 'unknown';
}

function auditMeta(req) {
  if (!req) return null;
  return {
    ip: getRequestClientIp(req),
    userAgent: String(req.headers?.['user-agent'] || '')
  };
}

function getLoginRateLimitKey(req, username) {
  return `${getRequestClientIp(req)}:${String(username || '').trim().toLowerCase()}`;
}

function getLoginRateLimitConfig(db) {
  const systemConfig = normalizeSystemConfig(db?.systemConfig || {});
  return {
    windowMs: systemConfig.loginRateLimitWindowMinutes * 60000,
    lockMs: systemConfig.loginRateLimitLockMinutes * 60000,
    maxAttempts: systemConfig.loginRateLimitMaxAttempts
  };
}

function getLoginRateLimitState(db, req, username) {
  const store = getLoginRateLimitStateStore(db);
  const key = getLoginRateLimitKey(req, username);
  const { windowMs } = getLoginRateLimitConfig(db);
  const state = store.get(key) || { count: 0, firstAttemptAt: 0, lastAttemptAt: 0, lockedUntil: 0 };
  if (state.lockedUntil > nowMs()) {
    return { blocked: true, retryAfterMs: state.lockedUntil - nowMs(), key, state, store };
  }
  if (!state.firstAttemptAt || nowMs() - state.firstAttemptAt > windowMs) {
    state.count = 0;
    state.firstAttemptAt = 0;
    state.lastAttemptAt = 0;
    state.lockedUntil = 0;
    store.set(key, state);
    setLoginRateLimitStateStore(db, store);
  }
  return { blocked: false, retryAfterMs: 0, key, state, store };
}

function registerLoginFailure(db, req, username) {
  const { key, state, store } = getLoginRateLimitState(db, req, username);
  const { windowMs, lockMs, maxAttempts } = getLoginRateLimitConfig(db);
  if (!state.firstAttemptAt || nowMs() - state.firstAttemptAt > windowMs) {
    state.count = 0;
    state.firstAttemptAt = nowMs();
  }
  state.count += 1;
  state.lastAttemptAt = nowMs();
  if (state.count >= maxAttempts) {
    state.lockedUntil = nowMs() + lockMs;
  }
  store.set(key, state);
  setLoginRateLimitStateStore(db, store);
  return state;
}

function clearLoginFailures(db, req, username) {
  const store = getLoginRateLimitStateStore(db);
  store.delete(getLoginRateLimitKey(req, username));
  setLoginRateLimitStateStore(db, store);
}

// 登录失败计数存放在 runtimeState（整字段覆盖式合并），必须在临界区内基于最新状态自增，
// 否则并发失败会丢失计数，导致达到锁定阈值的尝试数被低估。
async function recordLoginFailureLocked(req, username) {
  return withDbMutationLock(async () => {
    const lockDb = await readDb();
    const failedState = registerLoginFailure(lockDb, req, username);
    if (req) {
      appendAuditLog(
        lockDb,
        { id: '', name: String(username || '').slice(0, 64) || '未知账号' },
        'login_failed',
        'auth',
        '',
        '账号或密码校验失败',
        '',
        auditMeta(req)
      );
    }
    await writeDb(lockDb, { silent: true });
    return failedState;
  });
}

const forgotPasswordRateLimitMap = new Map();
const FP_MAX_ATTEMPTS = 5;
const FP_WINDOW_MINUTES = 15;
const FP_LOCK_MINUTES = 30;
const FORGOT_PASSWORD_RATE_LIMIT_MAX_KEYS = 5000;

function pruneForgotPasswordRateLimits() {
  if (forgotPasswordRateLimitMap.size <= FORGOT_PASSWORD_RATE_LIMIT_MAX_KEYS) return;
  const now = nowMs();
  const windowMs = FP_WINDOW_MINUTES * 60 * 1000;
  for (const [key, state] of forgotPasswordRateLimitMap) {
    const expired = !state || (state.lockedUntil <= now && (!state.firstAttemptAt || now - state.firstAttemptAt > windowMs));
    if (expired) forgotPasswordRateLimitMap.delete(key);
  }
  while (forgotPasswordRateLimitMap.size > FORGOT_PASSWORD_RATE_LIMIT_MAX_KEYS) {
    const oldest = forgotPasswordRateLimitMap.keys().next();
    if (oldest.done) break;
    forgotPasswordRateLimitMap.delete(oldest.value);
  }
}

function getForgotPasswordRateLimitState(db, rateKey) {
  const state = forgotPasswordRateLimitMap.get(rateKey) || { count: 0, firstAttemptAt: 0, lockedUntil: 0 };
  const now = nowMs();
  const windowMs = FP_WINDOW_MINUTES * 60 * 1000;
  if (state.lockedUntil > now) {
    return { blocked: true, retryAfterMs: state.lockedUntil - now };
  }
  if (state.firstAttemptAt && now - state.firstAttemptAt > windowMs) {
    state.count = 0;
    state.firstAttemptAt = 0;
    state.lockedUntil = 0;
    forgotPasswordRateLimitMap.set(rateKey, state);
  }
  return { blocked: false, retryAfterMs: 0 };
}

function recordForgotPasswordAttempt(db, rateKey) {
  pruneForgotPasswordRateLimits();
  const state = forgotPasswordRateLimitMap.get(rateKey) || { count: 0, firstAttemptAt: 0, lockedUntil: 0 };
  const now = nowMs();
  const windowMs = FP_WINDOW_MINUTES * 60 * 1000;
  const lockMs = FP_LOCK_MINUTES * 60 * 1000;
  if (!state.firstAttemptAt || now - state.firstAttemptAt > windowMs) {
    state.count = 0;
    state.firstAttemptAt = now;
  }
  state.count += 1;
  if (state.count >= FP_MAX_ATTEMPTS) {
    state.lockedUntil = now + lockMs;
  }
  forgotPasswordRateLimitMap.set(rateKey, state);
}

function isEncryptedRequest(req) {
  if (req.socket?.encrypted) return true;
  if (!isTrustedProxyRequest(req)) return false;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https';
}

function shouldUseSecureCookies(req, systemConfig = {}) {
  const host = String(req.headers.host || '').trim().toLowerCase();
  if (isEncryptedRequest(req)) return true;
  if (host.endsWith('.monkeycode-ai.online')) return true;
  const httpsLoginEnabled = normalizeSystemConfig(systemConfig).httpsLoginEnabled;
  return httpsLoginEnabled;
}

function buildSessionCookie(req, token, systemConfig = {}, maxAgeSeconds = sessionMaxAgeSeconds) {
  const secure = shouldUseSecureCookies(req, systemConfig);
  const configured = String(process.env.COOKIE_SAMESITE || 'Lax').trim().toLowerCase();
  const sameSite = configured === 'none' && secure ? 'None' : 'Lax';
  const partitioned = sameSite === 'None' ? '; Partitioned' : '';
  return `sessionToken=${token}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}${partitioned}`;
}

function buildClearSessionCookie(req, systemConfig = {}) {
  const secure = shouldUseSecureCookies(req, systemConfig);
  const configured = String(process.env.COOKIE_SAMESITE || 'Lax').trim().toLowerCase();
  const sameSite = configured === 'none' && secure ? 'None' : 'Lax';
  const partitioned = sameSite === 'None' ? '; Partitioned' : '';
  return `sessionToken=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${secure ? '; Secure' : ''}${partitioned}`;
}

// OIDC state 必须与发起登录的浏览器绑定，否则攻击者可用自己的 state 诱导受害者完成登录回调（登录 CSRF）。
function buildOidcStateCookie(req, systemConfig, state, maxAgeSeconds = 600) {
  const secure = shouldUseSecureCookies(req, systemConfig);
  return `oidcState=${String(state || '')}; HttpOnly; Path=/api/auth/oidc; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function buildClearOidcStateCookie(req, systemConfig) {
  const secure = shouldUseSecureCookies(req, systemConfig);
  return `oidcState=; HttpOnly; Path=/api/auth/oidc; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function resolveSafeChildPath(baseDir, relativePath) {
  const normalizedRelativePath = path.posix.normalize(String(relativePath || '').replace(/\\/g, '/'));
  if (!normalizedRelativePath || normalizedRelativePath.startsWith('/') || normalizedRelativePath.startsWith('..') || normalizedRelativePath.includes('/../')) {
    throw new Error(`检测到非法路径: ${relativePath}`);
  }
  const resolved = path.resolve(baseDir, normalizedRelativePath);
  const resolvedBase = path.resolve(baseDir);
  if (!(resolved === resolvedBase || resolved.startsWith(`${resolvedBase}${path.sep}`))) {
    throw new Error(`检测到越界路径: ${relativePath}`);
  }
  return resolved;
}

function isPathInsideDirectory(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  let resolved = path.resolve(candidatePath);
  try {
    resolved = fs.realpathSync(candidatePath);
  } catch (_) {}
  return resolved === parent || resolved.startsWith(`${parent}${path.sep}`);
}

function getSystemReadiness() {
  const checks = [];
  let ok = true;
  try {
    fs.accessSync(backupDir, fs.constants.R_OK | fs.constants.W_OK);
    checks.push({ name: 'backup-dir', ok: true, detail: backupDir });
  } catch (error) {
    ok = false;
    checks.push({ name: 'backup-dir', ok: false, detail: error.message });
  }
  return { ok, checks, checkedAt: now(), version: packageInfo.version };
}

async function getSystemReadinessAsync() {
  const readiness = getSystemReadiness();
  let pool = null;
  try {
    await ensureMySqlReady();
    pool = requireMySqlPool();
    await withTimeout(pool.query('SELECT 1'), 5000, 'MySQL 健康检查超时');
    readiness.checks.push({ name: 'mysql', ok: true, detail: `${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}` });
  } catch (error) {
    if (pool && isTransientStorageError(error)) await resetMySqlConnection(pool);
    if (allowFileDbFallback) {
      readiness.checks.push({ name: 'mysql', ok: true, detail: '文件存储模式（内置数据引擎）' });
    } else {
      readiness.ok = false;
      readiness.checks.push({ name: 'mysql', ok: false, detail: error.message });
    }
  }
  return readiness;
}

function getHealthPayload() {
  return {
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    checkedAt: now()
  };
}

function rateLimitResponseHeaders(retryAfterMs) {
  return {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000)))
  };
}

function loginBlockedMessage(retryAfterMs) {
  return `登录失败次数过多，请在 ${Math.max(1, Math.ceil(retryAfterMs / 60000))} 分钟后重试`;
}

async function executeAiInspectionTask(db, task, options = {}) {
  const target = (db.aiInspectionTargets || []).find(item => item.id === task.targetId);
  const template = (db.aiInspectionTemplates || []).find(item => item.id === task.templateId);
  if (!target || !template) return null;
  const existing = (db.aiInspectionResults || []).find(item => item.taskId === task.id);
  if (existing && !task.cycle) {
    task.status = '已完成';
    task.completedAt = task.completedAt || existing.createdAt || now();
    // 调度器需要把「已存在结果」的任务状态落库，否则重新启用的单次任务会一直停留在「待执行」。
    return options.persist === true ? { result: existing, changed: true } : existing;
  }
  task.status = '执行中';
  let realData = null;
  try {
    const decryptedPassword = decryptCredential(target.password);
    const decryptedKey = decryptCredential(target.privateKey);
    const decryptedToken = decryptCredential(target.accessToken);
    const decryptedCommunity = decryptCredential(target.community);
    const probeResults = [];
    if (target.address) {
      if (['password', 'key'].includes(target.authType) && (target.protocol === 'ssh' || target.authType === 'password')) {
        const sshResult = await executeSSHCheck(
          target.address,
          target.port || 22,
          target.account,
          target.authType === 'key' ? decryptedKey : decryptedPassword,
          { privateKey: target.authType === 'key' }
        );
        probeResults.push({ type: 'ssh', result: sshResult });
        if (sshResult.success && sshResult.stdout) {
          const real = {};
          const loadMatch = sshResult.stdout.match(/load average:\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/);
          if (loadMatch) {
            real['CPU负载(1分钟)'] = parseFloat(loadMatch[1]);
            real['CPU负载(5分钟)'] = parseFloat(loadMatch[2]);
            real['CPU负载(15分钟)'] = parseFloat(loadMatch[3]);
            real['CPU使用率'] = Math.min(100, parseFloat(loadMatch[1]) * 100);
          }
          const diskLines = (sshResult.stdout.match(/(\d+)%\s+(\/[^\s]*)/g) || []);
          if (diskLines.length > 0) {
            const maxDiskUse = Math.max(...diskLines.map(line => parseInt(line, 10)));
            real['磁盘使用率'] = maxDiskUse;
          }
          const memMatch = sshResult.stdout.match(/Mem:\s+(\d+)\s+(\d+)/);
          if (memMatch) {
            const total = parseInt(memMatch[1], 10);
            const used = parseInt(memMatch[2], 10);
            if (total > 0) real['内存使用率'] = Math.round((used / total) * 100);
          }
          realData = real;
        }
      }
      if (!target.protocol || ['ssh', 'https', 'agent', 'winrm', 'snmp', 'telnet', 'http'].includes(target.protocol)) {
        const pingResult = await probeHostReachable(target.address);
        probeResults.push({ type: 'ping', result: pingResult });
        const portResult = await probePortOpen(target.address, target.port || 22);
        probeResults.push({ type: 'port', result: portResult });
        realData = realData || {};
        realData['连通性'] = portResult.open ? 100 : 0;
        if (pingResult.latency !== null) {
          realData['响应延迟'] = pingResult.latency;
        }
      }
    }
    const blockingProbeFailures = probeResults.filter(p => {
      if (p.type === 'ssh') return !p.result.success;
      if (p.type === 'port') return !p.result.open;
      return false;
    });
    if (blockingProbeFailures.length > 0) {
      const failureReasons = blockingProbeFailures.map(p => {
        if (p.type === 'ssh') return p.result.stderr || 'SSH 连接失败';
        if (p.type === 'port') return `端口 ${target.port || 22} 未开放或目标不可达`;
        return '未知原因';
      });
      const failedPing = probeResults.find(p => p.type === 'ping' && !p.result.reachable);
      if (failedPing) failureReasons.unshift('主机不可达');
      const failureMessage = `探测失败: ${failureReasons.join('; ')}`;
      const result = {
        id: id('aiResult'),
        projectId: target.projectId,
        taskId: task.id,
        targetId: target.id,
        templateId: template.id,
        createdBy: task.createdBy || '',
        score: 0,
        level: '严重',
        summary: failureMessage,
        risk: '无法连接到目标主机或目标服务，巡检数据不可用',
        suggestion: `请检查目标地址 ${target.address}:${target.port || 22} 的网络连通性、端口开放状态及认证信息`,
        abnormalItems: [failureMessage],
        realData: realData || {},
        createdAt: now(),
        probeError: failureMessage
      };
      db.aiInspectionResults = db.aiInspectionResults || [];
      db.aiInspectionResults.push(result);
      task.status = task.cycle ? '待执行' : '失败';
      task.completedAt = result.createdAt;
      if (task.cycle) {
        // 周期任务失败后同样要推进到下一周期，否则会在下一个调度 tick 立即重跑，导致结果与通知无限堆积。
        advanceAiTaskNextExecution(task);
      } else {
        task.executedAt = result.createdAt;
      }
      const operator = (db.users || []).find(item => item.id === task.createdBy);
      if (operator) {
        appendAuditLog(db, operator, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测失败: ${failureMessage}）`, task.projectId);
      } else {
        appendSystemAuditLog(db, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测失败: ${failureMessage}）`, task.projectId);
      }
      createNotification(db, task.projectId, '自动化巡检提醒', `${task.title} 探测失败: ${failureMessage}`, 'warning', 'ai-inspection', 'aiInspectionTask', task.id);
      if (options.persist === true) {
        return { result, changed: true };
      }
      return result;
    }
    const analysis = buildAiInspectionAnalysis(target.category, task.metrics || [], realData);
    const result = {
      id: id('aiResult'),
      projectId: target.projectId,
      taskId: task.id,
      targetId: target.id,
      templateId: template.id,
      createdBy: task.createdBy || '',
      score: analysis.score,
      level: analysis.level,
      summary: analysis.summary,
      risk: analysis.risk,
      suggestion: analysis.suggestion,
      abnormalItems: analysis.abnormalItems,
      realData: realData || {},
      createdAt: now()
    };
    db.aiInspectionResults = db.aiInspectionResults || [];
    db.aiInspectionResults.push(result);
    // 周期任务执行后必须回到「待执行」，否则调度器（跳过「已完成」）会永久不再执行该周期任务。
    task.status = task.cycle ? '待执行' : '已完成';
    task.completedAt = result.createdAt;
    if (task.cycle) {
      advanceAiTaskNextExecution(task);
    }
    const operator = (db.users || []).find(item => item.id === task.createdBy);
    if (operator) {
      appendAuditLog(db, operator, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}，结果 ${result.level}`, task.projectId);
    } else {
      appendSystemAuditLog(db, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}，结果 ${result.level}`, task.projectId);
    }
    if (result.level === '异常' || result.level === '严重') {
      createNotification(db, task.projectId, '自动化巡检提醒', `${task.title} 输出 ${result.level} 结果`, result.level === '严重' ? 'warning' : 'info', 'ai-inspection', 'aiInspectionTask', task.id);
    }
    if (options.persist === true) {
      return { result, changed: true };
    }
    return result;
  } catch (probeError) {
    const failureMessage = `探测异常: ${probeError.message || '未知错误'}`;
    const result = {
      id: id('aiResult'),
      projectId: target.projectId,
      taskId: task.id,
      targetId: target.id,
      templateId: template.id,
      createdBy: task.createdBy || '',
      score: 0,
      level: '严重',
      summary: failureMessage,
      risk: '探测过程发生异常，巡检数据不可用',
      suggestion: '请检查目标地址配置及认证信息是否正确',
      abnormalItems: [failureMessage],
      createdAt: now(),
      probeError: failureMessage
    };
    db.aiInspectionResults = db.aiInspectionResults || [];
    db.aiInspectionResults.push(result);
    task.status = task.cycle ? '待执行' : '失败';
    task.completedAt = result.createdAt;
    if (task.cycle) {
      // 周期任务失败后同样要推进到下一周期，否则会在下一个调度 tick 立即重跑，导致结果与通知无限堆积。
      advanceAiTaskNextExecution(task);
    } else {
      task.executedAt = result.createdAt;
    }
    const operator = (db.users || []).find(item => item.id === task.createdBy);
    if (operator) {
      appendAuditLog(db, operator, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测异常: ${failureMessage}）`, task.projectId);
    } else {
      appendSystemAuditLog(db, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测异常: ${failureMessage}）`, task.projectId);
    }
    createNotification(db, task.projectId, '自动化巡检提醒', `${task.title} 探测异常: ${failureMessage}`, 'warning', 'ai-inspection', 'aiInspectionTask', task.id);
    if (options.persist === true) {
      return { result, changed: true };
    }
    return result;
  }
}

function normalizeBackupCommand(command) {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function validateBackupCommand(command) {
  const normalized = normalizeBackupCommand(command);
  if (!normalized) return { ok: false, message: 'Backup command is empty' };
  if (!allowedBackupCommands.includes(normalized)) return { ok: false, message: 'Backup command is not allowed' };
  return { ok: true, command: normalized };
}

function executeSSHCommand(host, port, username, secret, command, options = {}) {
  if (!validateHost(host) || !validatePort(port)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid host or port' });
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(username)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid username' });
  const commandValidation = validateBackupCommand(command);
  if (!commandValidation.ok) return Promise.resolve({ success: false, stdout: '', stderr: commandValidation.message });
  // 连接前再次校验目标地址，避免白名单配置被绕过或出现 DNS rebinding。
  return resolveMonitorTargetAddress(host).then(gate => {
    if (!gate.ok) return { success: false, stdout: '', stderr: gate.message || '目标地址不允许探测' };
    return runSshCommand(host, port, username, secret, commandValidation, options);
  });
}

function runSshCommand(host, port, username, secret, commandValidation, options = {}) {
  return new Promise((resolve) => {
    const keyFile = path.join(sshRuntimeDir(), `key-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
    const knownHosts = sshKnownHostsPath();
    const cleanup = () => { fs.unlink(keyFile, () => {}); };
    const run = () => {
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=yes',
        '-o', `UserKnownHostsFile=${knownHosts}`,
        '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=8',
        '-p', String(port),
        `${username}@${host}`,
        commandValidation.command
      ];
      let executable = 'ssh';
      let args = sshArgs;
      const execEnv = sshMinimalEnv();
      if (options.privateKey) {
        fs.writeFileSync(keyFile, secret || '', { mode: 0o600 });
        args = ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', keyFile, ...sshArgs];
      } else {
        executable = 'sshpass';
        execEnv.SSHPASS = secret || '';
        args = ['-e', 'ssh', '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no', ...sshArgs];
      }
      execFile(executable, args, { timeout: 30000, maxBuffer: 1024 * 1024, env: execEnv }, (error, stdout, stderr) => {
        cleanup();
        if (error) return resolve({ success: false, stdout: '', stderr: stderr || error.message });
        resolve({ success: true, stdout: stdout || '', stderr: '' });
      });
    };
    ensureSshKnownHost(host, port).then(run).catch(error => resolve({ success: false, stdout: '', stderr: error.message || '主机指纹未登记' }));
  });
}

async function fetchWebBackup(target, accessToken) {
  const scheme = target.protocol === 'http' ? 'http' : 'https';
  const port = target.port ? `:${target.port}` : '';
  const pathPart = String(target.webBackupPath || '').trim();
  if (!pathPart) return { success: false, content: '', stderr: 'Web backup path is empty' };
  let url;
  let pinned;
  try {
    url = /^https?:\/\//i.test(pathPart) ? new URL(pathPart) : new URL(`${scheme}://${target.address}${port}${pathPart.startsWith('/') ? pathPart : '/' + pathPart}`);
    pinned = await resolveValidatedHttpTarget(url, target.address);
  } catch (error) {
    return { success: false, content: '', stderr: error.message };
  }
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  try {
    const response = await requestPinnedUrl(url, pinned, {
      method: target.webBackupMethod || 'GET',
      headers,
      timeoutMs: 10000,
      maxBytes: 1024 * 1024
    });
    const length = Number(response.headers['content-length'] || 0);
    if (length > 1024 * 1024) return { success: false, content: '', stderr: 'Web backup response is too large' };
    const contentType = response.headers['content-type'] || '';
    if (contentType && !/text|json|xml|octet-stream/i.test(contentType)) return { success: false, content: '', stderr: 'Unsupported content type' };
    if (response.status < 200 || response.status >= 300) return { success: false, content: '', stderr: `HTTP ${response.status}` };
    if (response.text.length > 1024 * 1024) return { success: false, content: '', stderr: 'Web backup response is too large' };
    return { success: true, content: response.text, stderr: '' };
  } catch (error) {
    return { success: false, content: '', stderr: error.message };
  }
}

function normalizeBackupContent(content, fallback) {
  const text = String(content || '').trim();
  return text || fallback;
}

async function executeConfigBackupPlan(db, plan, options = {}) {
  const target = (db.aiInspectionTargets || []).find(item => item.id === plan.targetId);
  const asset = target ? (db.assets || []).find(item => item.id === target.assetId) : null;
  const createdAt = now();
  const baseRecord = {
    id: id('cfgRecord'),
    planId: plan.id,
    projectId: plan.projectId,
    targetId: plan.targetId,
    assetId: target?.assetId || '',
    filename: '',
    content: '',
    size: 0,
    createdBy: options.operatorId || plan.createdBy || 'system',
    createdAt
  };
  const fail = message => {
    const record = { ...baseRecord, status: '失败', message };
    db.configBackupRecords = db.configBackupRecords || [];
    db.configBackupRecords.unshift(record);
    plan.lastBackupAt = createdAt;
    plan.lastStatus = '失败';
    if (plan.cycle) advanceAiTaskNextExecution(plan);
    createNotification(db, plan.projectId, '配置备份提醒', `${plan.name || '配置备份'} 失败: ${message}`, 'warning', 'config-backup', 'configBackupPlan', plan.id);
    return record;
  };
  if (!target) return fail('巡检对象不存在');
  if (!asset) return fail('巡检对象未关联有效资产');
  if (!target.address) return fail('巡检对象管理地址为空');
  const defaultPortMap = { ssh: 22, telnet: 23, http: 80, https: 443, winrm: 5985, snmp: 161, agent: 22 };
  const port = Number(target.port || defaultPortMap[target.protocol] || 22);
  const mode = ['cli', 'web'].includes(target.backupMode) ? target.backupMode : 'cli';
  let backupPayload = '';
  try {
    if (mode === 'cli') {
      if (target.protocol !== 'ssh') return fail('CLI 配置备份当前支持 SSH 协议');
      const secret = target.authType === 'key'
        ? decryptCredential(target.privateKey || '')
        : decryptCredential(target.password || '');
      const command = target.backupCommand || (target.category === 'server' ? 'cat /etc/os-release' : 'show running-config');
      const commandResult = await executeSSHCommand(target.address, port, target.account, secret, command, { privateKey: target.authType === 'key' });
      if (!commandResult.success) return fail(commandResult.stderr || 'CLI 命令执行失败');
      backupPayload = normalizeBackupContent(commandResult.stdout, 'CLI 命令执行成功，未返回配置内容');
    } else {
      const portResult = await probePortOpen(target.address, port);
      if (!portResult.open) return fail(`目标 ${target.address}:${port} 不可达`);
      if (!target.webBackupPath) return fail('Web 备份下载地址未配置');
      const webResult = await fetchWebBackup(target, decryptCredential(target.accessToken || ''));
      if (!webResult.success) return fail(webResult.stderr || 'Web 配置下载失败');
      backupPayload = normalizeBackupContent(webResult.content, 'Web 配置下载成功，未返回配置内容');
    }
  } catch (error) {
    // 凭据解密失败、命令执行异常等都要记录为单次失败，不能中断整批备份计划。
    return fail(error.message || '配置备份执行异常');
  }
  const filenameSafeName = String(target.name || asset.name || 'target').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_.-]+/g, '-').slice(0, 80) || 'target';
  const filename = `${filenameSafeName}-${createdAt.replace(/[:\s]/g, '-').slice(0, 19)}.txt`;
  const content = [
    `配置备份名称: ${plan.name || '-'}`,
    `备份方式: ${mode === 'cli' ? '命令行采集' : 'Web 下载'}`,
    `备份时间: ${createdAt}`,
    `巡检对象: ${target.name || '-'}`,
    `关联资产: ${asset.name || '-'}`,
    `资产编号: ${asset.serialNumber || '-'}`,
    `设备类别: ${target.category || '-'}`,
    `管理地址: ${target.address}:${port}`,
    `管理协议: ${target.protocol || '-'}`,
    `认证方式: ${target.authType || '-'}`,
    `系统版本: ${target.systemVersion || asset.version || '-'}`,
    `部署位置: ${target.location || asset.location || '-'}`,
    `资产厂商: ${asset.brand || '-'}`,
    `资产型号: ${asset.model || '-'}`,
    `资产序列号: ${asset.serialNumber || '-'}`,
    '',
    '[备份内容]',
    backupPayload,
    '',
    '[备注]',
    target.notes || '-'
  ].join('\n');
  const record = {
    ...baseRecord,
    status: '成功',
    filename,
    content,
    size: Buffer.byteLength(content, 'utf8'),
    message: '配置备份成功'
  };
  db.configBackupRecords = db.configBackupRecords || [];
  db.configBackupRecords.unshift(record);
  plan.lastBackupAt = createdAt;
  plan.lastStatus = '成功';
  if (plan.cycle) advanceAiTaskNextExecution(plan);
  return record;
}

async function processPendingConfigBackupPlans(db) {
  let changed = false;
  for (const plan of db.configBackupPlans || []) {
    if (plan.status === '已停用' || plan.status === '执行中') continue;
    if (parseAiInspectionScheduleTime(plan.executedAt) > Date.now()) continue;
    plan.status = '执行中';
    try {
      await executeConfigBackupPlan(db, plan);
    } catch (error) {
      plan.lastStatus = '失败';
      console.error('配置备份计划执行异常:', error.message);
      // 记录构建阶段抛错时也必须推进到下一个周期，否则该计划会被每个调度周期反复触发。
      advanceAiTaskNextExecution(plan);
    } finally {
      // 无论成功失败都要复位状态，避免单条计划卡在「执行中」并阻断后续计划。
      plan.status = plan.cycle ? '待执行' : '已完成';
    }
    changed = true;
  }
  return changed;
}

async function processPendingAiInspectionTasks(db) {
  let changed = false;
  for (const task of db.aiInspectionTasks || []) {
    if (task.status === '已完成' || task.status === '失败' || task.status === '执行中' || task.status === '已停用') continue;
    if (parseAiInspectionScheduleTime(task.executedAt) > Date.now()) continue;
    try {
      const result = await executeAiInspectionTask(db, task, { persist: true });
      if (result?.changed) changed = true;
      if (!result) {
        // 巡检对象或模板已被删除时无法执行，标记失败，避免每个调度周期无限重试。
        task.status = '失败';
        task.lastError = '巡检对象或模板不存在';
        changed = true;
      }
    } catch (error) {
      console.error('巡检任务执行异常:', error.message);
    }
  }
  return changed;
}

function parseNotifyBeforeDays(value) {
  const text = String(value || '').trim();
  if (text === '提前2个月') return 60;
  if (text === '提前3个月') return 90;
  return 30;
}

// 工单 SLA 在后台周期内推进：状态变化写入库，提醒按「工单 + 阈值」去重，
// 避免每个调度周期重复推送同一条超时通知。
function refreshTicketSlaStates(db) {
  let changed = false;
  const nowMsValue = Date.now();

  for (const ticket of db.tickets || []) {
    const nextSlaStatus = resolveTicketSlaStatus(ticket, nowMsValue);
    if (ticket.slaStatus !== nextSlaStatus) {
      ticket.slaStatus = nextSlaStatus;
      changed = true;
    }
    if (nextSlaStatus === '正常') continue;
    const notifyKey = nextSlaStatus === '超时' ? 'sla-timeout' : 'sla-warning';
    const exists = (db.notifications || []).some(item => item.sourceType === 'ticket'
      && item.sourceId === ticket.id
      && item.category === notifyKey);
    if (exists) continue;
    createNotification(
      db,
      ticket.projectId,
      nextSlaStatus === '超时' ? '工单已超时' : '工单即将超时',
      `${ticket.ticketNo} ${ticket.title} ${nextSlaStatus === '超时' ? '已超过' : '即将到达'} SLA 时限（${ticket.slaDeadline || '-'}）`,
      nextSlaStatus === '超时' ? 'error' : 'warning',
      notifyKey,
      'ticket',
      ticket.id
    );
    changed = true;
  }

  return changed;
}

function checkExpiryNotifications(db) {
  let changed = false;
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const todayKey = formatDateKey(new Date());

  for (const project of db.projects || []) {
    if (!project.projectEndDate) continue;
    const endDate = parseDateOnly(project.projectEndDate);
    const today = parseDateOnly(todayKey);
    if (!endDate || !today) continue;
    const daysLeft = Math.round((endDate.getTime() - today.getTime()) / 86400000);
    const thresholdDays = parseNotifyBeforeDays(project.notifyBefore);
    if (daysLeft <= thresholdDays) {
      const existingNotifications = (db.notifications || []).filter(
        n => n.category === 'project-expiry' && n.projectId === project.id && getNotificationCreatedAtMs(n) > (now - thirtyDaysMs)
      );
      if (existingNotifications.length === 0) {
        const expiryText = daysLeft <= 0 ? `已到期 ${Math.abs(daysLeft)} 天` : `剩余 ${daysLeft} 天`;
        createNotification(db, project.id, daysLeft <= 0 ? '项目已到期' : '项目即将到期', `${project.name}（客户：${project.customerName || '未知'}）将于 ${project.projectEndDate} 到期，${expiryText}`, daysLeft <= 7 ? 'warning' : 'info', 'project-expiry');
        changed = true;
      }
    }
  }

  for (const asset of db.assets || []) {
    if (!asset.maintainExpiryDate) continue;
    const expiryDate = parseDateOnly(asset.maintainExpiryDate);
    const today = parseDateOnly(todayKey);
    if (!expiryDate || !today) continue;
    const daysLeft = Math.round((expiryDate.getTime() - today.getTime()) / 86400000);
    if (daysLeft <= 30) {
      const existingNotifications = (db.notifications || []).filter(
        n => n.category === 'maintenance-expiry' && n.projectId === asset.projectId && String(n.content || '').includes(asset.name) && getNotificationCreatedAtMs(n) > (now - thirtyDaysMs)
      );
      if (existingNotifications.length === 0) {
        const expiryText = daysLeft <= 0 ? `已到期 ${Math.abs(daysLeft)} 天` : `剩余 ${daysLeft} 天`;
        createNotification(db, asset.projectId, daysLeft <= 0 ? '维保已到期' : '维保即将到期', `资产 ${asset.name}（${asset.type || '-'}）维保将于 ${asset.maintainExpiryDate} 到期，${expiryText}`, daysLeft <= 7 ? 'warning' : 'info', 'maintenance-expiry', 'asset', asset.id);
        changed = true;
      }
    }
  }

  for (const plan of db.inspectionPlans || []) {
    // 仅停用的计划不再提醒。已执行的计划会把 nextDate 顺延到下一轮，
    // 若按状态跳过会导致首轮执行后永久失去后续提醒。
    if (!plan.nextDate || String(plan.status || '') === '已停用') continue;
    // 到期未执行则回落到「待执行」，状态与待办口径保持一致。
    const resolvedStatus = resolveInspectionPlanStatus(plan, todayKey);
    if (resolvedStatus !== String(plan.status || '')) {
      plan.status = resolvedStatus;
      changed = true;
    }
    const nextDate = parseDateOnly(plan.nextDate);
    const today = parseDateOnly(todayKey);
    if (!nextDate || !today) continue;
    const daysLeft = Math.round((nextDate.getTime() - today.getTime()) / 86400000);
    if (daysLeft <= 7) {
      // 按「计划 + 本轮到期日」去重，保证每个巡检周期都能产生一条提醒。
      const existingNotifications = (db.notifications || []).filter(
        n => n.category === 'inspection-overdue'
          && n.sourceType === 'inspectionPlan'
          && n.sourceId === plan.id
          && String(n.content || '').includes(plan.nextDate)
      );
      if (existingNotifications.length === 0) {
        createNotification(db, plan.projectId, '巡检计划提醒', `巡检计划 ${plan.title || '-'} 将于 ${plan.nextDate} 到期（${daysLeft < 0 ? '已逾期 ' + Math.abs(daysLeft) + ' 天' : daysLeft === 0 ? '今日到期' : '剩余 ' + daysLeft + ' 天'}）`, daysLeft <= 0 ? 'warning' : 'info', 'inspection-overdue', 'inspectionPlan', plan.id);
        changed = true;
      }
    }
  }

  // 三个刷新各自可能独立产生变更，必须逐个执行；用逻辑或串联会因短路漏掉后续提醒。
  if (refreshTicketSlaStates(db)) changed = true;
  if (checkWorkReportReminderNotifications(db)) changed = true;
  return changed;
}

function requireExistingProject(projectId, db) {
  if (!projectId) return null;
  return db.projects.find(item => item.id === projectId) || null;
}

// SSO（LDAP/OIDC）首次开通账号时的默认策略：命中白名单且默认项目有效才自动启用，否则保持待审批。
function resolveSsoProvisioning(systemConfig, db, identities = []) {
  const allowlist = String(systemConfig?.ssoAutoApproveAllowlist || '')
    .split(/[\s,;]+/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.length) return null;
  const candidates = identities
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  if (!candidates.some(item => allowlist.includes(item))) return null;
  const projectId = String(systemConfig?.ssoDefaultProjectId || '').trim();
  if (!requireExistingProject(projectId, db)) return null;
  return { status: 'active', projectId };
}

function requireExistingUser(userId, db) {
  if (!userId) return null;
  return db.users.find(item => item.id === userId) || null;
}

function requireExistingAsset(assetId, db) {
  if (!assetId) return null;
  return db.assets.find(item => item.id === assetId) || null;
}

function canDecideApproval(user, approval) {
  if (!user || !approval) return false;
  // 禁止提交人审批自己的单据，避免自审自批。
  if (user.id === approval.requestedBy) return false;
  if (user.role === 'admin') return true;
  if (approval.currentStage === 'customer') return user.role === 'customer' && user.id === approval.customerId;
  // 运维审批阶段仅允许同项目工程师执行，避免只读角色被指派后获得写权限。
  if (user.role !== 'engineer') return false;
  if (!userHasProject(user, approval.projectId)) return false;
  return user.id === approval.approverId;
}

// 审批详情仅对提交人、审批人、甲方客户和管理员开放，其他项目成员只能看到流转状态。
function canViewApprovalDetail(user, approval) {
  if (!user || !approval) return false;
  if (user.role === 'admin') return true;
  return approval.requestedBy === user.id
    || approval.approverId === user.id
    || approval.customerId === user.id;
}

function canDeleteOwnedRecord(user, item, creatorId) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  if (!userHasProject(user, item.projectId)) return false;
  return creatorId === user.id;
}

// 统计除指定账号外仍处于启用状态的管理员数量，用于保证系统至少保留一个可用管理员。
function countActiveAdminsExcluding(db, excludeUserId) {
  // 只有状态为 active 的管理员才算「启用」，pending/rejected/disabled 均不构成可用管理员。
  return (db.users || []).filter(item => item.role === 'admin' && item.status === 'active' && item.id !== excludeUserId).length;
}

function canManageInspectionRecord(user, item) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  if (!userHasProject(user, item.projectId)) return false;
  // 无创建者的存量记录仅管理员可改删，避免同项目工程师横向越权。
  if (!item.createdBy) return false;
  return item.createdBy === user.id;
}

// 工单号按「日期 + 当日序号」生成，删除历史工单不会回收序号，避免编号重复。
function nextTicketNo(db, date = new Date()) {
  const dateKey = formatDateKey(date).replace(/-/g, '');
  const prefix = `WO${dateKey}`;
  let maxSeq = 0;
  for (const item of db.tickets || []) {
    const ticketNo = String(item.ticketNo || '');
    if (!ticketNo.startsWith(prefix)) continue;
    const seq = parseInt(ticketNo.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

// 采购单号与工单号同样按「日期 + 当日序号」生成，避免删除历史后编号复用。
function nextPurchaseNo(db, date = new Date()) {
  const dateKey = formatDateKey(date).replace(/-/g, '');
  const prefix = `PO${dateKey}`;
  let maxSeq = 0;
  for (const item of db.sparePartPurchases || []) {
    const no = String(item.purchaseNo || '');
    if (!no.startsWith(prefix)) continue;
    const seq = Number(no.slice(prefix.length));
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

function ticketSlaHours(priority) {
  return ticketSlaHoursByPriority[priority] || ticketSlaHoursByPriority['中'];
}

// SLA 截止时间按创建时间加时限计算，创建后修改优先级时同步刷新。
function computeTicketSlaDeadline(createdAtIso, priority) {
  const createdMs = Date.parse(String(createdAtIso || ''));
  const baseMs = Number.isFinite(createdMs) ? createdMs : Date.now();
  return new Date(baseMs + ticketSlaHours(priority) * 60 * 60 * 1000).toISOString();
}

function resolveTicketSlaStatus(ticket, atMs = Date.now()) {
  if (!ticket) return '正常';
  if (['已完成', '已关闭'].includes(ticket.status)) return '正常';
  const deadlineMs = Date.parse(String(ticket.slaDeadline || ''));
  if (!Number.isFinite(deadlineMs)) return '正常';
  const createdAtMs = Date.parse(String(ticket.createdAt || ''));
  const startMs = Number.isFinite(createdAtMs) ? createdAtMs : deadlineMs - ticketSlaHours(ticket.priority) * 60 * 60 * 1000;
  const totalMs = Math.max(1, deadlineMs - startMs);
  if (atMs >= deadlineMs) return '超时';
  if (atMs >= startMs + totalMs * ticketSlaWarningRatio) return '预警';
  return '正常';
}

// 客户可查看本项目的工单进度，但处理过程与内部备注仅运维可见。
function sanitizeTicketForViewer(ticket, viewer) {
  if (!ticket || !viewer || viewer.role !== 'customer') return ticket;
  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    projectId: ticket.projectId,
    title: ticket.title,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    assigneeName: ticket.assigneeName,
    slaStatus: ticket.slaStatus,
    slaDeadline: ticket.slaDeadline,
    resolution: ticket.resolution,
    customerConfirmedAt: ticket.customerConfirmedAt,
    customerComment: ticket.customerComment,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt
  };
}

// 工单处理人默认是同项目工程师；管理员可跨项目指派。
function canOperateTicket(user, ticket) {
  if (!user || !ticket) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'engineer') return false;
  return userHasProject(user, ticket.projectId);
}

function canDeleteTicket(user, ticket) {
  if (!user || !ticket) return false;
  if (user.role === 'admin') return true;
  return ticket.createdBy === user.id;
}

// 项目内可见即可操作（仅用于以已有巡检对象为模板新建计划等非执行类动作）。
function canAccessInspectionRecord(user, item) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  return userHasProject(user, item.projectId);
}

// 巡检对象改归属项目后，同步其派生任务/结果/备份计划/备份记录的 projectId，避免出现跨项目孤儿引用。
function syncAiInspectionTargetProject(target, projectId, db) {
  // 统一用重建数组（新对象）表达改动：aiInspectionResults 在快照克隆中只做数组浅拷贝，
  // 元素为共享引用，原地改写无法被脏检测与并发增量合并可靠捕获。
  if (Array.isArray(db.aiInspectionTasks)) {
    db.aiInspectionTasks = db.aiInspectionTasks.map(item =>
      (item && item.targetId === target.id && item.projectId !== projectId) ? { ...item, projectId } : item);
  }
  if (Array.isArray(db.aiInspectionResults)) {
    db.aiInspectionResults = db.aiInspectionResults.map(item =>
      (item && item.targetId === target.id && item.projectId !== projectId) ? { ...item, projectId } : item);
  }
  const planIds = new Set();
  if (Array.isArray(db.configBackupPlans)) {
    db.configBackupPlans = db.configBackupPlans.map(item => {
      if (!item || item.targetId !== target.id) return item;
      planIds.add(item.id);
      return item.projectId !== projectId ? { ...item, projectId } : item;
    });
  }
  if (Array.isArray(db.configBackupRecords) && planIds.size) {
    db.configBackupRecords = db.configBackupRecords.map(item =>
      (item && planIds.has(item.planId) && item.projectId !== projectId) ? { ...item, projectId } : item);
  }
}

function refreshInspectionPlanFromExecutions(db, planId) {
  const plan = (db.inspectionPlans || []).find(item => item.id === planId);
  if (!plan) return;
  const executions = (db.inspectionExecutions || [])
    .filter(item => item.planId === planId)
    .slice()
    .sort((a, b) => String(b.executedAt || b.createdAt || '').localeCompare(String(a.executedAt || a.createdAt || '')));
  if (!executions.length) {
    plan.status = '待执行';
    return;
  }
  const latestExecution = executions[0];
  plan.status = latestExecution.result === '异常' ? '异常待处理' : '已执行';
  if (latestExecution.nextDate) {
    plan.nextDate = latestExecution.nextDate;
  }
}

// 计划到期仍未执行时，状态从上一轮结果回到「待执行」，避免状态与实际待办不一致。
function resolveInspectionPlanStatus(plan, todayKey) {
  const status = String(plan?.status || '');
  if (status !== '已执行' && status !== '已完成') return status;
  if (!plan.nextDate || plan.nextDate >= todayKey) return status;
  return '待执行';
}

// 按巡检周期从指定日期推进到下一定检日，用于执行记录未填下次巡检日时自动顺延。
function computeNextInspectionDateKey(cycle, baseDateKey) {
  const base = parseDateOnly(baseDateKey);
  if (!base) return '';
  if (cycle === 'daily') return dateToKey(addDays(base, 1));
  if (cycle === 'weekly') return dateToKey(addDays(base, 7));
  if (cycle === 'monthly' || cycle === 'quarterly') {
    const next = new Date(base.getTime());
    next.setUTCMonth(next.getUTCMonth() + (cycle === 'quarterly' ? 3 : 1));
    return dateToKey(next);
  }
  return dateToKey(addDays(base, 30));
}

function startOfWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function getPeriodKey(dateString, period) {
  const d = parseDateOnly(dateString);
  if (!d) return '';
  if (period === 'year') return `${d.getUTCFullYear()}`;
  if (period === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const w = startOfWeek(d);
  const yearStart = Date.UTC(w.getUTCFullYear(), 0, 1);
  const weekNumber = Math.ceil((((w.getTime() - yearStart) / 86400000) + 1) / 7);
  return `${w.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

function parseDateOnly(dateString) {
  const match = String(dateString || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function getCalendarDateKey(dateString) {
  const raw = String(dateString || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : formatDateKey(parsed);
  }
  const datePart = match[1];
  const rest = match[2] || '';
  if (!rest || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(rest)) return datePart;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? datePart : formatDateKey(parsed);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function dateToKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getDateRangeFromPeriod(period, anchorDate = '', rangeStart = '', rangeEnd = '') {
  if (period === 'custom') {
    const start = parseDateOnly(rangeStart);
    const end = parseDateOnly(rangeEnd);
    if (!start || !end || start.getTime() > end.getTime()) return null;
    return {
      period: 'custom',
      periodKey: `${dateToKey(start)}_${dateToKey(end)}`,
      rangeStart: dateToKey(start),
      rangeEnd: dateToKey(end),
      label: `${dateToKey(start)} 至 ${dateToKey(end)}`
    };
  }
  const baseDate = parseDateOnly(anchorDate) || parseDateOnly(formatDateKey(new Date()));
  if (!baseDate) return null;
  if (period === 'day') {
    const key = dateToKey(baseDate);
    return { period, periodKey: key, rangeStart: key, rangeEnd: key, label: key };
  }
  if (period === 'week') {
    const start = startOfWeek(baseDate);
    const end = addDays(start, 6);
    return {
      period,
      periodKey: getPeriodKey(dateToKey(baseDate), 'week'),
      rangeStart: dateToKey(start),
      rangeEnd: dateToKey(end),
      label: `${dateToKey(start)} 至 ${dateToKey(end)}`
    };
  }
  const start = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), 1));
  const end = endOfMonth(baseDate);
  return {
    period: 'month',
    periodKey: getPeriodKey(dateToKey(baseDate), 'month'),
    rangeStart: dateToKey(start),
    rangeEnd: dateToKey(end),
    label: `${dateToKey(start)} 至 ${dateToKey(end)}`
  };
}

function getPreviousDateRange(range) {
  if (!range) return null;
  if (range.period === 'custom') {
    const currentStart = parseDateOnly(range.rangeStart);
    const currentEnd = parseDateOnly(range.rangeEnd);
    if (!currentStart || !currentEnd) return null;
    const dayCount = getInclusiveDayCount(range.rangeStart, range.rangeEnd);
    const previousEnd = addDays(currentStart, -1);
    const previousStart = addDays(previousEnd, -(dayCount - 1));
    return {
      period: 'custom',
      periodKey: `${dateToKey(previousStart)}_${dateToKey(previousEnd)}`,
      rangeStart: dateToKey(previousStart),
      rangeEnd: dateToKey(previousEnd),
      label: `${dateToKey(previousStart)} 至 ${dateToKey(previousEnd)}`
    };
  }
  const currentStart = parseDateOnly(range.rangeStart);
  if (!currentStart) return null;
  if (range.period === 'day') return getDateRangeFromPeriod('day', dateToKey(addDays(currentStart, -1)));
  if (range.period === 'week') return getDateRangeFromPeriod('week', dateToKey(addDays(currentStart, -7)));
  return getDateRangeFromPeriod('month', dateToKey(addDays(currentStart, -1)));
}

function getWorkReportPeriodMeta(reportType, anchorDate = '') {
  if (reportType === 'weekly') return getDateRangeFromPeriod('week', anchorDate);
  if (reportType === 'monthly') return getDateRangeFromPeriod('month', anchorDate);
  return getDateRangeFromPeriod('day', anchorDate);
}

function isDateInRange(dateString, rangeStart, rangeEnd) {
  const current = getCalendarDateKey(dateString);
  return Boolean(current) && current >= rangeStart && current <= rangeEnd;
}

function buildWorkloadMetrics(db, filters = {}) {
  const rangeStart = String(filters.rangeStart || '');
  const rangeEnd = String(filters.rangeEnd || '');
  const userId = String(filters.userId || '');
  const projectId = String(filters.projectId || '');
  const matches = (itemProjectId, itemUserId, itemDate) => {
    if (!isDateInRange(itemDate, rangeStart, rangeEnd)) return false;
    if (projectId && itemProjectId !== projectId) return false;
    if (userId && String(itemUserId || '') !== userId) return false;
    return true;
  };
  const logs = db.logs.filter(item => matches(item.projectId, item.userId, item.date));
  const inspectionCount = db.inspectionExecutions.filter(item => matches(item.projectId, item.createdBy, item.executedAt)).length;
  const incidentCount = db.incidentRecords.filter(item => matches(item.projectId, item.createdBy, item.occurredAt || item.createdAt)).length;
  const changeCount = db.changeRecords.filter(item => matches(item.projectId, item.createdBy, item.createdAt)).length;
  const knowledgeCount = db.knowledgeBase.filter(item => matches(item.projectId || (db.users.find(user => user.id === item.createdBy)?.projectId || ''), item.createdBy, item.createdAt)).length;
  const documentCount = db.documents.filter(item => matches(item.projectId, item.createdBy, item.createdAt)).length;
  const resolvedIncidentCount = db.incidentRecords.filter(item => matches(item.projectId, item.createdBy, item.occurredAt || item.createdAt) && ['已关闭', '已恢复'].includes(String(item.status || ''))).length;
  const workloadCategories = summarizeWorkloadCategories(logs);
  return normalizeWorkMetricsSnapshot({
    logCount: logs.length,
    totalHours: logs.reduce((sum, item) => sum + Number(item.durationHours || 0), 0),
    inspectionCount,
    incidentCount,
    changeCount,
    knowledgeCount,
    documentCount,
    resolvedIncidentCount,
    categoryCounts: workloadCategories.categoryCounts,
    categoryHours: workloadCategories.categoryHours
  });
}

function getInclusiveDayCount(rangeStart, rangeEnd) {
  const start = parseDateOnly(rangeStart);
  const end = parseDateOnly(rangeEnd);
  if (!start || !end || start.getTime() > end.getTime()) return 1;
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
}

function isWorkReportInRange(report, rangeStart, rangeEnd) {
  if (!report) return false;
  return String(report.rangeStart || '') <= rangeEnd && String(report.rangeEnd || '') >= rangeStart;
}

function getWorkloadSpecialFilterLabel(value) {
  if (value === 'no-daily') return '只看未提交日报人员';
  if (value === 'hour-anomaly') return '只看工时异常人员';
  if (value === 'low-output') return '只看本周低产出人员';
  return '';
}

const WORKLOAD_CATEGORY_LABELS = {
  inspection: '巡检类',
  incident: '故障类',
  change: '变更类',
  document: '资料类',
  task: '事务类',
  support: '外围支撑类'
};

const WORKLOAD_CATEGORY_ORDER = ['inspection', 'incident', 'change', 'document', 'task', 'support'];

function normalizeWorkloadCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (WORKLOAD_CATEGORY_LABELS[raw]) return raw;
  const normalized = raw.replace(/\s+/g, '');
  const aliasMap = {
    巡检类: 'inspection',
    巡检: 'inspection',
    故障类: 'incident',
    故障: 'incident',
    变更类: 'change',
    变更: 'change',
    资料类: 'document',
    资料: 'document',
    事务类: 'task',
    事务: 'task',
    外围支撑类: 'support',
    外围支撑: 'support'
  };
  return aliasMap[normalized] || '';
}

function deriveWorkloadCategory(ticketType = '') {
  const normalized = String(ticketType || '').trim();
  const ticketTypeMap = {
    '物理环境': 'inspection',
    '软硬件维护': 'inspection',
    '视频会议': 'support',
    '桌面终端及周边': 'support',
    '外围工作': 'support',
    '故障排查': 'incident',
    '网络安全告警': 'incident',
    '网络安全事件': 'incident',
    '设备变更': 'change',
    '配置变更': 'change',
    '资料管理': 'document',
    '事务工作': 'task'
  };
  return ticketTypeMap[normalized] || 'task';
}

function resolveWorkloadCategory(category, ticketType = '') {
  return normalizeWorkloadCategory(category) || deriveWorkloadCategory(ticketType);
}

function createWorkloadCategoryStats() {
  return WORKLOAD_CATEGORY_ORDER.reduce((result, key) => {
    result.counts[key] = 0;
    result.hours[key] = 0;
    return result;
  }, { counts: {}, hours: {} });
}

function summarizeWorkloadCategories(logs) {
  const stats = createWorkloadCategoryStats();
  for (const log of logs) {
    const category = resolveWorkloadCategory(log.workloadCategory, log.ticketType);
    const durationHours = Number(log.durationHours || 0);
    if (!(category in stats.counts)) continue;
    stats.counts[category] += 1;
    stats.hours[category] += durationHours;
  }
  return {
    categoryCounts: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, stats.counts[key]])),
    categoryHours: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, Number(stats.hours[key].toFixed(2))]))
  };
}

function formatWorkloadCategorySummary(values = {}, suffix = '') {
  return WORKLOAD_CATEGORY_ORDER.map(key => `${WORKLOAD_CATEGORY_LABELS[key]}${Number(values[key] || 0)}${suffix}`).join(' ｜ ');
}

const LOG_TICKET_TYPE_OPTIONS = [
  '物理环境',
  '设备变更',
  '配置变更',
  '网络安全告警',
  '网络安全事件',
  '故障排查',
  '软硬件维护',
  '桌面终端及周边',
  '资料管理',
  '事务工作',
  '外围工作',
  '视频会议'
];

const LOG_RESULT_OPTIONS = ['已完成', '处理中', '需跟进', '已转交', '异常待复盘'];
const LOG_SINGLE_DURATION_LIMIT_HOURS = 24;
const LOG_DAILY_DURATION_LIMIT_HOURS = 24;

function parseLogDateTime(dateString = '') {
  const raw = String(dateString || '').trim();
  if (!raw) return null;
  const value = raw.length === 10 ? `${raw}T00:00` : raw;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLogDayKey(dateString = '') {
  return getCalendarDateKey(dateString);
}

function normalizeLogResult(value = '') {
  const normalized = String(value || '').trim();
  return LOG_RESULT_OPTIONS.includes(normalized) ? normalized : '';
}

function normalizeLogText(value = '') {
  return String(value || '').trim();
}

function validateLogPayload(db, user, body, existingLog = null) {
  const requestedProjectId = String(body.projectId !== undefined ? body.projectId : (existingLog?.projectId || '')).trim();
  const projectId = user.role === 'admin' ? requestedProjectId : resolveWriteProjectId(user, requestedProjectId);
  if (!projectId) return { error: '请选择关联项目' };
  if (!requireExistingProject(projectId, db)) return { error: '关联项目不存在' };
  const assetId = String(body.assetId !== undefined ? body.assetId : (existingLog?.assetId || '')).trim();
  const asset = requireExistingAsset(assetId || '', db);
  if (assetId && (!asset || asset.projectId !== projectId)) return { error: '关联资产不存在或不属于当前项目' };
  const date = String(body.date !== undefined ? body.date : (existingLog?.date || '')).trim();
  if (!date) return { error: '请选择派单时间' };
  if (!parseLogDateTime(date)) return { error: '派单时间格式无效' };
  const ticketType = String(body.ticketType !== undefined ? body.ticketType : (existingLog?.ticketType || '')).trim();
  if (!ticketType) return { error: '请选择工单类型' };
  if (!LOG_TICKET_TYPE_OPTIONS.includes(ticketType)) return { error: '工单类型不在标准字典内' };
  const event = normalizeLogText(body.event !== undefined ? body.event : (existingLog?.event || ''));
  if (!event) return { error: '请输入工单内容' };
  const process = normalizeLogText(body.process !== undefined ? body.process : (existingLog?.process || ''));
  if (!process) return { error: '请输入处理过程' };
  const result = normalizeLogResult(body.result !== undefined ? body.result : (existingLog?.result || ''));
  if (!result) return { error: '请选择处理结果' };
  const conclusion = normalizeLogText(body.conclusion !== undefined ? body.conclusion : (existingLog?.conclusion || ''));
  if (!conclusion) return { error: '请输入结论' };
  const logLengthError = checkTextLength(event, 4000, '工单内容')
    || checkTextLength(process, 4000, '处理过程')
    || checkTextLength(conclusion, 4000, '结论');
  if (logLengthError) return { error: logLengthError };
  if (body.durationHours === undefined && !existingLog) return { error: '请输入工单用时' };
  const durationHours = Number(body.durationHours !== undefined ? body.durationHours : (existingLog?.durationHours || 0));
  if (!Number.isFinite(durationHours) || durationHours <= 0) return { error: '工单用时必须大于 0' };
  if (durationHours > LOG_SINGLE_DURATION_LIMIT_HOURS) return { error: `单条日志工时不能超过 ${LOG_SINGLE_DURATION_LIMIT_HOURS} 小时` };
  const dayKey = getLogDayKey(date);
  const totalHours = (db.logs || [])
    .filter(item => item.userId === (existingLog?.userId || user.id) && getLogDayKey(item.date) === dayKey && item.id !== existingLog?.id)
    .reduce((sum, item) => sum + Number(item.durationHours || 0), 0) + durationHours;
  if (totalHours > LOG_DAILY_DURATION_LIMIT_HOURS) return { error: `当日累计工时不能超过 ${LOG_DAILY_DURATION_LIMIT_HOURS} 小时` };
  const attachmentValidation = validateLogAttachments(body.attachments !== undefined ? body.attachments : existingLog?.attachments);
  if (attachmentValidation.error) return { error: attachmentValidation.error };
  return {
    payload: {
      projectId,
      assetId,
      date,
      event,
      relatedTarget: normalizeLogText(body.relatedTarget !== undefined ? body.relatedTarget : (existingLog?.relatedTarget || '')),
      dispatcher: normalizeLogText(body.dispatcher !== undefined ? body.dispatcher : (existingLog?.dispatcher || '')),
      dispatchDepartment: normalizeLogText(body.dispatchDepartment !== undefined ? body.dispatchDepartment : (existingLog?.dispatchDepartment || '')),
      ticketType,
      workloadCategory: resolveWorkloadCategory(body.workloadCategory !== undefined ? body.workloadCategory : (existingLog?.workloadCategory || ''), ticketType),
      assignee: normalizeLogText(body.assignee !== undefined ? body.assignee : (existingLog?.assignee || user.name || '')) || user.name,
      process,
      result,
      conclusion,
      remark: normalizeLogText(body.remark !== undefined ? body.remark : (existingLog?.remark || '')),
      durationHours,
      attachments: attachmentValidation.attachments
    }
  };
}

function buildLogQualityWarnings(db, userId, payload, existingLog = null) {
  const warnings = [];
  const logs = (db.logs || []).filter(item => item.userId === userId && item.id !== existingLog?.id);
  const duplicateItems = logs.filter(item => {
    return getLogDayKey(item.date) === getLogDayKey(payload.date)
      && String(item.projectId || '') === payload.projectId
      && String(item.ticketType || '') === payload.ticketType
      && normalizeLogText(item.event) === payload.event;
  });
  if (duplicateItems.length) {
    warnings.push(`发现 ${duplicateItems.length} 条同日、同项目、同工单类型且工单内容相同的日志，请确认是否重复记录。`);
  }
  const startTime = parseLogDateTime(payload.date);
  if (!startTime) return warnings;
  const endTime = new Date(startTime.getTime() + payload.durationHours * 3600000);
  const overlapItems = logs.filter(item => {
    const otherStart = parseLogDateTime(item.date);
    const otherDuration = Number(item.durationHours || 0);
    if (!otherStart || otherDuration <= 0) return false;
    const otherEnd = new Date(otherStart.getTime() + otherDuration * 3600000);
    return startTime < otherEnd && endTime > otherStart;
  });
  if (overlapItems.length) {
    warnings.push(`发现 ${overlapItems.length} 条同时间段重叠日志，请确认时间安排是否重复。`);
  }
  return warnings;
}

function buildWorkloadBoardSummary(rows = []) {
  return rows.reduce((totals, item) => {
    totals.logCount += Number(item.logCount || 0);
    totals.totalHours += Number(item.totalHours || 0);
    totals.inspectionCount += Number(item.inspectionCount || 0);
    totals.incidentCount += Number(item.incidentCount || 0);
    totals.resolvedIncidentCount += Number(item.resolvedIncidentCount || 0);
    totals.changeCount += Number(item.changeCount || 0);
    totals.knowledgeCount += Number(item.knowledgeCount || 0);
    totals.documentCount += Number(item.documentCount || 0);
    WORKLOAD_CATEGORY_ORDER.forEach(key => {
      totals.categoryCounts[key] += Number(item.categoryCounts?.[key] || 0);
      totals.categoryHours[key] += Number(item.categoryHours?.[key] || 0);
    });
    return totals;
  }, {
    logCount: 0,
    totalHours: 0,
    inspectionCount: 0,
    incidentCount: 0,
    resolvedIncidentCount: 0,
    changeCount: 0,
    knowledgeCount: 0,
    documentCount: 0,
    categoryCounts: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, 0])),
    categoryHours: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, 0]))
  });
}

function roundMetricValue(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildMetricDelta(currentValue, previousValue) {
  const current = roundMetricValue(currentValue);
  const previous = roundMetricValue(previousValue);
  const change = roundMetricValue(current - previous);
  const changeRate = previous === 0 ? (current === 0 ? 0 : null) : roundMetricValue((change / previous) * 100);
  return {
    current,
    previous,
    change,
    changeRate,
    baselineZero: previous === 0
  };
}

function buildWorkloadSummaryComparison(currentSummary, previousSummary) {
  return {
    logCount: buildMetricDelta(currentSummary.logCount, previousSummary.logCount),
    totalHours: buildMetricDelta(currentSummary.totalHours, previousSummary.totalHours),
    inspectionCount: buildMetricDelta(currentSummary.inspectionCount, previousSummary.inspectionCount),
    incidentCount: buildMetricDelta(currentSummary.incidentCount, previousSummary.incidentCount),
    resolvedIncidentCount: buildMetricDelta(currentSummary.resolvedIncidentCount, previousSummary.resolvedIncidentCount),
    changeCount: buildMetricDelta(currentSummary.changeCount, previousSummary.changeCount),
    knowledgeCount: buildMetricDelta(currentSummary.knowledgeCount, previousSummary.knowledgeCount),
    documentCount: buildMetricDelta(currentSummary.documentCount, previousSummary.documentCount),
    categoryCounts: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, buildMetricDelta(currentSummary.categoryCounts?.[key] || 0, previousSummary.categoryCounts?.[key] || 0)])),
    categoryHours: Object.fromEntries(WORKLOAD_CATEGORY_ORDER.map(key => [key, buildMetricDelta(currentSummary.categoryHours?.[key] || 0, previousSummary.categoryHours?.[key] || 0)]))
  };
}

function buildWorkReportTotals(reports = []) {
  const totals = reports.reduce((result, item) => {
    result.reportCount += 1;
    result.totalHours += Number(item.metricsSnapshot?.totalHours || 0);
    if (item.status === 'submitted') result.submitted += 1;
    if (item.status === 'locked') result.locked += 1;
    return result;
  }, { reportCount: 0, totalHours: 0, submitted: 0, locked: 0 });
  totals.totalHours = roundMetricValue(totals.totalHours);
  return totals;
}

function buildWorkReportTotalsComparison(currentTotals, previousTotals) {
  return {
    reportCount: buildMetricDelta(currentTotals.reportCount, previousTotals.reportCount),
    totalHours: buildMetricDelta(currentTotals.totalHours, previousTotals.totalHours),
    submitted: buildMetricDelta(currentTotals.submitted, previousTotals.submitted),
    locked: buildMetricDelta(currentTotals.locked, previousTotals.locked)
  };
}

function buildWorkloadRows(db, currentUser, filters = {}) {
  const specialFilter = String(filters.specialFilter || '').trim();
  const scopedUsers = currentUser.role === 'admin'
    ? db.users.filter(item => item.role !== 'customer')
    : db.users.filter(item => item.id === currentUser.id);
  const rangeStart = String(filters.rangeStart || '');
  const rangeEnd = String(filters.rangeEnd || '');
  const workDays = getInclusiveDayCount(rangeStart, rangeEnd);
  const reportRows = (db.workReports || []).filter(report => {
    if (!isWorkReportInRange(report, rangeStart, rangeEnd)) return false;
    if (currentUser.role !== 'admin' && !userHasProject(currentUser, report.projectId)) return false;
    return true;
  });
  const reportStatsByUser = new Map();
  for (const report of reportRows) {
    const key = report.userId;
    const current = reportStatsByUser.get(key) || {
      dailySubmittedCount: 0,
      submittedCount: 0,
      reportCount: 0
    };
    if (report.status !== 'draft') {
      current.submittedCount += 1;
      if (report.reportType === 'daily') current.dailySubmittedCount += 1;
    }
    current.reportCount += 1;
    reportStatsByUser.set(key, current);
  }
  return scopedUsers
    .filter(item => !filters.projectId || item.projectId === filters.projectId)
    .map(item => {
      const metrics = buildWorkloadMetrics(db, {
        rangeStart: filters.rangeStart,
        rangeEnd: filters.rangeEnd,
        userId: item.id,
        projectId: filters.projectId || item.projectId || ''
      });
      const project = db.projects.find(projectItem => projectItem.id === item.projectId);
      const reportStats = reportStatsByUser.get(item.id) || { dailySubmittedCount: 0, submittedCount: 0, reportCount: 0 };
      const workOrderCount = metrics.logCount;
      return {
        userId: item.id,
        userName: item.name,
        projectId: item.projectId || '',
        projectName: project?.name || '-',
        workOrderCount,
        ...metrics,
        workContentSummary: formatWorkloadCategorySummary(metrics.categoryCounts, '项'),
        workloadHoursSummary: formatWorkloadCategorySummary(metrics.categoryHours, 'h'),
        workEffectSummary: [`巡检${metrics.inspectionCount}`, `故障${metrics.incidentCount}`, `已解决${metrics.resolvedIncidentCount}`, `变更${metrics.changeCount}`, `知识${metrics.knowledgeCount}`, `资料${metrics.documentCount}`].join(' ｜ '),
        dailySubmittedCount: reportStats.dailySubmittedCount,
        submittedWorkReportCount: reportStats.submittedCount,
        workReportCount: reportStats.reportCount
      };
    })
    .filter(item => {
      if (!specialFilter) return true;
      if (specialFilter === 'no-daily') return item.dailySubmittedCount === 0;
      if (specialFilter === 'hour-anomaly') return item.totalHours >= Math.max(workDays * 8 * 1.5, 12);
      if (specialFilter === 'low-output') return item.totalHours < Math.max(workDays * 2, 4) && item.workOrderCount <= Math.max(workDays, 1);
      return true;
    })
    .sort((a, b) => {
      if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
      return a.userName.localeCompare(b.userName, 'zh-CN');
    });
}

function buildWorkloadCsv(rows) {
  const lines = [
    ['人员', '项目', '工单数', '累计工时', '巡检类工单', '故障类工单', '变更类工单', '资料类工单', '事务类工单', '外围支撑类工单', '巡检类工时', '故障类工时', '变更类工时', '资料类工时', '事务类工时', '外围支撑类工时', '巡检数', '故障数', '已解决故障数', '变更数', '知识数', '资料数', '日报数', '已提交汇报数'].join(',')
  ];
  rows.forEach(item => {
    lines.push([
      item.userName,
      item.projectName,
      item.workOrderCount ?? item.logCount,
      item.totalHours,
      item.categoryCounts?.inspection || 0,
      item.categoryCounts?.incident || 0,
      item.categoryCounts?.change || 0,
      item.categoryCounts?.document || 0,
      item.categoryCounts?.task || 0,
      item.categoryCounts?.support || 0,
      item.categoryHours?.inspection || 0,
      item.categoryHours?.incident || 0,
      item.categoryHours?.change || 0,
      item.categoryHours?.document || 0,
      item.categoryHours?.task || 0,
      item.categoryHours?.support || 0,
      item.inspectionCount,
      item.incidentCount,
      item.resolvedIncidentCount || 0,
      item.changeCount,
      item.knowledgeCount,
      item.documentCount || 0,
      item.dailySubmittedCount ?? 0,
      item.submittedWorkReportCount ?? 0
    ].map(quoteCsvValue).join(','));
  });
  return `\ufeff${lines.join('\n')}`;
}

function canManageWorkReport(user, report) {
  if (user.role === 'admin') return true;
  return user.id === report.userId && userHasProject(user, report.projectId);
}

function canEditWorkReportContent(report) {
  return report.status === 'draft' || report.status === 'returned';
}

function canSubmitWorkReport(report) {
  return report.status === 'draft' || report.status === 'returned';
}

function reportTypeLabel(reportType) {
  return reportType === 'weekly' ? '周报' : reportType === 'monthly' ? '月报' : '日报';
}

function canAccessWorkReport(user, report) {
  if (user.role === 'admin') return true;
  if (user.role === 'customer') {
  return userHasProject(user, report.projectId) && ['submitted', 'approved', 'locked'].includes(report.status);
  }
  return userHasProject(user, report.projectId) && user.id === report.userId;
}

function buildWorkReportResponse(db, report) {
  const owner = db.users.find(item => item.id === report.userId);
  const reviewer = db.users.find(item => item.id === report.reviewedBy);
  const project = db.projects.find(item => item.id === report.projectId);
  return {
    ...report,
    userName: owner?.name || '-',
    projectName: project?.name || '-',
    reviewerName: reviewer?.name || (report.reviewedBy ? '管理员' : '')
  };
}

function quoteCsvValue(value) {
  let text = String(value ?? '');
  // 中和电子表格公式注入：以 = + - @ 或制表符/回车开头的值前置单引号
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildAuditLogFilters(query = {}) {
  return {
    search: String(query.search || '').trim().toLowerCase(),
    action: String(query.action || '').trim(),
    targetType: String(query.targetType || '').trim(),
    projectId: String(query.projectId || '').trim(),
    startDate: String(query.startDate || '').trim(),
    endDate: String(query.endDate || '').trim()
  };
}

function matchesAuditLogFilters(item, filters) {
  if (filters.action && item.action !== filters.action) return false;
  if (filters.targetType && item.targetType !== filters.targetType) return false;
  if (filters.projectId && item.projectId !== filters.projectId) return false;
  const createdAt = String(item.createdAt || '');
  if (filters.startDate && createdAt.slice(0, 10) < filters.startDate) return false;
  if (filters.endDate && createdAt.slice(0, 10) > filters.endDate) return false;
  if (filters.search) {
    const hit = ['operatorName', 'action', 'targetType', 'targetId', 'detail']
      .some(key => String(item[key] || '').toLowerCase().includes(filters.search));
    if (!hit) return false;
  }
  return true;
}

function buildAuditLogCsv(entries) {
  const lines = [
    ['导出时间', new Date().toISOString()].map(quoteCsvValue).join(','),
    ['时间', '操作人', '操作', '对象类型', '对象ID', '详情', '项目ID', 'IP', 'User-Agent'].join(',')
  ];
  entries.forEach(item => {
    lines.push([
      item.createdAt,
      item.operatorName,
      item.action,
      item.targetType,
      item.targetId,
      item.detail,
      item.projectId,
      item.ip,
      item.userAgent
    ].map(quoteCsvValue).join(','));
  });
  return lines.join('\n');
}

const CONTRACT_STATUS_LABELS = { draft: '草稿', active: '执行中', completed: '已完成', terminated: '已终止' };

const globalSearchTypeOptions = [
  { key: 'assets', label: '资产' },
  { key: 'logs', label: '服务日志' },
  { key: 'tickets', label: '工单' },
  { key: 'knowledge', label: '知识库' },
  { key: 'documents', label: '资料' },
  { key: 'contracts', label: '合同' },
  { key: 'spareParts', label: '备件' },
  { key: 'projects', label: '项目' }
];

function searchMatch(keyword, fields) {
  return fields.some(field => String(field || '').toLowerCase().includes(keyword));
}

// 全局搜索统一在此聚合，各类型沿用与列表接口一致的可见范围，避免绕过权限。
function buildGlobalSearchResults(db, user, keyword, selectedTypes, limitPerType) {
  const lowered = String(keyword || '').trim().toLowerCase();
  if (!lowered) return { data: [], counts: {}, total: 0 };
  const projectNameOf = projectId => (db.projects || []).find(item => item.id === projectId)?.name || '';
  const hits = [];
  const counts = {};
  const types = selectedTypes.length ? selectedTypes : globalSearchTypeOptions.map(item => item.key);

  const push = (type, list) => {
    counts[type] = list.length;
    hits.push(...list.slice(0, limitPerType));
  };

  if (types.includes('assets')) {
    const list = filterByProjectScope(db.assets || [], user, item => item.projectId)
      .filter(item => searchMatch(lowered, [item.name, item.brand, item.model, item.serialNumber, item.installationLocation, item.owner]))
      .map(item => ({
        type: 'assets', id: item.id, title: item.name, subtitle: [item.type, item.brand, item.model, item.installationLocation].filter(Boolean).join(' / '),
        projectId: item.projectId, projectName: projectNameOf(item.projectId), updatedAt: item.createdAt
      }));
    push('assets', list);
  }

  if (types.includes('logs')) {
    let source = filterByProjectScope(db.logs || [], user, item => item.projectId);
    if (user.role === 'customer') {
      const visible = new Set(customerVisibleLogProjects(db, user));
      source = source.filter(item => visible.has(item.projectId));
    }
    const list = source
      .filter(item => searchMatch(lowered, [item.title, item.event, item.relatedTarget, item.process, item.result, item.conclusion]))
      .map(item => ({
        type: 'logs', id: item.id, title: item.title || item.event || '服务日志',
        subtitle: [item.date, item.event, item.result].filter(Boolean).join(' / '),
        projectId: item.projectId, projectName: projectNameOf(item.projectId), updatedAt: item.createdAt
      }));
    push('logs', list);
  }

  if (types.includes('tickets')) {
    const list = filterByProjectScope(db.tickets || [], user, item => item.projectId)
      .filter(item => searchMatch(lowered, [item.ticketNo, item.title, item.description, item.category, item.assigneeName]))
      .map(item => ({
        type: 'tickets', id: item.id, title: item.title,
        subtitle: [item.ticketNo, item.status, item.priority].filter(Boolean).join(' / '),
        projectId: item.projectId, projectName: projectNameOf(item.projectId), updatedAt: item.updatedAt || item.createdAt
      }));
    push('tickets', list);
  }

  if (types.includes('knowledge')) {
    let source = filterByProjectScope(db.knowledgeBase || [], user, item => item.projectId);
    if (user.role === 'customer') source = source.filter(item => item.status === 'published');
    const list = source
      .filter(item => searchMatch(lowered, user.role === 'customer'
        ? [item.title, item.keywords, item.category, item.tags]
        : [item.title, item.keywords, item.problem, item.solution]))
      .map(item => ({
        type: 'knowledge', id: item.id, title: item.title,
        subtitle: [item.category, item.status].filter(Boolean).join(' / '),
        projectId: item.projectId, projectName: projectNameOf(item.projectId), updatedAt: item.createdAt
      }));
    push('knowledge', list);
  }

  if (types.includes('documents')) {
    const list = filterByProjectScope(db.documents || [], user, item => item.projectId)
      .filter(item => searchMatch(lowered, [item.title, item.brand, item.model, item.serialNumber, item.managementIp, item.managementMethod]))
      .map(item => ({
        type: 'documents', id: item.id, title: item.title,
        subtitle: [item.brand, item.model, item.managementIp].filter(Boolean).join(' / '),
        projectId: item.projectId, projectName: projectNameOf(item.projectId), updatedAt: item.updatedAt || item.createdAt
      }));
    push('documents', list);
  }

  if (types.includes('contracts') && user.role !== 'customer') {
    const list = filterByProjectScope(db.contracts || [], user, item => item.projectId)
      .filter(item => searchMatch(lowered, [item.contractNo, item.name, item.partyA, item.partyB, item.notes]))
      .map(item => ({
        type: 'contracts', id: item.id, title: item.name,
        subtitle: [item.contractNo, CONTRACT_STATUS_LABELS[item.status] || item.status].filter(Boolean).join(' / '),
        projectId: item.projectId, projectName: projectNameOf(item.projectId), updatedAt: item.updatedAt || item.createdAt
      }));
    push('contracts', list);
  }

  if (types.includes('spareParts') && user.role !== 'customer') {
    const list = filterByProjectScope(db.spareParts || [], user, item => item.projectId)
      .filter(item => searchMatch(lowered, [item.name, item.model, item.brand, item.location, item.notes]))
      .map(item => ({
        type: 'spareParts', id: item.id, title: item.name,
        subtitle: [item.brand, item.model, item.location].filter(Boolean).join(' / '),
        projectId: item.projectId, projectName: projectNameOf(item.projectId), updatedAt: item.createdAt
      }));
    push('spareParts', list);
  }

  if (types.includes('projects')) {
    const list = (db.projects || [])
      .filter(item => canViewProject(user, item.id))
      .filter(item => searchMatch(lowered, [item.name, item.customerName, item.description]))
      .map(item => ({
        type: 'projects', id: item.id, title: item.name, subtitle: item.customerName || '',
        projectId: item.id, projectName: item.name, updatedAt: item.createdAt
      }));
    push('projects', list);
  }

  hits.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return { data: hits, counts, total, availableTypes: globalSearchTypeOptions };
}

function listScopedWorkReports(db, user, filters = {}) {
  const status = String(filters.status || '').trim();
  const reportType = String(filters.reportType || '').trim();
  const projectId = String(filters.projectId || '').trim();
  const userId = String(filters.userId || '').trim();
  return (db.workReports || []).filter(item => {
    if (!canAccessWorkReport(user, item)) return false;
    if (status && item.status !== status) return false;
    if (reportType && item.reportType !== reportType) return false;
    if (projectId && item.projectId !== projectId) return false;
    if (userId && item.userId !== userId) return false;
    return true;
  });
}

function buildWorkReportOverview(db, user, filters = {}) {
  const rangeStart = String(filters.rangeStart || '');
  const rangeEnd = String(filters.rangeEnd || '');
  const trendUnit = ['day', 'week', 'month'].includes(String(filters.trendUnit || '').trim())
    ? String(filters.trendUnit || '').trim()
    : 'week';
  const reports = listScopedWorkReports(db, user, filters)
    .filter(item => String(item.rangeStart || '') <= rangeEnd && String(item.rangeEnd || '') >= rangeStart)
    .map(item => buildWorkReportResponse(db, item));
  const totals = buildWorkReportTotals(reports);
  const previousRange = getPreviousDateRange({
    period: String(filters.period || ''),
    periodKey: String(filters.periodKey || ''),
    rangeStart,
    rangeEnd,
    label: String(filters.label || `${rangeStart} 至 ${rangeEnd}`)
  });
  const previousReports = previousRange
    ? listScopedWorkReports(db, user, filters)
      .filter(item => String(item.rangeStart || '') <= previousRange.rangeEnd && String(item.rangeEnd || '') >= previousRange.rangeStart)
      .map(item => buildWorkReportResponse(db, item))
    : [];
  const previousTotals = buildWorkReportTotals(previousReports);

  const trendMap = new Map();
  reports.forEach(item => {
    const bucket = getDateRangeFromPeriod(trendUnit, item.rangeStart);
    if (!bucket) return;
    const current = trendMap.get(bucket.periodKey) || {
      key: bucket.periodKey,
      label: bucket.label,
      rangeStart: bucket.rangeStart,
      rangeEnd: bucket.rangeEnd,
      reportCount: 0,
      totalHours: 0,
      logCount: 0,
      pendingCount: 0,
      submittedCount: 0,
      approvedCount: 0,
      lockedCount: 0
    };
    current.reportCount += 1;
    current.totalHours += Number(item.metricsSnapshot?.totalHours || 0);
    current.logCount += Number(item.metricsSnapshot?.logCount || 0);
    if (item.status === 'submitted') current.pendingCount += 1;
    if (item.status === 'submitted') current.submittedCount += 1;
    if (item.status === 'approved') current.approvedCount += 1;
    if (item.status === 'locked') current.lockedCount += 1;
    trendMap.set(bucket.periodKey, current);
  });
  const trend = [...trendMap.values()]
    .sort((a, b) => String(a.rangeStart).localeCompare(String(b.rangeStart)))
    .map(item => ({
      label: item.label,
      reportCount: item.reportCount,
      totalHours: Number(item.totalHours.toFixed(2)),
      logCount: item.logCount,
      pendingCount: item.pendingCount,
      submittedCount: item.submittedCount,
      approvedCount: item.approvedCount,
      lockedCount: item.lockedCount
    }));

  const buildRanking = field => [...reports.reduce((map, item) => {
    const key = String(item[field] || '');
    const current = map.get(key) || {
      id: key,
      name: field === 'userId' ? item.userName : item.projectName,
      reportCount: 0,
      totalHours: 0,
      logCount: 0,
      pendingCount: 0
    };
    current.reportCount += 1;
    current.totalHours += Number(item.metricsSnapshot?.totalHours || 0);
    current.logCount += Number(item.metricsSnapshot?.logCount || 0);
    if (item.status === 'submitted') current.pendingCount += 1;
    map.set(key, current);
    return map;
  }, new Map()).values()]
    .map(item => ({ ...item, totalHours: Number(item.totalHours.toFixed(2)) }))
    .sort((a, b) => b.reportCount - a.reportCount || b.totalHours - a.totalHours || String(a.name).localeCompare(String(b.name), 'zh-CN'));

  const pendingItems = reports
    .filter(item => item.status === 'submitted')
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')) || String(a.rangeStart).localeCompare(String(b.rangeStart)));
  const rankings = {
    users: buildRanking('userId'),
    projects: buildRanking('projectId')
  };
  const pendingSummary = {
    total: pendingItems.length,
    byType: ['daily', 'weekly', 'monthly']
      .map(type => ({ reportType: type, count: pendingItems.filter(item => item.reportType === type).length }))
      .filter(item => item.count > 0),
    byUsers: rankings.users.filter(item => Number(item.pendingCount) > 0),
    byProjects: rankings.projects.filter(item => Number(item.pendingCount) > 0),
    oldestSubmittedAt: pendingItems[0]?.submittedAt || '',
    items: pendingItems
  };

  return {
    range: {
      period: String(filters.period || ''),
      periodKey: String(filters.periodKey || ''),
      trendUnit,
      rangeStart,
      rangeEnd,
      label: String(filters.label || `${rangeStart} 至 ${rangeEnd}`)
    },
    previousRange,
    totals,
    totalsComparison: buildWorkReportTotalsComparison(totals, previousTotals),
    trend,
    rankings,
    pendingSummary
  };
}

function buildWorkReportListCsv(reports) {
  const lines = [
    ['导出时间', new Date().toISOString()].map(quoteCsvValue).join(','),
    [
    '周期开始', '周期结束', '汇报类型', '人员', '项目', '日志数', '累计工时', '巡检数', '故障数', '已解决故障数', '变更数', '知识数', '资料数',
    '巡检类工单', '故障类工单', '变更类工单', '资料类工单', '事务类工单', '外围支撑类工单',
    '状态', '工作总结', '已完成事项', '未完成事项', '风险阻塞', '下一步计划', '审核人', '审核意见', '提交时间', '审核时间', '锁定时间'
  ].join(',')];
  reports.forEach(item => {
    lines.push([
      item.rangeStart,
      item.rangeEnd,
      item.reportType === 'daily' ? '日报' : item.reportType === 'weekly' ? '周报' : '月报',
      item.userName,
      item.projectName,
      item.metricsSnapshot?.logCount || 0,
      item.metricsSnapshot?.totalHours || 0,
      item.metricsSnapshot?.inspectionCount || 0,
      item.metricsSnapshot?.incidentCount || 0,
      item.metricsSnapshot?.resolvedIncidentCount || 0,
      item.metricsSnapshot?.changeCount || 0,
      item.metricsSnapshot?.knowledgeCount || 0,
      item.metricsSnapshot?.documentCount || 0,
      item.metricsSnapshot?.categoryCounts?.inspection || 0,
      item.metricsSnapshot?.categoryCounts?.incident || 0,
      item.metricsSnapshot?.categoryCounts?.change || 0,
      item.metricsSnapshot?.categoryCounts?.document || 0,
      item.metricsSnapshot?.categoryCounts?.task || 0,
      item.metricsSnapshot?.categoryCounts?.support || 0,
      item.status === 'draft' ? '草稿' : item.status === 'submitted' ? '已提交' : item.status === 'returned' ? '已退回' : item.status === 'approved' ? '已确认' : '已锁定',
      item.summary,
      item.completedWork,
      item.pendingWork,
      item.risks,
      item.nextPlan,
      item.reviewerName,
      item.reviewComment,
      item.submittedAt,
      item.reviewedAt,
      item.lockedAt
    ].map(quoteCsvValue).join(','));
  });
  return `\ufeff${lines.join('\n')}`;
}

function buildWorkReportOverviewCsv(overview) {
  const lines = [];
  lines.push('汇总指标');
  lines.push(['统计范围', overview.range?.rangeStart || '', overview.range?.rangeEnd || ''].map(quoteCsvValue).join(','));
  lines.push(['统计口径', overview.range?.period || '', overview.range?.trendUnit || ''].map(quoteCsvValue).join(','));
  lines.push(['导出时间', new Date().toISOString()].map(quoteCsvValue).join(','));
  lines.push(['汇报总数', overview.totals?.reportCount || 0].map(quoteCsvValue).join(','));
  lines.push(['累计工时', overview.totals?.totalHours || 0].map(quoteCsvValue).join(','));
  lines.push(['待审核', overview.totals?.submitted || 0].map(quoteCsvValue).join(','));
  lines.push(['已锁定', overview.totals?.locked || 0].map(quoteCsvValue).join(','));
  lines.push('');
  lines.push('趋势');
  lines.push(['周期', '汇报数', '已提交', '已确认', '已锁定', '工时', '日志数', '待审核'].join(','));
  (overview.trend || []).forEach(item => {
    lines.push([item.label, item.reportCount, item.submittedCount || 0, item.approvedCount || 0, item.lockedCount || 0, item.totalHours, item.logCount, item.pendingCount].map(quoteCsvValue).join(','));
  });
  lines.push('');
  lines.push('待审核汇报');
  lines.push(['类型', '人员', '项目', '周期开始', '周期结束', '提交时间'].join(','));
  (overview.pendingSummary?.items || []).forEach(item => {
    lines.push([
      item.reportType === 'daily' ? '日报' : item.reportType === 'weekly' ? '周报' : '月报',
      item.userName,
      item.projectName,
      item.rangeStart,
      item.rangeEnd,
      item.submittedAt
    ].map(quoteCsvValue).join(','));
  });
  lines.push('');
  lines.push('人员排行');
  lines.push(['人员', '汇报数', '工时', '日志数', '待审核'].join(','));
  (overview.rankings?.users || []).forEach(item => {
    lines.push([item.name, item.reportCount, item.totalHours, item.logCount, item.pendingCount].map(quoteCsvValue).join(','));
  });
  lines.push('');
  lines.push('项目排行');
  lines.push(['项目', '汇报数', '工时', '日志数', '待审核'].join(','));
  (overview.rankings?.projects || []).forEach(item => {
    lines.push([item.name, item.reportCount, item.totalHours, item.logCount, item.pendingCount].map(quoteCsvValue).join(','));
  });
  return `\ufeff${lines.join('\n')}`;
}

function buildSummary(db, period, userId, projectId = '', projectIds = []) {
  const projectScope = new Set((projectIds || []).map(item => String(item || '').trim()).filter(Boolean));
  const filteredLogs = db.logs.filter(log => {
    if (userId && log.userId !== userId) return false;
    if (projectId && String(log.projectId || '') !== String(projectId)) return false;
    if (!projectId && projectScope.size && !projectScope.has(String(log.projectId || ''))) return false;
    return true;
  });
  const map = new Map();
  for (const log of filteredLogs) {
    const key = getPeriodKey(log.date, period);
    const user = db.users.find(item => item.id === log.userId);
    const project = db.projects.find(item => item.id === log.projectId);
    const current = map.get(key) || {
      period: key,
      totalLogs: 0,
      totalHours: 0,
      projects: new Set(),
      users: new Set()
    };
    current.totalLogs += 1;
    current.totalHours += Number(log.durationHours || 0);
    if (project) current.projects.add(project.name);
    if (user) current.users.add(user.name);
    map.set(key, current);
  }
  return [...map.values()]
    .sort((a, b) => b.period.localeCompare(a.period))
    .map(item => ({
      period: item.period,
      totalLogs: item.totalLogs,
      totalHours: Number(item.totalHours.toFixed(2)),
      projects: [...item.projects],
      users: [...item.users]
    }));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32(dataBuffer), 14);
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
    centralHeader.writeUInt32LE(crc32(dataBuffer), 16);
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
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function emu(inches) {
  return Math.round(inches * 914400);
}

function createTextParagraphs(lines, options = {}) {
  const size = options.size || 1800;
  const color = options.color || '0F172A';
  const bold = options.bold ? ' b="1"' : '';
  const align = options.align || 'l';
  const font = options.font || 'Microsoft YaHei';
  const spaceAfter = options.spaceAfter || 0;
  const textLines = lines.length ? lines : [''];
  return textLines.map(line => `
    <a:p>
      <a:pPr algn="${align}">${spaceAfter ? `<a:spcAft><a:spcPts val="${spaceAfter}"/></a:spcAft>` : ''}</a:pPr>
      <a:r>
        <a:rPr lang="zh-CN" sz="${size}"${bold}>
          <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
          <a:latin typeface="${font}"/>
          <a:ea typeface="${font}"/>
          <a:cs typeface="${font}"/>
        </a:rPr>
        <a:t>${escapeXml(line)}</a:t>
      </a:r>
      <a:endParaRPr lang="zh-CN" sz="${size}">
        <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
        <a:latin typeface="${font}"/>
        <a:ea typeface="${font}"/>
        <a:cs typeface="${font}"/>
      </a:endParaRPr>
    </a:p>`).join('');
}

function createShape(options) {
  const hasText = Array.isArray(options.textLines);
  const isTextBox = hasText && !options.fill && !options.line;
  const fill = options.fill ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>` : '<a:noFill/>';
  const line = options.line ? `<a:ln><a:solidFill><a:srgbClr val="${options.line}"/></a:solidFill></a:ln>` : (isTextBox ? '' : '<a:ln><a:noFill/></a:ln>');
  const style = isTextBox ? '' : `<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>`;
  const textBody = hasText
    ? `<p:txBody>
        <a:bodyPr wrap="${isTextBox ? 'none' : 'square'}" rtlCol="0" anchor="${options.anchor || 't'}">${isTextBox ? '<a:spAutoFit/>' : ''}</a:bodyPr>
        <a:lstStyle/>
        ${createTextParagraphs(options.textLines, options.textOptions || {})}
      </p:txBody>`
    : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>';
  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${options.id}" name="${escapeXml(options.name || `Shape ${options.id}`)}"/>
        <p:cNvSpPr${isTextBox ? ' txBox="1"' : ''}/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="${options.x}" y="${options.y}"/>
          <a:ext cx="${options.cx}" cy="${options.cy}"/>
        </a:xfrm>
        <a:prstGeom prst="${options.preset || (isTextBox ? 'rect' : 'rect')}"><a:avLst/></a:prstGeom>
        ${fill}
        ${line}
      </p:spPr>
      ${style}
      ${textBody}
    </p:sp>`;
}

function createBaseSlide(shapes, backgroundColor = 'F8FAFC') {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${backgroundColor}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr/>
      ${shapes.join('')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function createCoverSlide(payload) {
  return createBaseSlide([
    createShape({ id: 2, x: 0, y: 0, cx: emu(13.333), cy: emu(7.5), fill: 'F8FAFC', name: 'Background' }),
    createShape({ id: 3, x: emu(0.55), y: emu(0.45), cx: emu(12.2), cy: emu(6), fill: '0F172A', preset: 'roundRect', name: 'Hero' }),
    createShape({ id: 4, x: emu(0.55), y: emu(0.45), cx: emu(0.18), cy: emu(6), fill: 'F59E0B', name: 'Accent' }),
    createShape({ id: 5, x: emu(1.0), y: emu(0.95), cx: emu(7.5), cy: emu(0.7), textLines: [payload.reportTitle], textOptions: { size: 2600, color: 'FFFFFF', bold: true } }),
    createShape({ id: 6, x: emu(1.0), y: emu(1.8), cx: emu(6.6), cy: emu(0.35), textLines: [payload.projectName], textOptions: { size: 1400, color: 'BFDBFE' } }),
    createShape({ id: 7, x: emu(1.0), y: emu(2.45), cx: emu(4.8), cy: emu(0.35), textLines: [`周期：${payload.periodLabel}`], textOptions: { size: 1800, color: 'FFFFFF' } }),
    createShape({ id: 8, x: emu(1.0), y: emu(2.95), cx: emu(4.8), cy: emu(0.35), textLines: [`人员：${payload.userName}`], textOptions: { size: 1800, color: 'FFFFFF' } }),
    createShape({ id: 9, x: emu(1.0), y: emu(4.3), cx: emu(8.7), cy: emu(0.85), textLines: ['聚焦驻场巡检、问题处理、资产维护与知识沉淀，适合直接用于工作汇报与留档。'], textOptions: { size: 1600, color: 'E2E8F0' } }),
    createShape({ id: 10, x: emu(8.75), y: emu(1.15), cx: emu(3.1), cy: emu(3.6), fill: 'FFFFFF', preset: 'roundRect', name: 'SummaryPanel' }),
    createShape({ id: 11, x: emu(9.0), y: emu(1.4), cx: emu(2.5), cy: emu(0.25), textLines: ['核心数据'], textOptions: { size: 1400, color: '64748B' } }),
    createShape({ id: 12, x: emu(9.0), y: emu(1.95), cx: emu(2.5), cy: emu(0.45), textLines: [String(payload.totalLogs)], textOptions: { size: 2800, color: '2563EB', bold: true, align: 'ctr' } }),
    createShape({ id: 13, x: emu(9.0), y: emu(2.4), cx: emu(2.5), cy: emu(0.2), textLines: ['日志总数'], textOptions: { size: 1200, color: '64748B', align: 'ctr' } }),
    createShape({ id: 14, x: emu(9.0), y: emu(2.95), cx: emu(2.5), cy: emu(0.45), textLines: [String(payload.totalHours)], textOptions: { size: 2800, color: '16A34A', bold: true, align: 'ctr' } }),
    createShape({ id: 15, x: emu(9.0), y: emu(3.4), cx: emu(2.5), cy: emu(0.2), textLines: ['累计工时'], textOptions: { size: 1200, color: '64748B', align: 'ctr' } }),
    createShape({ id: 16, x: emu(9.0), y: emu(3.95), cx: emu(2.5), cy: emu(0.45), textLines: [String(payload.kbCount)], textOptions: { size: 2800, color: 'F59E0B', bold: true, align: 'ctr' } }),
    createShape({ id: 17, x: emu(9.0), y: emu(4.4), cx: emu(2.5), cy: emu(0.2), textLines: ['知识沉淀'], textOptions: { size: 1200, color: '64748B', align: 'ctr' } }),
    createShape({ id: 18, x: emu(0.7), y: emu(7.0), cx: emu(12), cy: emu(0.2), textLines: [`导出时间：${payload.exportTime}`], textOptions: { size: 900, color: '64748B' } })
  ]);
}

function createOverviewSlide(payload) {
  return createBaseSlide([
    createShape({ id: 2, x: 0, y: 0, cx: emu(13.333), cy: emu(7.5), fill: 'F8FAFC', name: 'Background' }),
    createShape({ id: 3, x: emu(0.7), y: emu(0.5), cx: emu(5.5), cy: emu(0.35), textLines: ['工作概览'], textOptions: { size: 2200, color: '0F172A', bold: true } }),
    createShape({ id: 4, x: emu(0.7), y: emu(0.92), cx: emu(7.5), cy: emu(0.2), textLines: ['以简洁卡片展示本周期的关键指标与汇报摘要'], textOptions: { size: 1100, color: '64748B' } }),
    createShape({ id: 5, x: emu(0.7), y: emu(1.45), cx: emu(3.7), cy: emu(1.45), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }),
    createShape({ id: 6, x: emu(0.7), y: emu(1.45), cx: emu(0.08), cy: emu(1.45), fill: '2563EB' }),
    createShape({ id: 7, x: emu(0.95), y: emu(1.65), cx: emu(2.9), cy: emu(0.2), textLines: ['日志总数'], textOptions: { size: 1300, color: '64748B' } }),
    createShape({ id: 8, x: emu(0.95), y: emu(2.05), cx: emu(2.9), cy: emu(0.4), textLines: [`${payload.totalLogs} 条`], textOptions: { size: 2600, color: '0F172A', bold: true } }),
    createShape({ id: 9, x: emu(4.8), y: emu(1.45), cx: emu(3.7), cy: emu(1.45), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }),
    createShape({ id: 10, x: emu(4.8), y: emu(1.45), cx: emu(0.08), cy: emu(1.45), fill: '16A34A' }),
    createShape({ id: 11, x: emu(5.05), y: emu(1.65), cx: emu(2.9), cy: emu(0.2), textLines: ['累计工时'], textOptions: { size: 1300, color: '64748B' } }),
    createShape({ id: 12, x: emu(5.05), y: emu(2.05), cx: emu(2.9), cy: emu(0.4), textLines: [`${payload.totalHours} 小时`], textOptions: { size: 2600, color: '0F172A', bold: true } }),
    createShape({ id: 13, x: emu(8.9), y: emu(1.45), cx: emu(3.7), cy: emu(1.45), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }),
    createShape({ id: 14, x: emu(8.9), y: emu(1.45), cx: emu(0.08), cy: emu(1.45), fill: 'F59E0B' }),
    createShape({ id: 15, x: emu(9.15), y: emu(1.65), cx: emu(2.9), cy: emu(0.2), textLines: ['知识沉淀'], textOptions: { size: 1300, color: '64748B' } }),
    createShape({ id: 16, x: emu(9.15), y: emu(2.05), cx: emu(2.9), cy: emu(0.4), textLines: [`${payload.kbCount} 条`], textOptions: { size: 2600, color: '0F172A', bold: true } }),
    createShape({ id: 17, x: emu(0.7), y: emu(3.35), cx: emu(11.9), cy: emu(2.8), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }),
    createShape({ id: 18, x: emu(1.0), y: emu(3.68), cx: emu(4.5), cy: emu(0.25), textLines: ['汇报摘要'], textOptions: { size: 1600, color: '0F172A', bold: true } }),
    createShape({ id: 19, x: emu(1.0), y: emu(4.05), cx: emu(10.8), cy: emu(1.7), textLines: [`项目：${payload.projectName}`, `周期：${payload.periodLabel}`, '本周期工作围绕巡检、故障处置、资产维护与经验沉淀展开，适合在周报、月报或客户汇报场景中直接使用。'], textOptions: { size: 1600, color: '0F172A', spaceAfter: 1000 } }),
    createShape({ id: 20, x: emu(0.7), y: emu(7.0), cx: emu(12), cy: emu(0.2), textLines: ['工作概览'], textOptions: { size: 900, color: '64748B' } })
  ]);
}

function createDetailSlide(payload) {
  const shapes = [
    createShape({ id: 2, x: 0, y: 0, cx: emu(13.333), cy: emu(7.5), fill: 'F8FAFC', name: 'Background' }),
    createShape({ id: 3, x: emu(0.7), y: emu(0.5), cx: emu(5.5), cy: emu(0.35), textLines: ['工作明细'], textOptions: { size: 2200, color: '0F172A', bold: true } }),
    createShape({ id: 4, x: emu(0.7), y: emu(0.92), cx: emu(7.5), cy: emu(0.2), textLines: ['展示本周期关键日志，包含地址位置、结论与处理过程摘要'], textOptions: { size: 1100, color: '64748B' } })
  ];
  if (!payload.logs.length) {
    shapes.push(createShape({ id: 5, x: emu(0.7), y: emu(1.6), cx: emu(11.9), cy: emu(4.8), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }));
    shapes.push(createShape({ id: 6, x: emu(3.8), y: emu(3.6), cx: emu(5.2), cy: emu(0.4), textLines: ['当前周期暂无运维日志'], textOptions: { size: 2000, color: '64748B', bold: true, align: 'ctr' } }));
  } else {
    payload.logs.slice(0, 4).forEach((item, index) => {
      const top = 1.45 + index * 1.25;
      const process = item.process.length > 62 ? `${item.process.slice(0, 62)}...` : item.process;
      const baseId = 10 + index * 10;
      shapes.push(createShape({ id: baseId, x: emu(0.7), y: emu(top), cx: emu(11.9), cy: emu(1.12), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }));
      shapes.push(createShape({ id: baseId + 1, x: emu(0.95), y: emu(top + 0.12), cx: emu(1.0), cy: emu(0.18), textLines: [item.date], textOptions: { size: 1100, color: '64748B' } }));
      shapes.push(createShape({ id: baseId + 2, x: emu(2.0), y: emu(top + 0.1), cx: emu(4.8), cy: emu(0.2), textLines: [item.event], textOptions: { size: 1600, color: '0F172A', bold: true } }));
      shapes.push(createShape({ id: baseId + 3, x: emu(7.1), y: emu(top + 0.12), cx: emu(2.1), cy: emu(0.18), textLines: [`地址：${item.location || '-'}`], textOptions: { size: 1100, color: '64748B' } }));
      shapes.push(createShape({ id: baseId + 4, x: emu(9.35), y: emu(top + 0.1), cx: emu(2.3), cy: emu(0.2), textLines: [`${item.durationHours} 小时`], textOptions: { size: 1400, color: '16A34A', bold: true, align: 'r' } }));
      shapes.push(createShape({ id: baseId + 5, x: emu(0.95), y: emu(top + 0.44), cx: emu(10.9), cy: emu(0.18), textLines: [`结论：${item.conclusion || '-'}`], textOptions: { size: 1200, color: '0F172A' } }));
      shapes.push(createShape({ id: baseId + 6, x: emu(0.95), y: emu(top + 0.71), cx: emu(10.9), cy: emu(0.18), textLines: [`处理过程：${process || '-'}`], textOptions: { size: 1100, color: '64748B' } }));
    });
  }
  shapes.push(createShape({ id: 99, x: emu(0.7), y: emu(7.0), cx: emu(12), cy: emu(0.2), textLines: ['工作明细'], textOptions: { size: 900, color: '64748B' } }));
  return createBaseSlide(shapes);
}

function truncateText(value, maxLength = 90) {
  const text = String(value ?? '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text || '-';
}

function buildOperationalReportData(db, scope, targetId, period, viewer) {
  const currentPeriod = getPeriodKey(formatDateKey(new Date()), period);
  const periodLabel = ({ week: '每周', month: '每月', year: '每年' }[period] || period);
  const targetUser = scope === 'user' ? db.users.find(item => item.id === targetId) : null;
  const project = scope === 'project'
    ? db.projects.find(item => item.id === targetId)
    : db.projects.find(item => item.id === targetUser?.projectId);
  if (!project || (scope === 'user' && !targetUser)) return null;
  const projectUserIds = (db.users || []).filter(item => userHasProject(item, project.id)).map(item => item.id);
  const logs = (db.logs || [])
    .filter(item => scope === 'user' ? item.userId === targetId : item.projectId === project.id)
    .filter(item => getPeriodKey(item.date, period) === currentPeriod)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const assets = (db.assets || []).filter(item => item.projectId === project.id);
  const kb = (db.knowledgeBase || []).filter(item => scope === 'user' ? item.createdBy === targetId : item.projectId === project.id || projectUserIds.includes(item.createdBy));
  const plans = (db.inspectionPlans || []).filter(item => item.projectId === project.id);
  const executions = (db.inspectionExecutions || [])
    .filter(item => item.projectId === project.id)
    .filter(item => getPeriodKey(item.executedAt, period) === currentPeriod)
    .sort((a, b) => String(b.executedAt || '').localeCompare(String(a.executedAt || '')));
  const changes = (db.changeRecords || [])
    .filter(item => item.projectId === project.id)
    .filter(item => getPeriodKey(item.createdAt, period) === currentPeriod)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const incidents = (db.incidentRecords || [])
    .filter(item => item.projectId === project.id)
    .filter(item => getPeriodKey(item.occurredAt || item.createdAt, period) === currentPeriod)
    .sort((a, b) => String(b.occurredAt || b.createdAt || '').localeCompare(String(a.occurredAt || a.createdAt || '')));
  const documents = (db.documents || []).filter(item => item.projectId === project.id);
  const spareParts = (db.spareParts || []).filter(item => item.projectId === project.id);
  const users = (db.users || []).filter(item => userHasProject(item, project.id));
  const totalHours = Number(logs.reduce((sum, item) => sum + Number(item.durationHours || 0), 0).toFixed(2));
  const sparePartStock = spareParts.reduce((sum, item) => sum + Number(item.quantity ?? item.stock ?? 0), 0);
  const projectStateSummary = `资产 ${assets.length} 项，巡检计划 ${plans.length} 个，资料 ${documents.length} 份，备件 ${spareParts.length} 类 / 库存 ${sparePartStock} 件。`;
  const periodOutputSummary = `本周期产出日志 ${logs.length} 条、工时 ${totalHours} 小时、巡检 ${executions.length} 次、变更 ${changes.length} 条、故障 ${incidents.length} 条、知识 ${kb.length} 条。`;
  const report = sanitizeOperationalReportForViewer({
    scope,
    targetUser,
    project,
    users,
    period,
    periodLabel,
    currentPeriod,
    title: scope === 'user' ? `${targetUser.name} 驻场运维完整报表` : `${project.customerName || '-'} / ${project.name || '-'} 运维完整报表`,
    projectName: `${project.customerName || '-'} / ${project.name || '-'}`,
    ownerName: scope === 'user' ? targetUser.name : project.name,
    logs,
    assets,
    kb,
    plans,
    executions,
    changes,
    incidents,
    documents,
    spareParts,
    totalHours,
    sparePartStock,
    abnormalInspectionCount: executions.filter(item => item.result === '异常').length,
    normalInspectionCount: executions.filter(item => item.result === '正常').length,
    openIncidentCount: incidents.filter(item => item.status !== '已关闭' && item.status !== '已解决').length,
    projectStateSummary,
    periodOutputSummary
  }, viewer);
  // 摘要按脱敏后的集合重新统计，避免通过数量泄露客户不可见的数据。
  const visibleSparePartStock = (report.spareParts || []).reduce((sum, item) => sum + Number(item.quantity ?? item.stock ?? 0), 0);
  report.totalHours = Number((report.logs || []).reduce((sum, item) => sum + Number(item.durationHours || 0), 0).toFixed(2));
  report.projectStateSummary = `资产 ${report.assets.length} 项，巡检计划 ${report.plans.length} 个，资料 ${report.documents.length} 份，备件 ${report.spareParts.length} 类 / 库存 ${visibleSparePartStock} 件。`;
  report.periodOutputSummary = `本周期产出日志 ${report.logs.length} 条、工时 ${report.totalHours} 小时、巡检 ${report.executions.length} 次、变更 ${report.changes.length} 条、故障 ${report.incidents.length} 条、知识 ${report.kb.length} 条。`;
  return report;
}

function createReportHeaderShapes(title, subtitle) {
  return [
    createShape({ id: 2, x: 0, y: 0, cx: emu(13.333), cy: emu(7.5), fill: 'F8FAFC', name: 'Background' }),
    createShape({ id: 3, x: emu(0.55), y: emu(0.35), cx: emu(0.12), cy: emu(0.58), fill: '2563EB', preset: 'roundRect' }),
    createShape({ id: 4, x: emu(0.85), y: emu(0.36), cx: emu(7.6), cy: emu(0.36), textLines: [title], textOptions: { size: 2100, color: '0F172A', bold: true } }),
    createShape({ id: 5, x: emu(0.85), y: emu(0.78), cx: emu(9.5), cy: emu(0.22), textLines: [subtitle], textOptions: { size: 1050, color: '64748B' } })
  ];
}

function createReportCoverSlide(report) {
  return createBaseSlide([
    createShape({ id: 2, x: 0, y: 0, cx: emu(13.333), cy: emu(7.5), fill: 'F8FAFC', name: 'Background' }),
    createShape({ id: 3, x: emu(0.7), y: emu(0.65), cx: emu(11.9), cy: emu(5.35), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }),
    createShape({ id: 5, x: emu(1.15), y: emu(1.12), cx: emu(10.6), cy: emu(0.7), textLines: [report.title], textOptions: { size: 2800, color: '0F172A', bold: true } }),
    createShape({ id: 6, x: emu(1.15), y: emu(2.05), cx: emu(9.8), cy: emu(0.28), textLines: [`项目：${report.projectName}`], textOptions: { size: 1400, color: '475569' } }),
    createShape({ id: 7, x: emu(1.15), y: emu(2.48), cx: emu(9.8), cy: emu(0.28), textLines: [`统计周期：${report.periodLabel}（${report.currentPeriod}）`], textOptions: { size: 1400, color: '475569' } }),
    createShape({ id: 8, x: emu(1.15), y: emu(3.35), cx: emu(10.8), cy: emu(0.65), textLines: ['覆盖运维日志、资产台账、巡检执行、变更故障、知识文档与备件库存，适合客户汇报与内部复盘。'], textOptions: { size: 1650, color: '0F172A' } }),
    createShape({ id: 9, x: emu(1.15), y: emu(4.55), cx: emu(4.0), cy: emu(0.34), fill: 'EFF6FF', line: 'BFDBFE', preset: 'roundRect', textLines: ['驻场运维管理系统'], textOptions: { size: 1300, color: '1D4ED8', bold: true, align: 'ctr' } }),
    createShape({ id: 10, x: emu(1.0), y: emu(7.0), cx: emu(11.4), cy: emu(0.2), textLines: [`生成时间：${now()}`], textOptions: { size: 900, color: '64748B' } })
  ]);
}

function createReportOverviewSlide(report) {
  const projectStateMetrics = [
    ['资产台账', `${report.assets.length} 项`, 'F59E0B'],
    ['巡检计划', `${report.plans.length} 个`, '0EA5E9'],
    ['项目资料', `${report.documents.length} 份`, '475569'],
    ['备件库存', `${report.spareParts.length} 类`, '84CC16']
  ];
  const periodOutputMetrics = [
    ['运维日志', `${report.logs.length} 条`, '2563EB'],
    ['累计工时', `${report.totalHours} 小时`, '16A34A'],
    ['巡检执行', `${report.executions.length} 次`, '0891B2'],
    ['变更故障', `${report.changes.length + report.incidents.length} 条`, 'DC2626']
  ];
  const shapes = createReportHeaderShapes('运维综合总览', `${report.projectName} · ${report.periodLabel} · ${report.currentPeriod}`);
  shapes.push(createShape({ id: 10, x: emu(0.7), y: emu(1.15), cx: emu(5.7), cy: emu(0.28), textLines: ['项目现状'], textOptions: { size: 1600, color: '0F172A', bold: true } }));
  shapes.push(createShape({ id: 11, x: emu(6.75), y: emu(1.15), cx: emu(5.7), cy: emu(0.28), textLines: ['周期产出'], textOptions: { size: 1600, color: '0F172A', bold: true } }));
  projectStateMetrics.forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const left = 0.7 + col * 2.95;
    const top = 1.55 + row * 1.25;
    const baseId = 20 + index * 5;
    shapes.push(createShape({ id: baseId, x: emu(left), y: emu(top), cx: emu(2.75), cy: emu(1.0), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }));
    shapes.push(createShape({ id: baseId + 1, x: emu(left), y: emu(top), cx: emu(0.08), cy: emu(1.0), fill: metric[2], preset: 'roundRect' }));
    shapes.push(createShape({ id: baseId + 2, x: emu(left + 0.25), y: emu(top + 0.18), cx: emu(2.2), cy: emu(0.16), textLines: [metric[0]], textOptions: { size: 1050, color: '64748B' } }));
    shapes.push(createShape({ id: baseId + 3, x: emu(left + 0.25), y: emu(top + 0.48), cx: emu(2.2), cy: emu(0.28), textLines: [metric[1]], textOptions: { size: 2100, color: '0F172A', bold: true } }));
  });
  periodOutputMetrics.forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const left = 6.75 + col * 2.95;
    const top = 1.55 + row * 1.25;
    const baseId = 60 + index * 5;
    shapes.push(createShape({ id: baseId, x: emu(left), y: emu(top), cx: emu(2.75), cy: emu(1.0), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }));
    shapes.push(createShape({ id: baseId + 1, x: emu(left), y: emu(top), cx: emu(0.08), cy: emu(1.0), fill: metric[2], preset: 'roundRect' }));
    shapes.push(createShape({ id: baseId + 2, x: emu(left + 0.25), y: emu(top + 0.18), cx: emu(2.2), cy: emu(0.16), textLines: [metric[0]], textOptions: { size: 1050, color: '64748B' } }));
    shapes.push(createShape({ id: baseId + 3, x: emu(left + 0.25), y: emu(top + 0.48), cx: emu(2.2), cy: emu(0.28), textLines: [metric[1]], textOptions: { size: 2100, color: '0F172A', bold: true } }));
  });
  shapes.push(createShape({ id: 90, x: emu(0.7), y: emu(4.35), cx: emu(5.8), cy: emu(1.45), fill: 'FFF7ED', line: 'FED7AA', preset: 'roundRect' }));
  shapes.push(createShape({ id: 91, x: emu(1.0), y: emu(4.62), cx: emu(5.1), cy: emu(0.82), textLines: [report.projectStateSummary], textOptions: { size: 1450, color: '0F172A' } }));
  shapes.push(createShape({ id: 92, x: emu(6.75), y: emu(4.35), cx: emu(5.85), cy: emu(1.45), fill: 'EFF6FF', line: 'BFDBFE', preset: 'roundRect' }));
  shapes.push(createShape({ id: 93, x: emu(7.05), y: emu(4.62), cx: emu(5.1), cy: emu(0.82), textLines: [report.periodOutputSummary], textOptions: { size: 1450, color: '0F172A' } }));
  return createBaseSlide(shapes);
}

function createReportListSlide(title, subtitle, rows, columns) {
  const shapes = createReportHeaderShapes(title, subtitle);
  shapes.push(createShape({ id: 10, x: emu(0.7), y: emu(1.25), cx: emu(11.9), cy: emu(0.38), fill: 'DBEAFE', line: 'BFDBFE', preset: 'roundRect' }));
  const widths = columns.map(item => item.width);
  let left = 0.92;
  columns.forEach((column, index) => {
    shapes.push(createShape({ id: 20 + index, x: emu(left), y: emu(1.37), cx: emu(widths[index]), cy: emu(0.12), textLines: [column.label], textOptions: { size: 850, color: '1E3A8A', bold: true } }));
    left += widths[index];
  });
  const visibleRows = rows.slice(0, 6);
  if (!visibleRows.length) {
    shapes.push(createShape({ id: 50, x: emu(0.7), y: emu(2.3), cx: emu(11.9), cy: emu(2.4), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }));
    shapes.push(createShape({ id: 51, x: emu(4.0), y: emu(3.35), cx: emu(5.2), cy: emu(0.35), textLines: ['当前周期暂无数据'], textOptions: { size: 1900, color: '64748B', bold: true, align: 'ctr' } }));
  } else {
    visibleRows.forEach((row, rowIndex) => {
      const top = 1.78 + rowIndex * 0.72;
      const baseId = 60 + rowIndex * 12;
      shapes.push(createShape({ id: baseId, x: emu(0.7), y: emu(top), cx: emu(11.9), cy: emu(0.58), fill: rowIndex % 2 ? 'F8FAFC' : 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }));
      let cellLeft = 0.92;
      columns.forEach((column, colIndex) => {
        shapes.push(createShape({ id: baseId + colIndex + 1, x: emu(cellLeft), y: emu(top + 0.15), cx: emu(column.width - 0.08), cy: emu(0.16), textLines: [truncateText(row[colIndex], column.max || 28)], textOptions: { size: 850, color: colIndex === 0 ? '0F172A' : '475569', bold: colIndex === 0 } }));
        cellLeft += column.width;
      });
    });
  }
  shapes.push(createShape({ id: 140, x: emu(0.7), y: emu(6.85), cx: emu(11.9), cy: emu(0.2), textLines: [`展示前 ${Math.min(visibleRows.length, 6)} 条，完整数据见 HTML 报表`], textOptions: { size: 850, color: '64748B' } }));
  return createBaseSlide(shapes);
}

function buildDetailedPptxBufferFromReport(report) {
  const slides = [
    createReportCoverSlide(report),
    createReportOverviewSlide(report),
    createReportListSlide('周期产出 / 运维日志', '事件、人员、位置、处理过程与结论', report.logs.map(item => [
      item.date || '-', item.event || '-', item.relatedTarget || item.location || '-', item.conclusion || '-', `${Number(item.durationHours || 0)}h`, item.process || '-'
    ]), [
      { label: '日期', width: 1.15, max: 12 }, { label: '事件', width: 2.0, max: 18 }, { label: '资产/位置', width: 1.7, max: 16 }, { label: '结论', width: 2.0, max: 20 }, { label: '工时', width: 0.75, max: 8 }, { label: '处理过程', width: 4.0, max: 40 }
    ]),
    createReportListSlide('项目现状 / 资产台账', '设备类型、品牌型号、位置、维保与状态', report.assets.map(item => [
      item.name || '-', item.type || '-', [item.brand, item.model].filter(Boolean).join(' / ') || '-', item.installationLocation || item.location || '-', item.maintainExpiryDate || '-', item.status || '-'
    ]), [
      { label: '名称', width: 2.0, max: 18 }, { label: '类型', width: 1.2, max: 10 }, { label: '品牌型号', width: 2.2, max: 22 }, { label: '位置', width: 2.0, max: 18 }, { label: '维保到期', width: 1.3, max: 12 }, { label: '状态', width: 1.2, max: 10 }
    ]),
    createReportListSlide('项目现状 / 巡检计划', '周期计划、执行结果、异常说明和整改建议', report.plans.map(plan => {
      const exec = report.executions.find(item => item.planId === plan.id);
      return [plan.title || '-', plan.cycle || '-', plan.nextDate || '-', exec?.executedAt || '-', exec?.result || '-', exec?.issue || exec?.suggestion || '-'];
    }), [
      { label: '计划', width: 2.1, max: 18 }, { label: '周期', width: 0.9, max: 8 }, { label: '下次巡检', width: 1.25, max: 12 }, { label: '执行时间', width: 1.45, max: 16 }, { label: '结果', width: 0.9, max: 8 }, { label: '异常/建议', width: 4.4, max: 42 }
    ]),
    createReportListSlide('周期产出 / 变更与故障', '变更审批、故障处理与当前状态', [
      ...report.changes.map(item => ['变更', item.title || '-', item.riskLevel || '-', item.status || '-', item.createdAt || '-', item.content || '-']),
      ...report.incidents.map(item => ['故障', item.title || '-', item.faultType || item.severity || '-', item.status || '-', item.occurredAt || item.createdAt || '-', item.resolution || '-'])
    ], [
      { label: '类型', width: 0.85, max: 8 }, { label: '标题', width: 2.2, max: 22 }, { label: '级别/类型', width: 1.2, max: 12 }, { label: '状态', width: 1.1, max: 10 }, { label: '时间', width: 1.5, max: 16 }, { label: '说明', width: 4.1, max: 42 }
    ]),
    createReportListSlide('项目现状 / 资料与备件', '项目资料、备件库存与知识沉淀', [
      ...report.kb.map(item => ['知识库', item.title || '-', item.keywords || '-', item.solution || '-', item.createdAt || '-']),
      ...report.documents.map(item => ['资料', item.title || '-', item.type || '-', item.attachmentName || '-', item.createdAt || '-']),
      ...report.spareParts.map(item => ['备件', item.name || '-', item.model || '-', `库存 ${item.quantity ?? 0}`, item.createdAt || '-'])
    ], [
      { label: '类别', width: 1.0, max: 8 }, { label: '名称', width: 2.35, max: 22 }, { label: '关键字段', width: 2.1, max: 20 }, { label: '状态/内容', width: 3.4, max: 38 }, { label: '创建时间', width: 2.0, max: 16 }
    ])
  ];
  const template = readPptxTemplate();
  const entries = Object.entries(template).map(([name, entry]) => ({
    name,
    data: entry.type === 'base64' ? Buffer.from(entry.data, 'base64') : entry.data
  }));
  const slideCount = slides.length;
  const contentTypes = entries.find(item => item.name === '[Content_Types].xml');
  const presentation = entries.find(item => item.name === 'ppt/presentation.xml');
  const presentationRels = entries.find(item => item.name === 'ppt/_rels/presentation.xml.rels');
  if (contentTypes && typeof contentTypes.data === 'string') {
    const overrides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
    contentTypes.data = contentTypes.data.replace(/<Override PartName="\/ppt\/slides\/slide\d+\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.presentationml\.slide\+xml"\/>/g, '').replace('</Types>', `${overrides}</Types>`);
  }
  if (presentation && typeof presentation.data === 'string') {
    const ids = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${7 + index}"/>`).join('');
    presentation.data = presentation.data.replace(/<p:sldIdLst>.*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`);
  }
  if (presentationRels && typeof presentationRels.data === 'string') {
    const rels = Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${7 + index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('');
    presentationRels.data = presentationRels.data.replace(/<Relationship Id="rId\d+" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slide" Target="slides\/slide\d+\.xml"\/>/g, '').replace('</Relationships>', `${rels}</Relationships>`);
  }
  const filtered = entries.filter(item => !/^ppt\/slides\/slide\d+\.xml$/.test(item.name) && !/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(item.name));
  slides.forEach((slide, index) => {
    filtered.push({ name: `ppt/slides/slide${index + 1}.xml`, data: slide });
    filtered.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout7.xml"/></Relationships>' });
  });
  return createZip(filtered);
}

function buildPptxBufferFromStats({ reportTitle, projectName, periodLabel, ownerName, logs, kbCount, summaryText }) {
  const totalHours = Number(logs.reduce((sum, item) => sum + Number(item.durationHours || 0), 0).toFixed(2));
  return buildDetailedPptxBufferFromReport({
    title: reportTitle,
    projectName,
    ownerName,
    periodLabel,
    currentPeriod: periodLabel,
    logs,
    assets: [],
    kb: Array.from({ length: kbCount }, (_, index) => ({ title: `知识条目 ${index + 1}` })),
    plans: [],
    executions: [],
    changes: [],
    incidents: [],
    documents: [],
    spareParts: [],
    totalHours,
    abnormalInspectionCount: 0,
    normalInspectionCount: 0,
    openIncidentCount: 0,
    summaryText
  });
}

function buildPptxBuffer(db, targetUserId, period, viewer) {
  const report = buildOperationalReportData(db, 'user', targetUserId, period, viewer);
  return report ? buildDetailedPptxBufferFromReport(report) : null;
}

function buildProjectPptxBuffer(db, projectId, period, viewer) {
  const report = buildOperationalReportData(db, 'project', projectId, period, viewer);
  return report ? buildDetailedPptxBufferFromReport(report) : null;
}

function buildServiceReportHtml(db, projectId, filters, viewer) {
  const project = (db.projects || []).find(item => item.id === projectId);
  if (!project) return null;
  const range = getDateRangeFromPeriod(filters.period, '', filters.startDate, filters.endDate)
    || getDateRangeFromPeriod('month');
  const inRange = value => {
    const key = String(value || '').slice(0, 10);
    return key && key >= range.rangeStart && key <= range.rangeEnd;
  };
  const isCustomer = viewer && viewer.role === 'customer';
  const logs = (db.logs || [])
    .filter(item => item.projectId === projectId && inRange(item.date || item.createdAt))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const executions = (db.inspectionExecutions || [])
    .filter(item => item.projectId === projectId && inRange(item.executedAt))
    .sort((a, b) => String(a.executedAt || '').localeCompare(String(b.executedAt || '')));
  const tickets = (db.tickets || [])
    .filter(item => item.projectId === projectId && inRange(item.createdAt))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const totalHours = Number(logs.reduce((sum, item) => sum + Number(item.durationHours || 0), 0).toFixed(2));
  const rows = (items, colspan, mapper) => items.map(mapper).join('') || `<tr><td colspan="${colspan}">本周期无记录</td></tr>`;
  const planTitle = planId => (db.inspectionPlans || []).find(item => item.id === planId)?.title || '-';
  const logRows = rows(logs, 6, item => `<tr>
    <td>${escapeHtml(item.date || '-')}</td>
    <td>${escapeHtml(item.event || item.title || '-')}</td>
    <td>${escapeHtml(item.relatedTarget || '-')}</td>
    <td>${escapeHtml(item.process || '-')}</td>
    <td>${escapeHtml(item.result || '-')}</td>
    <td>${escapeHtml(item.durationHours || 0)}</td>
  </tr>`);
  const inspectionRows = rows(executions, isCustomer ? 5 : 6, item => `<tr>
    <td>${escapeHtml(item.executedAt || '-')}</td>
    <td>${escapeHtml(planTitle(item.planId))}</td>
    <td>${escapeHtml(item.result || '-')}</td>
    <td>${escapeHtml(item.issue || '-')}</td>
    <td>${escapeHtml(item.suggestion || '-')}</td>
    ${isCustomer ? '' : `<td>${escapeHtml(item.executor || '-')}</td>`}
  </tr>`);
  const ticketRows = rows(tickets, 5, item => `<tr>
    <td>${escapeHtml(item.ticketNo || '-')}</td>
    <td>${escapeHtml(item.title || '-')}</td>
    <td>${escapeHtml(item.priority || '-')}</td>
    <td>${escapeHtml(item.status || '-')}</td>
    <td>${escapeHtml(item.closedAt || item.updatedAt || item.createdAt || '-')}</td>
  </tr>`);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(project.name)} 服务报告</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; padding: 28px; color: #0f172a; background: #f1f5f9; }
    .sheet { max-width: 1080px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px 36px; box-shadow: 0 10px 40px rgba(15,23,42,.08); }
    .head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 3px solid #2563eb; padding-bottom: 18px; }
    .head h1 { margin: 0 0 8px; font-size: 26px; }
    .head .meta { color: #64748b; font-size: 13px; line-height: 1.9; }
    .brand { text-align: right; font-size: 13px; color: #64748b; }
    .brand strong { display: block; font-size: 15px; color: #0f172a; margin-bottom: 4px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
    .stat { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; background: #f8fafc; }
    .stat span { font-size: 12px; color: #64748b; }
    .stat strong { display: block; margin-top: 6px; font-size: 22px; }
    h2 { font-size: 17px; margin: 26px 0 10px; padding-left: 10px; border-left: 4px solid #2563eb; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #eff6ff; font-weight: 600; }
    .sign { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 40px; margin-top: 36px; font-size: 13px; color: #475569; }
    .sign div { border-top: 1px solid #cbd5e1; padding-top: 10px; }
    .toolbar { position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; }
    .toolbar button { border: 0; border-radius: 8px; padding: 9px 16px; cursor: pointer; background: #2563eb; color: #fff; font-size: 13px; }
    .toolbar button.ghost { background: #e2e8f0; color: #0f172a; }
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: none; }
      .toolbar { display: none; }
      table { font-size: 10.5px; }
      tr, td, th { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">打印 / 另存 PDF</button>
    <button type="button" class="ghost" onclick="history.back()">返回</button>
  </div>
  <div class="sheet">
    <div class="head">
      <div>
        <h1>${escapeHtml(project.name)} 驻场运维服务报告</h1>
        <div class="meta">
          客户名称：${escapeHtml(project.customerName || '-')}<br />
          服务周期：${escapeHtml(project.projectStartDate || '-')} 至 ${escapeHtml(project.projectEndDate || '-')}<br />
          报告区间：${escapeHtml(range.rangeStart)} 至 ${escapeHtml(range.rangeEnd)}
        </div>
      </div>
      <div class="brand">
        <strong>驻场运维管理系统</strong>
        生成时间<br />${escapeHtml(now())}
      </div>
    </div>
    <div class="stats">
      <div class="stat"><span>服务记录</span><strong>${logs.length}</strong></div>
      <div class="stat"><span>累计工时</span><strong>${totalHours}</strong></div>
      <div class="stat"><span>巡检执行</span><strong>${executions.length}</strong></div>
      <div class="stat"><span>工单数量</span><strong>${tickets.length}</strong></div>
    </div>
    <h2>服务过程记录</h2>
    <table>
      <thead><tr><th style="width:96px;">日期</th><th style="width:140px;">事件</th><th>对象/位置</th><th>处理过程</th><th style="width:88px;">结果</th><th style="width:64px;">工时</th></tr></thead>
      <tbody>${logRows}</tbody>
    </table>
    <h2>巡检执行情况</h2>
    <table>
      <thead><tr><th style="width:150px;">执行时间</th><th>巡检计划</th><th style="width:76px;">结果</th><th>异常说明</th><th>整改建议</th>${isCustomer ? '' : '<th style="width:90px;">执行人</th>'}</tr></thead>
      <tbody>${inspectionRows}</tbody>
    </table>
    <h2>工单处理情况</h2>
    <table>
      <thead><tr><th style="width:150px;">工单号</th><th>标题</th><th style="width:70px;">优先级</th><th style="width:90px;">状态</th><th style="width:160px;">更新时间</th></tr></thead>
      <tbody>${ticketRows}</tbody>
    </table>
    <div class="sign">
      <div>运维服务方确认：____________________</div>
      <div>客户方确认：____________________</div>
    </div>
  </div>
</body>
</html>`;
}

function buildOperationalReportHtml(db, scope, targetId, period, viewer) {
  const report = buildOperationalReportData(db, scope, targetId, period, viewer);
  if (!report) return null;
  const tableRows = (items, emptyColspan, mapper) => items.map(mapper).join('') || `<tr><td colspan="${emptyColspan}">暂无数据</td></tr>`;
  const reportTitle = report.title;
  const renderSectionTitle = (group, title, tone) => `<div class="section-title ${tone}"><span class="section-group">${escapeHtml(group)}</span><span class="section-name">${escapeHtml(title)}</span></div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }
    .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:20px; margin-bottom:16px; box-shadow:0 10px 30px rgba(15,23,42,.04); }
    .title { font-size:28px; font-weight:700; margin-bottom:8px; }
    .muted { color:#64748b; font-size:14px; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-top:16px; }
    .stat { background:#eff6ff; border-radius:12px; padding:16px; border:1px solid #dbeafe; }
    .stat.state { background:#fff7ed; border-color:#fed7aa; }
    .stat.output { background:#eff6ff; border-color:#bfdbfe; }
    .stat strong { display:block; font-size:24px; margin-top:6px; }
    h2 { margin:0 0 12px; font-size:20px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { border-bottom:1px solid #e2e8f0; padding:9px 8px; text-align:left; vertical-align:top; }
    th { background:#f8fafc; white-space:nowrap; }
    .summary-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .summary-panel { border-radius:14px; padding:16px 18px; border:1px solid #e2e8f0; }
    .summary-panel.state { background:#fff7ed; border-color:#fed7aa; }
    .summary-panel.output { background:#eff6ff; border-color:#bfdbfe; }
    .summary-panel h2 { font-size:18px; margin-bottom:8px; }
    .section-title { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
    .section-group { font-size:12px; font-weight:700; border-radius:999px; padding:4px 10px; }
    .section-name { font-size:20px; font-weight:700; color:#0f172a; }
    .tone-state .section-group { background:#ffedd5; color:#9a3412; }
    .tone-output .section-group { background:#dbeafe; color:#1d4ed8; }
    /* 打印与另存 PDF：去掉背景色与阴影，避免分页时出现大面积色块并保证表格不被截断。 */
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
      body { margin: 0; background: #fff; }
      .card { box-shadow: none; break-inside: avoid; page-break-inside: avoid; }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { font-size: 11px; }
      tr, td, th { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">${escapeHtml(reportTitle)}</div>
    <div class="muted">项目：${escapeHtml(report.project.customerName || '-')} / ${escapeHtml(report.project.name || '-')}</div>
    <div class="muted">统计周期：${escapeHtml(report.periodLabel)}（${escapeHtml(report.currentPeriod)}）</div>
    <div class="muted">生成时间：${escapeHtml(now())}</div>
    <div class="stats">
      <div class="stat state"><span class="muted">资产台账</span><strong>${report.assets.length}</strong></div>
      <div class="stat state"><span class="muted">巡检计划</span><strong>${report.plans.length}</strong></div>
      <div class="stat state"><span class="muted">项目资料</span><strong>${report.documents.length}</strong></div>
      <div class="stat state"><span class="muted">备件种类</span><strong>${report.spareParts.length}</strong></div>
      <div class="stat output"><span class="muted">运维日志</span><strong>${report.logs.length}</strong></div>
      <div class="stat output"><span class="muted">累计工时</span><strong>${report.totalHours}</strong></div>
      <div class="stat output"><span class="muted">巡检执行</span><strong>${report.executions.length}</strong></div>
      <div class="stat output"><span class="muted">未关闭故障</span><strong>${report.openIncidentCount}</strong></div>
    </div>
  </div>
  <div class="card"><h2>项目基本信息</h2><table><tbody>
    <tr><th>客户/项目</th><td>${escapeHtml(report.project.customerName || '-')} / ${escapeHtml(report.project.name || '-')}</td><th>项目周期</th><td>${escapeHtml(report.project.projectStartDate || '-')} 至 ${escapeHtml(report.project.projectEndDate || '-')}</td></tr>
    <tr><th>统计对象</th><td>${escapeHtml(report.scope === 'user' ? report.targetUser.name : '项目整体')}</td><th>项目人员</th><td>${escapeHtml(report.users.map(item => item.name).join('、') || '-')}</td></tr>
  </tbody></table></div>
  <div class="summary-grid">
    <div class="summary-panel state"><h2>项目现状摘要</h2><div class="muted">${escapeHtml(report.projectStateSummary)}</div></div>
    <div class="summary-panel output"><h2>周期产出摘要</h2><div class="muted">${escapeHtml(report.periodOutputSummary)}</div></div>
  </div>
  <div class="card tone-state">${renderSectionTitle('项目现状', '资产台账', 'tone-state')}<table><thead><tr><th>名称</th><th>类型</th><th>品牌型号</th><th>位置</th><th>维保到期</th><th>状态</th></tr></thead><tbody>${tableRows(report.assets, 6, item => `<tr><td>${escapeHtml(item.name || '-')}</td><td>${escapeHtml(item.type || '-')}</td><td>${escapeHtml([item.brand, item.model].filter(Boolean).join(' / ') || '-')}</td><td>${escapeHtml(item.installationLocation || item.location || '-')}</td><td>${escapeHtml(item.maintainExpiryDate || '-')}</td><td>${escapeHtml(item.status || '-')}</td></tr>`)}</tbody></table></div>
  <div class="card tone-state">${renderSectionTitle('项目现状', '巡检计划', 'tone-state')}<table><thead><tr><th>计划名称</th><th>周期</th><th>下次巡检</th><th>计划状态</th><th>本周期执行时间</th><th>执行结果</th><th>异常说明</th><th>整改建议</th></tr></thead><tbody>${tableRows(report.plans, 8, plan => { const exec = report.executions.find(item => item.planId === plan.id); return `<tr><td>${escapeHtml(plan.title || '-')}</td><td>${escapeHtml(plan.cycle || '-')}</td><td>${escapeHtml(plan.nextDate || '-')}</td><td>${escapeHtml(plan.status || '-')}</td><td>${escapeHtml(exec?.executedAt || '-')}</td><td>${escapeHtml(exec?.result || '-')}</td><td>${escapeHtml(exec?.issue || '-')}</td><td>${escapeHtml(exec?.suggestion || '-')}</td></tr>`; })}</tbody></table></div>
  <div class="card tone-state">${renderSectionTitle('项目现状', '资料与备件', 'tone-state')}<table><thead><tr><th>类别</th><th>名称</th><th>关键字段</th><th>状态/数量</th><th>创建时间</th></tr></thead><tbody>${tableRows([...report.documents.map(item => ({ kind: '资料文档', name: item.title, key: item.type, status: item.attachmentName || '-', createdAt: item.createdAt })), ...report.spareParts.map(item => ({ kind: '备件', name: item.name, key: item.model || item.spec || '-', status: item.quantity ?? item.stock ?? '-', createdAt: item.createdAt }))], 5, item => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.name || '-')}</td><td>${escapeHtml(item.key || '-')}</td><td>${escapeHtml(item.status || '-')}</td><td>${escapeHtml(item.createdAt || '-')}</td></tr>`)}</tbody></table></div>
  <div class="card tone-output">${renderSectionTitle('周期产出', '运维日志', 'tone-output')}<table><thead><tr><th>日期</th><th>事件</th><th>人员</th><th>资产/位置</th><th>处理过程</th><th>结论</th><th>工时</th></tr></thead><tbody>${tableRows(report.logs, 7, item => `<tr><td>${escapeHtml(item.date || '-')}</td><td>${escapeHtml(item.event || '-')}</td><td>${escapeHtml((db.users || []).find(user => user.id === item.userId)?.name || '-')}</td><td>${escapeHtml(item.relatedTarget || item.location || '-')}</td><td>${escapeHtml(item.process || '-')}</td><td>${escapeHtml(item.conclusion || '-')}</td><td>${escapeHtml(item.durationHours || 0)}</td></tr>`)}</tbody></table></div>
  <div class="card tone-output">${renderSectionTitle('周期产出', '巡检执行', 'tone-output')}<table><thead><tr><th>执行时间</th><th>计划名称</th><th>执行结果</th><th>执行人</th><th>异常说明</th><th>整改建议</th></tr></thead><tbody>${tableRows(report.executions, 6, item => `<tr><td>${escapeHtml(item.executedAt || '-')}</td><td>${escapeHtml(report.plans.find(plan => plan.id === item.planId)?.title || '-')}</td><td>${escapeHtml(item.result || '-')}</td><td>${escapeHtml(item.executor || '-')}</td><td>${escapeHtml(item.issue || '-')}</td><td>${escapeHtml(item.suggestion || '-')}</td></tr>`)}</tbody></table></div>
  <div class="card tone-output">${renderSectionTitle('周期产出', '变更与故障', 'tone-output')}<table><thead><tr><th>类型</th><th>标题</th><th>级别/类型</th><th>状态</th><th>时间</th><th>说明</th></tr></thead><tbody>${tableRows([...report.changes.map(item => ({ kind: '变更', title: item.title, type: item.riskLevel, status: item.status, time: item.createdAt, note: item.content })), ...report.incidents.map(item => ({ kind: '故障', title: item.title, type: item.faultType || item.severity, status: item.status, time: item.occurredAt || item.createdAt, note: item.resolution }))], 6, item => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.title || '-')}</td><td>${escapeHtml(item.type || '-')}</td><td>${escapeHtml(item.status || '-')}</td><td>${escapeHtml(item.time || '-')}</td><td>${escapeHtml(item.note || '-')}</td></tr>`)}</tbody></table></div>
  <div class="card tone-output">${renderSectionTitle('周期产出', '知识沉淀', 'tone-output')}<table><thead><tr><th>名称</th><th>关键词</th><th>问题描述</th><th>解决方案</th><th>创建时间</th></tr></thead><tbody>${tableRows(report.kb, 5, item => `<tr><td>${escapeHtml(item.title || '-')}</td><td>${escapeHtml(item.keywords || '-')}</td><td>${escapeHtml(item.problem || '-')}</td><td>${escapeHtml(item.solution || '-')}</td><td>${escapeHtml(item.createdAt || '-')}</td></tr>`)}</tbody></table></div>
</body>
</html>`;
}

function buildInspectionExecutionCsv(db, projectId, period, viewer) {
  const project = db.projects.find(item => item.id === projectId);
  if (!project) return null;
  const currentPeriod = getPeriodKey(formatDateKey(new Date()), period);
  const executions = (db.inspectionExecutions || [])
    .filter(item => item.projectId === projectId)
    .filter(item => getPeriodKey(item.executedAt, period) === currentPeriod)
    .sort((a, b) => b.executedAt.localeCompare(a.executedAt))
    .map(item => sanitizeInspectionExecutionForViewer(item, viewer));
  const rows = executions.map(item => {
    const plan = (db.inspectionPlans || []).find(entry => entry.id === item.planId);
    const asset = (db.assets || []).find(entry => entry.id === item.assetId);
    const attachmentName = typeof item.attachment === 'string' ? item.attachment : item.attachment?.name || '';
    return [
      item.executedAt || '',
      plan?.title || '',
      asset?.name || '',
      item.executor || '',
      item.result || '',
      item.nextDate || '',
      item.issue || '',
      item.suggestion || '',
      attachmentName
    ].map(quoteCsvValue).join(',');
  });
  const header = ['执行时间', '计划名称', '关联资产', '执行人', '巡检结果', '下次巡检日', '异常说明', '整改建议', '附件名称'].map(quoteCsvValue).join(',');
  return `\uFEFF${[header, ...rows].join('\n')}`;
}

function buildInspectionExecutionHtml(db, projectId, period, viewer) {
  const project = db.projects.find(item => item.id === projectId);
  if (!project) return null;
  const currentPeriod = getPeriodKey(formatDateKey(new Date()), period);
  const periodLabel = ({ week: '每周', month: '每月', year: '每年' }[period] || period);
  const plans = (db.inspectionPlans || []).filter(item => item.projectId === projectId).map(item => sanitizeInspectionPlanForViewer(item, viewer));
  const assets = (db.assets || []).filter(item => item.projectId === projectId).map(item => sanitizeAssetForApi(item, viewer));
  const executions = (db.inspectionExecutions || [])
    .filter(item => item.projectId === projectId)
    .filter(item => getPeriodKey(item.executedAt, period) === currentPeriod)
    .sort((a, b) => String(b.executedAt || '').localeCompare(String(a.executedAt || '')))
    .map(item => sanitizeInspectionExecutionForViewer(item, viewer));
  const abnormalExecutions = executions.filter(item => item.result === '异常');
  const normalCount = executions.filter(item => item.result === '正常').length;
  const planCount = new Set(executions.map(item => item.planId).filter(Boolean)).size;
  const assetCount = new Set(executions.map(item => item.assetId).filter(Boolean)).size;
  const latestExecutionByPlan = new Map();
  executions.forEach(item => {
    if (!item.planId || latestExecutionByPlan.has(item.planId)) return;
    latestExecutionByPlan.set(item.planId, item);
  });
  const tableRows = (items, emptyColspan, mapper) => items.map(mapper).join('') || `<tr><td colspan="${emptyColspan}">暂无数据</td></tr>`;
  const assetMap = new Map(assets.map(item => [item.id, item]));
  const planRows = tableRows(plans, 8, plan => {
    const asset = assetMap.get(plan.assetId);
    const latest = latestExecutionByPlan.get(plan.id);
    return `<tr><td>${escapeHtml(plan.title || '-')}</td><td>${escapeHtml(asset?.name || '-')}</td><td>${escapeHtml([asset?.type, asset?.brand, asset?.model].filter(Boolean).join(' / ') || '-')}</td><td>${escapeHtml(asset?.location || '-')}</td><td>${escapeHtml(plan.cycle || '-')}</td><td>${escapeHtml(plan.nextDate || '-')}</td><td>${escapeHtml(latest?.executedAt || '-')}</td><td>${escapeHtml(latest?.result || plan.status || '-')}</td></tr>`;
  });
  const objectRows = tableRows(assets.filter(asset => executions.some(item => item.assetId === asset.id) || plans.some(item => item.assetId === asset.id)), 8, asset => {
    const assetPlans = plans.filter(item => item.assetId === asset.id);
    const assetExecutions = executions.filter(item => item.assetId === asset.id);
    const assetAbnormal = assetExecutions.filter(item => item.result === '异常').length;
    return `<tr><td>${escapeHtml(asset.name || '-')}</td><td>${escapeHtml(asset.type || '-')}</td><td>${escapeHtml([asset.brand, asset.model].filter(Boolean).join(' / ') || '-')}</td><td>${escapeHtml(asset.location || '-')}</td><td>${escapeHtml(asset.status || '-')}</td><td>${escapeHtml(asset.maintainExpiryDate || '-')}</td><td>${assetPlans.length}</td><td>${assetExecutions.length} 次 / 异常 ${assetAbnormal} 次</td></tr>`;
  });
  const abnormalRows = tableRows(abnormalExecutions, 9, item => {
    const plan = plans.find(entry => entry.id === item.planId);
    const asset = assetMap.get(item.assetId);
    return `<tr><td>${escapeHtml(item.executedAt || '-')}</td><td>${escapeHtml(plan?.title || '-')}</td><td>${escapeHtml(asset?.name || '-')}</td><td>${escapeHtml(asset?.location || '-')}</td><td>${escapeHtml(item.executor || '-')}</td><td>${escapeHtml(item.issue || '-')}</td><td>${escapeHtml(item.suggestion || '-')}</td><td>${escapeHtml(item.nextDate || '-')}</td><td>${escapeHtml(typeof item.attachment === 'string' ? item.attachment : item.attachment?.name || '-')}</td></tr>`;
  });
  const executionRows = tableRows(executions, 11, item => {
    const plan = plans.find(entry => entry.id === item.planId);
    const asset = assetMap.get(item.assetId);
    const attachmentName = typeof item.attachment === 'string' ? item.attachment : item.attachment?.name || '';
    return `<tr><td>${escapeHtml(item.executedAt || '-')}</td><td>${escapeHtml(plan?.title || '-')}</td><td>${escapeHtml(asset?.name || '-')}</td><td>${escapeHtml([asset?.type, asset?.brand, asset?.model].filter(Boolean).join(' / ') || '-')}</td><td>${escapeHtml(asset?.location || '-')}</td><td>${escapeHtml(item.executor || '-')}</td><td><span class="badge ${item.result === '异常' ? 'danger' : 'success'}">${escapeHtml(item.result || '-')}</span></td><td>${escapeHtml(item.checklist || '-')}</td><td>${escapeHtml(item.issue || '-')}</td><td>${escapeHtml(item.suggestion || '-')}</td><td>${escapeHtml(attachmentName || '-')}</td></tr>`;
  });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>巡检执行报表</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-bottom: 16px; box-shadow:0 10px 30px rgba(15,23,42,.04); }
    .title { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .muted { color: #64748b; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .stat { background: #eff6ff; border:1px solid #bfdbfe; border-radius: 12px; padding: 16px; }
    .stat strong { display: block; font-size: 24px; margin-top: 6px; }
    h2 { margin: 0 0 12px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 9px 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; white-space: nowrap; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .success { background: #dcfce7; color: #166534; }
    .danger { background: #fee2e2; color: #991b1b; }
    .summary { line-height: 1.8; background:linear-gradient(135deg,#eff6ff 0%,#f8fafc 100%); }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">巡检执行报表</div>
    <div class="muted">项目：${escapeHtml(project.customerName || '-')} / ${escapeHtml(project.name || '-')}</div>
    <div class="muted">统计周期：${escapeHtml(periodLabel)}（${escapeHtml(currentPeriod)}）</div>
    <div class="muted">生成时间：${escapeHtml(now())}</div>
    <div class="stats">
      <div class="stat"><span class="muted">执行次数</span><strong>${executions.length}</strong></div>
      <div class="stat"><span class="muted">正常次数</span><strong>${normalCount}</strong></div>
      <div class="stat"><span class="muted">异常次数</span><strong>${abnormalExecutions.length}</strong></div>
      <div class="stat"><span class="muted">覆盖计划</span><strong>${planCount}</strong></div>
      <div class="stat"><span class="muted">覆盖对象</span><strong>${assetCount}</strong></div>
      <div class="stat"><span class="muted">计划总数</span><strong>${plans.length}</strong></div>
      <div class="stat"><span class="muted">项目资产</span><strong>${assets.length}</strong></div>
      <div class="stat"><span class="muted">异常率</span><strong>${executions.length ? Math.round((abnormalExecutions.length / executions.length) * 100) : 0}%</strong></div>
    </div>
  </div>
  <div class="card summary"><h2>巡检结论</h2>本周期共执行 ${executions.length} 次巡检，覆盖 ${assetCount} 个巡检对象和 ${planCount} 个巡检计划；正常 ${normalCount} 次，异常 ${abnormalExecutions.length} 次。${abnormalExecutions.length ? '建议优先跟进异常项的整改建议、复检时间和附件证据。' : '整体巡检结果稳定，可按既定计划持续执行。'}</div>
  <div class="card"><h2>巡检对象画像</h2><table><thead><tr><th>对象名称</th><th>类型</th><th>品牌型号</th><th>位置</th><th>状态</th><th>维保到期</th><th>关联计划</th><th>本周期执行</th></tr></thead><tbody>${objectRows}</tbody></table></div>
  <div class="card"><h2>巡检计划覆盖</h2><table><thead><tr><th>计划名称</th><th>巡检对象</th><th>对象类型/型号</th><th>位置</th><th>周期</th><th>下次巡检</th><th>最近执行</th><th>状态/结果</th></tr></thead><tbody>${planRows}</tbody></table></div>
  <div class="card"><h2>异常与整改跟踪</h2><table><thead><tr><th>执行时间</th><th>计划</th><th>对象</th><th>位置</th><th>执行人</th><th>异常说明</th><th>整改建议</th><th>下次巡检</th><th>附件</th></tr></thead><tbody>${abnormalRows}</tbody></table></div>
  <div class="card"><h2>巡检执行明细</h2><table><thead><tr><th>执行时间</th><th>计划</th><th>对象</th><th>对象类型/型号</th><th>位置</th><th>执行人</th><th>结果</th><th>巡检项清单</th><th>异常说明</th><th>整改建议</th><th>附件</th></tr></thead><tbody>${executionRows}</tbody></table></div>
</body>
</html>`;
}

function getAiInspectionMetricStatus(metric) {
  const value = Number(metric?.value);
  if (!Number.isFinite(value)) return '待补录';
  if (metric.direction === 'low') {
    if (value <= Number(metric.critical)) return '严重';
    if (value <= Number(metric.warn)) return '异常';
    return '正常';
  }
  if (value >= Number(metric.critical)) return '严重';
  if (value >= Number(metric.warn)) return '异常';
  return '正常';
}

function getAiInspectionReportPayload(db, resultId) {
  const result = (db.aiInspectionResults || []).find(item => item.id === resultId);
  if (!result) return null;
  const task = (db.aiInspectionTasks || []).find(item => item.id === result.taskId);
  const target = (db.aiInspectionTargets || []).find(item => item.id === result.targetId);
  const template = (db.aiInspectionTemplates || []).find(item => item.id === result.templateId);
  const project = (db.projects || []).find(item => item.id === result.projectId);
  if (!task || !target || !project) return null;
  const metrics = (task.metrics || []).map(metric => ({ ...metric, status: getAiInspectionMetricStatus(metric) }));
  return { result, task, target, template, project, metrics };
}

function buildAiInspectionResultHtml(db, resultId, viewer) {
  const payload = getAiInspectionReportPayload(db, resultId);
  if (!payload) return null;
  const { result: rawResult, task, target, template, project, metrics } = payload;
  const result = sanitizeAiInspectionResultForViewer(rawResult, viewer);
  const hideNetwork = viewer && viewer.role === 'customer';
  const templateMetrics = (template?.metrics || []).filter(m => m.enabled);
  const hasReal = m => result.realData && result.realData[m.label] !== undefined && Number.isFinite(Number(result.realData[m.label]));
  const abnormalCount = metrics.filter(item => hasReal(item) && (item.status === '异常' || item.status === '严重')).length;
  const severeCount = metrics.filter(item => hasReal(item) && item.status === '严重').length;
  const statusColor = status => {
    if (status === '严重') return '#dc2626';
    if (status === '异常') return '#f59e0b';
    if (status === '待补录') return '#94a3b8';
    return '#16a34a';
  };
  const getMetricAdvice = (item, hasRealData) => {
    if (!hasRealData) return '无法获取真实数据，状态未知';
    const value = Number(result.realData[item.label]);
    const warn = Number(item.warn);
    const critical = Number(item.critical);
    if (item.direction === 'low') {
      if (Number.isFinite(critical) && value <= critical) return `当前值 ${value} 低于严重阈值 ${critical}，需立即处理`;
      if (Number.isFinite(warn) && value <= warn) return `当前值 ${value} 低于告警阈值 ${warn}，建议关注并排查`;
    } else {
      if (Number.isFinite(critical) && value >= critical) return `当前值 ${value} 超过严重阈值 ${critical}，需立即处理`;
      if (Number.isFinite(warn) && value >= warn) return `当前值 ${value} 超过告警阈值 ${warn}，建议关注并排查`;
    }
    return `当前值 ${value} 在正常范围内，无需处理`;
  };
  const rows = metrics.map(item => {
    const status = item.status;
    const hasRealData = hasReal(item);
    const valueDisplay = hasRealData
      ? `${Number(result.realData[item.label])}${escapeHtml(item.unit || '')}（实测）`
      : '-';
    const displayStatus = hasRealData ? status : '状态未知';
    const color = hasRealData ? statusColor(status) : '#94a3b8';
    const advice = getMetricAdvice(item, hasRealData);
    return `<tr><td>${escapeHtml(item.label || '-')}</td><td>${escapeHtml(item.unit || '-')}</td><td>${valueDisplay}</td><td>${escapeHtml(Number.isFinite(Number(item.warn)) ? item.warn : '-')}</td><td>${escapeHtml(Number.isFinite(Number(item.critical)) ? item.critical : '-')}</td><td>${escapeHtml(advice)}</td><td style="color:${color};font-weight:600;">${escapeHtml(displayStatus)}</td><td>${escapeHtml(item.description || '-')}</td></tr>`;
  }).join('') || '<tr><td colspan="8">暂无指标</td></tr>';
  const abnormalRows = (result.abnormalItems || []).map(item => `<li>${escapeHtml(hideNetwork ? redactNetworkDetails(item) : item)}</li>`).join('') || '<li>本次巡检未发现异常项</li>';
  const templateMetricText = templateMetrics.length
    ? templateMetrics.map(m => `${escapeHtml(m.label)}（阈值: ${m.warn ?? '-'}/${m.critical ?? '-'} ${escapeHtml(m.unit || '')}，${m.direction === 'low' ? '越低越好' : m.direction === 'high' ? '越高越好' : '无方向'}）`).join('<br />')
    : '无模板指标';
  const realDataCount = Object.keys(result.realData || {}).filter(k => result.realData[k] !== undefined).length;
  const realDataNote = realDataCount > 0
    ? `<div class="muted" style="margin-bottom:8px;">本次巡检通过真实探测获取了 ${realDataCount} 项指标数据（标注"实测"），其余为未获取到真实数据的指标（显示"-"）。</div>`
    : `<div class="muted" style="margin-bottom:8px;color:#f59e0b;">本次巡检未获取到真实探测数据，所有指标值及状态无法判定。</div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>自动化巡检报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-bottom: 16px; }
    .title { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1e293b; }
    .muted { color: #64748b; margin-top: 4px; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .stat { background: #eff6ff; border-radius: 12px; padding: 16px; }
    .stat strong { display: block; font-size: 24px; margin-top: 6px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-weight: 600; white-space: nowrap; }
    ul { margin: 0; padding-left: 20px; line-height: 1.8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">自动化巡检报告</div>
    <div class="muted">项目：${escapeHtml(project.customerName || '-')} / ${escapeHtml(project.name || '-')}</div>
    <div class="muted">巡检对象：${escapeHtml(target.name || '-')}${hideNetwork ? '' : ` | 地址：${escapeHtml(target.address || '-')}:${escapeHtml(String(target.port || '-'))}`}</div>
    <div class="muted">任务名称：${escapeHtml(task.title || '-')} | 执行人：${escapeHtml(task.executor || '-')}</div>
    <div class="muted">执行时间：${escapeHtml(task.executedAt || result.createdAt || '-')} | 生成时间：${escapeHtml(now())}</div>
    <div class="stats">
      <div class="stat"><span class="muted">巡检得分</span><strong>${result.score}</strong></div>
      <div class="stat"><span class="muted">风险等级</span><strong>${escapeHtml(result.level)}</strong></div>
      <div class="stat"><span class="muted">异常指标</span><strong>${abnormalCount}</strong></div>
      <div class="stat"><span class="muted">严重指标</span><strong>${severeCount}</strong></div>
    </div>
  </div>
  <div class="card">
    <div class="subtitle">巡检模板定义</div>
    <div class="muted">模板名称：${escapeHtml(template?.name || '-')} | 设备类别：${escapeHtml(target.category || '-')} | 指标数量：${templateMetrics.length}</div>
    <div style="margin-top:12px;font-size:13px;line-height:1.8;">${templateMetricText}</div>
  </div>
  <div class="grid">
    <div class="card">
      <div class="subtitle">巡检结论</div>
      <p>${escapeHtml(result.summary || '-')}</p>
      <div class="muted">风险说明</div>
      <p>${escapeHtml(result.risk || '-')}</p>
      <div class="muted">处置建议</div>
      <p>${escapeHtml(result.suggestion || '-')}</p>
    </div>
    <div class="card">
      <div class="subtitle">异常项清单</div>
      <ul>${abnormalRows}</ul>
    </div>
  </div>
  <div class="card">
    <div class="subtitle">指标巡检明细</div>
    ${realDataNote}
    <table>
      <thead><tr><th>指标名称</th><th>单位</th><th>当前值</th><th>告警阈值</th><th>严重阈值</th><th>分析建议</th><th>状态</th><th>说明</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

function buildAiInspectionResultPptxBuffer(db, resultId, viewer) {
  const payload = getAiInspectionReportPayload(db, resultId);
  if (!payload) return null;
  const { result: rawResult, task, target, project, metrics } = payload;
  const result = sanitizeAiInspectionResultForViewer(rawResult, viewer);
  const abnormalCount = metrics.filter(item => item.status === '异常' || item.status === '严重').length;
  const severeCount = metrics.filter(item => item.status === '严重').length;
  const logs = metrics.slice(0, 4).map(item => ({
    date: task.executedAt || result.createdAt || '',
    event: `${item.label || '-'} ${Number.isFinite(Number(item.value)) ? `${Number(item.value)}${item.unit || ''}` : '待补录'}`,
    relatedTarget: `${target.name || '-'} / ${item.status}`,
    durationHours: 0,
    conclusion: item.description || '-',
    process: `告警阈值 ${item.warn ?? '-'}，严重阈值 ${item.critical ?? '-'}，当前状态 ${item.status}`
  }));
  const summaryText = `${result.summary} 风险等级 ${result.level}，异常指标 ${abnormalCount} 项，严重指标 ${severeCount} 项。处置建议：${result.suggestion}`;
  return buildPptxBufferFromStats({
    reportTitle: `${target.name || '-'} 自动化巡检报告`,
    projectName: `${project.customerName || '-'} / ${project.name || '-'}`,
    periodLabel: task.executedAt || result.createdAt || '',
    ownerName: task.executor || '系统',
    logs,
    kbCount: abnormalCount,
    summaryText
  });
}


function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from('--' + boundary);
  const endBoundary = Buffer.from('--' + boundary + '--');
  const parts = [];
  let pos = boundaryBuffer.length + 2;
  while (pos < buffer.length) {
    const nextBoundary = buffer.indexOf(boundaryBuffer, pos);
    if (nextBoundary === -1) break;
    const sectionEnd = nextBoundary - 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1 || headerEnd >= sectionEnd) { pos = nextBoundary + boundaryBuffer.length + 2; continue; }
    const headerText = buffer.slice(pos, headerEnd).toString();
    const bodyEnd = sectionEnd;
    const body = buffer.slice(headerEnd + 4, bodyEnd);
    const nameMatch = headerText.match(/name="([^"]+)"/);
    const filenameMatch = headerText.match(/filename="([^"]+)"/);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : '',
      data: body
    });
    pos = nextBoundary + boundaryBuffer.length + 2;
  }
  return parts;
}

function normalizeUpgradeArchivePath(relativePath) {
  const normalized = path.posix.normalize(String(relativePath || '').replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error(`升级包包含非法路径：${relativePath}`);
  }
  return normalized;
}

function listUpgradeArchiveFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listUpgradeArchiveFiles(abs, baseDir));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(baseDir, abs).split(path.sep).join('/'));
    }
  }
  return files;
}

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

function compareSemver(left, right) {
  const parse = value => String(value || '0').split(/[.+-]/).map(part => parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return 1;
    if ((a[i] || 0) < (b[i] || 0)) return -1;
  }
  return 0;
}

const upgradeApplyFiles = ['server.js', 'package.json', 'Dockerfile', 'docker-compose.yml', 'docker-compose.prod.yml', 'pptx-template.json', 'docker-entrypoint.sh'];
const upgradeApplyDirs = ['public', 'scripts'];
// 入口脚本必须以可执行位落地，否则容器下次启动会报 permission denied。
const upgradeExecutableFiles = new Set(['docker-entrypoint.sh']);
// 关键文件决定升级后能否正常启动，任一失败都不重启，避免线上跑出「新前端 + 旧后端」的半升级状态。
const upgradeCriticalEntries = new Set(['server.js', 'package.json', 'public', 'scripts']);

function writeUpgradeSha256Sums(pendingDir) {
  const manifestPath = path.join(pendingDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const checksumMap = manifest.sha256 && typeof manifest.sha256 === 'object' ? manifest.sha256 : {};
  const lines = Object.keys(checksumMap).sort().map(file => `${String(checksumMap[file] || '').trim().toLowerCase()}  ${file}`);
  fs.writeFileSync(path.join(pendingDir, 'SHA256SUMS'), lines.join('\n') + '\n');
}

function describeUpgradeTarget(target) {
  try {
    const stat = fs.statSync(target);
    return `${target}（mode ${(stat.mode & 0o777).toString(8)}，uid ${stat.uid}，gid ${stat.gid}）`;
  } catch (_) {
    return target;
  }
}

function fileContentEquals(left, right) {
  try {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    if (!rightStat.isFile() || leftStat.size !== rightStat.size) return false;
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return digest(left) === digest(right);
  } catch (_) {
    return false;
  }
}

// 目标文件可能被 docker cp 或手工操作改成 root/只读，直接覆盖会 EACCES。
// 先写同目录临时文件，再用 rename 覆盖：rename 只要求目录可写，并顺带把属主落回容器用户。
function replaceFileFromStaged(src, dest, executable) {
  const parent = path.dirname(dest);
  const staged = path.join(parent, `.upgrade-${path.basename(dest)}-${process.pid}-${Date.now()}`);
  try {
    fs.copyFileSync(src, staged);
    // copyFileSync 会沿用源文件权限，升级包内若是 0644 会覆盖镜像里的 0755。
    if (executable) fs.chmodSync(staged, 0o755);
    fs.renameSync(staged, dest);
  } catch (error) {
    try { fs.rmSync(staged, { force: true }); } catch (_) {}
    error.message = `${error.message}（目标 ${describeUpgradeTarget(dest)}）`;
    throw error;
  }
}

// 目录同样用 rename 切换：先整体拷到临时目录，再原子替换，避免逐文件删除时被旧属主卡住。
function replaceDirFromStaged(src, dest) {
  const parent = path.dirname(dest);
  const suffix = `${process.pid}-${Date.now()}`;
  const staged = path.join(parent, `.upgrade-${path.basename(dest)}-${suffix}`);
  const backup = path.join(parent, `.upgrade-old-${path.basename(dest)}-${suffix}`);
  try {
    fs.cpSync(src, staged, { recursive: true });
    const existed = fs.existsSync(dest);
    if (existed) fs.renameSync(dest, backup);
    try {
      fs.renameSync(staged, dest);
    } catch (error) {
      if (existed) {
        try { fs.renameSync(backup, dest); } catch (_) {}
      }
      throw error;
    }
    if (existed) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch (_) {}
    }
  } catch (error) {
    try { fs.rmSync(staged, { recursive: true, force: true }); } catch (_) {}
    error.message = `${error.message}（目标 ${describeUpgradeTarget(dest)}）`;
    throw error;
  }
}

function applyPendingUpgradeFiles(pendingDir, appDir) {
  const applied = [];
  const unchanged = [];
  const failed = [];
  const attempt = (name, action) => {
    try {
      action();
      applied.push(name);
    } catch (error) {
      failed.push({ name, message: error.message, critical: upgradeCriticalEntries.has(name) });
    }
  };
  for (const file of upgradeApplyFiles) {
    const src = path.join(pendingDir, file);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dest = path.join(appDir, file);
    const executable = upgradeExecutableFiles.has(file);
    if (fileContentEquals(src, dest)) {
      // 内容一致时不再覆盖，但仍要纠正历史遗留的可执行位。
      if (executable) attempt(file, () => fs.chmodSync(dest, 0o755));
      else unchanged.push(file);
      continue;
    }
    attempt(file, () => replaceFileFromStaged(src, dest, executable));
  }
  for (const dir of upgradeApplyDirs) {
    const src = path.join(pendingDir, dir);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
    attempt(dir, () => replaceDirFromStaged(src, path.join(appDir, dir)));
  }
  return { applied, unchanged, failed };
}

function validateUpgradePackageIntegrity(pendingDir) {
  const manifestPath = path.join(pendingDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('升级包缺少 manifest.json');
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`升级包 manifest 无法解析：${error.message}`);
  }

  const rawFiles = Array.isArray(manifest.files) ? manifest.files : [];
  if (!rawFiles.length) {
    throw new Error('升级包 manifest 缺少 files 清单');
  }
  const checksumMap = manifest.sha256 && typeof manifest.sha256 === 'object' ? manifest.sha256 : null;
  if (!checksumMap) {
    throw new Error('升级包 manifest 缺少 SHA256 清单');
  }

  const files = rawFiles.map(item => normalizeUpgradeArchivePath(item));
  const listedFiles = new Set(files);
  if (listedFiles.size !== files.length) {
    throw new Error('升级包 manifest 包含重复文件');
  }

  const extractedFiles = listUpgradeArchiveFiles(pendingDir).filter(item => item !== 'manifest.json');
  const extractedSet = new Set(extractedFiles);
  for (const file of files) {
    if (!extractedSet.has(file)) {
      throw new Error(`升级包缺少 manifest 声明文件：${file}`);
    }
    const expected = String(checksumMap[file] || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`升级包 SHA256 清单无效：${file}`);
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(pendingDir, file))).digest('hex');
    if (actual !== expected) {
      throw new Error(`升级包 SHA256 校验失败：${file}`);
    }
  }

  for (const key of Object.keys(checksumMap)) {
    const normalized = normalizeUpgradeArchivePath(key);
    if (!listedFiles.has(normalized)) {
      throw new Error(`升级包 manifest 存在未声明的 SHA256 项：${normalized}`);
    }
  }

  const unlistedFiles = extractedFiles.filter(item => !listedFiles.has(item));
  if (unlistedFiles.length) {
    throw new Error(`升级包存在未声明文件：${unlistedFiles[0]}`);
  }

  if (!upgradeSigningKey || upgradeSigningKey.length < 32) {
    throw new Error('系统未配置升级签名密钥');
  }
  const receivedSignature = String(manifest.signature || '').trim().toLowerCase();
  if (isProduction || receivedSignature) {
    if (!receivedSignature) {
      throw new Error('升级包缺少签名');
    }
    const normalizedChecksums = files.reduce((result, file) => {
      result[file] = String(checksumMap[file] || '').trim().toLowerCase();
      return result;
    }, {});
    const payload = JSON.stringify(canonicalizeJson({
      version: manifest.version || '',
      files,
      sha256: normalizedChecksums
    }));
    const expectedSignature = crypto.createHmac('sha256', upgradeSigningKey).update(payload).digest('hex');
    if (receivedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) {
      throw new Error('升级包签名校验失败');
    }
  }

  return {
    version: manifest.version || '',
    files
  };
}

async function serveStatic(req, res, pathname, db) {
  const filePath = pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname);
  const normalized = path.resolve(filePath);
  if (!(normalized === publicDir || normalized.startsWith(publicDir + path.sep))) {
    text(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
    text(res, 404, 'Not Found');
    return;
  }
  // path.resolve 不解析符号链接，必须用 realpath 复核，防止 public 内的链接指向目录外文件。
  let resolvedPath;
  let realPublicDir;
  try {
    resolvedPath = fs.realpathSync(normalized);
    realPublicDir = fs.realpathSync(publicDir);
  } catch (_) {
    text(res, 404, 'Not Found');
    return;
  }
  if (!(resolvedPath === realPublicDir || resolvedPath.startsWith(realPublicDir + path.sep))) {
    text(res, 403, 'Forbidden');
    return;
  }
  // 安装包与校验文件包含完整源码，仅允许管理员下载，避免匿名获取。
  const downloadsDir = path.join(realPublicDir, 'downloads');
  if (resolvedPath === downloadsDir || resolvedPath.startsWith(downloadsDir + path.sep)) {
    const user = db ? getAuthUser(req, db) : null;
    if (!user || user.role !== 'admin') {
      text(res, 404, 'Not Found');
      return;
    }
  }
  const ext = path.extname(resolvedPath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
  };
  const contentType = types[ext] || 'application/octet-stream';
  const extraHeaders = { 'Content-Type': contentType };
  if (pathname === '/' || ext === '.html') {
    extraHeaders['Cache-Control'] = 'no-store, no-cache, must-revalidate';
    extraHeaders.Pragma = 'no-cache';
    extraHeaders.Expires = '0';
  }
  // HTML 每次请求生成独立 nonce，内联脚本块通过 __CSP_NONCE__ 占位符替换后下发。
  if (ext === '.html') {
    let html;
    try {
      html = await fs.promises.readFile(resolvedPath, 'utf8');
    } catch (_) {
      text(res, 404, 'Not Found');
      return;
    }
    const nonce = createNonce();
    const body = html.split('__CSP_NONCE__').join(nonce);
    const payload = Buffer.from(body, 'utf8');
    res.writeHead(200, buildSecurityHeaders({ ...extraHeaders, 'Content-Length': String(payload.length) }, nonce));
    res.end(payload);
    return;
  }
  // 读流失败（权限/升级替换窗口/fd 耗尽）必须就地收尾，否则未监听的 'error'
  // 会冒泡到 uncaughtException 并终止整个进程。打开成功后再写响应头。
  const stream = fs.createReadStream(resolvedPath);
  stream.once('error', () => {
    if (!res.headersSent) text(res, 404, 'Not Found');
    else if (!res.writableEnded) res.end();
  });
  stream.once('open', () => {
    res.writeHead(200, buildSecurityHeaders(extraHeaders));
    stream.pipe(res);
  });
}

const requestHandler = async (req, res) => {
  let pathname;
  let reqUrl;
  try {
    reqUrl = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(reqUrl.pathname);
  } catch (_) {
    return text(res, 400, 'Bad Request');
  }
  if (pathname === '/ws') return;
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, getHealthPayload());
    }
    if (req.method === 'GET' && pathname === '/api/ready') {
      const readiness = await getSystemReadinessAsync();
      return json(res, readiness.ok ? 200 : 503, { ok: readiness.ok, checkedAt: readiness.checkedAt, version: readiness.version });
    }
    let db;
    try {
      db = await readDb();
    } catch (error) {
      // 数据库故障时页面仍应能打开，否则外部只能看到整站 500，无法判断是登录问题还是存储问题。
      const staticRequest = (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/');
      logStorageFailure(`[storage] 数据库不可用，${staticRequest ? '降级下发静态资源' : '拒绝接口请求'}`, error);
      if (staticRequest) return await serveStatic(req, res, pathname, null);
      return json(res, 503, { message: '数据存储暂时不可用，请稍后重试或联系管理员' }, { 'Retry-After': '30' });
    }
    systemTimezoneOffsetMinutes = db.systemConfig?.timezoneOffset ?? 480;
    refreshMonitorTargetPolicy(db.systemConfig);
    if (!validateCsrf(req, res, db, pathname)) return;

    // 管理员可要求账号必须启用动态令牌；未完成绑定前只放行绑定所需接口，
    // 避免「已要求但可继续用密码操作」导致策略形同虚设。
    if (pathname.startsWith('/api/') && !isTwoFactorEnrollmentExemptPath(pathname)) {
      const gateUser = getAuthUser(req, db);
      if (gateUser && gateUser.twoFactorEnforced && !gateUser.twoFactorEnabled && !String(gateUser.username || '').startsWith('oidc_')) {
        return json(res, 403, {
          code: 'two_factor_enrollment_required',
          message: '管理员要求该账号启用动态令牌，请先完成绑定'
        });
      }
    }

    tryLazyInitHttps(db);

    if (db.systemConfig?.httpLoginDisabled && !isEncryptedRequest(req)) {
      const loginPaths = ['/api/login', '/api/register', '/api/forgot-password', '/api/captcha', '/api/auth'];
      if (loginPaths.some(p => pathname.startsWith(p))) {
        return json(res, 403, { message: 'HTTP 登录已禁用，请使用 HTTPS 登录' });
      }
    }


    if (req.method === 'GET' && pathname === '/api/captcha') {
      const captchaRate = checkCaptchaRequestRate(req);
      if (captchaRate.limited) {
        return json(res, 429, { message: '验证码请求过于频繁，请稍后重试' }, rateLimitResponseHeaders(captchaRate.retryAfterMs));
      }
      const code = generateCaptchaCode();
      const token = createCaptchaToken(code);
      // 仅非生产环境保留字形元数据，供自动化测试解码；生产环境只返回图片本身。
      const svg = renderCaptchaSvg(code, !isProduction);
      return json(res, 200, {
        token,
        svg: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        csrfToken: getSessionCsrfToken(token)
      }, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      });
    }

    // 登录页需要在未认证状态读取证书到期提示；证书有效期本身由 TLS 握手公开，不含密钥信息。
    if (req.method === 'GET' && pathname === '/api/https-certificate/notice') {
      return json(res, 200, {
        notice: getHttpsCertificateExpiryNotice(db.systemConfig),
        warningDays: HTTPS_CERT_EXPIRY_WARNING_DAYS
      }, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      });
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const username = normalizeLoginUsername(body.username);
      if (!username) return json(res, 400, { message: '请输入账号，长度不超过 64 位' });
      const rateLimitState = getLoginRateLimitState(db, req, username);
      if (rateLimitState.blocked) {
        return json(res, 429, { message: loginBlockedMessage(rateLimitState.retryAfterMs) }, rateLimitResponseHeaders(rateLimitState.retryAfterMs));
      }
      if (!verifyCaptchaToken(body.captchaToken, body.captcha)) {
        const failedState = await recordLoginFailureLocked(req, username);
        if (failedState.lockedUntil > nowMs()) {
          return json(res, 429, { message: loginBlockedMessage(failedState.lockedUntil - nowMs()) }, rateLimitResponseHeaders(failedState.lockedUntil - nowMs()));
        }
        return json(res, 401, { message: '验证码错误' });
      }
      const user = db.users.find(item => item.username === username);
      const passwordMatches = verifyPassword(body.password, user ? user.passwordHash : LOGIN_DUMMY_PASSWORD_HASH);
      if (!user || !passwordMatches) {
        const failedState = await recordLoginFailureLocked(req, username);
        if (failedState.lockedUntil > nowMs()) {
          return json(res, 429, { message: loginBlockedMessage(failedState.lockedUntil - nowMs()) }, rateLimitResponseHeaders(failedState.lockedUntil - nowMs()));
        }
        return json(res, 401, { message: '账号或密码错误' });
      }
      if (user.status === 'pending') {
        return json(res, 403, { message: '账号尚未通过管理员审批，请联系管理员' });
      }
      if (user.status === 'disabled') {
        return json(res, 403, { message: '账号已被禁用，请联系管理员' });
      }
      if (user.status === 'rejected') {
        return json(res, 403, { message: '账号注册申请未通过，请联系管理员' });
      }
      if (user.twoFactorEnabled) {
        if (!readUserTotpSecret(user)) {
          return json(res, 403, { message: '动态令牌配置异常，请联系管理员重置后重新绑定' });
        }
        const challengeToken = createTwoFactorChallenge(user.id, req);
        return json(res, 200, {
          twoFactorRequired: true,
          challengeToken,
          message: '请输入身份验证器中的 6 位动态码'
        });
      }
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(nowMs() + sessionMaxAgeSeconds * 1000).toISOString();
      // 清除失败计数、升级哈希、建立会话需在同一临界区内基于最新状态完成，
      // 既避免并发失败计数被覆盖，也避免与并发登录互相清掉会话。
      const upgradedHash = !String(user.passwordHash).startsWith('$scrypt$') ? hash(body.password) : '';
      await withDbMutationLock(async () => {
        const lockDb = await readDb();
        clearLoginFailures(lockDb, req, username);
        if (upgradedHash) {
          const lockUser = (lockDb.users || []).find(item => item.id === user.id);
          if (lockUser) lockUser.passwordHash = upgradedHash;
        }
        lockDb.sessions = (lockDb.sessions || []).filter(item => item.userId !== user.id && Date.parse(item.expiresAt) > nowMs());
        lockDb.sessions.push({ token, userId: user.id, createdAt: now(), lastActivityAt: now(), expiresAt });
        const lockLoginUser = (lockDb.users || []).find(item => item.id === user.id);
        if (lockLoginUser) {
          appendAuditLog(lockDb, lockLoginUser, 'login', 'auth', lockLoginUser.id, '账号密码登录成功', '', auditMeta(req));
        }
        await writeDb(lockDb, { silent: true, replaceCollections: ['sessions'] });
      });
      return json(res, 200, { user: sanitizeUser(user), systemConfig: presentSystemConfig(user, db.systemConfig), csrfToken: getSessionCsrfToken(token) }, { 'Set-Cookie': buildSessionCookie(req, token, db.systemConfig) });
    }

    if (req.method === 'POST' && pathname === '/api/login/2fa') {
      const body = await readBody(req);
      const challengeToken = String(body.challengeToken || '').trim();
      const challenge = getTwoFactorChallenge(challengeToken, req);
      if (!challenge) {
        return json(res, 401, { message: '登录验证已过期，请重新登录' });
      }
      const user = db.users.find(item => item.id === challenge.userId);
      if (!user) {
        twoFactorChallenges.delete(challengeToken);
        return json(res, 401, { message: '登录验证已过期，请重新登录' });
      }
      const rateLimitState = getLoginRateLimitState(db, req, user.username);
      if (rateLimitState.blocked) {
        twoFactorChallenges.delete(challengeToken);
        return json(res, 429, { message: loginBlockedMessage(rateLimitState.retryAfterMs) }, rateLimitResponseHeaders(rateLimitState.retryAfterMs));
      }
      if (user.status === 'pending' || user.status === 'disabled' || user.status === 'rejected') {
        twoFactorChallenges.delete(challengeToken);
        return json(res, 403, { message: '账号状态异常，请联系管理员' });
      }
      const totpSecret = readUserTotpSecret(user);
      if (!user.twoFactorEnabled || !totpSecret) {
        twoFactorChallenges.delete(challengeToken);
        return json(res, 401, { message: '登录验证已过期，请重新登录' });
      }
      const code = String(body.code || '').trim();
      const totpMatched = consumeTotpCode(user, totpSecret, code, 'login');
      const recoveryMatched = !totpMatched && consumeRecoveryCode(user, code);
      if (!totpMatched && !recoveryMatched) {
        challenge.attempts += 1;
        if (challenge.attempts >= TWO_FACTOR_CHALLENGE_MAX_ATTEMPTS) {
          twoFactorChallenges.delete(challengeToken);
        }
        const failedState = await recordLoginFailureLocked(req, user.username);
        if (failedState.lockedUntil > nowMs()) {
          return json(res, 429, { message: loginBlockedMessage(failedState.lockedUntil - nowMs()) }, rateLimitResponseHeaders(failedState.lockedUntil - nowMs()));
        }
        return json(res, 401, { message: '动态码或恢复码错误' });
      }
      twoFactorChallenges.delete(challengeToken);
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(nowMs() + sessionMaxAgeSeconds * 1000).toISOString();
      // 二次验证通过后仍要在临界区内复核账号状态，避免与管理员重置/禁用并发时建立会话。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const lockUser = (lockDb.users || []).find(item => item.id === user.id);
        if (!lockUser || !lockUser.twoFactorEnabled || lockUser.status !== 'active') return { ok: false };
        if (recoveryMatched) {
          lockUser.twoFactorRecoveryCodeHashes = Array.isArray(user.twoFactorRecoveryCodeHashes) ? user.twoFactorRecoveryCodeHashes : [];
        }
        clearLoginFailures(lockDb, req, user.username);
        lockDb.sessions = (lockDb.sessions || []).filter(item => item.userId !== lockUser.id && Date.parse(item.expiresAt) > nowMs());
        lockDb.sessions.push({ token, userId: lockUser.id, createdAt: now(), lastActivityAt: now(), expiresAt });
        appendAuditLog(lockDb, lockUser, 'login', 'auth', lockUser.id, recoveryMatched ? '动态令牌恢复码登录成功' : '动态令牌登录成功', '', auditMeta(req));
        await writeDb(lockDb, { silent: true, replaceCollections: ['sessions'] });
        return { ok: true, user: lockUser };
      });
      if (!outcome.ok) {
        return json(res, 401, { message: '登录验证已过期，请重新登录' });
      }
      return json(res, 200, {
        user: sanitizeUser(outcome.user),
        systemConfig: presentSystemConfig(outcome.user, db.systemConfig),
        csrfToken: getSessionCsrfToken(token),
        recoveryCodeUsed: recoveryMatched
      }, { 'Set-Cookie': buildSessionCookie(req, token, db.systemConfig) });
    }

    if (req.method === 'POST' && pathname === '/api/change-password') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!body.oldPassword || !body.newPassword) {
        return json(res, 400, { message: '当前密码和新密码不能为空' });
      }
      if (body.oldPassword === body.newPassword) {
        return json(res, 400, { message: '新密码不能与当前密码相同' });
      }
      if (String(body.newPassword).length < 8) {
        return json(res, 400, { message: '密码长度不能少于 8 位' });
      }
      if (!/[a-zA-Z]/.test(body.newPassword) || !/[0-9]/.test(body.newPassword) || !/[^a-zA-Z0-9]/.test(body.newPassword)) {
        return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
      }
      const changePasswordLock = getPasswordReauthLockState(user);
      if (changePasswordLock.locked) {
        return json(res, 429, { message: '密码尝试次数过多，请稍后重试' }, rateLimitResponseHeaders(changePasswordLock.retryAfterMs));
      }
      if (!verifyPassword(body.oldPassword, user.passwordHash)) {
        recordPasswordReauthFailure(user);
        return json(res, 401, { message: '当前密码错误' });
      }
      clearPasswordReauthFailures(user);
      user.passwordHash = hash(body.newPassword);
      db.sessions = (db.sessions || []).filter(item => item.userId !== user.id);
      appendAuditLog(db, user, 'update', 'user', user.id, '修改个人密码');
      await writeDb(db, { replaceCollections: ['sessions'] });
      closeUserWebSockets(user.id);
      return json(res, 200, { message: '密码修改成功' });
    }

    if (req.method === 'GET' && pathname === '/api/account/2fa') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      return json(res, 200, {
        enabled: Boolean(user.twoFactorEnabled),
        enabledAt: user.twoFactorEnabledAt || '',
        enforced: Boolean(user.twoFactorEnforced),
        pending: Boolean(user.twoFactorPendingSecret),
        recoveryCodesRemaining: Array.isArray(user.twoFactorRecoveryCodeHashes) ? user.twoFactorRecoveryCodeHashes.length : 0
      });
    }

    if (req.method === 'POST' && pathname === '/api/account/2fa/setup') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (String(user.username || '').startsWith('oidc_')) {
        return json(res, 400, { message: '企业 SSO 账号的二次认证由身份提供方管理' });
      }
      if (user.twoFactorEnabled) {
        return json(res, 400, { message: '动态令牌已启用，如需更换请先关闭' });
      }
      const body = await readBody(req);
      const setupReauthLock = getPasswordReauthLockState(user);
      if (setupReauthLock.locked) {
        return json(res, 429, { message: '密码尝试次数过多，请稍后重试' }, rateLimitResponseHeaders(setupReauthLock.retryAfterMs));
      }
      if (!(await verifyTwoFactorPassword(user, body.password))) {
        recordPasswordReauthFailure(user);
        return json(res, 401, { message: '当前密码错误' });
      }
      clearPasswordReauthFailures(user);
      const secret = generateTotpSecret();
      user.twoFactorPendingSecret = encryptCredential(secret);
      appendAuditLog(db, user, 'update', 'user', user.id, '申请绑定动态令牌');
      await writeDb(db);
      return json(res, 200, {
        secret,
        otpauthUrl: buildTotpOtpauthUrl(user.username, secret),
        account: user.username
      });
    }

    if (req.method === 'POST' && pathname === '/api/account/2fa/enable') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.twoFactorEnabled) {
        return json(res, 400, { message: '动态令牌已启用' });
      }
      const pendingSecret = readPendingTotpSecret(user);
      if (!pendingSecret) {
        return json(res, 400, { message: '绑定已过期，请重新开始绑定' });
      }
      const enableLock = getTwoFactorVerifyLockState(user);
      if (enableLock.locked) {
        return json(res, 429, { message: '动态码尝试次数过多，请稍后重试' }, rateLimitResponseHeaders(enableLock.retryAfterMs));
      }
      const body = await readBody(req);
      if (!consumeTotpCode(user, pendingSecret, body.code, '2fa-enable')) {
        recordTwoFactorVerifyFailure(user);
        return json(res, 400, { message: '动态码错误，请核对身份验证器后重试' });
      }
      clearTwoFactorVerifyFailures(user);
      const recoveryCodes = generateRecoveryCodes();
      user.twoFactorSecret = user.twoFactorPendingSecret;
      user.twoFactorPendingSecret = '';
      user.twoFactorEnabled = true;
      user.twoFactorEnabledAt = now();
      user.twoFactorRecoveryCodeHashes = recoveryCodes.map(hashRecoveryCode).filter(Boolean);
      appendAuditLog(db, user, 'update', 'user', user.id, '启用动态令牌二次认证');
      await writeDb(db);
      return json(res, 200, { message: '动态令牌已启用', recoveryCodes });
    }

    if (req.method === 'POST' && pathname === '/api/account/2fa/disable') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (!user.twoFactorEnabled) {
        return json(res, 400, { message: '动态令牌未启用' });
      }
      if (user.twoFactorEnforced) {
        return json(res, 400, { message: '管理员已要求该账号启用动态令牌，无法自行关闭' });
      }
      const body = await readBody(req);
      const disableReauthLock = getPasswordReauthLockState(user);
      if (disableReauthLock.locked) {
        return json(res, 429, { message: '密码尝试次数过多，请稍后重试' }, rateLimitResponseHeaders(disableReauthLock.retryAfterMs));
      }
      if (!(await verifyTwoFactorPassword(user, body.password))) {
        recordPasswordReauthFailure(user);
        return json(res, 401, { message: '当前密码错误' });
      }
      clearPasswordReauthFailures(user);
      const totpSecret = readUserTotpSecret(user);
      if (!totpSecret) {
        return json(res, 400, { message: '动态令牌配置异常，请联系管理员重置' });
      }
      const disableLock = getTwoFactorVerifyLockState(user);
      if (disableLock.locked) {
        return json(res, 429, { message: '动态码尝试次数过多，请稍后重试' }, rateLimitResponseHeaders(disableLock.retryAfterMs));
      }
      if (!consumeTotpCode(user, totpSecret, body.code, '2fa-disable') && !consumeRecoveryCode(user, body.code)) {
        recordTwoFactorVerifyFailure(user);
        return json(res, 400, { message: '动态码或恢复码错误' });
      }
      clearTwoFactorVerifyFailures(user);
      clearTwoFactorFields(user);
      appendAuditLog(db, user, 'update', 'user', user.id, '关闭动态令牌二次认证');
      await writeDb(db);
      return json(res, 200, { message: '动态令牌已关闭' });
    }

    if (req.method === 'POST' && pathname === '/api/account/2fa/recovery-codes') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (!user.twoFactorEnabled) {
        return json(res, 400, { message: '动态令牌未启用' });
      }
      const body = await readBody(req);
      const totpSecret = readUserTotpSecret(user);
      const recoveryLock = getTwoFactorVerifyLockState(user);
      if (recoveryLock.locked) {
        return json(res, 429, { message: '动态码尝试次数过多，请稍后重试' }, rateLimitResponseHeaders(recoveryLock.retryAfterMs));
      }
      if (!totpSecret || !consumeTotpCode(user, totpSecret, body.code, '2fa-recovery-codes')) {
        if (totpSecret) recordTwoFactorVerifyFailure(user);
        return json(res, 400, { message: '动态码错误' });
      }
      clearTwoFactorVerifyFailures(user);
      const recoveryCodes = generateRecoveryCodes();
      user.twoFactorRecoveryCodeHashes = recoveryCodes.map(hashRecoveryCode).filter(Boolean);
      appendAuditLog(db, user, 'update', 'user', user.id, '重新生成动态令牌恢复码');
      await writeDb(db);
      return json(res, 200, { message: '恢复码已重新生成', recoveryCodes });
    }

    if (req.method === 'POST' && pathname === '/api/forgot-password/verify') {
      const body = await readBody(req);
      const username = normalizeLoginUsername(body.username);
      if (!username) return json(res, 400, { message: '请输入账号，长度不超过 64 位' });
      const clientIp = getRequestClientIp(req);
      const rateKey = `forgot:verify:${clientIp}:${username}`;
      const rateState = getForgotPasswordRateLimitState(db, rateKey);
      if (rateState.blocked) {
        return json(res, 429, { message: `尝试次数过多，请在 ${Math.max(1, Math.ceil(rateState.retryAfterMs / 60000))} 分钟后重试` }, rateLimitResponseHeaders(rateState.retryAfterMs));
      }
      recordForgotPasswordAttempt(db, rateKey);
      if (!verifyCaptchaToken(body.captchaToken, body.captcha)) {
        return json(res, 401, { message: '验证码错误' });
      }
      const ticket = createForgotPasswordTicket(username);
      return json(res, 200, { ticket, question: '请输入您设置的安全问题答案', message: '如账号存在且已设置安全问题，请继续验证' });
    }

    if (req.method === 'POST' && pathname === '/api/forgot-password/reset') {
      const body = await readBody(req);
      const username = normalizeLoginUsername(body.username);
      if (!username) return json(res, 400, { message: '请输入账号，长度不超过 64 位' });
      const clientIp = getRequestClientIp(req);
      const rateKey = `forgot:reset:${clientIp}:${username}`;
      const rateState = getForgotPasswordRateLimitState(db, rateKey);
      if (rateState.blocked) {
        return json(res, 429, { message: `尝试次数过多，请在 ${Math.max(1, Math.ceil(rateState.retryAfterMs / 60000))} 分钟后重试` }, rateLimitResponseHeaders(rateState.retryAfterMs));
      }
      recordForgotPasswordAttempt(db, rateKey);
      if (!verifyCaptchaToken(body.captchaToken, body.captcha)) {
        return json(res, 401, { message: '验证码错误' });
      }
      // 密码强度先于票据消费校验，避免弱密码白白消耗一次性票据。
      if (!body.newPassword || String(body.newPassword).length < 8) {
        return json(res, 400, { message: '密码长度不能少于 8 位' });
      }
      if (!/[a-zA-Z]/.test(body.newPassword) || !/[0-9]/.test(body.newPassword) || !/[^a-zA-Z0-9]/.test(body.newPassword)) {
        return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
      }
      // 票据必须先校验再比对安全问题：否则未携带票据时「答案正确」返回 400、
      // 「答案错误」返回通用 200，会形成无需票据即可判定安全答案的 oracle。
      // 票据一次性，答错安全问题同样消耗，避免在 TTL 内反复尝试。
      const providedTicket = String(body.ticket || '').trim();
      if (!providedTicket || !consumeForgotPasswordTicket(providedTicket, username)) {
        return json(res, 400, { message: '验证已过期，请重新获取验证码' });
      }
      const user = db.users.find(item => item.username === username && item.status !== 'disabled');
      if (!user || !user.securityAnswerHash || !verifyPassword(body.securityAnswer, user.securityAnswerHash)) {
        return json(res, 200, { message: '如验证信息正确，密码将被重置' });
      }
      user.passwordHash = hash(body.newPassword);
      db.sessions = (db.sessions || []).filter(item => item.userId !== user.id);
      appendAuditLog(db, user, 'update', 'user', user.id, '通过安全问题重置密码');
      await writeDb(db, { replaceCollections: ['sessions'] });
      closeUserWebSockets(user.id);
      return json(res, 200, { reset: true, message: '密码重置成功，请使用新密码登录' });
    }

    if (req.method === 'POST' && pathname === '/api/register') {
      const body = await readBody(req);
      if (!verifyCaptchaToken(body.captchaToken, body.captcha)) {
        return json(res, 401, { message: '验证码错误' });
      }
      const username = String(body.username || '').trim();
      if (!username) {
        return json(res, 400, { message: '账号不能为空' });
      }
      if (username.length > 64) {
        return json(res, 400, { message: '账号长度不能超过 64 位' });
      }
      const registerLengthError = checkTextLength(body.name, 64, '姓名')
        || checkTextLength(body.phone, 32, '电话')
        || checkTextLength(body.idCard, 32, '身份证号')
        || checkTextLength(body.email, 128, '邮箱')
        || checkTextLength(body.wechat, 64, '微信');
      if (registerLengthError) return json(res, 400, { message: registerLengthError });
      if (!db.systemConfig.allowRegistration) {
        return json(res, 403, { message: '管理员已关闭自主注册功能' });
      }
      if (isReservedUsername(username)) {
        return json(res, 400, { message: '该账号前缀为系统保留，请更换账号' });
      }
      if (!body.password || String(body.password).length < 8) {
        return json(res, 400, { message: '密码长度不能少于 8 位' });
      }
      if (!/[a-zA-Z]/.test(body.password) || !/[0-9]/.test(body.password) || !/[^a-zA-Z0-9]/.test(body.password)) {
        return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
      }
      // 无论账号是否已存在都返回相同文案，唯一性检查与写入在同一临界区内完成。
      await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const existing = (lockDb.users || []).find(item => item.username === username);
        const payload = {
          passwordHash: hash(body.password),
          role: 'viewer',
          name: body.name || username,
          phone: body.phone || '',
          idCard: body.idCard || '',
          email: body.email || '',
          wechat: body.wechat || '',
          projectId: body.projectId || '',
          startDate: body.startDate || '',
          endDate: body.endDate || '',
          securityQuestion: body.securityQuestion || '',
          securityAnswerHash: body.securityAnswer ? hash(body.securityAnswer) : '',
          status: 'pending'
        };
        if (existing) {
          // 仅允许被驳回的账号重新提交，其余状态（待审/启用/停用）保持唯一性不变。
          if (existing.status !== 'rejected') return;
          Object.assign(existing, payload, { reviewedAt: '', reviewedBy: '' });
          appendAuditLog(lockDb, existing, 'update', 'user', existing.id, `自注册账号重新提交 ${existing.name}`);
        } else {
          const created = Object.assign({ id: id('user'), username, createdAt: now() }, payload);
          lockDb.users.push(created);
          appendAuditLog(lockDb, created, 'create', 'user', created.id, `自注册账号 ${created.name}`);
        }
        await writeDb(lockDb);
      });
      return json(res, 201, { message: '提交成功，请等待管理员审批' });
    }

    if (req.method === 'GET' && pathname === '/api/auth/oidc/login') {
      const { issuer, clientId, redirectUri } = getOidcConfig();
      if (!issuer || !clientId) {
        return json(res, 501, { message: 'OIDC 未配置，请设置 OIDC_ISSUER 和 OIDC_CLIENT_ID 环境变量' });
      }
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const state = crypto.randomBytes(16).toString('hex');
      const nonce = crypto.randomBytes(16).toString('hex');
      const oidcConfig = await fetchOidcConfig(issuer);
      if (!oidcConfig) {
        return json(res, 502, { message: '无法获取 OIDC 配置' });
      }
      db.runtimeState.oidcState = db.runtimeState.oidcState || {};
      // 清理超时未回调的 state，避免 /api/auth/oidc/login 被反复调用导致持久化数据膨胀。
      const oidcStateTtlMs = 10 * 60 * 1000;
      for (const [key, entry] of Object.entries(db.runtimeState.oidcState)) {
        if (!entry || nowMs() - Number(entry.createdAt || 0) > oidcStateTtlMs) {
          delete db.runtimeState.oidcState[key];
        }
      }
      db.runtimeState.oidcState[state] = { codeVerifier, nonce, createdAt: nowMs() };
      await writeDb(db, { silent: true });
      const authUrl = new URL(oidcConfig.authorization_endpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'openid profile email');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('nonce', nonce);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      res.writeHead(302, buildSecurityHeaders({
        Location: authUrl.toString(),
        'Set-Cookie': buildOidcStateCookie(req, db.systemConfig, state)
      }));
      return res.end();
    }

    if (req.method === 'GET' && pathname === '/api/auth/oidc/callback') {
      const { issuer, clientId, clientSecret, redirectUri } = getOidcConfig();
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');
      if (!code || !state) {
        return json(res, 400, { message: '缺少授权参数' });
      }
      const stateData = (db.runtimeState.oidcState || {})[state];
      if (!stateData || (nowMs() - (stateData.createdAt || 0)) > 600000) {
        return json(res, 401, { message: '授权状态已过期' });
      }
      const stateCookie = parseCookies(req).oidcState || '';
      if (!stateCookie || stateCookie !== state) {
        delete db.runtimeState.oidcState[state];
        await writeDb(db, { silent: true });
        return json(res, 401, { message: '授权状态无效，请重新登录' }, { 'Set-Cookie': buildClearOidcStateCookie(req, db.systemConfig) });
      }
      delete db.runtimeState.oidcState[state];
      const oidcConfig = await fetchOidcConfig(issuer);
      if (!oidcConfig) {
        return json(res, 502, { message: '无法获取 OIDC 配置' });
      }
      try {
        const tokenRes = await fetchWithTimeout(oidcConfig.token_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: String(new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
            code_verifier: stateData.codeVerifier
          }))
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
          return json(res, 401, { message: 'OIDC 认证失败' });
        }
        const idToken = tokenData.id_token;
        if (!idToken || !oidcConfig.jwks_uri) {
          return json(res, 401, { message: 'OIDC 认证失败' });
        }
        const userInfo = await verifyOidcIdToken(idToken, oidcConfig, { issuer, clientId, nonce: stateData.nonce });
        const oidcSub = userInfo.sub;
        const preferredUsername = userInfo.preferred_username || userInfo.email || oidcSub;
        const displayName = userInfo.name || preferredUsername;
        let localUser = db.users.find(item => item.username === 'oidc_' + oidcSub);
        if (!localUser) {
          const provisioning = resolveSsoProvisioning(db.systemConfig, db, [preferredUsername, userInfo.email, oidcSub]);
          localUser = {
            id: id('user'),
            username: 'oidc_' + oidcSub,
            passwordHash: hash(crypto.randomBytes(16).toString('hex')),
            role: 'viewer',
            name: displayName,
            phone: '',
            idCard: '',
            email: userInfo.email || '',
            wechat: '',
            projectId: provisioning?.projectId || '',
            startDate: '',
            endDate: '',
            securityQuestion: '',
            securityAnswerHash: '',
            status: provisioning?.status || 'pending',
            createdAt: now()
          };
          db.users.push(localUser);
        }
        if (localUser.status === 'pending' || localUser.status === 'disabled' || localUser.status === 'rejected') {
          await writeDb(db);
          res.writeHead(302, buildSecurityHeaders({
            Location: '/?auth=pending',
            'Set-Cookie': buildClearOidcStateCookie(req, db.systemConfig)
          }));
          return res.end();
        }
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(nowMs() + sessionMaxAgeSeconds * 1000).toISOString();
        db.sessions = (db.sessions || []).filter(item => item.userId !== localUser.id && Date.parse(item.expiresAt) > nowMs());
        db.sessions.push({ token, userId: localUser.id, createdAt: now(), lastActivityAt: now(), expiresAt });
        appendAuditLog(db, localUser, 'sso_login', 'auth', localUser.id, 'OIDC 单点登录成功', '', auditMeta(req));
        await writeDb(db, { replaceCollections: ['sessions'] });
        res.writeHead(302, buildSecurityHeaders({
          Location: '/',
          'Set-Cookie': [
            buildSessionCookie(req, token, db.systemConfig),
            buildClearOidcStateCookie(req, db.systemConfig)
          ]
        }));
        return res.end();
      } catch (err) {
        return json(res, 502, { message: 'OIDC 认证服务不可用' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/ldap') {
      const { ldapUrl, ldapBaseDn, ldapBindDn, ldapBindPassword } = getLdapConfig();
      if (!ldapUrl) {
        return json(res, 501, { message: 'LDAP 未配置，请设置 LDAP_URL 环境变量' });
      }
      const body = await readBody(req);
      const username = normalizeLoginUsername(body.username);
      if (!username) return json(res, 400, { message: '请输入账号，长度不超过 64 位' });
      const password = String(body.password || '');
      const rateLimitState = getLoginRateLimitState(db, req, username);
      if (rateLimitState.blocked) {
        return json(res, 429, { message: loginBlockedMessage(rateLimitState.retryAfterMs) }, rateLimitResponseHeaders(rateLimitState.retryAfterMs));
      }
      if (!verifyCaptchaToken(body.captchaToken, body.captcha)) {
        const failedState = await recordLoginFailureLocked(req, username);
        if (failedState.lockedUntil > nowMs()) {
          return json(res, 429, { message: loginBlockedMessage(failedState.lockedUntil - nowMs()) }, rateLimitResponseHeaders(failedState.lockedUntil - nowMs()));
        }
        return json(res, 401, { message: '验证码错误' });
      }
      if (!username || !password) {
        return json(res, 400, { message: '请输入用户名和密码' });
      }
      try {
        const ldapUser = await ldapAuthenticate(ldapUrl, ldapBaseDn, ldapBindDn, ldapBindPassword, username, password);
        if (!ldapUser) {
          const failedState = await recordLoginFailureLocked(req, username);
          if (failedState.lockedUntil > nowMs()) {
            return json(res, 429, { message: loginBlockedMessage(failedState.lockedUntil - nowMs()) }, rateLimitResponseHeaders(failedState.lockedUntil - nowMs()));
          }
          return json(res, 401, { message: 'LDAP 认证失败' });
        }
        clearLoginFailures(db, req, username);
        let createdLocalUser = false;
        let localUser = db.users.find(item => item.username === 'ldap_' + username);
        if (!localUser) {
          const provisioning = resolveSsoProvisioning(db.systemConfig, db, [username, ldapUser.email]);
          localUser = {
            id: id('user'),
            username: 'ldap_' + username,
            passwordHash: hash(crypto.randomBytes(16).toString('hex')),
            role: 'viewer',
            name: ldapUser.displayName || username,
            phone: ldapUser.phone || '',
            idCard: '',
            email: ldapUser.email || '',
            wechat: '',
            projectId: provisioning?.projectId || '',
            startDate: '',
            endDate: '',
            securityQuestion: '',
            securityAnswerHash: '',
            status: provisioning?.status || 'pending',
            createdAt: now()
          };
          db.users.push(localUser);
          createdLocalUser = true;
        }
        if (localUser.status === 'pending') {
          if (createdLocalUser) await writeDb(db);
          return json(res, 403, { message: '账号尚未通过管理员审批，请联系管理员' });
        }
        if (localUser.status === 'disabled') {
          return json(res, 403, { message: '账号已被禁用，请联系管理员' });
        }
        if (localUser.status === 'rejected') {
          return json(res, 403, { message: '账号注册申请未通过，请联系管理员' });
        }
        if (localUser.twoFactorEnabled) {
          if (!readUserTotpSecret(localUser)) {
            return json(res, 403, { message: '动态令牌配置异常，请联系管理员重置后重新绑定' });
          }
          const challengeToken = createTwoFactorChallenge(localUser.id, req);
          return json(res, 200, {
            twoFactorRequired: true,
            challengeToken,
            message: '请输入身份验证器中的 6 位动态码'
          });
        }
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(nowMs() + sessionMaxAgeSeconds * 1000).toISOString();
        db.sessions = (db.sessions || []).filter(item => item.userId !== localUser.id && Date.parse(item.expiresAt) > nowMs());
        db.sessions.push({ token, userId: localUser.id, createdAt: now(), lastActivityAt: now(), expiresAt });
        await writeDb(db, { silent: !createdLocalUser, replaceCollections: ['sessions'] });
        return json(res, 200, {
          user: sanitizeUser(localUser),
          systemConfig: presentSystemConfig(localUser, db.systemConfig),
          csrfToken: getSessionCsrfToken(token)
        }, { 'Set-Cookie': buildSessionCookie(req, token, db.systemConfig) });
      } catch (err) {
        return json(res, 502, { message: 'LDAP 认证服务不可用' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      const sessionToken = getSessionToken(req);
      if (sessionToken) {
        const session = (db.sessions || []).find(item => item.token === sessionToken);
        const sessionOwnerId = session ? session.userId : '';
        const logoutUser = sessionOwnerId ? (db.users || []).find(item => item.id === sessionOwnerId) : null;
        db.sessions = (db.sessions || []).filter(item => item.token !== sessionToken);
        if (logoutUser) appendAuditLog(db, logoutUser, 'logout', 'auth', logoutUser.id, '主动退出登录', '', auditMeta(req));
        await writeDb(db, { silent: true, replaceCollections: ['sessions'] });
        if (sessionOwnerId) closeUserWebSockets(sessionOwnerId);
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': buildClearSessionCookie(req, db.systemConfig) });
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      const user = getAuthUser(req, db);
      const sessionToken = getSessionToken(req);
      return json(res, 200, {
        user: sanitizeUser(user),
        systemConfig: user ? presentSystemConfig(user, db.systemConfig) : { allowRegistration: !!db.systemConfig.allowRegistration },
        csrfToken: user && sessionToken ? getSessionCsrfToken(sessionToken) : ''
      });
    }

    if (req.method === 'GET' && pathname === '/api/sessions/online') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const onlineUsers = [];
      const seenUserIds = new Set();
      const nowMs = Date.now();
      for (const s of (db.sessions || [])) {
        if (seenUserIds.has(s.userId)) continue;
        if (s.expiresAt && Date.parse(s.expiresAt) <= nowMs) continue;
        const u = (db.users || []).find(x => x.id === s.userId);
        if (u && u.status === 'active') {
          seenUserIds.add(s.userId);
          if (user.role === 'customer') {
            if (u.id === user.id) onlineUsers.push({ id: u.id, username: u.username, name: u.name, role: u.role });
          } else if (user.role === 'admin' || userProjectIds(user).some(projectId => userHasProject(u, projectId)) || u.id === user.id) {
            onlineUsers.push({
              id: u.id,
              username: user.role === 'admin' || u.id === user.id ? u.username : '',
              name: u.name,
              role: u.role
            });
          }
        }
      }
      return json(res, 200, { count: onlineUsers.length, users: onlineUsers });
    }

    if (req.method === 'GET' && pathname === '/api/projects') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectIds = userProjectIds(user);
      const list = user.role === 'admin' ? db.projects : db.projects.filter(item => projectIds.includes(item.id));
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    // 合同与费用：管理员与项目内工程师可读，写操作要求编辑器权限；客户不可见金额明细。
    if (req.method === 'GET' && pathname === '/api/contracts') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '无权查看合同信息' });
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.contracts || [], user, item => item.projectId);
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.status) list = list.filter(item => item.status === query.status);
      const sorted = parseSortQuery(query, list.map(item => ({
        ...item,
        ...summarizeContract(item, db.contractSettlements || [])
      })), 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'GET' && pathname === '/api/contracts/summary') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '无权查看合同信息' });
      const projectId = String(reqUrl.searchParams.get('projectId') || '').trim();
      let contracts = filterByProjectScope(db.contracts || [], user, item => item.projectId);
      if (projectId) contracts = contracts.filter(item => item.projectId === projectId);
      const totals = contracts.reduce((acc, contract) => {
        const summary = summarizeContract(contract, db.contractSettlements || []);
        acc.contractAmount += summary.contractAmount;
        acc.invoiceAmount += summary.invoiceAmount;
        acc.receivedAmount += summary.receivedAmount;
        acc.costAmount += summary.costAmount;
        acc.grossProfit += summary.grossProfit;
        return acc;
      }, { contractAmount: 0, invoiceAmount: 0, receivedAmount: 0, costAmount: 0, grossProfit: 0 });
      const grossMargin = totals.receivedAmount > 0
        ? Math.round((totals.grossProfit / totals.receivedAmount) * 1000) / 10
        : 0;
      return json(res, 200, {
        ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, normalizeMoney(value)])),
        grossMargin,
        contractCount: contracts.length
      });
    }

    if (req.method === 'POST' && pathname === '/api/contracts') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { message: '合同名称不能为空' });
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const amount = normalizeMoney(body.amount);
      const taxRate = normalizeMoney(body.taxRate);
      if (amount < 0 || taxRate < 0) return json(res, 400, { message: '合同金额与税率不能为负数' });
      const contract = {
        id: id('contract'),
        projectId,
        contractNo: String(body.contractNo || '').trim().slice(0, 64),
        name: name.slice(0, 128),
        partyA: String(body.partyA || '').slice(0, 128),
        partyB: String(body.partyB || '').slice(0, 128),
        amount,
        taxRate,
        settlementCycle: ['monthly', 'quarterly', 'milestone', 'once'].includes(body.settlementCycle) ? body.settlementCycle : 'monthly',
        signDate: body.signDate || '',
        startDate: body.startDate || '',
        endDate: body.endDate || '',
        status: ['draft', 'active', 'completed', 'terminated'].includes(body.status) ? body.status : 'active',
        notes: String(body.notes || '').slice(0, 500),
        createdBy: user.id,
        createdAt: now(),
        updatedAt: now()
      };
      db.contracts.push(contract);
      appendAuditLog(db, user, 'create', 'contract', contract.id, `创建合同 ${contract.name}`, projectId);
      await writeDb(db);
      return json(res, 201, { ...contract, ...summarizeContract(contract, db.contractSettlements || []) });
    }

    if (req.method && ['PUT', 'DELETE'].includes(req.method) && pathname.match(/^\/api\/contracts\/[^/]+$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const contractId = pathname.split('/')[3];
      const contract = (db.contracts || []).find(item => item.id === contractId);
      if (!contract) return json(res, 404, { message: '合同不存在' });
      if (!canViewProject(user, contract.projectId)) return json(res, 403, { message: '无权操作该合同' });
      if (req.method === 'DELETE') {
        db.contracts = (db.contracts || []).filter(item => item.id !== contractId);
        db.contractSettlements = (db.contractSettlements || []).filter(item => item.contractId !== contractId);
        appendAuditLog(db, user, 'delete', 'contract', contractId, `删除合同 ${contract.name}`, contract.projectId);
        await writeDb(db);
        return json(res, 200, { ok: true });
      }
      const body = await readBody(req);
      if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) return json(res, 400, { message: '合同名称不能为空' });
        contract.name = name.slice(0, 128);
      }
      if (body.amount !== undefined) {
        const amount = normalizeMoney(body.amount);
        if (amount < 0) return json(res, 400, { message: '合同金额不能为负数' });
        contract.amount = amount;
      }
      if (body.taxRate !== undefined) {
        const taxRate = normalizeMoney(body.taxRate);
        if (taxRate < 0) return json(res, 400, { message: '税率不能为负数' });
        contract.taxRate = taxRate;
      }
      if (body.contractNo !== undefined) contract.contractNo = String(body.contractNo || '').trim().slice(0, 64);
      if (body.partyA !== undefined) contract.partyA = String(body.partyA || '').slice(0, 128);
      if (body.partyB !== undefined) contract.partyB = String(body.partyB || '').slice(0, 128);
      if (body.settlementCycle !== undefined) {
        contract.settlementCycle = ['monthly', 'quarterly', 'milestone', 'once'].includes(body.settlementCycle) ? body.settlementCycle : contract.settlementCycle;
      }
      if (body.signDate !== undefined) contract.signDate = body.signDate || '';
      if (body.startDate !== undefined) contract.startDate = body.startDate || '';
      if (body.endDate !== undefined) contract.endDate = body.endDate || '';
      if (body.status !== undefined) {
        contract.status = ['draft', 'active', 'completed', 'terminated'].includes(body.status) ? body.status : contract.status;
      }
      if (body.notes !== undefined) contract.notes = String(body.notes || '').slice(0, 500);
      contract.updatedAt = now();
      appendAuditLog(db, user, 'update', 'contract', contract.id, `修改合同 ${contract.name}`, contract.projectId);
      await writeDb(db);
      return json(res, 200, { ...contract, ...summarizeContract(contract, db.contractSettlements || []) });
    }

    if (req.method === 'GET' && pathname === '/api/contract-settlements') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '无权查看结算信息' });
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.contractSettlements || [], user, item => item.projectId);
      if (query.contractId) list = list.filter(item => item.contractId === query.contractId);
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.status) list = list.filter(item => item.status === query.status);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/contract-settlements') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const contract = (db.contracts || []).find(item => item.id === String(body.contractId || ''));
      if (!contract) return json(res, 400, { message: '关联合同不存在' });
      if (!canViewProject(user, contract.projectId)) return json(res, 403, { message: '无权操作该合同' });
      const invoiceAmount = normalizeMoney(body.invoiceAmount);
      const receivedAmount = normalizeMoney(body.receivedAmount);
      const costAmount = normalizeMoney(body.costAmount);
      if (invoiceAmount < 0 || receivedAmount < 0 || costAmount < 0) {
        return json(res, 400, { message: '开票、回款与成本金额不能为负数' });
      }
      const settlement = {
        id: id('settlement'),
        contractId: contract.id,
        projectId: contract.projectId,
        periodKey: String(body.periodKey || '').slice(0, 32),
        title: String(body.title || '').slice(0, 128),
        invoiceAmount,
        receivedAmount,
        costAmount,
        invoiceNo: String(body.invoiceNo || '').slice(0, 64),
        invoicedAt: body.invoicedAt || '',
        receivedAt: body.receivedAt || '',
        status: ['pending', 'invoiced', 'received'].includes(body.status) ? body.status : 'pending',
        notes: String(body.notes || '').slice(0, 500),
        createdBy: user.id,
        createdAt: now(),
        updatedAt: now()
      };
      db.contractSettlements.push(settlement);
      appendAuditLog(db, user, 'create', 'contractSettlement', settlement.id, `登记合同结算 ${contract.name}`, contract.projectId);
      await writeDb(db);
      return json(res, 201, settlement);
    }

    if (req.method && ['PUT', 'DELETE'].includes(req.method) && pathname.match(/^\/api\/contract-settlements\/[^/]+$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const settlementId = pathname.split('/')[3];
      const settlement = (db.contractSettlements || []).find(item => item.id === settlementId);
      if (!settlement) return json(res, 404, { message: '结算记录不存在' });
      if (!canViewProject(user, settlement.projectId)) return json(res, 403, { message: '无权操作该结算记录' });
      if (req.method === 'DELETE') {
        db.contractSettlements = (db.contractSettlements || []).filter(item => item.id !== settlementId);
        appendAuditLog(db, user, 'delete', 'contractSettlement', settlementId, '删除合同结算记录', settlement.projectId);
        await writeDb(db);
        return json(res, 200, { ok: true });
      }
      const body = await readBody(req);
      for (const field of ['invoiceAmount', 'receivedAmount', 'costAmount']) {
        if (body[field] === undefined) continue;
        const value = normalizeMoney(body[field]);
        if (value < 0) return json(res, 400, { message: '开票、回款与成本金额不能为负数' });
        settlement[field] = value;
      }
      if (body.periodKey !== undefined) settlement.periodKey = String(body.periodKey || '').slice(0, 32);
      if (body.title !== undefined) settlement.title = String(body.title || '').slice(0, 128);
      if (body.invoiceNo !== undefined) settlement.invoiceNo = String(body.invoiceNo || '').slice(0, 64);
      if (body.invoicedAt !== undefined) settlement.invoicedAt = body.invoicedAt || '';
      if (body.receivedAt !== undefined) settlement.receivedAt = body.receivedAt || '';
      if (body.status !== undefined) {
        settlement.status = ['pending', 'invoiced', 'received'].includes(body.status) ? body.status : settlement.status;
      }
      if (body.notes !== undefined) settlement.notes = String(body.notes || '').slice(0, 500);
      settlement.updatedAt = now();
      appendAuditLog(db, user, 'update', 'contractSettlement', settlement.id, '修改合同结算记录', settlement.projectId);
      await writeDb(db);
      return json(res, 200, settlement);
    }

    if (req.method === 'POST' && pathname === '/api/projects') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!String(body.name || '').trim()) return json(res, 400, { message: '项目名称不能为空' });
      const projectLengthError = checkTextLength(body.name, 128, '项目名称')
        || checkTextLength(body.customerName, 128, '客户名称');
      if (projectLengthError) return json(res, 400, { message: projectLengthError });
      const project = {
        id: id('project'),
        name: body.name,
        customerName: body.customerName || body.name,
        projectStartDate: body.projectStartDate || '',
        projectEndDate: body.projectEndDate || '',
        notifyBefore: body.notifyBefore || '',
        paymentMethod: body.paymentMethod || '',
        customerLogVisible: body.customerLogVisible === true,
        description: body.description || '',
        createdAt: now()
      };
      db.projects.push(project);
      appendAuditLog(db, user, 'create', 'project', project.id, `创建项目 ${project.name}`, project.id);
      await writeDb(db);
      return json(res, 201, project);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/projects/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[3];
      const project = db.projects.find(item => item.id === projectId);
      if (!project) {
        return json(res, 404, { message: '项目不存在' });
      }
      const body = await readBody(req);
      const nextProjectName = String(body.name || '').trim();
      if (!nextProjectName) return json(res, 400, { message: '项目名称不能为空' });
      const projectLengthError = checkTextLength(nextProjectName, 128, '项目名称')
        || checkTextLength(body.customerName, 128, '客户名称');
      if (projectLengthError) return json(res, 400, { message: projectLengthError });
      project.name = nextProjectName;
      project.customerName = body.customerName !== undefined
        ? (String(body.customerName || '').trim() || nextProjectName)
        : (project.customerName || nextProjectName);
      project.projectStartDate = body.projectStartDate || '';
      project.projectEndDate = body.projectEndDate || '';
      project.notifyBefore = body.notifyBefore || '';
      project.paymentMethod = body.paymentMethod || '';
      project.customerLogVisible = body.customerLogVisible === true;
      project.description = body.description || '';
      appendAuditLog(db, user, 'update', 'project', project.id, `修改项目 ${project.name}`, project.id);
      await writeDb(db);
      return json(res, 200, project);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/projects/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[3];
      // 通知属于过程性提醒，不构成业务关联；随项目删除级联清理，避免历史通知长期阻断项目删除。
      db.notifications = (db.notifications || []).filter(item => item.projectId !== projectId);
      // users 不参与按 projectId 过滤：多项目账号只解除该项目归属，账号本身保留。
      const projectRelationCollections = ['contracts','contractSettlements','assets','assetLifecycles','assetCheckouts','assetInventoryTasks','logs','workReports','knowledgeBase','kbRevisions','documents','inspectionPlans','inspectionExecutions','spareParts','sparePartMovements','sparePartVendors','sparePartPurchases','sparePartInventoryTasks','changeRecords','incidentRecords','tickets','dutyShifts','approvals','notifications','notificationChannels','monitorAlerts','monitorMaintenanceWindows','aiInspectionTargets','aiInspectionTemplates','aiInspectionTasks','aiInspectionResults','configBackupPlans','configBackupRecords'];
      const force = String(reqUrl.searchParams.get('force') || '') === '1';
      if (force) {
        // 管理员强制删除：先级联清理该项目下的全部业务数据与人员，再删除项目，便于清理历史残留项目。
        // 多项目工程师只解除当前项目归属；仅主项目只剩这一个项目时才随项目删除账号。
        const removedUserIds = [];
        for (const account of db.users || []) {
          if (!userHasProject(account, projectId)) continue;
          const remaining = userProjectIds(account).filter(id => id !== projectId);
          if (!remaining.length) {
            removedUserIds.push(account.id);
            continue;
          }
          account.projectIds = remaining;
          account.projectId = remaining.includes(account.projectId) ? account.projectId : remaining[0];
        }
        const projectAssetIds = new Set((db.assets || []).filter(item => item.projectId === projectId).map(item => item.id));
        const projectDocumentIds = (db.documents || []).filter(item => item.projectId === projectId).map(item => item.id);
        const removedCounts = {};
        for (const key of projectRelationCollections) {
          if (!Array.isArray(db[key])) continue;
          const before = db[key].length;
          db[key] = db[key].filter(item => item.projectId !== projectId);
          const removed = before - db[key].length;
          if (removed > 0) removedCounts[key] = removed;
        }
        // 资产关系 assetRelations 只按 source/target 资产 ID 关联、没有 projectId，
        // 需按即将删除的资产单独清理，否则会遗留指向已删资产的孤儿关系并继续占用拓扑/流量运行时状态。
        if (projectAssetIds.size) {
          const beforeRelations = (db.assetRelations || []).length;
          const removedRelationIds = (db.assetRelations || [])
            .filter(item => projectAssetIds.has(item.sourceAssetId) || projectAssetIds.has(item.targetAssetId))
            .map(item => item.id);
          db.assetRelations = (db.assetRelations || []).filter(item => !projectAssetIds.has(item.sourceAssetId) && !projectAssetIds.has(item.targetAssetId));
          const removedRelations = beforeRelations - db.assetRelations.length;
          if (removedRelations > 0) removedCounts.assetRelations = removedRelations;
          removedRelationIds.forEach(invalidateRelationRuntimeState);
          projectAssetIds.forEach(invalidateAssetRuntimeState);
        }
        // 项目和人员归属强相关，强制删除项目时同步清理其人员及会话，避免遗留无归属账号。
        if (removedUserIds.length) {
          db.users = (db.users || []).filter(item => !removedUserIds.includes(item.id));
          db.sessions = (db.sessions || []).filter(item => !removedUserIds.includes(item.userId));
        }
        const index = db.projects.findIndex(item => item.id === projectId);
        if (index === -1) return json(res, 404, { message: '项目不存在' });
        const removedProject = db.projects.splice(index, 1)[0];
        if (db.topologyLayouts && db.topologyLayouts.positions && typeof db.topologyLayouts.positions === 'object') {
          delete db.topologyLayouts.positions[projectId];
        }
        const summary = Object.entries(removedCounts).map(([key, count]) => `${key}:${count}`).join(', ') || '无关联数据';
        appendAuditLog(db, user, 'delete', 'project', projectId, `管理员强制删除项目 ${removedProject.name || projectId}（级联清理 ${summary}）`, projectId);
        await writeDb(db, { replaceCollections: ['sessions'] });
        // 资料附件存放在磁盘，落库成功后一并清理对应目录，避免残留不可达附件占用空间。
        for (const docId of projectDocumentIds) {
          try { fs.rmSync(path.join(documentsUploadDir, docId), { recursive: true, force: true }); } catch (_) {}
        }
        return json(res, 200, { ok: true, forced: true, removed: removedCounts });
      }
      const relationNames = projectRelationCollections.filter(key => (db[key] || []).some(item => item.projectId === projectId));
      if ((db.users || []).some(item => userHasProject(item, projectId))) relationNames.unshift('users');
      if (relationNames.length) {
        return json(res, 400, { message: `该项目存在关联数据(${relationNames.join(', ')})，请先清理后再删除` });
      }
      const index = db.projects.findIndex(item => item.id === projectId);
      if (index === -1) {
        return json(res, 404, { message: '项目不存在' });
      }
      db.projects.splice(index, 1);
      // 拓扑布局按 projectId 存放，删除项目时同步清理，避免残留陈旧布局。
      if (db.topologyLayouts && db.topologyLayouts.positions && typeof db.topologyLayouts.positions === 'object') {
        delete db.topologyLayouts.positions[projectId];
      }
      appendAuditLog(db, user, 'delete', 'project', projectId, '删除项目', projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/users') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = user.role === 'admin'
        ? db.users.map(item => sanitizeUserForViewer(item, user))
        : userProjectIds(user).length
          ? db.users.filter(item => userProjectIds(user).some(projectId => userHasProject(item, projectId))).map(item => sanitizeUserForViewer(item, user))
          : [];
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/users') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!body.password) {
        return json(res, 400, { message: '创建人员时必须填写密码' });
      }
      if (String(body.password).length < 8) {
        return json(res, 400, { message: '密码长度不能少于 8 位' });
      }
      if (!/[a-zA-Z]/.test(body.password) || !/[0-9]/.test(body.password) || !/[^a-zA-Z0-9]/.test(body.password)) {
        return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
      }
      if (!allowedUserRoles.includes(body.role)) {
        return json(res, 400, { message: '请选择有效的账号角色' });
      }
      const username = String(body.username ?? '').trim();
      if (!username) {
        return json(res, 400, { message: '请输入账号' });
      }
      if (username.length > 64) {
        return json(res, 400, { message: '账号长度不能超过 64 位' });
      }
      if (isReservedUsername(username)) {
        return json(res, 400, { message: '该账号前缀为系统保留，请更换账号' });
      }
      const name = String(body.name ?? '').trim();
      if (!name) {
        return json(res, 400, { message: '请输入姓名' });
      }
      const userLengthError = checkTextLength(name, 64, '姓名')
        || checkTextLength(body.phone, 32, '电话')
        || checkTextLength(body.idCard, 32, '身份证号')
        || checkTextLength(body.email, 128, '邮箱')
        || checkTextLength(body.wechat, 64, '微信');
      if (userLengthError) return json(res, 400, { message: userLengthError });
      // 用户名唯一性检查与写入放入同一临界区，避免并发创建出重复账号。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        if ((lockDb.users || []).some(item => item.username === username)) {
          return { status: 400, message: '账号已存在' };
        }
        const projectSelection = normalizeUserProjectSelection(lockDb, body.projectId, body.projectIds);
        if (projectSelection.error) return { status: 400, message: projectSelection.error };
        const created = {
          id: id('user'),
          username,
          passwordHash: hash(body.password),
          role: body.role,
          name,
          phone: body.phone || '',
          idCard: body.idCard || '',
          email: body.email || '',
          wechat: body.wechat || '',
          projectId: projectSelection.projectId,
          projectIds: projectSelection.projectIds,
          startDate: body.startDate || '',
          endDate: body.endDate || '',
          status: 'active',
          createdAt: now()
        };
        created.securityQuestion = String(body.securityQuestion || '').trim();
        created.securityAnswerHash = body.securityAnswer ? hash(body.securityAnswer) : '';
        created.twoFactorEnforced = body.twoFactorEnforced === true;
        lockDb.users.push(created);
        appendAuditLog(lockDb, user, 'create', 'user', created.id, `创建人员 ${created.name}`, created.projectId);
        await writeDb(lockDb);
        return { status: 201, item: sanitizeUser(created) };
      });
      if (!outcome.item) return json(res, outcome.status, { message: outcome.message });
      return json(res, 201, outcome.item);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/users/') && pathname.endsWith('/reset-2fa')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      if (target.role === 'admin' && user.id !== target.id) {
        return json(res, 403, { message: '不能重置其他管理员账号的动态令牌' });
      }
      if (!target.twoFactorEnabled) {
        return json(res, 400, { message: '该账号未启用动态令牌' });
      }
      const body = await readBody(req);
      if (!verifyAdminStepUp(user, body.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      clearTwoFactorFields(target);
      appendAuditLog(db, user, 'update', 'user', target.id, `重置动态令牌 ${target.name}`, target.projectId);
      await writeDb(db);
      return json(res, 200, {
        message: target.twoFactorEnforced
          ? '动态令牌已重置，该账号下次登录后需重新绑定'
          : '动态令牌已重置，该账号下次登录无需动态码'
      });
    }

    if (req.method === 'PUT' && pathname.endsWith('/approve') && pathname.startsWith('/api/users/')) {
      const approver = requireAdmin(req, res, db);
      if (!approver) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      if (target.status !== 'pending') {
        return json(res, 400, { message: '该账号无需审批' });
      }
      const body = await readBody(req);
      const nextRole = String(body.role || 'viewer').trim();
      if (!allowedUserRoles.includes(nextRole)) {
        return json(res, 400, { message: '无效的角色' });
      }
      if (!body.projectId || !requireExistingProject(body.projectId, db)) {
        return json(res, 400, { message: '审批通过前必须指定有效项目' });
      }
      target.role = nextRole;
      const projectSelection = normalizeUserProjectSelection(db, body.projectId, body.projectIds);
      if (projectSelection.error) return json(res, 400, { message: projectSelection.error });
      target.projectId = projectSelection.projectId;
      target.projectIds = projectSelection.projectIds;
      target.status = 'active';
      appendAuditLog(db, approver, 'update', 'user', target.id, `审批通过账号 ${target.name}，角色 ${nextRole}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { message: '已审批通过', user: sanitizeUser(target) });
    }

    if (req.method === 'PUT' && pathname.endsWith('/reject') && pathname.startsWith('/api/users/')) {
      const approver = requireAdmin(req, res, db);
      if (!approver) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      if (target.status !== 'pending') {
        return json(res, 400, { message: '该账号无需审批' });
      }
      target.status = 'rejected';
      db.sessions = (db.sessions || []).filter(item => item.userId !== target.id);
      appendAuditLog(db, approver, 'update', 'user', target.id, `拒绝自注册账号 ${target.name}`, target.projectId);
      await writeDb(db, { replaceCollections: ['sessions'] });
      closeUserWebSockets(target.id);
      return json(res, 200, { message: '已拒绝该注册申请', user: sanitizeUser(target) });
    }

    // 已拒绝账号此前是终态，误操作后无法纠正；允许管理员恢复为待审批或直接启用。
    if (req.method === 'PUT' && pathname.endsWith('/restore') && pathname.startsWith('/api/users/')) {
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      if (target.status !== 'rejected') {
        return json(res, 400, { message: '仅已拒绝的账号需要恢复' });
      }
      const body = await readBody(req);
      const nextStatus = body.status === undefined ? 'pending' : String(body.status);
      if (nextStatus !== 'pending' && nextStatus !== 'active') {
        return json(res, 400, { message: '恢复状态只能为待审批或启用' });
      }
      if (nextStatus === 'active') {
        const nextRole = body.role === undefined ? target.role : String(body.role);
        if (!allowedUserRoles.includes(nextRole)) {
          return json(res, 400, { message: '无效的角色' });
        }
        if (!body.projectId || !requireExistingProject(String(body.projectId), db)) {
          return json(res, 400, { message: '启用前必须指定有效项目' });
        }
        target.role = nextRole;
        target.projectId = String(body.projectId);
      }
      target.status = nextStatus;
      appendAuditLog(db, admin, 'update', 'user', target.id, `恢复已拒绝账号 ${target.name} 为${nextStatus === 'active' ? '启用' : '待审批'}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { message: nextStatus === 'active' ? '账号已启用' : '账号已恢复为待审批', user: sanitizeUser(target) });
    }

    if (req.method === 'PUT' && pathname.endsWith('/disable') && pathname.startsWith('/api/users/')) {
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      // 仅允许在 active <-> disabled 之间切换，避免 pending/rejected 通过禁用再启用绕过审批。
      if (target.status !== 'active') {
        return json(res, 400, { message: '仅启用状态的账号可以禁用' });
      }
      if (target.role === 'admin' && admin.id !== target.id) {
        return json(res, 403, { message: '不能禁用其他管理员账号' });
      }
      if (target.role === 'admin' && countActiveAdminsExcluding(db, target.id) === 0) {
        return json(res, 400, { message: '系统必须保留至少一个启用状态的管理员' });
      }
      target.status = 'disabled';
      db.sessions = (db.sessions || []).filter(item => item.userId !== target.id);
      appendAuditLog(db, admin, 'update', 'user', target.id, `禁用账号 ${target.name}`, target.projectId);
      await writeDb(db, { replaceCollections: ['sessions'] });
      closeUserWebSockets(target.id);
      return json(res, 200, { message: '账号已禁用', user: sanitizeUser(target) });
    }

    if (req.method === 'PUT' && pathname.endsWith('/enable') && pathname.startsWith('/api/users/')) {
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      if (target.status !== 'disabled') {
        return json(res, 400, { message: '该账号未被禁用' });
      }
      target.status = 'active';
      appendAuditLog(db, admin, 'update', 'user', target.id, `启用账号 ${target.name}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { message: '账号已启用', user: sanitizeUser(target) });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/users/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      // 与 /disable、删除等管理操作保持一致：不允许通过通用更新接口修改其他管理员账号
      // （否则可先降级再禁用，绕过禁用接口的保护）。
      if (target.role === 'admin' && user.id !== target.id) {
        return json(res, 403, { message: '不能修改其他管理员账号' });
      }
      const body = await readBody(req);
      // 未提交的字段保持原值，避免局部更新（如仅改密码）静默清空手机号、项目等资料。
      const nextUsername = body.username !== undefined ? String(body.username).trim() : target.username;
      if (!nextUsername) {
        return json(res, 400, { message: '请输入账号' });
      }
      if (nextUsername.length > 64) {
        return json(res, 400, { message: '账号长度不能超过 64 位' });
      }
      if (nextUsername !== target.username && isReservedUsername(nextUsername)) {
        return json(res, 400, { message: '该账号前缀为系统保留，请更换账号' });
      }
      if (db.users.some(item => item.username === nextUsername && item.id !== targetUserId)) {
        return json(res, 400, { message: '账号已存在' });
      }
      if (body.name !== undefined && !String(body.name || '').trim()) {
        return json(res, 400, { message: '请输入姓名' });
      }
      const userLengthError = checkTextLength(body.name, 64, '姓名')
        || checkTextLength(body.phone, 32, '电话')
        || checkTextLength(body.idCard, 32, '身份证号')
        || checkTextLength(body.email, 128, '邮箱')
        || checkTextLength(body.wechat, 64, '微信');
      if (userLengthError) return json(res, 400, { message: userLengthError });
      const nextRole = body.role !== undefined ? String(body.role) : target.role;
      if (body.role !== undefined && !allowedUserRoles.includes(nextRole)) {
        return json(res, 400, { message: '无效的角色' });
      }
      if (target.role === 'admin' && nextRole !== 'admin' && countActiveAdminsExcluding(db, target.id) === 0) {
        return json(res, 400, { message: '系统必须保留至少一个启用状态的管理员' });
      }
      const nextProjectId = body.projectId !== undefined ? String(body.projectId || '') : (target.projectId || '');
      const projectSelection = normalizeUserProjectSelection(
        db,
        nextProjectId,
        body.projectIds !== undefined ? body.projectIds : target.projectIds
      );
      if (projectSelection.error) return json(res, 400, { message: projectSelection.error });
      const projectSetChanged = projectSelection.projectIds.join('\u0000') !== userProjectIds(target).join('\u0000');
      const roleOrProjectChanged = nextRole !== target.role || projectSetChanged;
      target.username = nextUsername;
      target.role = nextRole;
      target.name = body.name !== undefined ? String(body.name).trim() : target.name;
      target.phone = body.phone !== undefined ? String(body.phone || '') : (target.phone || '');
      target.idCard = body.idCard !== undefined ? String(body.idCard || '') : (target.idCard || '');
      target.email = body.email !== undefined ? String(body.email || '') : (target.email || '');
      target.wechat = body.wechat !== undefined ? String(body.wechat || '') : (target.wechat || '');
      target.projectId = projectSelection.projectId;
      target.projectIds = projectSelection.projectIds;
      target.startDate = body.startDate !== undefined ? String(body.startDate || '') : (target.startDate || '');
      target.endDate = body.endDate !== undefined ? String(body.endDate || '') : (target.endDate || '');
      if (body.securityQuestion !== undefined) {
        target.securityQuestion = String(body.securityQuestion || '').trim();
      }
      if (body.securityAnswer) {
        target.securityAnswerHash = hash(body.securityAnswer);
      }
      if (body.twoFactorEnforced !== undefined) {
        target.twoFactorEnforced = body.twoFactorEnforced === true;
        if (target.twoFactorEnforced) {
          appendAuditLog(db, user, 'update', 'user', target.id, `要求 ${target.name} 启用动态令牌`, target.projectId);
        }
      }
      if (body.password) {
        if (String(body.password).length < 8) {
          return json(res, 400, { message: '密码长度不能少于 8 位' });
        }
        if (!/[a-zA-Z]/.test(body.password) || !/[0-9]/.test(body.password) || !/[^a-zA-Z0-9]/.test(body.password)) {
          return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
        }
        target.passwordHash = hash(body.password);
      }
      appendAuditLog(db, user, 'update', 'user', target.id, `修改人员 ${target.name}`, target.projectId);
      if (body.password || roleOrProjectChanged) {
        db.sessions = (db.sessions || []).filter(item => item.userId !== target.id);
        await writeDb(db, { replaceCollections: ['sessions'] });
        closeUserWebSockets(target.id);
      } else {
        await writeDb(db);
      }
      return json(res, 200, sanitizeUserForViewer(target, user));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/users/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const targetUserId = pathname.split('/')[3];
      if (user.id === targetUserId) {
        return json(res, 400, { message: '当前登录账号不能删除自己' });
      }
      // 删除人员前阻断所有引用该用户的数据，避免产生孤儿引用。
      const userRelationChecks = [
        ['合同', (db.contracts || []), ['createdBy']],
        ['合同结算', (db.contractSettlements || []), ['createdBy']],
        ['日志', (db.logs || []), ['userId']],
        ['知识库', (db.knowledgeBase || []), ['createdBy']],
        ['资产', (db.assets || []), ['createdBy']],
        ['资产履历', (db.assetLifecycles || []), ['operatorId']],
        ['资产借还', (db.assetCheckouts || []), ['borrowerId', 'operatorId']],
        ['资产盘点', (db.assetInventoryTasks || []), ['createdBy']],
        ['监控告警', (db.monitorAlerts || []), ['acknowledgedBy', 'silencedBy']],
        ['维护窗口', (db.monitorMaintenanceWindows || []), ['createdBy']],
        ['工作汇报', (db.workReports || []), ['userId', 'reviewedBy']],
        ['巡检计划', (db.inspectionPlans || []), ['createdBy']],
        ['巡检执行', (db.inspectionExecutions || []), ['createdBy']],
        ['资料', (db.documents || []), ['createdBy']],
        ['变更记录', (db.changeRecords || []), ['createdBy', 'approverId', 'customerId']],
        ['故障记录', (db.incidentRecords || []), ['createdBy']],
        ['审批记录', (db.approvals || []), ['requestedBy', 'approvedBy', 'approverId', 'customerId']],
        ['备件流水', (db.sparePartMovements || []), ['operatorId']],
        ['备件采购', (db.sparePartPurchases || []), ['applicantId', 'approverId', 'createdBy']],
        ['备件盘点', (db.sparePartInventoryTasks || []), ['createdBy']],
        ['巡检对象', (db.aiInspectionTargets || []), ['createdBy']],
        ['巡检模板', (db.aiInspectionTemplates || []), ['createdBy']],
        ['巡检任务', (db.aiInspectionTasks || []), ['createdBy']],
        ['配置备份计划', (db.configBackupPlans || []), ['createdBy']],
        ['配置备份记录', (db.configBackupRecords || []), ['createdBy']]
      ];
      const blockingRelations = userRelationChecks
        .filter(([, list, fields]) => list.some(item => fields.some(field => item[field] === targetUserId)))
        .map(([label]) => label);
      const hasRelations = blockingRelations.length > 0;
      if (hasRelations) {
        return json(res, 400, { message: `该人员已关联数据(${blockingRelations.join('、')})，暂时不能删除` });
      }
      const index = db.users.findIndex(item => item.id === targetUserId);
      if (index === -1) {
        return json(res, 404, { message: '人员不存在' });
      }
      const removedUser = db.users[index];
      db.users.splice(index, 1);
      db.sessions = (db.sessions || []).filter(item => item.userId !== targetUserId);
      // 清理通知里按用户 id 存储的已读/隐藏映射，避免删除账号后残留永不会被使用的孤儿键。
      for (const notification of db.notifications || []) {
        let notificationChanged = false;
        for (const field of ['readBy', 'hiddenBy']) {
          const map = notification[field];
          if (map && typeof map === 'object' && map[targetUserId] !== undefined) {
            delete map[targetUserId];
            notificationChanged = true;
          }
        }
        if (notificationChanged) notification._dirty = true;
      }
      appendAuditLog(db, user, 'delete', 'user', targetUserId, `删除人员 ${removedUser.name || targetUserId}`, removedUser.projectId || '');
      await writeDb(db, { replaceCollections: ['sessions', 'notifications'] });
      closeUserWebSockets(targetUserId);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/assets') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.assets, user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted.map(item => sanitizeAssetForApi(item, user)), query, user));
    }

    // 资产全生命周期流水：创建、状态变更、调拨、借还、报废退役、盘点均可追溯。
    if (req.method === 'GET' && pathname === '/api/asset-lifecycles') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.assetLifecycles || [], user, item => item.projectId);
      if (query.assetId) list = list.filter(item => item.assetId === query.assetId);
      if (query.action) list = list.filter(item => item.action === query.action);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'GET' && pathname === '/api/asset-checkouts') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.assetCheckouts || [], user, item => item.projectId);
      if (query.assetId) list = list.filter(item => item.assetId === query.assetId);
      if (query.status) list = list.filter(item => item.status === query.status);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    // 借出登记：资产状态同步为「借出」，归还后恢复为「使用中」。
    if (req.method === 'POST' && pathname === '/api/asset-checkouts') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const asset = (db.assets || []).find(item => item.id === String(body.assetId || ''));
      if (!asset) return json(res, 404, { message: '资产不存在' });
      if (!canManageAssetProject(user, asset)) return json(res, 403, { message: '无权操作该资产' });
      if (['已报废', '已退役'].includes(normalizeAssetStatus(asset.status))) {
        return json(res, 400, { message: '已报废或已退役的资产不能借出' });
      }
      if ((db.assetCheckouts || []).some(item => item.assetId === asset.id && item.status === 'checked_out')) {
        return json(res, 400, { message: '该资产已借出，请先归还' });
      }
      const borrowerId = String(body.borrowerId || '').trim();
      const borrower = borrowerId ? requireExistingUser(borrowerId, db) : null;
      if (borrowerId && !borrower) return json(res, 400, { message: '借用人不存在' });
      const borrowerName = borrower ? borrower.name : String(body.borrowerName || '').trim();
      if (!borrowerName) return json(res, 400, { message: '请填写借用人' });
      const purposeError = checkTextLength(body.purpose, 200, '借用用途');
      if (purposeError) return json(res, 400, { message: purposeError });
      const dueAt = String(body.dueAt || '').trim();
      if (dueAt && !parseDateOnly(dueAt)) return json(res, 400, { message: '预计归还日期格式无效' });
      const record = {
        id: id('assetCheckout'),
        projectId: asset.projectId,
        assetId: asset.id,
        borrowerId: borrower ? borrower.id : '',
        borrowerName,
        quantity: 1,
        purpose: String(body.purpose || '').trim(),
        checkoutAt: now(),
        dueAt,
        returnedAt: '',
        returnCondition: '',
        status: 'checked_out',
        operatorId: user.id,
        operatorName: user.name || user.username || '',
        createdAt: now()
      };
      db.assetCheckouts = db.assetCheckouts || [];
      db.assetCheckouts.push(record);
      const previousStatus = normalizeAssetStatus(asset.status);
      asset.status = '借出';
      appendAssetLifecycle(db, asset, 'checkout', user, `借出给 ${borrowerName}${dueAt ? `，预计 ${dueAt} 归还` : ''}`, {
        fromStatus: previousStatus,
        toStatus: '借出'
      });
      appendAuditLog(db, user, 'checkout', 'asset', asset.id, `借出资产 ${asset.name} 给 ${borrowerName}`, asset.projectId);
      await writeDb(db);
      return json(res, 201, record);
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/asset-checkouts\/[^/]+\/return$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const checkoutId = pathname.split('/')[3];
      const record = (db.assetCheckouts || []).find(item => item.id === checkoutId);
      if (!record) return json(res, 404, { message: '借出记录不存在' });
      if (!canViewProject(user, record.projectId)) return json(res, 403, { message: '无权操作该记录' });
      if (record.status === 'returned') return json(res, 400, { message: '该资产已归还' });
      const body = await readBody(req);
      record.status = 'returned';
      record.returnedAt = now();
      record.returnCondition = String(body.condition || '').trim();
      const asset = (db.assets || []).find(item => item.id === record.assetId);
      if (asset && normalizeAssetStatus(asset.status) === '借出') {
        asset.status = '使用中';
        appendAssetLifecycle(db, asset, 'return', user, `由 ${record.borrowerName} 归还${record.returnCondition ? `，状况：${record.returnCondition}` : ''}`, {
          fromStatus: '借出',
          toStatus: '使用中'
        });
      }
      appendAuditLog(db, user, 'return', 'asset', record.assetId, `资产归还 ${record.borrowerName}`, record.projectId);
      await writeDb(db);
      return json(res, 200, record);
    }

    if (req.method === 'GET' && pathname === '/api/asset-inventory-tasks') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      const list = filterByProjectScope(db.assetInventoryTasks || [], user, item => item.projectId);
      if (query.status) list = list.filter(item => item.status === query.status);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    // 创建盘点任务时冻结当前资产快照，盘点差异始终基于任务创建时的状态。
    if (req.method === 'POST' && pathname === '/api/asset-inventory-tasks') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!projectId || !requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { message: '盘点任务名称不能为空' });
      const nameError = checkTextLength(name, 100, '盘点任务名称');
      if (nameError) return json(res, 400, { message: nameError });
      const assets = (db.assets || []).filter(item => item.projectId === projectId && !['已报废', '已退役'].includes(normalizeAssetStatus(item.status)));
      if (!assets.length) return json(res, 400, { message: '该项目暂无可盘点资产' });
      const task = {
        id: id('assetInv'),
        projectId,
        name,
        status: 'pending',
        createdBy: user.id,
        createdByName: user.name || user.username || '',
        startedAt: '',
        completedAt: '',
        items: assets.map(asset => ({
          assetId: asset.id,
          assetName: asset.name || '',
          expectedStatus: normalizeAssetStatus(asset.status),
          actualStatus: '',
          location: asset.installationLocation || '',
          result: '',
          note: '',
          checkedAt: ''
        })),
        createdAt: now()
      };
      db.assetInventoryTasks = db.assetInventoryTasks || [];
      db.assetInventoryTasks.push(task);
      appendAuditLog(db, user, 'create', 'assetInventory', task.id, `创建盘点任务 ${name}（${task.items.length} 项）`, projectId);
      await writeDb(db);
      return json(res, 201, task);
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/asset-inventory-tasks\/[^/]+\/start$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const taskId = pathname.split('/')[3];
      const task = (db.assetInventoryTasks || []).find(item => item.id === taskId);
      if (!task) return json(res, 404, { message: '盘点任务不存在' });
      if (!canViewProject(user, task.projectId)) return json(res, 403, { message: '无权操作该盘点任务' });
      if (task.status !== 'pending') return json(res, 400, { message: '仅待开始的任务可以启动' });
      task.status = 'running';
      task.startedAt = now();
      appendAuditLog(db, user, 'update', 'assetInventory', task.id, `开始盘点任务 ${task.name}`, task.projectId);
      await writeDb(db);
      return json(res, 200, task);
    }

    // 逐项登记盘点结果：状态或位置与快照不一致记为 mismatch，缺失记为 missing。
    if (req.method === 'POST' && pathname.match(/^\/api\/asset-inventory-tasks\/[^/]+\/items$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const taskId = pathname.split('/')[3];
      const task = (db.assetInventoryTasks || []).find(item => item.id === taskId);
      if (!task) return json(res, 404, { message: '盘点任务不存在' });
      if (!canViewProject(user, task.projectId)) return json(res, 403, { message: '无权操作该盘点任务' });
      if (task.status === 'completed') return json(res, 400, { message: '盘点任务已完成' });
      const body = await readBody(req);
      const entries = Array.isArray(body.items) ? body.items : [];
      if (!entries.length) return json(res, 400, { message: '请提交盘点结果' });
      const itemMap = new Map(task.items.map(item => [item.assetId, item]));
      for (const entry of entries) {
        const assetId = String(entry && entry.assetId || '');
        const item = itemMap.get(assetId);
        if (!item) continue;
        const actualStatus = entry.missing === true ? '缺失' : normalizeAssetStatus(entry.actualStatus || item.expectedStatus);
        const location = String(entry.location !== undefined ? entry.location : item.location) ?? '';
        const statusMismatch = actualStatus !== item.expectedStatus;
        const locationMismatch = String(location || '') !== String(item.location || '');
        item.actualStatus = actualStatus;
        item.location = location;
        item.note = String(entry.note || '').slice(0, 200);
        item.checkedAt = now();
        item.result = entry.missing === true
          ? 'missing'
          : (statusMismatch || locationMismatch ? 'mismatch' : 'match');
      }
      if (task.status === 'pending') {
        task.status = 'running';
        task.startedAt = task.startedAt || now();
      }
      await writeDb(db);
      return json(res, 200, task);
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/asset-inventory-tasks\/[^/]+\/complete$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const taskId = pathname.split('/')[3];
      const task = (db.assetInventoryTasks || []).find(item => item.id === taskId);
      if (!task) return json(res, 404, { message: '盘点任务不存在' });
      if (!canViewProject(user, task.projectId)) return json(res, 403, { message: '无权操作该盘点任务' });
      if (task.status === 'completed') return json(res, 400, { message: '盘点任务已完成' });
      const unchecked = task.items.filter(item => !item.checkedAt).length;
      if (unchecked) return json(res, 400, { message: `还有 ${unchecked} 项未盘点` });
      task.status = 'completed';
      task.completedAt = now();
      const diff = task.items.filter(item => item.result !== 'match').length;
      appendAuditLog(db, user, 'update', 'assetInventory', task.id, `完成盘点任务 ${task.name}（差异 ${diff} 项）`, task.projectId);
      await writeDb(db);
      return json(res, 200, task);
    }

    // 调拨：跨项目变更归属，同步资产关联关系与生命周期流水。
    if (req.method === 'POST' && pathname.match(/^\/api\/assets\/[^/]+\/transfer$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const assetId = pathname.split('/')[3];
      const asset = (db.assets || []).find(item => item.id === assetId);
      if (!asset) return json(res, 404, { message: '资产不存在' });
      if (!canManageAssetProject(user, asset)) return json(res, 403, { message: '无权操作该资产' });
      const body = await readBody(req);
      const toProjectId = String(body.projectId || '').trim();
      if (!requireExistingProject(toProjectId, db)) return json(res, 400, { message: '目标项目不存在' });
      if (user.role !== 'admin') return json(res, 403, { message: '仅管理员可跨项目调拨' });
      if (toProjectId === asset.projectId) return json(res, 400, { message: '资产已在该项目下' });
      const reasonError = checkTextLength(body.reason, 200, '调拨原因');
      if (reasonError) return json(res, 400, { message: reasonError });
      const fromProjectId = asset.projectId;
      asset.projectId = toProjectId;
      // 资产履历与借还记录跟随资产归属，调拨后新项目仍可追溯完整历史。
      (db.assetLifecycles || []).forEach(item => {
        if (item.assetId === asset.id) item.projectId = toProjectId;
      });
      (db.assetCheckouts || []).forEach(item => {
        if (item.assetId === asset.id) item.projectId = toProjectId;
      });
      appendAssetLifecycle(db, asset, 'transfer', user, `从项目调拨至目标项目${body.reason ? `：${body.reason}` : ''}`, {
        fromProjectId,
        toProjectId
      });
      appendAuditLog(db, user, 'transfer', 'asset', asset.id, `调拨资产 ${asset.name}`, toProjectId);
      await writeDb(db);
      return json(res, 200, sanitizeAssetForApi(asset, user));
    }

    // 报废 / 退役：终态资产停止监控，并记录原因。
    if (req.method === 'POST' && pathname.match(/^\/api\/assets\/[^/]+\/(retire|scrap)$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const parts = pathname.split('/');
      const assetId = parts[3];
      const action = parts[4] === 'scrap' ? 'scrap' : 'retire';
      const asset = (db.assets || []).find(item => item.id === assetId);
      if (!asset) return json(res, 404, { message: '资产不存在' });
      if (!canManageAssetProject(user, asset)) return json(res, 403, { message: '无权操作该资产' });
      if (user.role !== 'admin') return json(res, 403, { message: '仅管理员可执行报废或退役' });
      const activeCheckout = (db.assetCheckouts || []).find(item => item.assetId === assetId && item.status === 'checked_out');
      if (activeCheckout) return json(res, 400, { message: '资产仍在借出中，请先归还' });
      const body = await readBody(req);
      const reason = String(body.reason || '').trim();
      if (!reason) return json(res, 400, { message: '请填写报废或退役原因' });
      const reasonError = checkTextLength(reason, 200, '原因');
      if (reasonError) return json(res, 400, { message: reasonError });
      const previousStatus = normalizeAssetStatus(asset.status);
      asset.status = action === 'scrap' ? '已报废' : '已退役';
      asset.retiredAt = now();
      asset.retiredReason = reason;
      asset.monitorEnabled = false;
      invalidateAssetRuntimeState(asset.id);
      appendAssetLifecycle(db, asset, action, user, reason, { fromStatus: previousStatus, toStatus: asset.status });
      appendAuditLog(db, user, action, 'asset', asset.id, `${action === 'scrap' ? '报废' : '退役'}资产 ${asset.name}：${reason}`, asset.projectId);
      await writeDb(db);
      return json(res, 200, sanitizeAssetForApi(asset, user));
    }

    if (req.method === 'POST' && pathname === '/api/assets/cabinet-layout/relocate') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (!updates.length) return json(res, 400, { message: '请至少选择一台设备' });
      if (updates.length > ASSET_IMPORT_MAX_ROWS) return json(res, 400, { message: `单次最多调整 ${ASSET_IMPORT_MAX_ROWS} 台设备` });
      const seenAssetIds = new Set();
      const targetIds = [];
      for (const update of updates) {
        const assetId = String(update && update.assetId || '');
        if (!assetId || seenAssetIds.has(assetId)) continue;
        seenAssetIds.add(assetId);
        targetIds.push(assetId);
      }
      if (!targetIds.length) return json(res, 400, { message: '请至少选择一台设备' });
      const cabinetName = String(body.cabinetName || '').trim();
      if (!cabinetName) return json(res, 400, { message: '机柜名称不能为空' });
      const startRaw = body.rackUnitStart;
      const hasStart = startRaw !== undefined && startRaw !== null && String(startRaw).trim() !== '';
      let nextStart = hasStart ? parseOptionalRackUnit(startRaw, '起始U位') : null;
      if (nextStart && nextStart.error) return json(res, 400, { message: nextStart.error });
      nextStart = nextStart ? nextStart.value : null;
      // 先做完整校验再写入，避免部分设备已改、部分失败。
      const planned = [];
      for (const assetId of targetIds) {
        const asset = (db.assets || []).find(item => item.id === assetId);
        if (!asset) return json(res, 400, { message: '存在无效的资产，请刷新后重试' });
        if (user.role !== 'admin' && !userHasProject(user, asset.projectId)) return json(res, 403, { message: '无权调整该资产' });
        const entry = { asset };
        if (nextStart !== null) {
          const size = Number.isInteger(asset.rackUnitSize) && asset.rackUnitSize > 0 ? asset.rackUnitSize : 1;
          if (nextStart + size - 1 > RACK_UNIT_MAX) {
            return json(res, 400, { message: `剩余槽位不足：${asset.name || '设备'} 需要 ${size}U，无法排到 ${RACK_UNIT_MAX}U 以内` });
          }
          entry.rackUnitStart = nextStart;
          entry.rackUnitSize = size;
          nextStart += size;
        }
        planned.push(entry);
      }
      // 显式指定起始 U 位时，若与目标机柜已有设备冲突则阻断，避免静默覆盖；可通过 allowOverlap 显式忽略。
      if (hasStart) {
        const movingIds = new Set(planned.map(entry => entry.asset.id));
        const requested = new Map();
        for (const entry of planned) {
          if (entry.rackUnitStart === undefined) continue;
          const key = `${entry.asset.projectId || ''}\u0000${cabinetName}`;
          const ranges = requested.get(key) || [];
          ranges.push([entry.rackUnitStart, entry.rackUnitStart + entry.rackUnitSize - 1]);
          requested.set(key, ranges);
        }
        for (const [key, ranges] of requested) {
          const [projectId] = key.split('\u0000');
          const conflicts = (db.assets || []).filter(item =>
            (item.projectId || '') === projectId
            && String(item.cabinetName || '').trim() === cabinetName
            && !movingIds.has(item.id)
            && Number.isInteger(item.rackUnitStart)
          ).filter(item => {
            const size = Number.isInteger(item.rackUnitSize) && item.rackUnitSize > 0 ? item.rackUnitSize : 1;
            const end = item.rackUnitStart + size - 1;
            return ranges.some(([start, stop]) => item.rackUnitStart <= stop && end >= start);
          });
          if (conflicts.length && body.allowOverlap !== true) {
            const names = conflicts.slice(0, 3).map(item => item.name || '设备').join('、');
            return json(res, 409, { message: `机柜「${cabinetName}」中 ${names} 已占用所选 U 位，可调整起始 U 位或勾选允许重叠后重试` });
          }
        }
      }
      for (const entry of planned) {
        entry.asset.cabinetName = cabinetName;
        if (entry.rackUnitStart !== undefined) {
          entry.asset.rackUnitStart = entry.rackUnitStart;
          entry.asset.rackUnitSize = entry.rackUnitSize;
        }
      }
      // 管理员可跨项目归位，审计归属取设备实际所属项目；混合项目时留空，避免错误记到操作者项目。
      const plannedProjectIds = [...new Set(planned.map(entry => entry.asset.projectId).filter(Boolean))];
      appendAuditLog(db, user, 'update', 'asset', '', `批量归位 ${planned.length} 台设备到 ${cabinetName}`, plannedProjectIds.length === 1 ? plannedProjectIds[0] : '');
      await writeDb(db);
      return json(res, 200, { ok: true, updated: planned.length });
    }

    if (req.method === 'POST' && pathname === '/api/assets') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!projectId || !requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const cabinetFields = readCabinetFields(body);
      if (cabinetFields.error) return json(res, 400, { message: cabinetFields.error });
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { message: '资产名称不能为空' });
      const assetLengthError = checkTextLength(name, 128, '资产名称')
        || checkTextLength(body.installationLocation, 128, '安装位置')
        || checkTextLength(body.brand, 64, '品牌')
        || checkTextLength(body.model, 64, '型号')
        || checkTextLength(body.serialNumber, 64, '序列号')
        || checkTextLength(body.owner, 64, '责任人')
        || checkTextLength(body.version, 32, '版本')
        || checkTextLength(body.notes, 4000, '备注');
      if (assetLengthError) return json(res, 400, { message: assetLengthError });
      const typeField = readAssetTypeField(body.type);
      if (typeField.error) return json(res, 400, { message: typeField.error });
      const type = typeField.type;
      const monitorFields = readMonitorFields(body);
      if (monitorFields.error) return json(res, 400, { message: monitorFields.error });
      if (monitorFields.monitorEnabled && monitorFields.monitorHost) {
        const gate = await resolveMonitorTargetAddress(monitorFields.monitorHost);
        if (!gate.ok) return json(res, 400, { message: gate.message });
      }
      const maintainField = normalizeAssetDateField(body.maintainExpiryDate, '维保到期日');
      if (maintainField.error) return json(res, 400, { message: maintainField.error });
      const item = {
        id: id('asset'),
        projectId,
        type,
        name,
        brand: body.brand || '',
        model: body.model || '',
        owner: body.owner || '',
        version: body.version || '',
        serialNumber: body.serialNumber || '',
        status: normalizeAssetStatus(body.status),
        maintainExpiryDate: maintainField.value,
        installationLocation: body.installationLocation || '',
        notes: body.notes || '',
        cabinetName: cabinetFields.cabinetName,
        rackUnitStart: cabinetFields.rackUnitStart,
        rackUnitSize: cabinetFields.rackUnitSize,
        monitorEnabled: monitorFields.monitorEnabled,
        monitorType: monitorFields.monitorType,
        monitorHost: monitorFields.monitorHost,
        monitorPort: monitorFields.monitorPort,
        snmpCommunity: monitorFields.snmpCommunity,
        snmpPort: monitorFields.snmpPort,
        createdBy: user.id,
        createdAt: now()
      };
      db.assets.push(item);
      appendAssetLifecycle(db, item, 'create', user, '创建资产', { toStatus: item.status });
      appendAuditLog(db, user, 'create', 'asset', item.id, `创建资产 ${item.name}`, projectId);
      await writeDb(db);
      return json(res, 201, sanitizeAssetForApi(item, user));
    }

    if (req.method === 'POST' && pathname === '/api/assets/import') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const rows = Array.isArray(body.assets) ? body.assets : [];
      if (!rows.length) return json(res, 400, { message: '导入数据为空' });
      if (rows.length > ASSET_IMPORT_MAX_ROWS) return json(res, 400, { message: `单次最多导入 ${ASSET_IMPORT_MAX_ROWS} 条` });
      const results = { created: 0, skipped: 0, errors: [], warnings: [] };
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowLabel = `第${i + 2}行`;
        // Excel 数字单元格会被解析为 number，先做字符串归一化再 trim。
        const name = String(row.name ?? row['资产名称'] ?? '').trim();
        if (!name) { results.errors.push(`${rowLabel}: 资产名称为空`); results.skipped++; continue; }
        const importLengthError = checkTextLength(name, 128, '资产名称')
          || checkTextLength(row.installationLocation ?? row['安装位置'], 128, '安装位置')
          || checkTextLength(row.brand ?? row['品牌'], 64, '品牌')
          || checkTextLength(row.model ?? row['规格型号'], 64, '型号')
          || checkTextLength(row.serialNumber ?? row['序列号'], 64, '序列号')
          || checkTextLength(row.owner ?? row['责任人'] ?? row['责任人/部门'], 64, '责任人')
          || checkTextLength(row.version ?? row['版本'], 32, '版本')
          || checkTextLength(row.notes ?? row['备注'], 4000, '备注');
        if (importLengthError) { results.errors.push(`${rowLabel}: ${importLengthError}`); results.skipped++; continue; }
        const typeValue = String(row.type ?? row['资产类型'] ?? '').trim();
        if (!ASSET_TYPE_OPTIONS.includes(typeValue)) { results.errors.push(`${rowLabel}: 资产类型无效`); results.skipped++; continue; }
        let projectId = resolveWriteProjectId(user);
        const projectName = String(row.projectName ?? row['关联项目'] ?? '').trim();
        if (user.role === 'admin' && projectName) {
          const p = db.projects.find(prj => prj.name === projectName);
          if (p) {
            projectId = p.id;
          } else {
            const available = db.projects.map(prj => prj.name).join('、');
            results.warnings.push(`${rowLabel}: 项目"${projectName}"不存在，已归入默认项目。可用项目：${available || '无'}`);
          }
        }
        if (!db.projects.find(prj => prj.id === projectId)) { results.errors.push(`${rowLabel}: 关联项目不存在`); results.skipped++; continue; }
        const rawDate = row.maintainExpiryDate ?? row['维保到期日'];
        let maintainExpiryDate = '';
        if (rawDate != null && rawDate !== '') {
          if (typeof rawDate === 'number') {
            // Excel 序列号以 UTC 纪元计日，必须用 UTC 构造，否则非 UTC 时区会整体偏移一天。
            const d = new Date(Date.UTC(1899, 11, 30) + Math.round(rawDate) * 86400000);
            if (!Number.isNaN(d.getTime())) maintainExpiryDate = d.toISOString().slice(0, 10);
          } else {
            const str = String(rawDate).trim();
            const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
            if (m) {
              maintainExpiryDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
            } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(str)) {
              const parts = str.split(/[\/\-]/);
              maintainExpiryDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            }
          }
          // 维保日期非法时跳过该行，避免写入空日期或 2026-13-45 之类的无效值。
          if (!maintainExpiryDate || !parseDateOnly(maintainExpiryDate)) {
            results.errors.push(`${rowLabel}: 维保到期日格式无效"${String(rawDate).trim()}"，请使用YYYY-MM-DD格式`);
            results.skipped++;
            continue;
          }
        }
        const cabinetFields = readCabinetFields({
          cabinetName: row.cabinetName || row['机柜名称'] || '',
          rackUnitStart: row.rackUnitStart ?? row['起始U'] ?? row['起始U位'],
          rackUnitSize: row.rackUnitSize ?? row['占用U'] ?? row['占用U数']
        });
        if (cabinetFields.error) {
          results.errors.push(`${rowLabel}: ${cabinetFields.error}`);
          results.skipped++;
          continue;
        }
        const monitorFields = readImportedMonitorFields(row);
        if (monitorFields.error) {
          results.errors.push(`${rowLabel}: ${monitorFields.error}`);
          results.skipped++;
          continue;
        }
        if (monitorFields.monitorEnabled && monitorFields.monitorHost) {
          const gate = await resolveMonitorTargetAddress(monitorFields.monitorHost);
          if (!gate.ok) {
            results.errors.push(`${rowLabel}: ${gate.message}`);
            results.skipped++;
            continue;
          }
        }
        const item = {
          id: id('asset'),
          projectId,
          type: typeValue,
          name,
          brand: row.brand || row['品牌'] || '',
          model: row.model || row['规格型号'] || '',
          owner: row.owner || row['责任人'] || row['责任人/部门'] || '',
          version: row.version || row['版本'] || '',
          serialNumber: row.serialNumber || row['序列号'] || '',
          status: normalizeAssetStatus(row.status || row['状态'] || ''),
          maintainExpiryDate,
          installationLocation: row.installationLocation || row['安装位置'] || '',
          notes: row.notes || row['备注'] || '',
          cabinetName: cabinetFields.cabinetName,
          rackUnitStart: cabinetFields.rackUnitStart,
          rackUnitSize: cabinetFields.rackUnitSize,
          monitorEnabled: monitorFields.monitorEnabled,
          monitorType: monitorFields.monitorType,
          monitorHost: monitorFields.monitorHost,
          monitorPort: monitorFields.monitorPort,
          snmpCommunity: monitorFields.snmpCommunity,
          snmpPort: monitorFields.snmpPort,
          createdBy: user.id,
          createdAt: now()
        };
        db.assets.push(item);
        appendAssetLifecycle(db, item, 'create', user, '批量导入创建资产', { toStatus: item.status });
        results.created++;
      }
      appendAuditLog(db, user, 'import', 'asset', '', `批量导入资产 ${results.created} 条`, userProjectIds(user).length === 1 ? userProjectIds(user)[0] : '');
      await writeDb(db);
      return json(res, 200, results);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/assets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const assetId = parseAssetIdFromPath(pathname);
      const target = db.assets.find(item => item.id === assetId);
      if (!target) return json(res, 404, { message: '资产不存在' });
      if (user.role !== 'admin' && !userHasProject(user, target.projectId)) return json(res, 403, { message: '无权修改该资产' });
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? (body.projectId || target.projectId) : target.projectId;
      // 资产不允许跨项目迁移，否则引用它的备件/巡检/变更/故障/日志会留在原项目形成跨项目脏引用。
      if (user.role === 'admin' && body.projectId !== undefined && String(body.projectId) !== target.projectId) {
        return json(res, 400, { message: '不支持变更资产所属项目' });
      }
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const cabinetFields = readCabinetFields({
        cabinetName: body.cabinetName !== undefined ? body.cabinetName : target.cabinetName,
        rackUnitStart: body.rackUnitStart !== undefined ? body.rackUnitStart : target.rackUnitStart,
        rackUnitSize: body.rackUnitSize !== undefined ? body.rackUnitSize : target.rackUnitSize
      });
      if (cabinetFields.error) return json(res, 400, { message: cabinetFields.error });
      if (body.name !== undefined && !String(body.name || '').trim()) return json(res, 400, { message: '资产名称不能为空' });
      const typeField = readAssetTypeField(body.type !== undefined ? body.type : target.type);
      if (typeField.error) return json(res, 400, { message: typeField.error });
      const monitorFields = readMonitorFields(body, target);
      if (monitorFields.error) return json(res, 400, { message: monitorFields.error });
      if (monitorFields.monitorEnabled && monitorFields.monitorHost) {
        const gate = await resolveMonitorTargetAddress(monitorFields.monitorHost);
        if (!gate.ok) return json(res, 400, { message: gate.message });
      }
      let nextMaintainExpiryDate = target.maintainExpiryDate;
      if (body.maintainExpiryDate !== undefined) {
        const maintainField = normalizeAssetDateField(body.maintainExpiryDate, '维保到期日');
        if (maintainField.error) return json(res, 400, { message: maintainField.error });
        nextMaintainExpiryDate = maintainField.value;
      }
      const assetLengthError = checkTextLength(body.name, 128, '资产名称')
        || checkTextLength(body.installationLocation, 128, '安装位置')
        || checkTextLength(body.brand, 64, '品牌')
        || checkTextLength(body.model, 64, '型号')
        || checkTextLength(body.serialNumber, 64, '序列号')
        || checkTextLength(body.owner, 64, '责任人')
        || checkTextLength(body.version, 32, '版本')
        || checkTextLength(body.notes, 4000, '备注');
      if (assetLengthError) return json(res, 400, { message: assetLengthError });
      const monitorChanged = ['monitorEnabled', 'monitorType', 'monitorHost', 'monitorPort', 'snmpCommunity', 'snmpPort']
        .some(field => monitorFields[field] !== target[field]);
      target.projectId = projectId;
      target.type = typeField.type;
      target.name = body.name !== undefined ? String(body.name).trim() : target.name;
      // 仅更新请求中显式提交的字段，避免未提交字段被空值覆盖。
      target.brand = body.brand !== undefined ? body.brand : target.brand;
      target.model = body.model !== undefined ? body.model : target.model;
      target.owner = body.owner !== undefined ? body.owner : target.owner;
      target.version = body.version !== undefined ? body.version : target.version;
      (db.aiInspectionTargets || []).forEach(item => {
        if (item.assetId === target.id) item.systemVersion = target.version;
      });
      target.serialNumber = body.serialNumber !== undefined ? body.serialNumber : target.serialNumber;
      const previousAssetStatus = normalizeAssetStatus(target.status);
      target.status = body.status !== undefined ? normalizeAssetStatus(body.status) : previousAssetStatus;
      const assetStatusChanged = target.status !== previousAssetStatus;
      // 报废/退役属于终态操作，需走专用接口记录原因，避免普通编辑绕过状态机直接置终态。
      if (body.status !== undefined && ['已报废', '已退役'].includes(target.status) && !['已报废', '已退役'].includes(previousAssetStatus)) {
        return json(res, 400, { message: '报废或退役请使用专用操作并填写原因' });
      }
      target.maintainExpiryDate = nextMaintainExpiryDate;
      target.installationLocation = body.installationLocation !== undefined ? body.installationLocation : target.installationLocation;
      target.notes = body.notes !== undefined ? body.notes : target.notes;
      target.cabinetName = cabinetFields.cabinetName;
      target.rackUnitStart = cabinetFields.rackUnitStart;
      target.rackUnitSize = cabinetFields.rackUnitSize;
      target.monitorEnabled = monitorFields.monitorEnabled;
      target.monitorType = monitorFields.monitorType;
      target.monitorHost = monitorFields.monitorHost;
      target.monitorPort = monitorFields.monitorPort;
      target.snmpCommunity = monitorFields.snmpCommunity;
      target.snmpPort = monitorFields.snmpPort;
      if (monitorChanged) {
        invalidateAssetRuntimeState(target.id);
        // 关闭监控时结束未恢复告警，避免监控已停用仍显示处理中。
        if (!target.monitorEnabled) {
          for (const metric of MONITOR_ALERT_METRICS) {
            resolveMonitorAlert(db, target, metric, '资产已停止监控', now());
          }
        }
      }
      if (assetStatusChanged) {
        appendAssetLifecycle(db, target, 'status', user, `状态由 ${previousAssetStatus} 变更为 ${target.status}`, {
          fromStatus: previousAssetStatus,
          toStatus: target.status
        });
      }
      appendAuditLog(db, user, 'update', 'asset', target.id, `修改资产 ${target.name}`, projectId);
      await writeDb(db);
      return json(res, 200, sanitizeAssetForApi(target, user));
    }

    // 重置拓扑布局：删除该项目已保存的节点坐标，前端刷新后回到自动布局。
    if (req.method === 'DELETE' && pathname === '/api/assets/topology-layout') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const projectId = user.role === 'admin' ? (reqUrl.searchParams.get('projectId') || user.projectId) : resolveWriteProjectId(user, reqUrl.searchParams.get('projectId'));
      if (db.topologyLayouts && db.topologyLayouts.positions) {
        delete db.topologyLayouts.positions[projectId];
      }
      appendAuditLog(db, user, 'delete', 'topologyLayout', projectId, '重置拓扑布局', projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/assets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const assetId = parseAssetIdFromPath(pathname);
      const forceCascade = reqUrl.searchParams.get('cascade') === '1';
      // 资产及派生关系/流水的校验与删除必须同一临界区完成，否则并发新增关联会产生孤儿引用。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const index = lockDb.assets.findIndex(item => item.id === assetId);
        if (index === -1) return { status: 404, message: '资产不存在' };
        const target = lockDb.assets[index];
        if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return { status: 403, message: '仅支持删除自己创建的资产' };
        const warnings = collectAssetDeleteBlockers(lockDb, assetId);
        if (warnings.length) {
          // 默认阻断，要求先清理关联数据；管理员可通过 cascade=1 强制级联删除。
          if (forceCascade && user.role === 'admin') {
            const removed = cascadeDeleteAsset(lockDb, assetId);
            appendAuditLog(lockDb, user, 'delete', 'asset', assetId, `强制删除资产 ${target.name}，级联移除 变更${removed.changeRecords}/审批${removed.approvals}/故障${removed.incidents}/备件${removed.spareParts}/流水${removed.sparePartMovements}/巡检计划${removed.inspectionPlans}/巡检执行${removed.inspectionExecutions}/巡检对象${removed.targets}/日志${removed.logs}/关联${removed.relations}`, target.projectId);
            await writeDb(lockDb);
            return { status: 200, body: { ok: true, removed } };
          }
          return { status: 409, message: '该资产存在关联数据: ' + warnings.join('; ') + '。请先删除关联数据后再删除资产。' };
        }
        lockDb.assets.splice(index, 1);
        lockDb.assetLifecycles = (lockDb.assetLifecycles || []).filter(item => item.assetId !== assetId);
        lockDb.assetCheckouts = (lockDb.assetCheckouts || []).filter(item => item.assetId !== assetId);
        lockDb.monitorAlerts = (lockDb.monitorAlerts || []).filter(item => item.assetId !== assetId);
        for (const window of lockDb.monitorMaintenanceWindows || []) {
          if (Array.isArray(window.assetIds)) window.assetIds = window.assetIds.filter(id => id !== assetId);
        }
        for (const task of lockDb.assetInventoryTasks || []) {
          if (Array.isArray(task.items)) task.items = task.items.filter(item => item.assetId !== assetId);
        }
        const removedRelationIds = (lockDb.assetRelations || [])
          .filter(item => item.sourceAssetId === assetId || item.targetAssetId === assetId)
          .map(item => item.id);
        lockDb.assetRelations = (lockDb.assetRelations || []).filter(item => item.sourceAssetId !== assetId && item.targetAssetId !== assetId);
        removedRelationIds.forEach(invalidateRelationRuntimeState);
        if (lockDb.topologyLayouts && lockDb.topologyLayouts.positions) {
          for (const key of Object.keys(lockDb.topologyLayouts.positions)) {
            const positions = lockDb.topologyLayouts.positions[key];
            if (positions && positions[assetId]) delete positions[assetId];
          }
        }
        invalidateAssetRuntimeState(assetId);
        // 资产维保到期、离线告警等通知标记了 sourceType='asset'，随资产删除一并清理。
        removeNotificationsBySource(lockDb, 'asset', assetId);
        appendAuditLog(lockDb, user, 'delete', 'asset', assetId, `删除资产 ${target.name}`, target.projectId);
        await writeDb(lockDb);
        return { status: 200, body: { ok: true } };
      });
      if (outcome.status !== 200) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, outcome.body);
    }

    if (req.method === 'POST' && pathname === '/api/asset-relations') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const sourceAssetId = body.sourceAssetId || '';
      const targetAssetId = body.targetAssetId || '';
      if (!sourceAssetId || !targetAssetId) return json(res, 400, { message: '源资产和目标资产不能为空' });
      if (sourceAssetId === targetAssetId) return json(res, 400, { message: '不能连接自身' });
      const srcAsset = db.assets.find(a => a.id === sourceAssetId);
      const tgtAsset = db.assets.find(a => a.id === targetAssetId);
      if (!srcAsset) return json(res, 404, { message: '源资产不存在' });
      if (!tgtAsset) return json(res, 404, { message: '目标资产不存在' });
      if (user.role !== 'admin') {
        if (!userHasProject(user, srcAsset.projectId)) return json(res, 403, { message: '无权访问源资产' });
        if (!userHasProject(user, tgtAsset.projectId)) return json(res, 403, { message: '无权访问目标资产' });
      }
      if (!db.assetRelations) db.assetRelations = [];
      const relationType = String(body.relationType || 'connected').trim() || 'connected';
      if (!ASSET_RELATION_TYPES.includes(relationType)) return json(res, 400, { message: '关系类型无效' });
      const exists = db.assetRelations.find(r => r.sourceAssetId === sourceAssetId && r.targetAssetId === targetAssetId);
      if (exists) return json(res, 409, { message: '该关系已存在' });
      const rel = {
        id: id('rel'),
        sourceAssetId,
        targetAssetId,
        relationType,
        label: body.label || '',
        sourcePort: body.sourcePort || '',
        targetPort: body.targetPort || '',
        createdAt: now()
      };
      db.assetRelations.push(rel);
      await writeDb(db);
      return json(res, 201, rel);
    }

    if (req.method === 'GET' && pathname === '/api/asset-relations') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = db.assetRelations || [];
      if (user.role !== 'admin') {
        const userAssetIds = new Set((db.assets || []).filter(a => userHasProject(user, a.projectId)).map(a => a.id));
        list = list.filter(r => userAssetIds.has(r.sourceAssetId) && userAssetIds.has(r.targetAssetId));
      }
      if (query.sourceAssetId) list = list.filter(r => r.sourceAssetId === query.sourceAssetId);
      if (query.targetAssetId) list = list.filter(r => r.targetAssetId === query.targetAssetId);
      return json(res, 200, list);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/asset-relations/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const relId = pathname.split('/')[3];
      const idx = (db.assetRelations || []).findIndex(r => r.id === relId);
      if (idx === -1) return json(res, 404, { message: '关系不存在' });
      if (user.role !== 'admin') {
        const rel = db.assetRelations[idx];
        const srcAsset = (db.assets || []).find(a => a.id === rel.sourceAssetId);
        if (!srcAsset || !userHasProject(user, srcAsset.projectId)) return json(res, 403, { message: '无权操作此关系' });
      }
      db.assetRelations.splice(idx, 1);
      invalidateRelationRuntimeState(relId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/asset-relations/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const relId = pathname.split('/')[3];
      const idx = (db.assetRelations || []).findIndex(r => r.id === relId);
      if (idx === -1) return json(res, 404, { message: '关系不存在' });
      const rel = db.assetRelations[idx];
      if (user.role !== 'admin') {
        const srcAsset = (db.assets || []).find(a => a.id === rel.sourceAssetId);
        if (!srcAsset || !userHasProject(user, srcAsset.projectId)) return json(res, 403, { message: '无权操作此关系' });
      }
      const body = await readBody(req);
      const hasSourceField = body.sourceAssetId !== undefined;
      const hasTargetField = body.targetAssetId !== undefined;
      if (hasSourceField || hasTargetField) {
        const newSrc = hasSourceField ? String(body.sourceAssetId || '') : rel.sourceAssetId;
        const newTgt = hasTargetField ? String(body.targetAssetId || '') : rel.targetAssetId;
        if (!newSrc || !newTgt) return json(res, 400, { message: '源资产和目标资产不能为空' });
        if (newSrc === newTgt) return json(res, 400, { message: '不能连接自身' });
        if (!db.assets.find(a => a.id === newSrc)) return json(res, 404, { message: '源资产不存在' });
        if (!db.assets.find(a => a.id === newTgt)) return json(res, 404, { message: '目标资产不存在' });
        if (user.role !== 'admin') {
          const sa = db.assets.find(a => a.id === newSrc);
          const ta = db.assets.find(a => a.id === newTgt);
          if (!sa || !userHasProject(user, sa.projectId)) return json(res, 403, { message: '无权访问源资产' });
          if (!ta || !userHasProject(user, ta.projectId)) return json(res, 403, { message: '无权访问目标资产' });
        }
      }
      if (body.sourcePort !== undefined) rel.sourcePort = body.sourcePort;
      if (body.targetPort !== undefined) rel.targetPort = body.targetPort;
      if (body.relationType !== undefined) {
        const relationType = String(body.relationType || '').trim();
        if (!ASSET_RELATION_TYPES.includes(relationType)) return json(res, 400, { message: '关系类型无效' });
        rel.relationType = relationType;
      }
      if (body.label !== undefined) rel.label = body.label;
      if (hasSourceField) rel.sourceAssetId = String(body.sourceAssetId);
      if (hasTargetField) rel.targetAssetId = String(body.targetAssetId);
      invalidateRelationRuntimeState(relId);
      await writeDb(db);
      return json(res, 200, { ok: true, relation: rel });
    }

    if (req.method === 'GET' && pathname === '/api/assets/cabinet-layout') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      let list = db.assets || [];
      if (user.role === 'admin') {
        const filterProjectId = reqUrl.searchParams.get('projectId');
        if (filterProjectId) list = list.filter(item => item.projectId === filterProjectId);
      } else {
        list = filterByProjectScope(list, user, item => item.projectId);
      }
      const projectNames = new Map((db.projects || []).map(item => [item.id, item.name]));
      const payload = buildCabinetLayoutPayload(list, projectNames);
      if (user.role === 'customer') {
        const stripSecrets = device => {
          if (!device) return device;
          delete device.installationLocation;
          delete device.serialNumber;
          // 客户只看槽位与在线状态，SNMP 性能指标（CPU/内存/磁盘/流量）不下发。
          delete device.metrics;
          return device;
        };
        payload.cabinets.forEach(cabinet => (cabinet.devices || []).forEach(stripSecrets));
        payload.unassigned.forEach(stripSecrets);
      }
      return json(res, 200, payload);
    }

    if (req.method === 'GET' && pathname === '/api/assets/topology-layout') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const layoutData = db.topologyLayouts || { positions: {} };
      const projectId = user.role === 'admin' ? (reqUrl.searchParams.get('projectId') || user.projectId) : resolveWriteProjectId(user, reqUrl.searchParams.get('projectId'));
      const positions = layoutData.positions[projectId] || {};
      return json(res, 200, { positions });
    }

    if (req.method === 'POST' && pathname === '/api/assets/topology-layout') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (projectId && !requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const layout = sanitizeTopologyPositions(body.positions);
      if (layout.error) return json(res, 400, { message: layout.error });
      if (!db.topologyLayouts) db.topologyLayouts = { positions: {} };
      if (!db.topologyLayouts.positions) db.topologyLayouts.positions = {};
      db.topologyLayouts.positions[projectId] = layout.positions;
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/assets/') && pathname.endsWith('/snmp-interfaces')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const parts = pathname.split('/');
      const assetId = parts[3];
      const asset = db.assets.find(a => a.id === assetId);
      if (!asset) return json(res, 404, { message: '资产不存在' });
      if (!canViewProject(user, asset.projectId)) return json(res, 403, { message: '无权访问该资产' });
      const host = String(asset.monitorHost || '').trim();
      if (!host || !validateHost(host)) return json(res, 200, { interfaces: [] });
      const community = String(asset.snmpCommunity || '').trim();
      if (!community) return json(res, 200, { interfaces: [] });

      try {
        const ifList = await snmpWalkSubtree(host, parseInt(asset.snmpPort || '161', 10), community, [1, 3, 6, 1, 2, 1, 2, 2, 1, 2], 5000);
        ifList.sort((a, b) => a.index - b.index);
        return json(res, 200, { interfaces: ifList.map(i => String(i.value)) });
      } catch (e) {
        return json(res, 200, { interfaces: [], error: e.message });
      }
    }

    if (req.method === 'GET' && pathname === '/api/assets/topology') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      let assets = db.assets || [];
      if (user.role === 'admin') {
        const filterProjectId = reqUrl.searchParams.get('projectId');
        if (filterProjectId) assets = assets.filter(a => a.projectId === filterProjectId);
      } else {
        assets = assets.filter(a => userHasProject(user, a.projectId));
      }
      const assetIds = new Set(assets.map(a => a.id));
      const relations = (db.assetRelations || []).filter(r => assetIds.has(r.sourceAssetId) && assetIds.has(r.targetAssetId));
      return json(res, 200, { assets: assets.map(item => sanitizeAssetForApi(item, user)), relations });
    }

    if (req.method === 'GET' && pathname === '/api/assets/monitor-status') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let assets = db.assets || [];
      if (query.projectId) assets = assets.filter(a => a.projectId === query.projectId);
      if (user.role !== 'admin') assets = assets.filter(a => userHasProject(user, a.projectId));
      const statuses = {};
      const alerts = [];
      for (const asset of assets) {
        if (asset.monitorEnabled) {
          const status = getMonitorStatus(asset.id) || { status: 'unknown', lastCheck: null };
          statuses[asset.id] = status;
          if (status.status === 'offline') {
            const presented = sanitizeAssetForApi(asset, user);
            alerts.push({
              assetId: asset.id,
              assetName: asset.name || '',
              host: presented.monitorHost || '',
              time: status.lastCheck || Date.now()
            });
          }
        }
      }
      return json(res, 200, { statuses, alerts });
    }

    if (req.method === 'GET' && pathname === '/api/monitor/history') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const assetId = String(reqUrl.searchParams.get('assetId') || '').trim();
      const asset = (db.assets || []).find(item => item.id === assetId);
      if (!asset) return json(res, 404, { message: '资产不存在' });
      if (!canViewProject(user, asset.projectId)) return json(res, 403, { message: '无权查看该资产监控历史' });
      return json(res, 200, buildMonitorTrend(asset.id, Object.fromEntries(reqUrl.searchParams)));
    }

    // 管理员手动触发一轮采集，便于验证告警链路与生成趋势数据；强制采样不受节流限制。
    if (req.method === 'POST' && pathname === '/api/monitor/run') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req).catch(() => ({}));
      const requestedIds = Array.isArray(body.assetIds) ? body.assetIds.map(item => String(item || '')).filter(Boolean) : [];
      // 资产范围必须落在本次请求可见的项目内，避免管理员误操作跨越未预期范围。
      const unknownAsset = requestedIds.find(assetId => !(db.assets || []).some(item => item.id === assetId));
      if (unknownAsset) return json(res, 400, { message: '采集范围包含不存在的资产' });
      const outcome = await runAssetMonitorScheduler({ force: true, assetIds: requestedIds.length ? requestedIds : undefined });
      if (!outcome) return json(res, 500, { message: '监控采集执行失败' });
      if (outcome.skipped) return json(res, 409, { message: '已有采集任务正在运行，请稍后重试' });
      // 采集过程会独立读写数据库，审计日志必须基于最新快照追加，避免覆盖刚写入的告警与通知。
      const auditDb = await readDb();
      appendAuditLog(auditDb, user, 'execute', 'system', '', '手动执行监控采集');
      await writeDb(auditDb, { replaceCollections: ['auditLogs'] });
      return json(res, 200, { ok: true, ...outcome });
    }

    if (req.method === 'GET' && pathname === '/api/monitor/alerts') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.monitorAlerts || [], user, item => item.projectId);
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.assetId) list = list.filter(item => item.assetId === query.assetId);
      if (query.metric) list = list.filter(item => item.metric === query.metric);
      if (query.status === 'open') list = list.filter(item => item.status !== 'resolved');
      else if (query.status) list = list.filter(item => item.status === query.status);
      const sorted = parseSortQuery(query, list, 'lastTriggeredAt');
      const openCount = list.filter(item => item.status !== 'resolved').length;
      return json(res, 200, { ...paginateResult(sorted, query, user), openCount });
    }

    if (req.method === 'GET' && pathname === '/api/monitor/maintenance-windows') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      let list = filterByProjectScope(db.monitorMaintenanceWindows || [], user, item => item.projectId);
      const projectId = String(reqUrl.searchParams.get('projectId') || '').trim();
      if (projectId) list = list.filter(item => item.projectId === projectId);
      const sorted = list.slice().sort((a, b) => String(b.startAt || '').localeCompare(String(a.startAt || '')));
      return json(res, 200, { data: sorted, total: sorted.length });
    }

    if (req.method === 'POST' && pathname === '/api/monitor/maintenance-windows') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { message: '请填写维护窗口名称' });
      const projectId = user.role === 'admin'
        ? String(body.projectId || '').trim()
        : resolveWriteProjectId(user, body.projectId);
      if (projectId && !requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const startMs = Date.parse(String(body.startAt || ''));
      const endMs = Date.parse(String(body.endAt || ''));
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return json(res, 400, { message: '请填写有效的开始与结束时间' });
      if (endMs <= startMs) return json(res, 400, { message: '结束时间必须晚于开始时间' });
      const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(item => String(item || '')).filter(Boolean) : [];
      const invalidAsset = assetIds.find(assetId => {
        const asset = (db.assets || []).find(item => item.id === assetId);
        return !asset || (projectId && asset.projectId !== projectId);
      });
      if (invalidAsset) return json(res, 400, { message: '维护窗口中的资产不属于所选项目' });
      const record = {
        id: id('monitorWindow'),
        projectId,
        name: name.slice(0, 100),
        assetIds,
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        enabled: body.enabled !== false,
        notes: String(body.notes || '').slice(0, 500),
        createdBy: user.id,
        createdByName: user.name || user.username || '',
        createdAt: now()
      };
      db.monitorMaintenanceWindows = db.monitorMaintenanceWindows || [];
      db.monitorMaintenanceWindows.unshift(record);
      appendAuditLog(db, user, 'create', 'monitorWindow', record.id, `创建维护窗口 ${record.name}`, projectId);
      await writeDb(db);
      return json(res, 201, record);
    }

    if (req.method && ['PUT', 'DELETE'].includes(req.method) && pathname.match(/^\/api\/monitor\/maintenance-windows\/[^/]+$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const windowId = pathname.split('/')[4];
      const record = (db.monitorMaintenanceWindows || []).find(item => item.id === windowId);
      if (!record) return json(res, 404, { message: '维护窗口不存在' });
      if (!canViewProject(user, record.projectId)) return json(res, 403, { message: '无权操作该维护窗口' });
      if (req.method === 'DELETE') {
        db.monitorMaintenanceWindows = (db.monitorMaintenanceWindows || []).filter(item => item.id !== windowId);
        appendAuditLog(db, user, 'delete', 'monitorWindow', windowId, `删除维护窗口 ${record.name}`, record.projectId);
        await writeDb(db);
        return json(res, 200, { ok: true });
      }
      const body = await readBody(req);
      if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) return json(res, 400, { message: '请填写维护窗口名称' });
        record.name = name.slice(0, 100);
      }
      if (body.startAt !== undefined || body.endAt !== undefined) {
        const startMs = Date.parse(String(body.startAt !== undefined ? body.startAt : record.startAt));
        const endMs = Date.parse(String(body.endAt !== undefined ? body.endAt : record.endAt));
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return json(res, 400, { message: '请填写有效的开始与结束时间' });
        if (endMs <= startMs) return json(res, 400, { message: '结束时间必须晚于开始时间' });
        record.startAt = new Date(startMs).toISOString();
        record.endAt = new Date(endMs).toISOString();
      }
      if (body.assetIds !== undefined) {
        const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(item => String(item || '')).filter(Boolean) : [];
        const invalidAsset = assetIds.find(assetId => {
          const asset = (db.assets || []).find(item => item.id === assetId);
          return !asset || (record.projectId && asset.projectId !== record.projectId);
        });
        if (invalidAsset) return json(res, 400, { message: '维护窗口中的资产不属于所选项目' });
        record.assetIds = assetIds;
      }
      if (body.enabled !== undefined) record.enabled = body.enabled !== false;
      if (body.notes !== undefined) record.notes = String(body.notes || '').slice(0, 500);
      appendAuditLog(db, user, 'update', 'monitorWindow', record.id, `更新维护窗口 ${record.name}`, record.projectId);
      await writeDb(db);
      return json(res, 200, record);
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/monitor\/alerts\/[^/]+\/(acknowledge|resolve|silence)$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const parts = pathname.split('/');
      const alertId = parts[4];
      const action = parts[5];
      const alert = (db.monitorAlerts || []).find(item => item.id === alertId);
      if (!alert) return json(res, 404, { message: '告警不存在' });
      if (!canViewProject(user, alert.projectId)) return json(res, 403, { message: '无权处理该告警' });
      if (alert.status === 'resolved' && action !== 'resolve') return json(res, 400, { message: '告警已恢复，无需继续处理' });
      const body = await readBody(req);
      if (action === 'acknowledge') {
        alert.status = 'acknowledged';
        alert.acknowledgedAt = now();
        alert.acknowledgedBy = user.id;
        alert.acknowledgedByName = user.name || user.username || '';
        alert.acknowledgeNote = String(body.note || '').slice(0, 500);
        appendAuditLog(db, user, 'acknowledge', 'monitorAlert', alert.id, `确认告警 ${alert.title}`, alert.projectId);
      } else if (action === 'resolve') {
        alert.status = 'resolved';
        alert.resolvedAt = now();
        alert.resolvedReason = String(body.reason || '人工标记恢复').slice(0, 500);
        appendAuditLog(db, user, 'resolve', 'monitorAlert', alert.id, `恢复告警 ${alert.title}`, alert.projectId);
      } else {
        const minutes = Number(body.minutes);
        const untilMs = Number.isFinite(minutes) && minutes > 0
          ? Date.now() + Math.min(7 * 24 * 60, minutes) * 60 * 1000
          : Date.parse(String(body.until || ''));
        if (!Number.isFinite(untilMs) || untilMs <= Date.now()) return json(res, 400, { message: '请设置有效的静默时长或时间' });
        alert.silencedUntil = new Date(untilMs).toISOString();
        alert.silencedBy = user.id;
        appendAuditLog(db, user, 'silence', 'monitorAlert', alert.id, `静默告警 ${alert.title} 至 ${alert.silencedUntil}`, alert.projectId);
      }
      await writeDb(db, { replaceCollections: ['monitorAlerts'] });
      return json(res, 200, alert);
    }

    if (req.method === 'GET' && pathname === '/api/search') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const keyword = String(reqUrl.searchParams.get('keyword') || '').trim();
      if (keyword.length < 2) return json(res, 400, { message: '请输入至少 2 个字符' });
      const rawTypes = String(reqUrl.searchParams.get('types') || '').split(',').map(item => item.trim()).filter(Boolean);
      const validTypes = rawTypes.filter(item => globalSearchTypeOptions.some(option => option.key === item));
      const limitPerType = Math.min(20, Math.max(1, Number(reqUrl.searchParams.get('limit') || 5)));
      const result = buildGlobalSearchResults(db, user, keyword, validTypes, limitPerType);
      return json(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/api/logs') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      if (user.role === 'customer') {
        // 客户仅能查看已开启开关的项目，并且只下发服务过程与结果，内部备注与附件不外发。
        if (!customerVisibleLogProjects(db, user).length) return json(res, 200, paginateResult([], query, user));
        let customerLogs = customerVisibleLogProjects(db, user)
          .flatMap(projectId => (db.logs || []).filter(item => item.projectId === projectId));
        if (query.projectId) customerLogs = customerLogs.filter(item => item.projectId === query.projectId);
        if (query.date) customerLogs = customerLogs.filter(item => item.date === query.date);
        const keyword = String(query.keyword || '').trim().toLowerCase();
        if (keyword) {
          customerLogs = customerLogs.filter(item => [item.title, item.event, item.process, item.result, item.conclusion]
            .some(field => String(field || '').toLowerCase().includes(keyword)));
        }
        const sorted = parseSortQuery(query, customerLogs, 'createdAt');
        const presented = sorted.map(item => ({
          id: item.id,
          projectId: item.projectId,
          date: item.date,
          event: item.event,
          title: item.title,
          relatedTarget: item.relatedTarget,
          ticketType: item.ticketType,
          process: item.process,
          result: item.result,
          conclusion: item.conclusion,
          durationHours: item.durationHours,
          dispatcher: item.dispatcher,
          createdAt: item.createdAt
        }));
        return json(res, 200, paginateResult(presented, query, user));
      }
      let list = filterByRecordScope(db.logs || [], user, query, item => item.userId || '');
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.userId) list = list.filter(item => item.userId === query.userId);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'GET' && pathname === '/api/logs/dictionaries') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      return json(res, 200, {
        ticketTypes: LOG_TICKET_TYPE_OPTIONS,
        results: LOG_RESULT_OPTIONS
      });
    }

    if (req.method === 'POST' && pathname === '/api/logs/quality-check') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const existingLog = body.id ? (db.logs || []).find(item => item.id === body.id) : null;
      if (body.id && !existingLog) return json(res, 404, { message: '日志不存在' });
      if (existingLog && user.role !== 'admin' && existingLog.userId !== user.id) return json(res, 403, { message: '仅日志创建者或管理员可以校验' });
      const validation = validateLogPayload(db, user, body, existingLog);
      if (validation.error) return json(res, 400, { message: validation.error });
      return json(res, 200, {
        warnings: buildLogQualityWarnings(db, existingLog?.userId || user.id, validation.payload, existingLog)
      });
    }

    if (req.method === 'POST' && pathname === '/api/logs') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req, logAttachmentBodyLimitBytes);
      const validation = validateLogPayload(db, user, body);
      if (validation.error) return json(res, 400, { message: validation.error });
      const attachmentQuotaError = findAttachmentQuotaExceeded({
        items: db.logs,
        userId: user.id,
        projectId: validation.payload.projectId,
        incomingBytes: (validation.payload.attachments || []).reduce((sum, item) => sum + logAttachmentBytes(item), 0),
        getOwnerId: item => item.userId || '',
        getProjectId: item => item.projectId || '',
        getBytes: item => (item.attachments || []).reduce((sum, attachment) => sum + logAttachmentBytes(attachment), 0),
        perUserBytes: logAttachmentQuotaPerUserBytes,
        perProjectBytes: logAttachmentQuotaPerProjectBytes,
        label: '日志附件'
      });
      if (attachmentQuotaError) return json(res, 413, { message: attachmentQuotaError });
      const warnings = buildLogQualityWarnings(db, user.id, validation.payload);
      const item = {
        id: id('log'),
        userId: user.id,
        ...validation.payload,
        createdAt: now()
      };
      db.logs.push(item);
      appendAuditLog(db, user, 'create', 'log', item.id, `创建日志 ${item.event}`, item.projectId);
      await writeDb(db);
      return json(res, 201, { ...item, warnings });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/logs/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const logId = pathname.split('/')[3];
      const target = db.logs.find(item => item.id === logId);
      if (!target) return json(res, 404, { message: '日志不存在' });
      if (user.role !== 'admin' && target.userId !== user.id) return json(res, 403, { message: '仅日志创建者或管理员可以编辑' });
      const body = await readBody(req, logAttachmentBodyLimitBytes);
      const validation = validateLogPayload(db, user, body, target);
      if (validation.error) return json(res, 400, { message: validation.error });
      const attachmentQuotaError = findAttachmentQuotaExceeded({
        items: db.logs,
        userId: target.userId || user.id,
        projectId: validation.payload.projectId,
        incomingBytes: (validation.payload.attachments || []).reduce((sum, item) => sum + logAttachmentBytes(item), 0),
        excludeId: logId,
        getOwnerId: item => item.userId || '',
        getProjectId: item => item.projectId || '',
        getBytes: item => (item.attachments || []).reduce((sum, attachment) => sum + logAttachmentBytes(attachment), 0),
        perUserBytes: logAttachmentQuotaPerUserBytes,
        perProjectBytes: logAttachmentQuotaPerProjectBytes,
        label: '日志附件'
      });
      if (attachmentQuotaError) return json(res, 413, { message: attachmentQuotaError });
      const warnings = buildLogQualityWarnings(db, target.userId || user.id, validation.payload, target);
      if (body.title !== undefined) target.title = String(body.title || '').trim() || target.title;
      Object.assign(target, validation.payload);
      appendAuditLog(db, user, 'update', 'log', logId, `编辑日志 ${target.event || target.title || logId}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ...target, warnings });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/logs/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const logId = pathname.split('/')[3];
      const index = db.logs.findIndex(item => item.id === logId);
      if (index === -1) return json(res, 404, { message: '日志不存在' });
      const target = db.logs[index];
      if (!canDeleteOwnedRecord(user, target, target.userId || '')) return json(res, 403, { message: '仅支持删除自己创建的日志' });
      db.logs.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'log', logId, `删除日志 ${target.event}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/kb') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const keyword = String(reqUrl.searchParams.get('keyword') || '').trim().toLowerCase();
      let list = filterByProjectScope(db.knowledgeBase || [], user, item => item.projectId);
      if (reqUrl.searchParams.get('projectId')) list = list.filter(item => item.projectId === reqUrl.searchParams.get('projectId'));
      if (reqUrl.searchParams.get('userId')) list = list.filter(item => item.createdBy === reqUrl.searchParams.get('userId'));
      const statusFilter = String(reqUrl.searchParams.get('status') || '').trim();
      if (statusFilter) list = list.filter(item => item.status === statusFilter);
      // 客户只看已发布条目，草稿与待审核内容不对客可见。
      if (user.role === 'customer') list = list.filter(item => item.status === 'published');
      if (keyword) {
        list = list.filter(item => {
          const fields = user.role === 'customer'
            ? [item.title, item.keywords, item.category, item.tags]
            : [item.title, item.keywords, item.problem, item.solution];
          return fields.some(field => String(field || '').toLowerCase().includes(keyword));
        });
      }
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      const presented = user.role === 'customer'
        ? sorted.map(item => ({
          id: item.id,
          title: item.title,
          category: item.category || '',
          tags: item.tags || '',
          projectId: item.projectId,
          createdAt: item.createdAt,
          createdBy: item.createdBy,
          hasContent: Boolean(item.content || item.problem || item.solution)
        }))
        : sorted.map(item => ({ ...item, revisionCount: (db.kbRevisions || []).filter(rev => rev.kbId === item.id).length }));
      return json(res, 200, paginateResult(presented, query, user));
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/kb\/[^/]+\/revisions$/)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const kbId = pathname.split('/')[3];
      const target = (db.knowledgeBase || []).find(item => item.id === kbId);
      if (!target) return json(res, 404, { message: '知识条目不存在' });
      if (!canViewProject(user, target.projectId)) return json(res, 403, { message: '无权访问该知识条目' });
      if (user.role === 'customer' && target.status !== 'published') return json(res, 403, { message: '无权访问该知识条目' });
      const revisions = (db.kbRevisions || [])
        .filter(item => item.kbId === kbId)
        .sort((a, b) => Number(b.version || 0) - Number(a.version || 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
      return json(res, 200, { data: revisions, total: revisions.length, currentVersion: target.version || 1 });
    }

    // 详情读取对项目内所有角色开放（含客户），列表接口只脱敏正文，详情接口按权限返回完整内容。
    if (req.method === 'GET' && /^\/api\/kb\/[^/]+$/.test(pathname)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const kbId = pathname.split('/')[3];
      const target = (db.knowledgeBase || []).find(item => item.id === kbId);
      if (!target) return json(res, 404, { message: '知识条目不存在' });
      if (!canViewProject(user, target.projectId)) return json(res, 403, { message: '无权访问该知识条目' });
      if (user.role === 'customer' && target.status !== 'published') return json(res, 403, { message: '无权访问该知识条目' });
      return json(res, 200, target);
    }

    if (req.method === 'POST' && pathname === '/api/kb') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const kbTitle = String(body.title || '').trim();
      if (!kbTitle) return json(res, 400, { message: '知识条目标题不能为空' });
      const kbLengthError = checkTextLength(kbTitle, 128, '标题')
        || checkTextLength(body.content, 4000, '正文')
        || checkTextLength(body.problem, 4000, '问题描述')
        || checkTextLength(body.solution, 4000, '解决方案');
      if (kbLengthError) return json(res, 400, { message: kbLengthError });
      const kbProjectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(kbProjectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const item = {
        id: id('kb'),
        title: kbTitle,
        content: body.content || '',
        category: body.category || '',
        tags: body.tags || '',
        keywords: body.keywords || '',
        problem: body.problem || '',
        solution: body.solution || '',
        // 默认直接发布以保持既有创建体验，草稿与待审核需显式提交。
        status: ['draft', 'pending', 'published', 'rejected'].includes(body.status) ? body.status : 'published',
        version: 1,
        reviewNote: '',
        reviewedBy: '',
        reviewedAt: '',
        publishedAt: now(),
        createdBy: user.id,
        projectId: kbProjectId,
        createdAt: now()
      };
      db.knowledgeBase.push(item);
      snapshotKbRevision(db, item, 'create', user);
      appendAuditLog(db, user, 'create', 'kb', item.id, `创建知识条目 ${item.title}`, item.projectId);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/kb/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const kbId = pathname.split('/')[3];
      const target = db.knowledgeBase.find(item => item.id === kbId);
      if (!target) return json(res, 404, { message: '知识条目不存在' });
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持修改自己创建的知识条目' });
      const body = await readBody(req);
      const beforeContent = {
        title: target.title, keywords: target.keywords, problem: target.problem,
        solution: target.solution, content: target.content, category: target.category, tags: target.tags
      };
      if (body.title !== undefined) {
        const nextKbTitle = String(body.title || '').trim();
        if (!nextKbTitle) return json(res, 400, { message: '知识条目标题不能为空' });
        target.title = nextKbTitle;
      }
      const kbLengthError = checkTextLength(body.title, 128, '标题')
        || checkTextLength(body.content, 4000, '正文')
        || checkTextLength(body.problem, 4000, '问题描述')
        || checkTextLength(body.solution, 4000, '解决方案');
      if (kbLengthError) return json(res, 400, { message: kbLengthError });
      if (body.content !== undefined) target.content = body.content;
      if (body.category !== undefined) target.category = body.category;
      if (body.tags !== undefined) target.tags = body.tags;
      if (body.keywords !== undefined) target.keywords = body.keywords;
      if (body.problem !== undefined) target.problem = body.problem;
      if (body.solution !== undefined) target.solution = body.solution;
      if (user.role === 'admin' && body.projectId !== undefined) {
        if (!requireExistingProject(body.projectId, db)) return json(res, 400, { message: '关联项目不存在' });
        target.projectId = body.projectId;
      }
      // 内容变化才递增版本；仅调整审核状态时保留版本号，避免版本历史被状态切换污染。
      const kbContentChanged = ['title', 'keywords', 'problem', 'solution', 'content', 'category']
        .some(key => String(beforeContent[key] || '') !== String(target[key] || ''))
        || JSON.stringify(beforeContent.tags || '') !== JSON.stringify(target.tags || '');
      if (kbContentChanged) {
        target.version = Math.max(1, Number(target.version || 1)) + 1;
        // 内容变更一律回到待审核；管理员可保留草稿态，发布须走审核接口。
        target.status = user.role === 'admin' && body.status === 'draft' ? 'draft' : 'pending';
        target.reviewNote = '';
        target.reviewedBy = '';
        target.reviewedAt = '';
        snapshotKbRevision(db, target, 'update', user);
      } else if (['draft', 'pending', 'published', 'rejected'].includes(body.status) && body.status !== target.status) {
        // 状态切换同样需要审核：只有管理员可以直接发布，其他角色最多提交到待审核。
        if (body.status === 'published' && user.role !== 'admin') {
          target.status = 'pending';
        } else {
          target.status = body.status;
          if (body.status === 'published') target.publishedAt = now();
        }
      }
      appendAuditLog(db, user, 'update', 'kb', kbId, `修改知识条目 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/kb/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const kbId = pathname.split('/')[3];
      const index = db.knowledgeBase.findIndex(item => item.id === kbId);
      if (index === -1) return json(res, 404, { message: '知识条目不存在' });
      const target = db.knowledgeBase[index];
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持删除自己创建的知识条目' });
      db.knowledgeBase.splice(index, 1);
      db.kbRevisions = (db.kbRevisions || []).filter(item => item.kbId !== kbId);
      appendAuditLog(db, user, 'delete', 'kb', kbId, `删除知识条目 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    // 知识库审核：仅管理员可发布或驳回，驳回意见回写条目并在版本历史留痕。
    if (req.method === 'POST' && pathname.match(/^\/api\/kb\/[^/]+\/review$/)) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const kbId = pathname.split('/')[3];
      const target = (db.knowledgeBase || []).find(item => item.id === kbId);
      if (!target) return json(res, 404, { message: '知识条目不存在' });
      if (target.status !== 'pending') return json(res, 400, { message: '仅待审核的条目可以审核' });
      const body = await readBody(req);
      const decision = String(body.decision || '').trim();
      if (!['publish', 'reject'].includes(decision)) return json(res, 400, { message: '审核结论无效' });
      const note = String(body.note || '').slice(0, 500);
      target.status = decision === 'publish' ? 'published' : 'rejected';
      target.reviewNote = note;
      target.reviewedBy = user.id;
      target.reviewedAt = now();
      if (decision === 'publish') target.publishedAt = now();
      snapshotKbRevision(db, target, decision === 'publish' ? 'publish' : 'reject', user, note);
      appendAuditLog(db, user, decision === 'publish' ? 'approved' : 'returned', 'kb', target.id,
        `${decision === 'publish' ? '发布' : '驳回'}知识条目 ${target.title}${note ? `：${note}` : ''}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'GET' && pathname === '/api/documents') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const keyword = String(reqUrl.searchParams.get('keyword') || '').trim().toLowerCase();
      let list = filterByProjectScope(db.documents || [], user, item => item.projectId);
      if (reqUrl.searchParams.get('projectId')) list = list.filter(item => item.projectId === reqUrl.searchParams.get('projectId'));
      if (reqUrl.searchParams.get('type')) list = list.filter(item => item.type === reqUrl.searchParams.get('type'));
      if (keyword) {
        list = list.filter(item => (item.title || '').toLowerCase().includes(keyword));
      }
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      const sanitized = sorted.map(item => sanitizeDocumentForApi(item, false));
      return json(res, 200, paginateResult(sanitized, query, user));
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/documents\/([^/]+)$/) && !pathname.includes('/verify-password') && !pathname.includes('/download')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (user.role !== 'admin' && !userHasProject(user, target.projectId)) return json(res, 403, { message: '无权访问该资料' });
      if (target.accessPasswordHash) {
        const verified = verifyDocumentAccessToken(readDocumentAccessToken(req), docId, user.id);
        if (!verified.ok) return json(res, 403, { message: verified.message });
      }
      // 仅管理员与工程师可查看管理 IP / 登录账号等受保护字段，只读角色同样隐藏。
      const revealProtected = user.role === 'admin' || user.role === 'engineer';
      return json(res, 200, sanitizeDocumentForApi(target, revealProtected));
    }

    if (req.method === 'POST' && pathname === '/api/documents') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return json(res, 400, { message: '请使用 multipart/form-data 提交资料' });
      }
      const boundary = parseMultipartBoundary(contentType);
      if (!boundary) return json(res, 400, { message: '无效的上传格式' });
      const rawBody = await readMultipartBody(req, documentAttachmentLimitBytes, `附件不能超过 ${documentAttachmentLimitMb}MB`).catch(err => {
        if (err.status) return json(res, err.status, { message: err.message });
        throw err;
      });
      if (!Buffer.isBuffer(rawBody)) return;
      const parts = parseMultipart(rawBody, boundary);
      const getField = (name) => {
        const part = parts.find(p => p.name === name && !p.filename);
        return part ? part.data.toString('utf8').trim() : '';
      };
      const projectId = resolveWriteProjectId(user, getField('projectId'));
      const type = getField('type');
      const title = getField('title');
      const accessPassword = getField('accessPassword');
      if (!projectId) return json(res, 400, { message: '请选择关联项目' });
      if (!type || !DOCUMENT_TYPES.includes(type)) return json(res, 400, { message: '请选择有效的资料类型' });
      if (!title) return json(res, 400, { message: '请输入资料名称' });
      if (!accessPassword) return json(res, 400, { message: '请设置访问密码' });
      const project = requireExistingProject(projectId, db);
      if (!project) return json(res, 400, { message: '关联项目不存在' });
      const docId = id('doc');
      let attachmentName = '', attachmentPath = '', attachmentSize = 0;
      if (type !== 'device') {
        const filePart = parts.find(p => p.name === 'attachment' && p.filename);
        if (!filePart || !filePart.filename) return json(res, 400, { message: '请上传附件' });
        const quotaError = findAttachmentQuotaExceeded({
          items: db.documents,
          userId: user.id,
          projectId,
          incomingBytes: filePart.data.length,
          getOwnerId: item => item.createdBy || '',
          getProjectId: item => item.projectId || '',
          getBytes: item => item.attachmentSize || 0,
          perUserBytes: documentQuotaPerUserBytes,
          perProjectBytes: documentQuotaPerProjectBytes,
          label: '资料附件'
        });
        if (quotaError) return json(res, 413, { message: quotaError });
        const docDir = path.join(documentsUploadDir, docId);
        fs.mkdirSync(docDir, { recursive: true });
        attachmentName = sanitizeUploadFilename(filePart.filename);
        attachmentPath = resolveSafeChildPath(docDir, attachmentName);
        fs.writeFileSync(attachmentPath, filePart.data);
        attachmentSize = filePart.data.length;
      }
      const item = {
        id: docId, projectId, type, title,
        brand: getField('brand'), model: getField('model'),
        serialNumber: getField('serialNumber'), purchaseDate: getField('purchaseDate'),
        warrantyExpiryDate: getField('warrantyExpiryDate'), managementMethod: getField('managementMethod'),
        managementIp: getField('managementIp'), managementPort: getField('managementPort'),
        loginAccount: getField('loginAccount'),
        loginPasswordHash: getField('loginPassword') ? hash(getField('loginPassword')) : '',
        loginPasswordEncrypted: getField('loginPassword') ? encryptLoginPassword(getField('loginPassword'), accessPassword) : '',
        attachmentName, attachmentPath, attachmentSize,
        accessPasswordHash: hash(accessPassword),
        createdBy: user.id, createdAt: now(), updatedAt: now()
      };
      db.documents.push(item);
      appendAuditLog(db, user, 'create', 'document', docId, `新增资料 ${title}`, projectId);
      await writeDb(db);
      return json(res, 201, sanitizeDocumentForApi(item, true));
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/documents/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持修改自己创建的资料' });
      const contentType = req.headers['content-type'] || '';
      // 附件文件在落库成功后才删除旧文件，避免写库失败时数据库仍指向已删除的路径。
      let replacedAttachmentPath = '';
      let uploadedAttachmentPath = '';
      if (contentType.includes('multipart/form-data')) {
        const boundary = parseMultipartBoundary(contentType);
        if (!boundary) return json(res, 400, { message: '无效的上传格式' });
        const rawBody = await readMultipartBody(req, documentAttachmentLimitBytes, `附件不能超过 ${documentAttachmentLimitMb}MB`).catch(err => {
          if (err.status) return json(res, err.status, { message: err.message });
          throw err;
        });
        if (!Buffer.isBuffer(rawBody)) return;
        const parts = parseMultipart(rawBody, boundary);
        const getField = (name) => {
          const part = parts.find(p => p.name === name && !p.filename);
          return part ? part.data.toString('utf8').trim() : '';
        };
        if (getField('title')) target.title = getField('title');
        if (getField('type')) target.type = getField('type');
        if (getField('brand') !== undefined) target.brand = getField('brand');
        if (getField('model') !== undefined) target.model = getField('model');
        if (getField('serialNumber') !== undefined) target.serialNumber = getField('serialNumber');
        if (getField('purchaseDate') !== undefined) target.purchaseDate = getField('purchaseDate');
        if (getField('warrantyExpiryDate') !== undefined) target.warrantyExpiryDate = getField('warrantyExpiryDate');
        if (getField('managementMethod') !== undefined) target.managementMethod = getField('managementMethod');
        if (getField('managementIp') !== undefined) target.managementIp = getField('managementIp');
        if (getField('managementPort') !== undefined) target.managementPort = getField('managementPort');
        if (getField('loginAccount') !== undefined) target.loginAccount = getField('loginAccount');
        const nextLoginPassword = getField('loginPassword');
        const nextAccessPassword = getField('accessPassword');
        const legacyAccessKey = getField('_encryptionKey');
        if (nextLoginPassword) {
          target.loginPasswordHash = hash(nextLoginPassword);
          // 登录密码密文由访问密码派生密钥加密，优先使用本次提交的新访问密码。
          const encKey = nextAccessPassword || legacyAccessKey;
          if (encKey) target.loginPasswordEncrypted = encryptLoginPassword(nextLoginPassword, encKey);
        }
        if (nextAccessPassword) {
          target.accessPasswordHash = hash(nextAccessPassword);
          if (nextLoginPassword) {
            target.loginPasswordEncrypted = encryptLoginPassword(nextLoginPassword, nextAccessPassword);
          } else if (target.loginPasswordEncrypted) {
            // 仅修改访问密码时，用旧密钥解密后按新密码重新加密，避免登录密码永久不可恢复。
            let plainLoginPassword = '';
            try { plainLoginPassword = decryptLoginPassword(target.loginPasswordEncrypted, legacyAccessKey) || ''; } catch (_) { plainLoginPassword = ''; }
            if (!plainLoginPassword) return json(res, 400, { message: '修改访问密码时请同时重新填写登录密码' });
            target.loginPasswordEncrypted = encryptLoginPassword(plainLoginPassword, nextAccessPassword);
          }
        }
        if (user.role === 'admin' && getField('projectId')) {
          const nextDocumentProjectId = getField('projectId');
          if (!requireExistingProject(nextDocumentProjectId, db)) return json(res, 400, { message: '关联项目不存在' });
          target.projectId = nextDocumentProjectId;
        }
        const newType = getField('type') || target.type;
        if (newType && !DOCUMENT_TYPES.includes(newType)) {
          return json(res, 400, { message: '无效的资料类型' });
        }
        if (getField('type')) target.type = newType;
        const filePart = parts.find(p => p.name === 'attachment' && p.filename);
        if (filePart && filePart.filename) {
          const quotaError = findAttachmentQuotaExceeded({
            items: db.documents,
            userId: user.id,
            projectId: target.projectId || '',
            incomingBytes: filePart.data.length,
            excludeId: docId,
            getOwnerId: item => item.createdBy || '',
            getProjectId: item => item.projectId || '',
            getBytes: item => item.attachmentSize || 0,
            perUserBytes: documentQuotaPerUserBytes,
            perProjectBytes: documentQuotaPerProjectBytes,
            label: '资料附件'
          });
          if (quotaError) return json(res, 413, { message: quotaError });
          const docDir = path.join(documentsUploadDir, docId);
          fs.mkdirSync(docDir, { recursive: true });
          target.attachmentName = sanitizeUploadFilename(filePart.filename);
          const nextAttachmentPath = resolveSafeChildPath(docDir, target.attachmentName);
          const previousAttachmentPath = target.attachmentPath || '';
          // 先写临时文件再原子重命名，避免中途失败导致旧附件已被删除、新附件写入一半。
          const tempAttachmentPath = `${nextAttachmentPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
          fs.writeFileSync(tempAttachmentPath, filePart.data);
          try {
            fs.renameSync(tempAttachmentPath, nextAttachmentPath);
          } catch (error) {
            try { fs.rmSync(tempAttachmentPath, { force: true }); } catch (_) {}
            throw error;
          }
          target.attachmentPath = nextAttachmentPath;
          target.attachmentSize = filePart.data.length;
          replacedAttachmentPath = previousAttachmentPath;
          uploadedAttachmentPath = nextAttachmentPath;
        }
        // 与 JSON 分支保持一致：非设备类型资料必须存在附件。
        if (newType !== 'device') {
          const hasAttachment = !!(target.attachmentPath && fs.existsSync(target.attachmentPath));
          if (!hasAttachment) return json(res, 400, { message: '非设备类型资料必须上传附件' });
        }
        target.updatedAt = now();
        appendAuditLog(db, user, 'update', 'document', docId, `修改资料 ${target.title}`, target.projectId);
        try {
          await writeDb(db);
        } catch (error) {
          // 落库失败时回收本次上传的新文件，避免留下数据库从未引用的孤儿附件。
          if (uploadedAttachmentPath && uploadedAttachmentPath !== replacedAttachmentPath) {
            try { fs.rmSync(uploadedAttachmentPath, { force: true }); } catch (_) {}
          }
          throw error;
        }
        if (replacedAttachmentPath && replacedAttachmentPath !== uploadedAttachmentPath) {
          // 旧文件在数据库确认不再引用后才删除，写库失败时保持原附件可用。
          try { fs.rmSync(replacedAttachmentPath, { force: true }); } catch (_) {}
        }
        // 与详情接口保持一致：受保护字段需通过访问密码校验（X-Document-Access-Token）后才可下发。
        const revealProtectedOnUpdate = !target.accessPasswordHash || verifyDocumentAccessToken(readDocumentAccessToken(req), docId, user.id).ok;
        return json(res, 200, sanitizeDocumentForApi(target, revealProtectedOnUpdate));
      }
      const body = await readBody(req);
      const newType = body.type !== undefined ? body.type : target.type;
      if (newType && !DOCUMENT_TYPES.includes(newType)) {
        return json(res, 400, { message: '无效的资料类型' });
      }
      if (newType !== 'device' && body.type !== undefined) {
        const hasAttachment = !!(target.attachmentPath && fs.existsSync(target.attachmentPath));
        if (!hasAttachment) return json(res, 400, { message: '非设备类型资料必须上传附件，请使用附件上传方式提交' });
      }
      if (body.title !== undefined) {
        const nextDocTitle = String(body.title || '').trim();
        if (!nextDocTitle) return json(res, 400, { message: '资料名称不能为空' });
        target.title = nextDocTitle;
      }
      if (body.type !== undefined) target.type = newType;
      if (body.brand !== undefined) target.brand = body.brand;
      if (body.model !== undefined) target.model = body.model;
      if (body.serialNumber !== undefined) target.serialNumber = body.serialNumber;
      if (body.purchaseDate !== undefined) target.purchaseDate = body.purchaseDate;
      if (body.warrantyExpiryDate !== undefined) target.warrantyExpiryDate = body.warrantyExpiryDate;
      if (body.managementMethod !== undefined) target.managementMethod = body.managementMethod;
      if (body.managementIp !== undefined) target.managementIp = body.managementIp;
      if (body.managementPort !== undefined) target.managementPort = body.managementPort;
      if (body.loginAccount !== undefined) target.loginAccount = body.loginAccount;
      if (body.loginPassword) {
        target.loginPasswordHash = hash(body.loginPassword);
        const encKey = body.accessPassword || body._encryptionKey;
        if (encKey) target.loginPasswordEncrypted = encryptLoginPassword(body.loginPassword, encKey);
      }
      if (body.accessPassword) {
        target.accessPasswordHash = hash(body.accessPassword);
        if (body.loginPassword) {
          target.loginPasswordEncrypted = encryptLoginPassword(body.loginPassword, body.accessPassword);
        } else if (target.loginPasswordEncrypted) {
          // 与 multipart 分支一致：仅改访问密码时用旧密钥重新加密，失败则要求重填登录密码。
          let plainLoginPassword = '';
          try { plainLoginPassword = decryptLoginPassword(target.loginPasswordEncrypted, body._encryptionKey) || ''; } catch (_) { plainLoginPassword = ''; }
          if (!plainLoginPassword) return json(res, 400, { message: '修改访问密码时请同时重新填写登录密码' });
          target.loginPasswordEncrypted = encryptLoginPassword(plainLoginPassword, body.accessPassword);
        }
      }
      if (user.role === 'admin' && body.projectId !== undefined) {
        if (!requireExistingProject(body.projectId, db)) return json(res, 400, { message: '关联项目不存在' });
        target.projectId = body.projectId;
      }
      target.updatedAt = now();
      appendAuditLog(db, user, 'update', 'document', docId, `修改资料 ${target.title}`, target.projectId);
      await writeDb(db);
      const revealProtectedOnUpdate = !target.accessPasswordHash || verifyDocumentAccessToken(readDocumentAccessToken(req), docId, user.id).ok;
      return json(res, 200, sanitizeDocumentForApi(target, revealProtectedOnUpdate));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/documents/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const index = db.documents.findIndex(item => item.id === docId);
      if (index === -1) return json(res, 404, { message: '资料不存在' });
      const target = db.documents[index];
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持删除自己创建的资料' });
      db.documents.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'document', docId, `删除资料 ${target.title}`, target.projectId);
      await writeDb(db);
      // 先落库再清理文件：写库失败时保留附件，避免记录还在但文件已丢失。
      if (target.attachmentPath) {
        try {
          const docDir = path.join(documentsUploadDir, docId);
          fs.rmSync(docDir, { recursive: true, force: true });
        } catch (_) {}
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/documents\/([^/]+)\/verify-password$/)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (user.role !== 'admin' && !userHasProject(user, target.projectId)) return json(res, 403, { message: '无权访问该资料' });
      const body = await readBody(req);
      const password = String(body.password || '');
      if (!password) return json(res, 400, { message: '请输入访问密码' });
      const rateKey = `${docId}:${getRequestClientIp(req)}:${user.id}`;
      const store = getLoginRateLimitStateStore(db);
      let rateState = store.get(rateKey) || { count: 0, firstAttemptAt: 0, lockedUntil: 0 };
      if (rateState.lockedUntil > nowMs()) {
        const remainingSeconds = Math.ceil((rateState.lockedUntil - nowMs()) / 1000);
        return json(res, 429, { message: `密码验证过于频繁，请 ${Math.ceil(remainingSeconds / 60)} 分钟后重试` });
      }
      const nowMsVal = nowMs();
      if (!rateState.firstAttemptAt || nowMsVal - rateState.firstAttemptAt > 5 * 60 * 1000) {
        rateState.count = 0;
        rateState.firstAttemptAt = nowMsVal;
      }
      if (!verifyPassword(password, target.accessPasswordHash)) {
        rateState.count += 1;
        if (rateState.count >= 3) {
          rateState.lockedUntil = nowMsVal + 5 * 60 * 1000;
        }
        store.set(rateKey, rateState);
        setLoginRateLimitStateStore(db, store);
        await writeDb(db);
        if (rateState.lockedUntil) {
          return json(res, 429, { message: '密码验证过于频繁，请 5 分钟后重试' });
        }
        return json(res, 401, { message: `密码错误，剩余 ${3 - rateState.count} 次尝试` });
      }
      store.delete(rateKey);
      setLoginRateLimitStateStore(db, store);
      appendAuditLog(db, user, 'verify', 'document', docId, `验证资料访问密码 ${target.title}`, target.projectId);
      await writeDb(db);
      const payload = `${docId}:${user.id}:${nowMsVal}`;
      const sig = crypto.createHmac('sha256', DOCUMENT_TOKEN_SECRET).update(payload).digest('hex');
      const token = Buffer.from(`${payload}:${sig}`).toString('base64url');
      let loginPassword = '';
      try {
        loginPassword = decryptLoginPassword(target.loginPasswordEncrypted, password) || '';
      } catch (_) {
        loginPassword = '';
      }
      const canRevealLoginPassword = user.role === 'admin' || user.role === 'engineer';
      return json(res, 200, {
        ok: true,
        token,
        hasLoginPassword: Boolean(target.loginPasswordEncrypted),
        loginPassword: canRevealLoginPassword ? loginPassword : ''
      });
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/documents\/([^/]+)\/download$/)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (user.role !== 'admin' && !userHasProject(user, target.projectId)) return json(res, 403, { message: '无权访问该资料' });
      if (target.accessPasswordHash) {
        const verified = verifyDocumentAccessToken(readDocumentAccessToken(req), docId, user.id);
        if (!verified.ok) return json(res, 403, { message: verified.message });
      }
      if (!target.attachmentPath || !fs.existsSync(target.attachmentPath)) {
        return json(res, 404, { message: '附件文件不存在' });
      }
      if (!isPathInsideDirectory(documentsUploadDir, target.attachmentPath)) {
        return json(res, 404, { message: '附件文件不存在' });
      }
      appendAuditLog(db, user, 'access', 'document', docId, `下载资料附件 ${target.title}`, target.projectId);
      await writeDb(db);
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(target.attachmentName || 'download')}`,
        'Content-Length': target.attachmentSize || fs.statSync(target.attachmentPath).size
      }));
      const stream = fs.createReadStream(target.attachmentPath);
      stream.on('error', () => {
        if (!res.headersSent) {
          json(res, 404, { message: '附件文件不存在' });
          return;
        }
        if (!res.writableEnded) res.end();
      });
      return stream.pipe(res);
    }

    if (req.method === 'GET' && pathname === '/api/inspection-plans') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const todayKey = formatDateKey(new Date());
      const query = Object.fromEntries(reqUrl.searchParams);
      const list = filterByRecordScope(db.inspectionPlans || [], user, query, item => item.createdBy || '')
        .map(plan => sanitizeInspectionPlanForViewer({ ...plan, status: resolveInspectionPlanStatus(plan, todayKey) }, user));
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/inspection-plans') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const asset = requireExistingAsset(body.assetId || '', db);
      if (body.assetId && (!asset || asset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或归属不一致' });
      const planTitle = String(body.title || '').trim();
      if (!planTitle) return json(res, 400, { message: '请输入巡检计划名称' });
      const planCycle = String(body.cycle || 'monthly');
      if (!['daily', 'weekly', 'monthly', 'quarterly'].includes(planCycle)) return json(res, 400, { message: '无效的巡检周期' });
      const planStatus = String(body.status || '待执行');
      if (!['待执行', '执行中', '已完成', '已执行', '异常待处理', '已停用'].includes(planStatus)) return json(res, 400, { message: '无效的巡检计划状态' });
      const plan = {
        id: id('inspection'),
        projectId,
        assetId: body.assetId || '',
        title: planTitle,
        cycle: planCycle,
        nextDate: body.nextDate || '',
        owner: body.owner || user.name,
        status: planStatus,
        checklistTemplate: normalizeInspectionChecklistTemplate(body.checklistTemplate),
        createdBy: user.id,
        createdAt: now()
      };
      db.inspectionPlans.push(plan);
      appendAuditLog(db, user, 'create', 'inspectionPlan', plan.id, `创建巡检计划 ${plan.title}`, projectId);
      await writeDb(db);
      return json(res, 201, plan);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/inspection-plans/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const planId = pathname.split('/')[3];
      const target = (db.inspectionPlans || []).find(item => item.id === planId);
      if (!target) return json(res, 404, { message: '巡检计划不存在' });
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权修改该巡检计划' });
      const body = await readBody(req);
      if (body.title !== undefined || body.name !== undefined) target.title = body.title || body.name || target.title;
      if (body.cycle !== undefined || body.frequency !== undefined) target.cycle = body.frequency || body.cycle || target.cycle;
      if (body.nextDate !== undefined) target.nextDate = body.nextDate;
      if (body.owner !== undefined) target.owner = body.owner;
      if (body.description !== undefined) target.description = body.description;
      if (body.checklistTemplate !== undefined) target.checklistTemplate = normalizeInspectionChecklistTemplate(body.checklistTemplate);
      const newProjectId = (user.role === 'admin' && body.projectId !== undefined) ? body.projectId : target.projectId;
      if (body.assetId !== undefined) {
        const asset = requireExistingAsset(body.assetId, db);
        if (!asset || asset.projectId !== newProjectId) return json(res, 400, { message: '关联资产不存在或归属不一致' });
        target.assetId = body.assetId;
      }
      if (user.role === 'admin' && body.projectId !== undefined) {
        if (!requireExistingProject(body.projectId, db)) return json(res, 400, { message: '关联项目不存在' });
        const previousProjectId = target.projectId;
        target.projectId = body.projectId;
        if (previousProjectId !== body.projectId) {
          // 执行记录冗余了计划的项目归属，改项目后同步，避免旧项目仍能看到该计划的执行记录。
          for (const execution of db.inspectionExecutions || []) {
            if (execution.planId === target.id && execution.projectId !== body.projectId) execution.projectId = body.projectId;
          }
        }
        // 管理员改项目但未同时指定资产时，原关联资产可能属于旧项目；跨项目引用会让报表统计对不上，
        // 此处按新项目复校验，不一致即清空，与其它同类接口保持一致。
        if (body.assetId === undefined && target.assetId) {
          const linkedAsset = requireExistingAsset(target.assetId, db);
          if (!linkedAsset || linkedAsset.projectId !== body.projectId) target.assetId = '';
        }
      }
      appendAuditLog(db, user, 'update', 'inspectionPlan', planId, `修改巡检计划 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/inspection-plans/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const planId = pathname.split('/')[3];
      const index = (db.inspectionPlans || []).findIndex(item => item.id === planId);
      if (index === -1) return json(res, 404, { message: '巡检计划不存在' });
      const target = db.inspectionPlans[index];
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权删除该巡检计划' });
      const removedExecutionCount = (db.inspectionExecutions || []).filter(item => item.planId === planId).length;
      db.inspectionPlans.splice(index, 1);
      db.inspectionExecutions = (db.inspectionExecutions || []).filter(item => item.planId !== planId);
      // 级联清理该计划产生的通知，避免通知中心残留指向已删除计划的记录。
      removeNotificationsBySource(db, 'inspectionPlan', planId);
      appendAuditLog(db, user, 'delete', 'inspectionPlan', planId, `删除巡检计划 ${target.title}，同时移除 ${removedExecutionCount} 条执行记录`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/inspection-executions') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      const list = filterByRecordScope(db.inspectionExecutions || [], user, query, item => item.createdBy || '')
        .map(item => sanitizeInspectionExecutionForViewer(item, user));
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/inspection-executions') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req, inspectionAttachmentBodyLimitBytes);
      const plan = (db.inspectionPlans || []).find(item => item.id === body.planId);
      if (!plan) return json(res, 404, { message: '巡检计划不存在' });
      if (user.role !== 'admin' && !userHasProject(user, plan.projectId)) {
        return json(res, 403, { message: '无权执行该巡检计划' });
      }
      if (!['正常', '异常'].includes(String(body.result || '正常'))) return json(res, 400, { message: '无效的巡检结果' });
      const executedAt = body.executedAt || now().slice(0, 16);
      const executedDateKey = String(executedAt).slice(0, 10);
      let nextDate = body.nextDate || plan.nextDate || '';
      // 未填下次巡检日或原日期已过期时按周期自动顺延，避免计划执行后仍停留在逾期状态。
      if (!nextDate || nextDate < executedDateKey) {
        nextDate = computeNextInspectionDateKey(plan.cycle, executedDateKey) || nextDate;
      }
      const attachment = normalizeInspectionAttachment(body.attachment);
      const attachmentQuotaError = findAttachmentQuotaExceeded({
        items: db.inspectionExecutions,
        userId: user.id,
        projectId: plan.projectId,
        incomingBytes: inspectionAttachmentBytes(attachment),
        getOwnerId: item => item.createdBy || '',
        getProjectId: item => item.projectId || '',
        getBytes: item => inspectionAttachmentBytes(item.attachment),
        perUserBytes: inspectionAttachmentQuotaPerUserBytes,
        perProjectBytes: inspectionAttachmentQuotaPerProjectBytes,
        label: '巡检附件'
      });
      if (attachmentQuotaError) return json(res, 413, { message: attachmentQuotaError });
      const checklistItems = normalizeInspectionChecklistItems(body.checklistItems);
      const hasAbnormalItem = checklistItems.some(item => item.result === '异常');
      // 逐项结果优先于手工选择：只要存在异常项，整单必须记为异常，避免误判为正常后漏掉整改。
      const executionResult = hasAbnormalItem ? '异常' : (body.result || '正常');
      const execution = {
        id: id('inspectionExec'),
        planId: plan.id,
        projectId: plan.projectId,
        assetId: plan.assetId || '',
        executedAt,
        executor: body.executor || user.name,
        checklist: body.checklist || '',
        checklistItems,
        result: executionResult,
        issue: body.issue || '',
        suggestion: body.suggestion || '',
        ticketId: '',
        recheckStatus: '',
        recheckAt: '',
        recheckBy: '',
        recheckResult: '',
        attachment,
        nextDate,
        createdBy: user.id,
        createdAt: now()
      };
      db.inspectionExecutions = db.inspectionExecutions || [];
      db.inspectionExecutions.push(execution);
      if (execution.result === '异常') {
        const abnormalNames = checklistItems.filter(item => item.result === '异常').map(item => item.name);
        const createdAt = now();
        const ticket = {
          id: id('ticket'),
          ticketNo: nextTicketNo(db),
          projectId: plan.projectId,
          assetId: plan.assetId || '',
          title: `${plan.title || '巡检'} 巡检异常`,
          description: [
            abnormalNames.length ? `异常检查项：${abnormalNames.join('、')}` : '',
            execution.issue ? `异常说明：${execution.issue}` : '',
            execution.suggestion ? `整改建议：${execution.suggestion}` : ''
          ].filter(Boolean).join('\n') || '巡检发现异常，请跟进处理',
          category: '巡检异常',
          priority: '中',
          status: '待接单',
          assigneeId: '',
          assigneeName: '',
          dispatcherId: user.id,
          sourceType: 'inspectionExecution',
          sourceId: execution.id,
          slaHours: ticketSlaHours('中'),
          slaDeadline: computeTicketSlaDeadline(createdAt, '中'),
          slaStatus: '正常',
          acceptedAt: '',
          respondedAt: '',
          closedAt: '',
          resolution: '',
          customerConfirmedAt: '',
          customerComment: '',
          createdBy: user.id,
          createdAt,
          updatedAt: createdAt
        };
        db.tickets = db.tickets || [];
        db.tickets.push(ticket);
        execution.ticketId = ticket.id;
        execution.recheckStatus = '待复查';
      }
      // 统一按该计划下最新一条执行记录派生状态，避免补录历史记录时覆盖当前状态。
      refreshInspectionPlanFromExecutions(db, plan.id);
      appendAuditLog(db, user, 'execute', 'inspectionPlan', plan.id, `执行巡检 ${plan.title}，结果 ${execution.result}`, plan.projectId);
      if (execution.result === '异常') {
        createNotification(db, plan.projectId, '巡检异常提醒', `${plan.title} 巡检发现异常`, 'warning', 'inspection', 'inspectionPlan', plan.id);
        createNotification(db, plan.projectId, '巡检异常已转工单', `${execution.ticketId ? '已自动生成整改工单' : '请及时跟进整改'}：${plan.title}`, 'warning', 'ticket-created', 'ticket', execution.ticketId || plan.id);
      }
      await writeDb(db);
      return json(res, 201, execution);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/inspection-executions/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const executionId = pathname.split('/')[3];
      const target = (db.inspectionExecutions || []).find(item => item.id === executionId);
      if (!target) return json(res, 404, { message: '巡检执行记录不存在' });
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权修改该巡检执行记录' });
      const body = await readBody(req, inspectionAttachmentBodyLimitBytes);
      if (body.result !== undefined && !['正常', '异常'].includes(String(body.result))) return json(res, 400, { message: '无效的巡检结果' });
      if (body.executedAt !== undefined) target.executedAt = body.executedAt;
      if (body.executor !== undefined) target.executor = body.executor;
      if (body.result !== undefined) target.result = body.result;
      if (body.checklist !== undefined) target.checklist = body.checklist;
      if (body.checklistItems !== undefined) {
        target.checklistItems = normalizeInspectionChecklistItems(body.checklistItems);
        if (target.checklistItems.some(item => item.result === '异常')) target.result = '异常';
      }
      if (body.issue !== undefined) target.issue = body.issue;
      if (body.suggestion !== undefined) target.suggestion = body.suggestion;
      if (body.nextDate !== undefined) target.nextDate = body.nextDate;
      const attachment = normalizeInspectionAttachment(body.attachment);
      if (attachment && attachment.name) {
        const attachmentQuotaError = findAttachmentQuotaExceeded({
          items: db.inspectionExecutions,
          userId: user.id,
          projectId: target.projectId || '',
          incomingBytes: inspectionAttachmentBytes(attachment),
          excludeId: executionId,
          getOwnerId: item => item.createdBy || '',
          getProjectId: item => item.projectId || '',
          getBytes: item => inspectionAttachmentBytes(item.attachment),
          perUserBytes: inspectionAttachmentQuotaPerUserBytes,
          perProjectBytes: inspectionAttachmentQuotaPerProjectBytes,
          label: '巡检附件'
        });
        if (attachmentQuotaError) return json(res, 413, { message: attachmentQuotaError });
        target.attachment = attachment;
      }
      // 依据该计划下最新一条执行记录统一刷新状态，避免修改历史记录时错误覆盖计划当前状态。
      const plan = (db.inspectionPlans || []).find(item => item.id === target.planId);
      refreshInspectionPlanFromExecutions(db, target.planId);
      appendAuditLog(db, user, 'update', 'inspectionExecution', executionId, `修改巡检执行记录`, target.projectId || plan?.projectId || '');
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/inspection-executions/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const executionId = pathname.split('/')[3];
      const index = (db.inspectionExecutions || []).findIndex(item => item.id === executionId);
      if (index === -1) return json(res, 404, { message: '巡检执行记录不存在' });
      const target = db.inspectionExecutions[index];
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权删除该巡检执行记录' });
      db.inspectionExecutions.splice(index, 1);
      refreshInspectionPlanFromExecutions(db, target.planId);
      const plan = (db.inspectionPlans || []).find(item => item.id === target.planId);
      appendAuditLog(db, user, 'delete', 'inspectionExecution', executionId, `删除巡检执行记录 ${target.executedAt || target.id}`, target.projectId || plan?.projectId || '');
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && /^\/api\/inspection-executions\/[^/]+\/recheck$/.test(pathname)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const executionId = pathname.split('/')[3];
      const target = (db.inspectionExecutions || []).find(item => item.id === executionId);
      if (!target) return json(res, 404, { message: '巡检执行记录不存在' });
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权复查该巡检执行记录' });
      if (target.result !== '异常') return json(res, 400, { message: '仅异常记录需要复查' });
      if (target.recheckStatus === '已复查') return json(res, 400, { message: '该异常已完成复查' });
      const body = await readBody(req);
      const recheckResult = String(body.recheckResult || '').trim();
      if (!recheckResult) return json(res, 400, { message: '请填写复查结果' });
      target.recheckStatus = '已复查';
      target.recheckAt = now();
      target.recheckBy = user.id;
      target.recheckResult = recheckResult.slice(0, 2000);
      // 复查完成后同步推进关联工单，避免工单仍需人工去关联记录里查找复查结论。
      const linkedTicket = (db.tickets || []).find(item => item.id === target.ticketId);
      if (linkedTicket && ['待接单', '处理中'].includes(linkedTicket.status)) {
        linkedTicket.status = '待客户确认';
        linkedTicket.resolution = `${linkedTicket.resolution || '巡检异常已整改'}\n复查结果：${target.recheckResult}`;
        linkedTicket.respondedAt = target.recheckAt;
        linkedTicket.updatedAt = target.recheckAt;
        linkedTicket.slaStatus = resolveTicketSlaStatus(linkedTicket);
      }
      appendAuditLog(db, user, 'recheck', 'inspectionExecution', executionId, `复查巡检异常：${target.recheckResult}`, target.projectId);
      createNotification(db, target.projectId, '巡检异常已复查', `${target.recheckResult}`, 'info', 'inspection-recheck', 'inspectionExecution', target.id);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'GET' && pathname === '/api/spare-parts') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') {
        const query = Object.fromEntries(reqUrl.searchParams);
        return json(res, 200, paginateResult([], query, user));
      }
      const list = filterByProjectScope(db.spareParts || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'GET' && pathname === '/api/spare-part-movements') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') {
        const query = Object.fromEntries(reqUrl.searchParams);
        return json(res, 200, paginateResult([], query, user));
      }
      const query = Object.fromEntries(reqUrl.searchParams);
      const list = filterByRecordScope(db.sparePartMovements || [], user, query, item => item.operatorId || '');
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/spare-parts') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const assetId = body.assetId ? String(body.assetId) : '';
      if (assetId) {
        const asset = (db.assets || []).find(a => a.id === assetId);
        if (!asset) return json(res, 404, { message: '关联资产不存在' });
        if (asset.projectId !== projectId) return json(res, 400, { message: '关联资产不属于该项目' });
      }
      const quantityValue = body.quantity === undefined || body.quantity === '' ? 0 : Number(body.quantity);
      const safeStockValue = body.safeStock === undefined || body.safeStock === '' ? 0 : Number(body.safeStock);
      if (!Number.isFinite(quantityValue) || quantityValue < 0 || !Number.isFinite(safeStockValue) || safeStockValue < 0) {
        return json(res, 400, { message: '库存数量与安全库存必须为非负数' });
      }
      const spareName = String(body.name || '').trim();
      if (!spareName) return json(res, 400, { message: '备件名称不能为空' });
      const item = { id: id('spare'), projectId, assetId, name: spareName, model: body.model || '', quantity: quantityValue, safeStock: safeStockValue, unit: body.unit || '', location: body.location || '', notes: body.notes || '', createdAt: now() };
      db.spareParts.push(item);
      appendAuditLog(db, user, 'create', 'sparePart', item.id, `创建备件 ${item.name}`, projectId);
      if (item.quantity <= item.safeStock) createNotification(db, projectId, '备件库存提醒', `${item.name} 库存达到安全阈值`, 'warning', 'inventory', 'sparePart', item.id);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/spare-parts/') && !pathname.endsWith('/stock')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const sparePartId = pathname.split('/')[3];
      const body = await readBody(req);
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const target = (lockDb.spareParts || []).find(item => item.id === sparePartId);
        if (!target) return { status: 404, message: '备件不存在' };
        if (user.role !== 'admin' && !userHasProject(user, target.projectId)) {
          return { status: 403, message: '无权操作该备件' };
        }
        const nextProjectId = user.role === 'admin' && body.projectId !== undefined ? String(body.projectId || '').trim() : target.projectId;
        if (user.role === 'admin' && body.projectId !== undefined && !requireExistingProject(nextProjectId, lockDb)) {
          return { status: 400, message: '关联项目不存在' };
        }
        if (body.assetId !== undefined && body.assetId) {
          const asset = (lockDb.assets || []).find(a => a.id === String(body.assetId));
          if (!asset) return { status: 404, message: '关联资产不存在' };
          if (asset.projectId !== nextProjectId) return { status: 400, message: '关联资产不属于该项目' };
        }
        if (body.name !== undefined) {
          const nextSpareName = String(body.name || '').trim();
          if (!nextSpareName) return { status: 400, message: '备件名称不能为空' };
          target.name = nextSpareName;
        }
        if (body.model !== undefined) target.model = body.model;
        // 直接修改库存数量时补一条「盘点调整」流水，保证流水账与库存始终对得上。
        let inventoryAdjusted = false;
        let previousQuantity = target.quantity;
        if (body.quantity !== undefined) {
          const quantityValue = body.quantity === '' ? 0 : Number(body.quantity);
          if (!Number.isFinite(quantityValue) || quantityValue < 0) return { status: 400, message: '库存数量必须为非负数' };
          if (quantityValue !== target.quantity) inventoryAdjusted = true;
          target.quantity = quantityValue;
        }
        if (body.safeStock !== undefined) {
          const safeStockValue = body.safeStock === '' ? 0 : Number(body.safeStock);
          if (!Number.isFinite(safeStockValue) || safeStockValue < 0) return { status: 400, message: '安全库存必须为非负数' };
          target.safeStock = safeStockValue;
        }
        if (body.unit !== undefined) target.unit = body.unit;
        if (body.location !== undefined) target.location = body.location;
        if (body.notes !== undefined) target.notes = body.notes;
        if (body.assetId !== undefined) target.assetId = body.assetId;
        if (user.role === 'admin' && body.projectId !== undefined) {
          const previousProjectId = target.projectId;
          target.projectId = nextProjectId;
          if (previousProjectId !== nextProjectId) {
            // 出入库流水冗余了备件归属项目，改项目后同步，避免旧项目仍能看到该备件的流水。
            for (const movement of lockDb.sparePartMovements || []) {
              if (movement.sparePartId === target.id && movement.projectId !== nextProjectId) movement.projectId = nextProjectId;
            }
          }
        }
        // 项目变更后原关联资产可能已不属于该项目，无法确认归属时清空关联，避免跨项目脏引用。
        if (target.assetId) {
          const linkedAsset = (lockDb.assets || []).find(a => a.id === String(target.assetId));
          if (!linkedAsset || linkedAsset.projectId !== target.projectId) target.assetId = '';
        }
        if (inventoryAdjusted) {
          lockDb.sparePartMovements = lockDb.sparePartMovements || [];
          lockDb.sparePartMovements.push({
            id: id('spareMove'),
            sparePartId: target.id,
            projectId: target.projectId,
            assetId: target.assetId || '',
            type: 'adjust',
            quantity: Math.abs(target.quantity - previousQuantity),
            reason: `盘点调整：${previousQuantity} → ${target.quantity}`,
            operatorId: user.id,
            operatorName: user.name,
            createdAt: now()
          });
        }
        appendAuditLog(lockDb, user, 'update', 'sparePart', sparePartId, `修改备件 ${target.name}`, target.projectId);
        await writeDb(lockDb);
        return { status: 200, item: target };
      });
      if (!outcome.item) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, outcome.item);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/spare-parts/') && !pathname.endsWith('/stock')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const sparePartId = pathname.split('/')[3];
      // 备件与其出入库流水必须同一临界区内删除，否则并发出入库会留下指向已删备件的孤儿流水。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const index = (lockDb.spareParts || []).findIndex(item => item.id === sparePartId);
        if (index === -1) return { status: 404, message: '备件不存在' };
        const target = lockDb.spareParts[index];
        if (user.role !== 'admin' && !userHasProject(user, target.projectId)) {
          return { status: 403, message: '无权操作该备件' };
        }
        const removedMovementCount = (lockDb.sparePartMovements || []).filter(item => item.sparePartId === sparePartId).length;
        lockDb.spareParts.splice(index, 1);
        lockDb.sparePartMovements = (lockDb.sparePartMovements || []).filter(item => item.sparePartId !== sparePartId);
        // 备件库存提醒标记了 sourceType='sparePart'，随备件删除一并清理。
        removeNotificationsBySource(lockDb, 'sparePart', sparePartId);
        appendAuditLog(lockDb, user, 'delete', 'sparePart', sparePartId, `删除备件 ${target.name}，同时移除 ${removedMovementCount} 条出入库流水`, target.projectId);
        await writeDb(lockDb);
        return { status: 200 };
      });
      if (outcome.status !== 200) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/spare-parts/') && pathname.endsWith('/stock')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const sparePartId = pathname.split('/')[3];
      const body = await readBody(req);
      const type = body.type === 'inbound' ? 'inbound' : 'outbound';
      const quantity = Number(body.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return json(res, 400, { message: '数量必须大于 0' });
      }
      // 库存校验与扣减必须在同一临界区内基于最新库存完成，否则并发出库会绕过负库存保护。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const target = (lockDb.spareParts || []).find(item => item.id === sparePartId);
        if (!target) return { status: 404, message: '备件不存在' };
        if (user.role !== 'admin' && !userHasProject(user, target.projectId)) {
          return { status: 403, message: '无权操作该备件' };
        }
        if (type === 'outbound' && target.quantity < quantity) {
          return { status: 400, message: '库存不足，无法消耗' };
        }
        target.quantity = type === 'inbound' ? target.quantity + quantity : target.quantity - quantity;
        const movement = {
          id: id('spareMove'),
          sparePartId: target.id,
          projectId: target.projectId,
          assetId: target.assetId || '',
          type,
          quantity,
          reason: body.reason || '',
          operatorId: user.id,
          operatorName: user.name,
          createdAt: now()
        };
        lockDb.sparePartMovements = lockDb.sparePartMovements || [];
        lockDb.sparePartMovements.push(movement);
        appendAuditLog(lockDb, user, 'stock', 'sparePart', target.id, `${type === 'inbound' ? '入库' : '消耗'}备件 ${target.name} 数量 ${quantity}`, target.projectId);
        if (target.quantity <= target.safeStock) {
          createNotification(lockDb, target.projectId, '备件库存提醒', `${target.name} 当前库存 ${target.quantity}，已达到安全阈值`, 'warning', 'inventory', 'sparePart', target.id);
        }
        await writeDb(lockDb);
        return { status: 200, item: target, movement };
      });
      if (!outcome.item) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, { item: outcome.item, movement: outcome.movement });
    }

    if (req.method === 'GET' && pathname === '/api/spare-part-vendors') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '无权查看供应商信息' });
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.sparePartVendors || [], user, item => item.projectId);
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.status) list = list.filter(item => item.status === query.status);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/spare-part-vendors') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { message: '供应商名称不能为空' });
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const vendor = {
        id: id('spareVendor'),
        projectId,
        name: name.slice(0, 128),
        contactName: String(body.contactName || '').slice(0, 64),
        contactPhone: String(body.contactPhone || '').slice(0, 32),
        email: String(body.email || '').slice(0, 128),
        address: String(body.address || '').slice(0, 256),
        status: body.status === 'inactive' ? 'inactive' : 'active',
        notes: String(body.notes || '').slice(0, 500),
        createdAt: now()
      };
      db.sparePartVendors.push(vendor);
      appendAuditLog(db, user, 'create', 'sparePartVendor', vendor.id, `创建供应商 ${vendor.name}`, projectId);
      await writeDb(db);
      return json(res, 201, vendor);
    }

    if (req.method && ['PUT', 'DELETE'].includes(req.method) && pathname.match(/^\/api\/spare-part-vendors\/[^/]+$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const vendorId = pathname.split('/')[3];
      const vendor = (db.sparePartVendors || []).find(item => item.id === vendorId);
      if (!vendor) return json(res, 404, { message: '供应商不存在' });
      if (!canViewProject(user, vendor.projectId)) return json(res, 403, { message: '无权操作该供应商' });
      if (req.method === 'DELETE') {
        const referenced = (db.sparePartPurchases || []).some(item => item.vendorId === vendorId && item.status !== 'cancelled');
        if (referenced) return json(res, 409, { message: '该供应商存在未取消的采购申请，无法删除' });
        db.sparePartVendors = (db.sparePartVendors || []).filter(item => item.id !== vendorId);
        appendAuditLog(db, user, 'delete', 'sparePartVendor', vendorId, `删除供应商 ${vendor.name}`, vendor.projectId);
        await writeDb(db);
        return json(res, 200, { ok: true });
      }
      const body = await readBody(req);
      if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) return json(res, 400, { message: '供应商名称不能为空' });
        vendor.name = name.slice(0, 128);
      }
      if (body.contactName !== undefined) vendor.contactName = String(body.contactName || '').slice(0, 64);
      if (body.contactPhone !== undefined) vendor.contactPhone = String(body.contactPhone || '').slice(0, 32);
      if (body.email !== undefined) vendor.email = String(body.email || '').slice(0, 128);
      if (body.address !== undefined) vendor.address = String(body.address || '').slice(0, 256);
      if (body.status !== undefined) vendor.status = body.status === 'inactive' ? 'inactive' : 'active';
      if (body.notes !== undefined) vendor.notes = String(body.notes || '').slice(0, 500);
      appendAuditLog(db, user, 'update', 'sparePartVendor', vendor.id, `修改供应商 ${vendor.name}`, vendor.projectId);
      await writeDb(db);
      return json(res, 200, vendor);
    }

    if (req.method === 'GET' && pathname === '/api/spare-part-purchases') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '无权查看采购申请' });
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.sparePartPurchases || [], user, item => item.projectId);
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.status) list = list.filter(item => item.status === query.status);
      if (query.sparePartId) list = list.filter(item => item.sparePartId === query.sparePartId);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/spare-part-purchases') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const sparePart = (db.spareParts || []).find(item => item.id === String(body.sparePartId || ''));
      if (!sparePart) return json(res, 400, { message: '关联备件不存在' });
      if (!canViewProject(user, sparePart.projectId)) return json(res, 403, { message: '无权为该备件发起采购' });
      const vendor = (db.sparePartVendors || []).find(item => item.id === String(body.vendorId || ''));
      if (vendor && vendor.projectId !== sparePart.projectId) return json(res, 400, { message: '供应商不属于该备件项目' });
      const quantity = Number(body.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) return json(res, 400, { message: '采购数量必须大于 0' });
      const unitPrice = normalizeMoney(body.unitPrice);
      if (unitPrice < 0) return json(res, 400, { message: '采购单价不能为负数' });
      const purchase = {
        id: id('sparePurchase'),
        purchaseNo: nextPurchaseNo(db),
        projectId: sparePart.projectId,
        sparePartId: sparePart.id,
        vendorId: vendor ? vendor.id : '',
        quantity,
        unitPrice,
        totalAmount: normalizeMoney(quantity * unitPrice),
        requestedAt: now(),
        expectedAt: body.expectedAt || '',
        receivedAt: '',
        status: 'pending',
        applicantId: user.id,
        applicantName: user.name || user.username || '',
        approverId: '',
        approverName: '',
        approvalNote: '',
        notes: String(body.notes || '').slice(0, 500),
        createdBy: user.id,
        createdAt: now(),
        updatedAt: now()
      };
      db.sparePartPurchases.push(purchase);
      appendAuditLog(db, user, 'create', 'sparePartPurchase', purchase.id, `提交备件采购申请 ${sparePart.name} x${quantity}`, sparePart.projectId);
      await writeDb(db);
      return json(res, 201, purchase);
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/spare-part-purchases\/[^/]+\/(approve|receive|cancel)$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const parts = pathname.split('/');
      const purchaseId = parts[3];
      const action = parts[4];
      const purchase = (db.sparePartPurchases || []).find(item => item.id === purchaseId);
      if (!purchase) return json(res, 404, { message: '采购申请不存在' });
      if (!canViewProject(user, purchase.projectId)) return json(res, 403, { message: '无权处理该采购申请' });
      const body = await readBody(req).catch(() => ({}));
      if (action === 'approve') {
        if (user.role !== 'admin') return json(res, 403, { message: '仅管理员可审批采购申请' });
        if (purchase.status !== 'pending') return json(res, 400, { message: '仅待审批的申请可以审批' });
        purchase.status = 'approved';
        purchase.approverId = user.id;
        purchase.approverName = user.name || user.username || '';
        purchase.approvalNote = String(body.note || '').slice(0, 500);
        appendAuditLog(db, user, 'approved', 'sparePartPurchase', purchase.id, `审批通过备件采购 ${purchase.purchaseNo}`, purchase.projectId);
      } else if (action === 'receive') {
        if (purchase.status !== 'approved') return json(res, 400, { message: '仅已审批的申请可以收货' });
        const sparePart = (db.spareParts || []).find(item => item.id === purchase.sparePartId);
        if (!sparePart) return json(res, 404, { message: '关联备件已删除，无法入库' });
        sparePart.quantity = Number(sparePart.quantity || 0) + Number(purchase.quantity || 0);
        db.sparePartMovements.push({
          id: id('spareMove'),
          sparePartId: sparePart.id,
          projectId: sparePart.projectId,
          assetId: sparePart.assetId || '',
          type: 'inbound',
          quantity: Number(purchase.quantity || 0),
          reason: `采购入库 ${purchase.purchaseNo}`,
          operatorId: user.id,
          operatorName: user.name || user.username || '',
          createdAt: now()
        });
        purchase.status = 'received';
        purchase.receivedAt = now();
        appendAuditLog(db, user, 'receive', 'sparePartPurchase', purchase.id, `备件采购到货入库 ${purchase.purchaseNo}`, purchase.projectId);
      } else {
        if (purchase.status === 'received') return json(res, 400, { message: '已入库的采购申请不能取消' });
        purchase.status = 'cancelled';
        appendAuditLog(db, user, 'cancel', 'sparePartPurchase', purchase.id, `取消备件采购 ${purchase.purchaseNo}`, purchase.projectId);
      }
      purchase.updatedAt = now();
      await writeDb(db);
      return json(res, 200, purchase);
    }

    if (req.method === 'GET' && pathname === '/api/spare-part-inventory-tasks') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '无权查看备件盘点' });
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.sparePartInventoryTasks || [], user, item => item.projectId);
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.status) list = list.filter(item => item.status === query.status);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/spare-part-inventory-tasks') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { message: '盘点任务名称不能为空' });
      const items = (db.spareParts || [])
        .filter(item => item.projectId === projectId)
        .map(item => ({
          sparePartId: item.id,
          name: item.name,
          expectedQuantity: Number(item.quantity || 0),
          actualQuantity: null,
          difference: 0,
          result: 'unchecked',
          note: '',
          checkedAt: ''
        }));
      if (!items.length) return json(res, 400, { message: '当前项目暂无备件可盘点' });
      const task = {
        id: id('spareInv'),
        projectId,
        name: name.slice(0, 128),
        status: 'pending',
        createdBy: user.id,
        createdByName: user.name || user.username || '',
        completedAt: '',
        items,
        createdAt: now()
      };
      db.sparePartInventoryTasks.push(task);
      appendAuditLog(db, user, 'create', 'sparePartInventoryTask', task.id, `创建备件盘点任务 ${task.name}`, projectId);
      await writeDb(db);
      return json(res, 201, task);
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/spare-part-inventory-tasks\/[^/]+\/(record|complete)$/)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const parts = pathname.split('/');
      const taskId = parts[3];
      const action = parts[4];
      const task = (db.sparePartInventoryTasks || []).find(item => item.id === taskId);
      if (!task) return json(res, 404, { message: '盘点任务不存在' });
      if (!canViewProject(user, task.projectId)) return json(res, 403, { message: '无权操作该盘点任务' });
      if (task.status === 'completed') return json(res, 400, { message: '盘点任务已完成' });
      const body = await readBody(req);
      if (action === 'record') {
        const entry = task.items.find(item => item.sparePartId === String(body.sparePartId || ''));
        if (!entry) return json(res, 404, { message: '盘点明细不存在' });
        const actual = Number(body.actualQuantity);
        if (!Number.isFinite(actual) || actual < 0) return json(res, 400, { message: '实盘数量必须为非负数' });
        entry.actualQuantity = actual;
        entry.difference = normalizeMoney(actual - entry.expectedQuantity);
        entry.result = entry.difference === 0 ? 'match' : 'mismatch';
        entry.note = String(body.note || '').slice(0, 500);
        entry.checkedAt = now();
        task.status = 'running';
        appendAuditLog(db, user, 'update', 'sparePartInventoryTask', task.id, `登记备件盘点 ${entry.name} 实盘 ${actual}`, task.projectId);
        await writeDb(db);
        return json(res, 200, task);
      }
      // 完成盘点时按实盘数量回写库存，并为每条差异生成 adjust 流水，保证账实一致且可追溯。
      const unchecked = task.items.filter(item => item.result === 'unchecked');
      if (unchecked.length) return json(res, 400, { message: `仍有 ${unchecked.length} 项备件未盘点` });
      for (const entry of task.items) {
        const sparePart = (db.spareParts || []).find(item => item.id === entry.sparePartId);
        if (!sparePart || entry.actualQuantity === null) continue;
        if (sparePart.quantity === entry.actualQuantity) continue;
        const delta = normalizeMoney(entry.actualQuantity - sparePart.quantity);
        sparePart.quantity = entry.actualQuantity;
        db.sparePartMovements.push({
          id: id('spareMove'),
          sparePartId: sparePart.id,
          projectId: sparePart.projectId,
          assetId: sparePart.assetId || '',
          type: 'adjust',
          quantity: delta,
          reason: `盘点调整 ${task.name}`,
          operatorId: user.id,
          operatorName: user.name || user.username || '',
          createdAt: now()
        });
      }
      task.status = 'completed';
      task.completedAt = now();
      appendAuditLog(db, user, 'complete', 'sparePartInventoryTask', task.id, `完成备件盘点 ${task.name}`, task.projectId);
      await writeDb(db);
      return json(res, 200, task);
    }

    if (req.method === 'GET' && pathname === '/api/change-records') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      const rejectionMap = new Map();
      (db.approvals || []).forEach(a => {
        if (a.category === 'change' && a.status === '已驳回' && a.rejectionReason) {
          rejectionMap.set(a.relatedId, a.rejectionReason);
        }
      });
      // GET 不应改写共享状态，驳回原因以只读视图方式合成。
      const list = filterByRecordScope(db.changeRecords || [], user, query, item => item.createdBy || '')
        .map(item => (!item.rejectionReason && rejectionMap.has(item.id) ? { ...item, rejectionReason: rejectionMap.get(item.id) } : item));
      const sorted = parseSortQuery(query, list, 'createdAt');
      const presented = sorted.map(item => sanitizeChangeRecordForViewer(item, user));
      return json(res, 200, paginateResult(presented, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/change-records') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      if (!title || !content) return json(res, 400, { message: '变更标题和变更内容不能为空' });
      const project = requireExistingProject(projectId, db);
      if (!project) return json(res, 400, { message: '关联项目不存在' });
      const asset = requireExistingAsset(body.assetId, db);
      if (body.assetId && (!asset || asset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或不属于当前项目' });
      const approver = requireExistingUser(body.approverId, db);
      if (!approver || !canViewProject(approver, projectId) || !['admin', 'engineer'].includes(approver.role)) return json(res, 400, { message: '审批人不存在或无权限审批当前项目' });
      if (approver.id === user.id) return json(res, 400, { message: '不能指定提交人本人为审批人' });
      const customer = requireExistingUser(body.customerId, db);
      if (!customer || !userHasProject(customer, projectId) || customer.role !== 'customer') return json(res, 400, { message: '甲方客户不存在或不属于当前项目' });
      const riskLevel = String(body.riskLevel || '中').trim();
      if (!['低', '中', '高'].includes(riskLevel)) return json(res, 400, { message: '风险等级无效' });
      const item = {
        id: id('change'),
        projectId,
        assetId: body.assetId || '',
        title: title,
        content: content,
        riskLevel,
        status: '待运维审批',
        approverId: approver.id,
        approverName: approver.name,
        customerId: customer.id,
        customerName: customer.name,
        approvalId: '',
        createdBy: user.id,
        createdAt: now()
      };
      const approval = {
        id: id('approval'),
        projectId,
        category: 'change',
        title: item.title,
        content: item.content,
        status: '待运维审批',
        requestedBy: user.id,
        approvedBy: '',
        approverId: approver.id,
        customerId: customer.id,
        currentStage: 'approver',
        relatedId: item.id,
        createdAt: now(),
        updatedAt: now()
      };
      item.approvalId = approval.id;
      db.changeRecords.push(item);
      db.approvals.push(approval);
      appendAuditLog(db, user, 'create', 'changeRecord', item.id, `提交变更 ${item.title}`, projectId);
      createNotification(db, projectId, '变更待审批', `${item.title} 已提交给 ${approver.name} 审批`, 'warning', 'approval', 'changeRecord', item.id);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/change-records/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const recordId = pathname.split('/')[3];
      const body = await readBody(req);
      // 变更记录与其关联审批记录必须同一临界区完成读写，否则并发的审批决策/删除会基于旧快照覆盖彼此，产生孤儿审批或状态回退。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const target = (lockDb.changeRecords || []).find(item => item.id === recordId);
        if (!target) return { status: 404, message: '变更记录不存在' };
        if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return { status: 403, message: '仅支持修改自己创建的变更记录' };
        if (target.status !== '待运维审批' && target.status !== '已驳回') return { status: 400, message: '仅草稿或已驳回状态的变更记录支持修改' };
        const wasRejected = target.status === '已驳回';
        const oldStatus = target.status;
        // 管理员改项目时先校验项目存在，再按新项目归属校验关联资产/审批人/甲方客户。
        const nextChangeProjectId = (user.role === 'admin' && body.projectId !== undefined) ? String(body.projectId || '').trim() : target.projectId;
        const changeProjectChanged = nextChangeProjectId !== target.projectId;
        if (changeProjectChanged) {
          if (!requireExistingProject(nextChangeProjectId, lockDb)) return { status: 400, message: '关联项目不存在' };
          target.projectId = nextChangeProjectId;
        }
        if (body.title !== undefined) target.title = String(body.title || '').trim() || target.title;
        if (body.content !== undefined) target.content = String(body.content || '').trim() || target.content;
        if (body.riskLevel !== undefined) {
          const nextRiskLevel = String(body.riskLevel).trim();
          if (!['低', '中', '高'].includes(nextRiskLevel)) return { status: 400, message: '风险等级无效' };
          target.riskLevel = nextRiskLevel;
        }
        if (body.assetId !== undefined) {
          if (body.assetId) {
            const nextChangeAsset = requireExistingAsset(body.assetId, lockDb);
            if (!nextChangeAsset || nextChangeAsset.projectId !== target.projectId) return { status: 400, message: '关联资产不存在或不属于当前项目' };
          }
          target.assetId = body.assetId;
        } else if (changeProjectChanged && target.assetId) {
          const linkedAsset = requireExistingAsset(target.assetId, lockDb);
          if (!linkedAsset || linkedAsset.projectId !== target.projectId) target.assetId = '';
        }
        if (body.approverId !== undefined) {
          const approver = requireExistingUser(body.approverId, lockDb);
          if (!approver || !canViewProject(approver, target.projectId) || !['admin', 'engineer'].includes(approver.role)) return { status: 400, message: '审批人不存在或无权限审批当前项目' };
          if (approver.id === target.createdBy) return { status: 400, message: '不能指定提交人本人为审批人' };
          target.approverId = approver.id;
          target.approverName = approver.name;
        } else if (changeProjectChanged && target.approverId) {
          const approver = requireExistingUser(target.approverId, lockDb);
          if (!approver || !canViewProject(approver, target.projectId) || !['admin', 'engineer'].includes(approver.role)) {
            target.approverId = '';
            target.approverName = '';
          }
        }
        if (body.customerId !== undefined) {
          const customer = requireExistingUser(body.customerId, lockDb);
          if (!customer || !userHasProject(customer, target.projectId) || customer.role !== 'customer') return { status: 400, message: '甲方客户不存在或不属于当前项目' };
          target.customerId = customer.id;
          target.customerName = customer.name;
        } else if (changeProjectChanged && target.customerId) {
          const customer = requireExistingUser(target.customerId, lockDb);
          if (!customer || !userHasProject(customer, target.projectId) || customer.role !== 'customer') {
            target.customerId = '';
            target.customerName = '';
          }
        }
        // 变更内容/审批人/项目变更后同步到关联审批记录，避免审批端展示过期或跨项目信息。
        const linkedApproval = (lockDb.approvals || []).find(a => a.relatedId === target.id && a.category === 'change');
        if (linkedApproval) {
          linkedApproval.title = target.title;
          linkedApproval.content = target.content;
          linkedApproval.approverId = target.approverId;
          linkedApproval.customerId = target.customerId;
          linkedApproval.projectId = target.projectId;
        }
        if (wasRejected) {
          target.status = '待运维审批';
          // 重新提交后清理上一轮驳回原因，避免终态残留误导审批人。
          target.rejectionReason = '';
          const approver = (lockDb.users || []).find(u => u.id === target.approverId);
          createNotification(lockDb, target.projectId, '变更待审批', `${target.title} 已重新提交${oldStatus === '已驳回' ? '（原已驳回）' : ''}，待${approver ? approver.name : '审批人'}审批`, 'warning', 'approval', 'changeRecord', target.id);
          if (linkedApproval) {
            linkedApproval.status = '待运维审批';
            linkedApproval.currentStage = 'approver';
            linkedApproval.approvedBy = '';
            linkedApproval.rejectionReason = '';
            linkedApproval.updatedAt = now();
          }
        }
        appendAuditLog(lockDb, user, 'update', 'changeRecord', recordId, `修改变更记录 ${target.title}`, target.projectId);
        await writeDb(lockDb);
        return { status: 200, body: target };
      });
      if (outcome.status !== 200) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, outcome.body);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/change-records/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const recordId = pathname.split('/')[3];
      // 删除变更记录会级联移除其关联审批，必须与并发的审批决策/变更编辑同一临界区，避免审批被重新写回成为孤儿。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const target = (lockDb.changeRecords || []).find(item => item.id === recordId);
        if (!target) return { status: 404, message: '变更记录不存在' };
        if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return { status: 403, message: '仅支持删除自己创建的变更记录' };
        // 变更记录进入审批流转后仅管理员可删除，创建者仅能删除尚未进入审批或已被驳回的记录。
        if (user.role !== 'admin' && !['待运维审批', '已驳回'].includes(target.status)) {
          return { status: 403, message: '该变更记录已进入审批流程，仅管理员可删除' };
        }
        lockDb.changeRecords = (lockDb.changeRecords || []).filter(item => item.id !== recordId);
        // 同一变更可能关联多条审批（主审批 + 后续追加的变更审批），全部一并清理，避免遗留指向已删变更的孤儿审批。
        const affectedApprovalIds = new Set();
        for (const entry of lockDb.approvals || []) {
          if (entry.id === target.approvalId || (entry.category === 'change' && entry.relatedId === recordId)) {
            affectedApprovalIds.add(entry.id);
          }
        }
        if (affectedApprovalIds.size) {
          lockDb.approvals = (lockDb.approvals || []).filter(item => !affectedApprovalIds.has(item.id));
        }
        // 级联清理该变更及其审批产生的通知，避免遗留空通知。
        for (const affectedId of affectedApprovalIds) removeNotificationsBySource(lockDb, 'approval', affectedId);
        removeNotificationsBySource(lockDb, 'changeRecord', recordId);
        appendAuditLog(lockDb, user, 'delete', 'changeRecord', recordId, `删除变更记录 ${target.title}`, target.projectId);
        await writeDb(lockDb);
        return { status: 200 };
      });
      if (outcome.status !== 200) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/incidents') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      const list = filterByRecordScope(db.incidentRecords || [], user, query, item => item.createdBy || '');
      const sorted = parseSortQuery(query, list, 'createdAt');
      const presented = user.role === 'customer'
        ? sorted.map(item => ({ ...item, description: '', resolution: '' }))
        : sorted;
      return json(res, 200, paginateResult(presented, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/incidents') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      if (body.status !== undefined && !incidentStatusOptions.includes(String(body.status))) return json(res, 400, { message: '无效的故障处理状态' });
      if (body.slaStatus !== undefined && !incidentSlaStatusOptions.includes(String(body.slaStatus))) return json(res, 400, { message: '无效的 SLA 状态' });
      if (body.severity !== undefined && !incidentSeverityOptions.includes(String(body.severity))) return json(res, 400, { message: '无效的严重级别' });
      const incidentTitle = String(body.title || '').trim();
      if (!incidentTitle) return json(res, 400, { message: '故障标题不能为空' });
      const incidentOccurredAt = String(body.occurredAt || '').trim();
      if (!incidentOccurredAt || Number.isNaN(new Date(incidentOccurredAt).getTime())) {
        return json(res, 400, { message: '请选择有效的故障发生时间' });
      }
      const incidentAsset = requireExistingAsset(body.assetId, db);
      if (body.assetId && (!incidentAsset || incidentAsset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或不属于当前项目' });
      const item = { id: id('incident'), projectId, assetId: body.assetId || '', title: incidentTitle, faultType: body.faultType || '', severity: body.severity || '中', slaStatus: body.slaStatus || '正常', status: body.status || '处理中', description: body.description || '', occurredAt: incidentOccurredAt, resolution: body.resolution || '', createdBy: user.id, createdAt: now() };
      db.incidentRecords.push(item);
      appendAuditLog(db, user, 'create', 'incident', item.id, `登记故障 ${item.title}`, projectId);
      if (item.slaStatus === '超时') createNotification(db, projectId, 'SLA 超时提醒', `${item.title} 已超时`, 'error', 'incident', 'incident', item.id);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/incidents/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const incidentId = pathname.split('/')[3];
      const target = (db.incidentRecords || []).find(item => item.id === incidentId);
      if (!target) return json(res, 404, { message: '故障记录不存在' });
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持修改自己创建的故障记录' });
      const body = await readBody(req);
      const previousIncidentSlaStatus = String(target.slaStatus || '正常');
      if (body.status !== undefined && !incidentStatusOptions.includes(String(body.status))) return json(res, 400, { message: '无效的故障处理状态' });
      if (body.slaStatus !== undefined && !incidentSlaStatusOptions.includes(String(body.slaStatus))) return json(res, 400, { message: '无效的 SLA 状态' });
      if (body.severity !== undefined && !incidentSeverityOptions.includes(String(body.severity))) return json(res, 400, { message: '无效的严重级别' });
      if (body.title !== undefined) {
        const nextIncidentTitle = String(body.title || '').trim();
        if (!nextIncidentTitle) return json(res, 400, { message: '故障标题不能为空' });
        target.title = nextIncidentTitle;
      }
      if (body.faultType !== undefined) target.faultType = body.faultType;
      if (body.severity !== undefined) target.severity = body.severity;
      if (body.slaStatus !== undefined) target.slaStatus = body.slaStatus;
      if (body.status !== undefined) target.status = body.status;
      if (body.description !== undefined) target.description = body.description;
      if (body.occurredAt !== undefined) {
        const nextOccurredAt = String(body.occurredAt || '').trim();
        if (!nextOccurredAt || Number.isNaN(new Date(nextOccurredAt).getTime())) {
          return json(res, 400, { message: '请选择有效的故障发生时间' });
        }
        target.occurredAt = nextOccurredAt;
      }
      if (body.resolution !== undefined) target.resolution = body.resolution;
      if (user.role === 'admin' && body.projectId !== undefined) {
        if (!requireExistingProject(body.projectId, db)) return json(res, 400, { message: '关联项目不存在' });
        // 项目变更后原关联资产可能已不属于新项目，无法确认归属时清空。
        if (target.assetId) {
          const linkedIncidentAsset = requireExistingAsset(target.assetId, db);
          if (!linkedIncidentAsset || linkedIncidentAsset.projectId !== body.projectId) target.assetId = '';
        }
        target.projectId = body.projectId;
      }
      if (body.assetId !== undefined) {
        if (body.assetId) {
          const nextAsset = requireExistingAsset(body.assetId, db);
          if (!nextAsset || nextAsset.projectId !== target.projectId) return json(res, 400, { message: '关联资产不存在或不属于当前项目' });
        }
        target.assetId = body.assetId;
      }
      // SLA 由「正常/预警」跃迁到「超时」时补发提醒；仅改其他字段或重复提交「超时」不会重复通知。
      if (previousIncidentSlaStatus !== '超时' && target.slaStatus === '超时') {
        createNotification(db, target.projectId, 'SLA 超时提醒', `${target.title} 已超时`, 'error', 'incident', 'incident', target.id);
      }
      appendAuditLog(db, user, 'update', 'incident', incidentId, `修改故障记录 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/incidents/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const incidentId = pathname.split('/')[3];
      const index = (db.incidentRecords || []).findIndex(item => item.id === incidentId);
      if (index === -1) return json(res, 404, { message: '故障记录不存在' });
      const target = db.incidentRecords[index];
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持删除自己创建的故障记录' });
      db.incidentRecords.splice(index, 1);
      removeNotificationsBySource(db, 'incident', incidentId);
      appendAuditLog(db, user, 'delete', 'incident', incidentId, `删除故障记录 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/tickets') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByRecordScope(db.tickets || [], user, query, item => item.assigneeId || item.createdBy || '');
      if (query.status) list = list.filter(item => item.status === query.status);
      if (query.priority) list = list.filter(item => item.priority === query.priority);
      if (query.slaStatus) list = list.filter(item => item.slaStatus === query.slaStatus);
      if (query.q) {
        const keyword = String(query.q).toLowerCase();
        list = list.filter(item => [item.ticketNo, item.title, item.description, item.assigneeName]
          .some(value => String(value || '').toLowerCase().includes(keyword)));
      }
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted.map(item => sanitizeTicketForViewer(item, user)), query, user));
    }

    if (req.method === 'POST' && pathname === '/api/tickets') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const title = String(body.title || '').trim();
      if (!title) return json(res, 400, { message: '工单标题不能为空' });
      if (title.length > 120) return json(res, 400, { message: '工单标题不能超过 120 个字符' });
      if (body.category !== undefined && !ticketCategoryOptions.includes(String(body.category))) {
        return json(res, 400, { message: '无效的工单分类' });
      }
      if (body.priority !== undefined && !ticketPriorityOptions.includes(String(body.priority))) {
        return json(res, 400, { message: '无效的优先级' });
      }
      if (body.assetId) {
        const asset = requireExistingAsset(body.assetId, db);
        if (!asset || asset.projectId !== projectId) return json(res, 400, { message: '关联资产不存在或不属于当前项目' });
      }
      const assignee = body.assigneeId ? requireExistingUser(body.assigneeId, db) : null;
      if (body.assigneeId) {
        if (!assignee) return json(res, 400, { message: '指派的处理人不存在' });
        if (user.role !== 'admin' && !userHasProject(assignee, projectId)) {
          return json(res, 400, { message: '处理人不属于当前项目' });
        }
      }
      const priority = body.priority || '中';
      const createdAt = now();
      const item = {
        id: id('ticket'),
        ticketNo: nextTicketNo(db),
        projectId,
        assetId: body.assetId || '',
        title,
        description: String(body.description || '').slice(0, 4000),
        category: body.category || '服务请求',
        priority,
        status: '待接单',
        assigneeId: assignee?.id || '',
        assigneeName: assignee?.name || '',
        dispatcherId: user.id,
        sourceType: body.sourceType || '',
        sourceId: body.sourceId || '',
        slaHours: ticketSlaHours(priority),
        slaDeadline: computeTicketSlaDeadline(createdAt, priority),
        slaStatus: '正常',
        acceptedAt: '',
        respondedAt: '',
        closedAt: '',
        resolution: '',
        customerConfirmedAt: '',
        customerComment: '',
        createdBy: user.id,
        createdAt,
        updatedAt: createdAt
      };
      db.tickets = db.tickets || [];
      db.tickets.push(item);
      appendAuditLog(db, user, 'create', 'ticket', item.id, `创建工单 ${item.ticketNo} ${item.title}`, projectId);
      createNotification(db, projectId, '新工单待接单', `${item.ticketNo} ${item.title}（${item.priority}）已派发`, 'info', 'ticket-created', 'ticket', item.id);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/tickets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const ticketId = pathname.split('/')[3];
      const target = (db.tickets || []).find(item => item.id === ticketId);
      if (!target) return json(res, 404, { message: '工单不存在' });
      if (!canOperateTicket(user, target)) return json(res, 403, { message: '无权修改该工单' });
      if (['已完成', '已关闭'].includes(target.status)) return json(res, 400, { message: '已完成或已关闭的工单不可修改' });
      const body = await readBody(req);
      if (body.priority !== undefined && !ticketPriorityOptions.includes(String(body.priority))) {
        return json(res, 400, { message: '无效的优先级' });
      }
      if (body.category !== undefined && !ticketCategoryOptions.includes(String(body.category))) {
        return json(res, 400, { message: '无效的工单分类' });
      }
      if (body.title !== undefined) {
        const nextTitle = String(body.title || '').trim();
        if (!nextTitle) return json(res, 400, { message: '工单标题不能为空' });
        target.title = nextTitle.slice(0, 120);
      }
      if (body.description !== undefined) target.description = String(body.description || '').slice(0, 4000);
      if (body.category !== undefined) target.category = body.category;
      if (body.priority !== undefined && body.priority !== target.priority) {
        target.priority = body.priority;
        target.slaHours = ticketSlaHours(body.priority);
        target.slaDeadline = computeTicketSlaDeadline(target.createdAt, body.priority);
        target.slaStatus = resolveTicketSlaStatus(target);
      }
      if (body.assetId !== undefined) {
        if (body.assetId) {
          const asset = requireExistingAsset(body.assetId, db);
          if (!asset || asset.projectId !== target.projectId) return json(res, 400, { message: '关联资产不存在或不属于当前项目' });
        }
        target.assetId = body.assetId;
      }
      if (body.assigneeId !== undefined) {
        const assignee = body.assigneeId ? requireExistingUser(body.assigneeId, db) : null;
        if (body.assigneeId && !assignee) return json(res, 400, { message: '指派的处理人不存在' });
        if (assignee && user.role !== 'admin' && !userHasProject(assignee, target.projectId)) {
          return json(res, 400, { message: '处理人不属于当前项目' });
        }
        target.assigneeId = assignee?.id || '';
        target.assigneeName = assignee?.name || '';
      }
      target.updatedAt = now();
      appendAuditLog(db, user, 'update', 'ticket', ticketId, `修改工单 ${target.ticketNo}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'POST' && /^\/api\/tickets\/[^/]+\/actions$/.test(pathname)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const ticketId = pathname.split('/')[3];
      const target = (db.tickets || []).find(item => item.id === ticketId);
      if (!target) return json(res, 404, { message: '工单不存在' });
      const body = await readBody(req);
      const action = String(body.action || '');
      const isCustomer = user.role === 'customer';
      if (!isCustomer && !canOperateTicket(user, target)) return json(res, 403, { message: '无权操作该工单' });
      if (isCustomer && (!userHasProject(user, target.projectId) || action !== 'confirm')) {
        return json(res, 403, { message: '仅可确认本项目的待确认工单' });
      }
      const previousStatus = target.status;

      if (action === 'accept') {
        if (target.status !== '待接单') return json(res, 400, { message: '仅待接单工单可接单' });
        target.status = '处理中';
        target.acceptedAt = now();
        if (!target.assigneeId) {
          target.assigneeId = user.id;
          target.assigneeName = user.name || user.username || '';
        }
      } else if (action === 'transfer') {
        if (['已完成', '已关闭'].includes(target.status)) return json(res, 400, { message: '已完成或已关闭的工单不可转派' });
        const assignee = requireExistingUser(String(body.assigneeId || ''), db);
        if (!assignee) return json(res, 400, { message: '请选择有效的转派处理人' });
        if (user.role !== 'admin' && !userHasProject(assignee, target.projectId)) {
          return json(res, 400, { message: '处理人不属于当前项目' });
        }
        target.assigneeId = assignee.id;
        target.assigneeName = assignee.name || assignee.username || '';
        if (target.status === '处理中') target.status = '待接单';
        createNotification(db, target.projectId, '工单转派', `${target.ticketNo} ${target.title} 已转派给 ${target.assigneeName}`, 'info', 'ticket-transfer', 'ticket', target.id);
      } else if (action === 'resolve') {
        if (target.status !== '处理中') return json(res, 400, { message: '仅处理中的工单可回单' });
        const resolution = String(body.resolution || '').trim();
        if (!resolution) return json(res, 400, { message: '请填写处理结论' });
        target.resolution = resolution.slice(0, 4000);
        target.status = '待客户确认';
        target.respondedAt = now();
        createNotification(db, target.projectId, '工单待确认', `${target.ticketNo} ${target.title} 已处理完成，等待客户确认`, 'info', 'ticket-resolve', 'ticket', target.id);
      } else if (action === 'close') {
        if (target.status !== '待客户确认') return json(res, 400, { message: '仅待客户确认的工单可关闭' });
        target.status = '已完成';
        target.closedAt = now();
      } else if (action === 'confirm') {
        if (user.role !== 'customer') return json(res, 403, { message: '仅客户可确认工单' });
        if (target.status !== '待客户确认') return json(res, 400, { message: '仅待客户确认的工单可确认' });
        target.customerConfirmedAt = now();
        target.customerComment = String(body.comment || '').slice(0, 1000);
        target.status = '已完成';
        target.closedAt = target.closedAt || now();
      } else {
        return json(res, 400, { message: '无效的工单操作' });
      }

      target.updatedAt = now();
      target.slaStatus = resolveTicketSlaStatus(target);
      appendAuditLog(db, user, action === 'confirm' ? 'confirm' : action, 'ticket', ticketId, `工单 ${target.ticketNo} 状态 ${previousStatus} -> ${target.status}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/tickets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const ticketId = pathname.split('/')[3];
      const index = (db.tickets || []).findIndex(item => item.id === ticketId);
      if (index === -1) return json(res, 404, { message: '工单不存在' });
      const target = db.tickets[index];
      if (!canDeleteTicket(user, target)) return json(res, 403, { message: '仅支持删除自己创建的工单' });
      db.tickets.splice(index, 1);
      removeNotificationsBySource(db, 'ticket', ticketId);
      appendAuditLog(db, user, 'delete', 'ticket', ticketId, `删除工单 ${target.ticketNo}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/duty-shifts') {
      // 值班交接含内部遗留问题，仅运维与管理角色可见。
      const user = requireEditor(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByProjectScope(db.dutyShifts || [], user, item => item.projectId);
      if (query.status) list = list.filter(item => item.status === query.status);
      if (query.dutyDate) list = list.filter(item => item.dutyDate === query.dutyDate);
      const sorted = parseSortQuery(query, list, 'dutyDate');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/duty-shifts') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const dutyDate = String(body.dutyDate || '').slice(0, 10);
      if (!parseDateOnly(dutyDate)) return json(res, 400, { message: '请选择有效的值班日期' });
      const startTime = String(body.startTime || '').slice(0, 5);
      const endTime = String(body.endTime || '').slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime) {
        return json(res, 400, { message: '请填写有效的值班开始与结束时间' });
      }
      const primaryUser = requireExistingUser(String(body.primaryUserId || ''), db);
      if (!primaryUser) return json(res, 400, { message: '请选择值班人' });
      if (user.role !== 'admin' && !userHasProject(primaryUser, projectId)) {
        return json(res, 400, { message: '值班人不属于当前项目' });
      }
      if (body.backupUserId) {
        const backupUser = requireExistingUser(String(body.backupUserId), db);
        if (!backupUser) return json(res, 400, { message: '备班人不存在' });
        if (user.role !== 'admin' && !userHasProject(backupUser, projectId)) {
          return json(res, 400, { message: '备班人不属于当前项目' });
        }
      }
      const duplicate = (db.dutyShifts || []).some(item => item.projectId === projectId
        && item.dutyDate === dutyDate
        && item.primaryUserId === primaryUser.id
        && item.startTime === startTime
        && item.endTime === endTime);
      if (duplicate) return json(res, 409, { message: '同一值班人在该时段已有排班' });
      const createdAt = now();
      const item = {
        id: id('dutyShift'),
        projectId,
        title: String(body.title || '').trim().slice(0, 120) || `${dutyDate} 值班`,
        dutyDate,
        startTime,
        endTime,
        shiftType: body.shiftType || '白班',
        primaryUserId: primaryUser.id,
        backupUserId: body.backupUserId || '',
        status: '待开始',
        handoverContent: '',
        handoverIssue: '',
        handoverAt: '',
        handoverBy: '',
        receivedBy: '',
        createdBy: user.id,
        createdAt,
        updatedAt: createdAt
      };
      db.dutyShifts = db.dutyShifts || [];
      db.dutyShifts.push(item);
      appendAuditLog(db, user, 'create', 'dutyShift', item.id, `新增值班排班 ${item.title}`, projectId);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/duty-shifts/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const shiftId = pathname.split('/')[3];
      const target = (db.dutyShifts || []).find(item => item.id === shiftId);
      if (!target) return json(res, 404, { message: '值班排班不存在' });
      if (!canOperateTicket(user, target)) return json(res, 403, { message: '无权修改该值班排班' });
      if (target.status === '已交接') return json(res, 400, { message: '已交接的排班不可修改' });
      const body = await readBody(req);
      if (body.title !== undefined) target.title = String(body.title || '').trim().slice(0, 120) || target.title;
      if (body.dutyDate !== undefined) {
        const dutyDate = String(body.dutyDate || '').slice(0, 10);
        if (!parseDateOnly(dutyDate)) return json(res, 400, { message: '请选择有效的值班日期' });
        target.dutyDate = dutyDate;
      }
      if (body.startTime !== undefined) target.startTime = String(body.startTime || '').slice(0, 5);
      if (body.endTime !== undefined) target.endTime = String(body.endTime || '').slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(target.startTime) || !/^\d{2}:\d{2}$/.test(target.endTime) || target.startTime >= target.endTime) {
        return json(res, 400, { message: '请填写有效的值班开始与结束时间' });
      }
      if (body.shiftType !== undefined) target.shiftType = String(body.shiftType || '白班');
      if (body.primaryUserId !== undefined) {
        const primaryUser = requireExistingUser(String(body.primaryUserId || ''), db);
        if (!primaryUser) return json(res, 400, { message: '请选择值班人' });
        if (user.role !== 'admin' && !userHasProject(primaryUser, target.projectId)) {
          return json(res, 400, { message: '值班人不属于当前项目' });
        }
        target.primaryUserId = primaryUser.id;
      }
      if (body.backupUserId !== undefined) {
        if (body.backupUserId) {
          const backupUser = requireExistingUser(String(body.backupUserId), db);
          if (!backupUser) return json(res, 400, { message: '备班人不存在' });
          if (user.role !== 'admin' && !userHasProject(backupUser, target.projectId)) {
            return json(res, 400, { message: '备班人不属于当前项目' });
          }
        }
        target.backupUserId = body.backupUserId || '';
      }
      if (body.status !== undefined) {
        if (!dutyShiftStatusOptions.includes(String(body.status))) return json(res, 400, { message: '无效的值班状态' });
        target.status = body.status;
      }
      target.updatedAt = now();
      appendAuditLog(db, user, 'update', 'dutyShift', shiftId, `修改值班排班 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'POST' && /^\/api\/duty-shifts\/[^/]+\/handover$/.test(pathname)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const shiftId = pathname.split('/')[3];
      const target = (db.dutyShifts || []).find(item => item.id === shiftId);
      if (!target) return json(res, 404, { message: '值班排班不存在' });
      if (!canOperateTicket(user, target)) return json(res, 403, { message: '无权交接该值班排班' });
      if (target.status === '已交接') return json(res, 400, { message: '该排班已交接' });
      const body = await readBody(req);
      const handoverContent = String(body.handoverContent || '').trim();
      if (!handoverContent) return json(res, 400, { message: '请填写交接内容' });
      const receivedBy = body.receivedBy ? requireExistingUser(String(body.receivedBy), db) : null;
      if (body.receivedBy && !receivedBy) return json(res, 400, { message: '接班人不存在' });
      if (receivedBy && user.role !== 'admin' && !userHasProject(receivedBy, target.projectId)) {
        return json(res, 400, { message: '接班人不属于当前项目' });
      }
      target.handoverContent = handoverContent.slice(0, 4000);
      target.handoverIssue = String(body.handoverIssue || '').slice(0, 4000);
      target.handoverAt = now();
      target.handoverBy = user.id;
      target.receivedBy = receivedBy?.id || '';
      target.status = '已交接';
      target.updatedAt = target.handoverAt;
      appendAuditLog(db, user, 'handover', 'dutyShift', shiftId, `交接值班 ${target.title}`, target.projectId);
      createNotification(db, target.projectId, '值班交接完成', `${target.title} 已完成交接`, 'info', 'duty-handover', 'dutyShift', target.id);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/duty-shifts/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const shiftId = pathname.split('/')[3];
      const index = (db.dutyShifts || []).findIndex(item => item.id === shiftId);
      if (index === -1) return json(res, 404, { message: '值班排班不存在' });
      const target = db.dutyShifts[index];
      if (!canOperateTicket(user, target)) return json(res, 403, { message: '无权删除该值班排班' });
      db.dutyShifts.splice(index, 1);
      removeNotificationsBySource(db, 'dutyShift', shiftId);
      appendAuditLog(db, user, 'delete', 'dutyShift', shiftId, `删除值班排班 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/approvals') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      let list = filterByProjectScope(db.approvals || [], user, item => item.projectId);
      if (user.role === 'customer') list = list.filter(item => item.customerId === user.id);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      const presented = user.role === 'customer'
        ? sorted.map(item => ({
          id: item.id,
          title: item.title,
          status: item.status,
          currentStage: item.currentStage,
          category: item.category,
          relatedId: item.relatedId,
          projectId: item.projectId,
          createdAt: item.createdAt,
          customerId: item.customerId
        }))
        : sorted.map(item => (canViewApprovalDetail(user, item) ? item : { ...item, content: '', rejectionReason: '' }));
      return json(res, 200, paginateResult(presented, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/approvals') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const approver = requireExistingUser(body.approverId, db);
      if (!approver || !canViewProject(approver, projectId) || !['admin', 'engineer'].includes(approver.role)) return json(res, 400, { message: '审批人不存在或无权限审批当前项目' });
      if (approver.id === user.id) return json(res, 400, { message: '不能指定提交人本人为审批人' });
      const customer = requireExistingUser(body.customerId, db);
      if (!customer || !userHasProject(customer, projectId) || customer.role !== 'customer') return json(res, 400, { message: '甲方客户不存在或不属于当前项目' });
      const relatedId = body.relatedId || '';
      if (body.category === 'change' && relatedId) {
        const changeRecord = (db.changeRecords || []).find(entry => entry.id === relatedId);
        if (!changeRecord || changeRecord.projectId !== projectId) {
          return json(res, 400, { message: '关联变更记录不存在或不属于当前项目' });
        }
      }
      const item = { id: id('approval'), projectId, category: body.category || '', title: body.title || '', content: body.content || '', status: '待运维审批', requestedBy: user.id, approvedBy: '', approverId: approver.id, customerId: customer.id, currentStage: 'approver', relatedId, createdAt: now(), updatedAt: now() };
      db.approvals.push(item);
      appendAuditLog(db, user, 'create', 'approval', item.id, `提交审批 ${item.title}`, projectId);
      createNotification(db, projectId, '审批待处理', `${item.title} 等待 ${approver.name} 审批`, 'warning', 'approval', 'approval', item.id);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/approvals/') && pathname.endsWith('/decision')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const approvalId = pathname.split('/')[3];
      const body = await readBody(req);
      // 仅接受明确的通过/驳回决策，避免缺省或异常状态被误判为驳回。
      const decision = String(body.status || '').trim();
      // 审批决策会同时改写关联变更记录，必须与并发的变更编辑/删除同一临界区，避免状态回退或写回已被删除的审批。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const item = (lockDb.approvals || []).find(entry => entry.id === approvalId);
        if (!item) return { status: 404, message: '审批记录不存在' };
        if (!canDecideApproval(user, item)) return { status: 403, message: '当前账号无权处理该审批' };
        // 已结束的审批不可再次决策，避免重复流转覆盖最终结果。
        if (item.currentStage === 'completed' || item.status === '已通过' || item.status === '已驳回') {
          return { status: 400, message: '该审批已结束，不能重复处理' };
        }
        if (!['approved', 'rejected'].includes(decision)) {
          return { status: 400, message: '无效的审批决策' };
        }
        if (decision === 'approved') {
          if (item.currentStage === 'approver') {
            item.status = '待客户确认';
            item.currentStage = 'customer';
            item.approvedBy = user.id;
            createNotification(lockDb, item.projectId, '审批流转通知', `${item.title} 已通过运维审批，等待甲方客户确认`, 'warning', 'approval', 'approval', item.id);
          } else {
            item.status = '已通过';
            item.currentStage = 'completed';
            item.approvedBy = user.id;
            createNotification(lockDb, item.projectId, '审批结果通知', `${item.title} 已完成客户确认`, 'info', 'approval', 'approval', item.id);
          }
        } else {
          item.status = '已驳回';
          item.currentStage = 'completed';
          item.approvedBy = user.id;
          item.rejectionReason = body.reason || '';
          createNotification(lockDb, item.projectId, '审批结果通知', `${item.title} 已驳回${item.rejectionReason ? '：' + item.rejectionReason : ''}`, 'warning', 'approval', 'approval', item.id);
        }
        item.updatedAt = now();
        if (body.relatedType === 'changeRecord' || item.category === 'change') {
          const target = (lockDb.changeRecords || []).find(entry => entry.id === item.relatedId);
          // 仅同步同项目的变更记录，避免跨项目篡改他人数据。
          if (target && target.projectId === item.projectId) { target.status = item.status; target.rejectionReason = item.rejectionReason || ''; }
        }
        appendAuditLog(lockDb, user, 'decision', 'approval', item.id, `${item.title} ${item.status}`, item.projectId);
        await writeDb(lockDb);
        return { status: 200, body: item };
      });
      if (outcome.status !== 200) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, outcome.body);
    }

    // 删除审批：审批与关联变更记录属于同一闭环。
    // 管理员删除属于变更流程的审批时，级联清理关联变更记录及其通知，避免变更记录停留在无审批的半闭环状态；
    // 其他账号仅能作废自己提交、尚未结束且不在变更流程中的审批。
    if (req.method === 'DELETE' && /^\/api\/approvals\/[^/]+$/.test(pathname)) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const approvalId = pathname.split('/')[3];
      // 删除审批需与并发的审批决策/变更编辑同一临界区，避免在关联判断后审批又被并发改写。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const target = (lockDb.approvals || []).find(item => item.id === approvalId);
        if (!target) return { status: 404, message: '审批记录不存在' };
        const linkedChange = (lockDb.changeRecords || []).find(entry => entry.approvalId === target.id || (target.category === 'change' && entry.id === target.relatedId));
        if (linkedChange && user.role !== 'admin') {
          return { status: 400, message: '该审批属于变更记录流程，请删除对应变更记录' };
        }
        if (user.role !== 'admin') {
          if (target.requestedBy !== user.id) return { status: 403, message: '仅支持作废自己提交的审批' };
          if (target.currentStage === 'completed') return { status: 403, message: '已完成的审批不能作废' };
        }
        let cascadedChangeId = '';
        if (linkedChange) {
          // 同一变更记录可能关联多条审批，一并清理，避免遗留指向已删变更的孤儿审批。
          const affectedApprovalIds = new Set([target.id]);
          for (const entry of lockDb.approvals || []) {
            if (entry.id === linkedChange.approvalId || entry.relatedId === linkedChange.id) affectedApprovalIds.add(entry.id);
          }
          lockDb.approvals = (lockDb.approvals || []).filter(item => !affectedApprovalIds.has(item.id));
          for (const affectedId of affectedApprovalIds) removeNotificationsBySource(lockDb, 'approval', affectedId);
          lockDb.changeRecords = (lockDb.changeRecords || []).filter(entry => entry.id !== linkedChange.id);
          removeNotificationsBySource(lockDb, 'changeRecord', linkedChange.id);
          cascadedChangeId = linkedChange.id;
        } else {
          lockDb.approvals = (lockDb.approvals || []).filter(item => item.id !== approvalId);
          removeNotificationsBySource(lockDb, 'approval', approvalId);
        }
        appendAuditLog(lockDb, user, 'delete', 'approval', target.id, cascadedChangeId ? `删除审批 ${target.title} 并级联清理变更记录` : `作废审批 ${target.title}`, target.projectId);
        await writeDb(lockDb);
        return { status: 200, cascadedChangeId };
      });
      if (outcome.status !== 200) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, { ok: true, cascadedChangeId: outcome.cascadedChangeId || '' });
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/targets') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const assetVersionMap = new Map((db.assets || []).map(item => [item.id, item.version || '']));
      const list = filterByProjectScope(db.aiInspectionTargets || [], user, item => item.projectId)
        .map(item => sanitizeAiInspectionTargetForViewer({ ...item, systemVersion: item.assetId && assetVersionMap.has(item.assetId) ? assetVersionMap.get(item.assetId) : item.systemVersion }, user));
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/targets') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = resolveWriteProjectId(user, body.projectId);
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const asset = requireExistingAsset(body.assetId || '', db);
      if (body.assetId && (!asset || asset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或归属不一致' });
      if (!String(body.name || '').trim() || !String(body.address || '').trim()) return json(res, 400, { message: '巡检对象名称和管理地址不能为空' });
      if (!validateHost(String(body.address || '').trim())) return json(res, 400, { message: '管理地址格式无效，请填写 IP 或主机名' });
      const addressGate = await resolveMonitorTargetAddress(String(body.address || '').trim());
      if (!addressGate.ok) return json(res, 400, { message: addressGate.message });
      if (body.port !== undefined && body.port !== '' && body.port !== null && Number(body.port) !== 0 && !validatePort(body.port)) {
        return json(res, 400, { message: '管理端口需为 1-65535 之间的整数' });
      }
      const category = ['network', 'security'].includes(body.category) ? body.category : 'server';
      const protocol = normalizeAiInspectionProtocol(body.protocol, category);
      const authType = normalizeAiInspectionAuthType(body.authType, protocol);
      const account = String(body.account || '').trim();
      const credentialDomain = String(body.credentialDomain || '').trim();
      const password = String(body.password || '').trim();
      const privateKey = String(body.privateKey || '').trim();
      const accessToken = String(body.accessToken || '').trim();
      const community = String(body.community || '').trim();
      if (['password', 'key'].includes(authType) && !account) return json(res, 400, { message: '当前认证方式需要填写接入账号' });
      if (authType === 'password' && !password) return json(res, 400, { message: '当前认证方式需要填写接入密码' });
      if (authType === 'key' && !privateKey) return json(res, 400, { message: '当前认证方式需要填写私钥内容' });
      if (authType === 'token' && !accessToken) return json(res, 400, { message: '当前认证方式需要填写 Token' });
      if (authType === 'community' && !community) return json(res, 400, { message: '当前认证方式需要填写 Community' });
      const backupMode = ['cli', 'web'].includes(body.backupMode) ? body.backupMode : 'cli';
      const backupCommand = String(body.backupCommand || '').trim();
      if (backupCommand && user.role !== 'admin') return json(res, 403, { message: '仅管理员可配置 CLI 备份命令' });
      if (backupMode === 'cli' && backupCommand) {
        const commandValidation = validateBackupCommand(backupCommand);
        if (!commandValidation.ok) return json(res, 400, { message: commandValidation.message });
      }
      const item = {
        id: id('aiTarget'),
        projectId,
        assetId: body.assetId || '',
        name: String(body.name || '').trim(),
        category,
        address: String(body.address || '').trim(),
        protocol,
        port: Number(body.port || 0),
        authType,
        account,
        credentialDomain: ['winrm', 'wmi'].includes(protocol) ? credentialDomain : '',
        password: authType === 'password' ? encryptCredential(password) : '',
        privateKey: authType === 'key' ? encryptCredential(privateKey) : '',
        accessToken: authType === 'token' ? encryptCredential(accessToken) : '',
        community: authType === 'community' ? encryptCredential(community) : '',
        systemVersion: String(asset ? asset.version || '' : body.systemVersion || '').trim(),
        backupMode,
        backupCommand,
        webBackupPath: String(body.webBackupPath || '').trim(),
        webBackupMethod: String(body.webBackupMethod || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
        webLoginPath: String(body.webLoginPath || '').trim(),
        webUsernameSelector: String(body.webUsernameSelector || '').trim(),
        webPasswordSelector: String(body.webPasswordSelector || '').trim(),
        webBackupButtonSelector: String(body.webBackupButtonSelector || '').trim(),
        location: String(body.location || '').trim(),
        notes: String(body.notes || '').trim(),
        createdBy: user.id,
        createdAt: now()
      };
      db.aiInspectionTargets = db.aiInspectionTargets || [];
      db.aiInspectionTargets.push(item);
      appendAuditLog(db, user, 'create', 'aiInspectionTarget', item.id, `创建智能巡检对象 ${item.name}`, projectId);
      await writeDb(db);
      return json(res, 201, sanitizeAiInspectionTargetForViewer(item, user));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/ai-inspection/targets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const targetId = pathname.split('/')[4];
      const index = (db.aiInspectionTargets || []).findIndex(item => item.id === targetId);
      if (index === -1) return json(res, 404, { message: '巡检对象不存在' });
      const target = db.aiInspectionTargets[index];
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权删除该巡检对象' });
      // 对象删除会连带清理任务与备份计划，需先收集其 ID，以便同步移除它们产生的通知。
      const cascadeTaskIds = (db.aiInspectionTasks || []).filter(item => item.targetId === targetId).map(item => item.id);
      const cascadePlanIds = (db.configBackupPlans || []).filter(item => item.targetId === targetId).map(item => item.id);
      db.aiInspectionTargets.splice(index, 1);
      db.aiInspectionTasks = (db.aiInspectionTasks || []).filter(item => item.targetId !== targetId);
      db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => item.targetId !== targetId);
      db.configBackupPlans = (db.configBackupPlans || []).filter(item => item.targetId !== targetId);
      db.configBackupRecords = (db.configBackupRecords || []).filter(item => item.targetId !== targetId);
      cascadeTaskIds.forEach(idValue => removeNotificationsBySource(db, 'aiInspectionTask', idValue));
      cascadePlanIds.forEach(idValue => removeNotificationsBySource(db, 'configBackupPlan', idValue));
      appendAuditLog(db, user, 'delete', 'aiInspectionTarget', targetId, `删除智能巡检对象 ${target.name}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/ai-inspection/targets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const targetId = pathname.split('/')[4];
      const target = (db.aiInspectionTargets || []).find(item => item.id === targetId);
      if (!target) return json(res, 404, { message: '巡检对象不存在' });
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权修改该巡检对象' });
      const body = await readBody(req);
      const nextProjectId = user.role === 'admin' && body.projectId !== undefined ? body.projectId : target.projectId;
      if (!requireExistingProject(nextProjectId, db)) return json(res, 400, { message: '关联项目不存在' });
      if (body.name !== undefined) {
        const nextTargetName = String(body.name || '').trim();
        if (!nextTargetName) return json(res, 400, { message: '巡检对象名称不能为空' });
        target.name = nextTargetName;
      }
      if (body.category !== undefined) target.category = ['network', 'security'].includes(body.category) ? body.category : 'server';
      if (body.address !== undefined || body.managementAddress !== undefined) {
        const nextAddress = String(body.address || body.managementAddress || '').trim();
        if (nextAddress && !validateHost(nextAddress)) return json(res, 400, { message: '管理地址格式无效，请填写 IP 或主机名' });
        if (nextAddress) {
          const addressGate = await resolveMonitorTargetAddress(nextAddress);
          if (!addressGate.ok) return json(res, 400, { message: addressGate.message });
        }
        target.address = nextAddress;
      }
      if (body.protocol !== undefined) {
        target.protocol = normalizeAiInspectionProtocol(body.protocol, target.category);
      }
      if (body.port !== undefined || body.managementPort !== undefined) {
        const nextPort = body.port ?? body.managementPort ?? 0;
        if (nextPort !== '' && nextPort !== null && Number(nextPort) !== 0 && !validatePort(nextPort)) {
          return json(res, 400, { message: '管理端口需为 1-65535 之间的整数' });
        }
        target.port = Number(nextPort || 0);
      }
      if (body.authType !== undefined) {
        target.authType = normalizeAiInspectionAuthType(body.authType, target.protocol);
      }
      if (body.account !== undefined) {
        target.account = String(body.account || '').trim();
      }
      if (body.credentialDomain !== undefined) {
        target.credentialDomain = String(body.credentialDomain || '').trim();
      }
      // 回填的编辑表单不会携带原始凭据（接口只返回 has* 标记），空字符串表示"不修改"，
      // 直接覆盖会导致已保存的密码/私钥/Token/Community 被加密空串清空。
      if (body.password !== undefined && String(body.password) !== '') {
        target.password = encryptCredential(String(body.password));
      }
      if (body.privateKey !== undefined && String(body.privateKey) !== '') {
        target.privateKey = encryptCredential(String(body.privateKey));
      }
      if (body.accessToken !== undefined && String(body.accessToken) !== '') {
        target.accessToken = encryptCredential(String(body.accessToken));
      }
      if (body.community !== undefined && String(body.community) !== '') {
        target.community = encryptCredential(String(body.community));
      }
      // 切换认证方式后必须补齐对应的凭据，避免生成无法完成巡检的巡检对象。
      if (['password', 'key'].includes(target.authType) && !target.account) return json(res, 400, { message: '当前认证方式需要填写接入账号' });
      if (target.authType === 'password' && !target.password) return json(res, 400, { message: '当前认证方式需要填写接入密码' });
      if (target.authType === 'key' && !target.privateKey) return json(res, 400, { message: '当前认证方式需要填写私钥内容' });
      if (target.authType === 'token' && !target.accessToken) return json(res, 400, { message: '当前认证方式需要填写 Token' });
      if (target.authType === 'community' && !target.community) return json(res, 400, { message: '当前认证方式需要填写 Community' });
      if (body.description !== undefined || body.notes !== undefined) {
        target.notes = String(body.description || body.notes || '').trim();
      }
      let linkedAsset = target.assetId ? requireExistingAsset(target.assetId, db) : null;
      if (linkedAsset && linkedAsset.projectId !== nextProjectId) {
        linkedAsset = null;
        target.assetId = '';
      }
      if (body.assetId !== undefined) {
        linkedAsset = requireExistingAsset(body.assetId, db);
        if (body.assetId && (!linkedAsset || linkedAsset.projectId !== nextProjectId)) return json(res, 400, { message: '关联资产不存在或归属不一致' });
        target.assetId = body.assetId;
      }
      if (user.role === 'admin' && body.projectId !== undefined) {
        const previousProjectId = target.projectId;
        target.projectId = nextProjectId;
        if (previousProjectId !== nextProjectId) syncAiInspectionTargetProject(target, nextProjectId, db);
      }
      target.systemVersion = linkedAsset ? String(linkedAsset.version || '').trim() : String(body.systemVersion || target.systemVersion || '').trim();
      if (body.backupMode !== undefined) target.backupMode = ['cli', 'web'].includes(body.backupMode) ? body.backupMode : 'cli';
      if (body.backupCommand !== undefined) {
        const backupCommand = String(body.backupCommand || '').trim();
        if (backupCommand && user.role !== 'admin') return json(res, 403, { message: '仅管理员可配置 CLI 备份命令' });
        if ((target.backupMode || 'cli') === 'cli' && backupCommand) {
          const commandValidation = validateBackupCommand(backupCommand);
          if (!commandValidation.ok) return json(res, 400, { message: commandValidation.message });
        }
        target.backupCommand = backupCommand;
      }
      if (body.webBackupPath !== undefined) target.webBackupPath = String(body.webBackupPath || '').trim();
      if (body.webBackupMethod !== undefined) target.webBackupMethod = String(body.webBackupMethod || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
      if (body.webLoginPath !== undefined) target.webLoginPath = String(body.webLoginPath || '').trim();
      if (body.webUsernameSelector !== undefined) target.webUsernameSelector = String(body.webUsernameSelector || '').trim();
      if (body.webPasswordSelector !== undefined) target.webPasswordSelector = String(body.webPasswordSelector || '').trim();
      if (body.webBackupButtonSelector !== undefined) target.webBackupButtonSelector = String(body.webBackupButtonSelector || '').trim();
      if (body.location !== undefined) target.location = String(body.location || '').trim();
      appendAuditLog(db, user, 'update', 'aiInspectionTarget', targetId, `修改智能巡检对象 ${target.name}`, target.projectId);
      await writeDb(db);
      return json(res, 200, sanitizeAiInspectionTargetForViewer(target, user));
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/templates') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = (db.aiInspectionTemplates || []).filter(item => canUseAiInspectionTemplate(user, item));
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/templates') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      if (user.role !== 'admin' && !userProjectIds(user).length) {
        return json(res, 400, { message: '当前账号未绑定项目，无法创建巡检模板' });
      }
      const body = await readBody(req);
      const templateProjectId = user.role === 'admin' ? String(body.projectId || '').trim() : '';
      if (templateProjectId && !requireExistingProject(templateProjectId, db)) {
        return json(res, 400, { message: '关联项目不存在' });
      }
      const metrics = normalizeAiInspectionMetrics(body.metrics, body.category || 'server');
      if (!metrics.length) return json(res, 400, { message: '巡检模板至少包含一个指标' });
      const item = {
        id: id('aiTpl'),
        projectId: user.role === 'admin' ? templateProjectId : resolveWriteProjectId(user, body.projectId),
        name: String(body.name || '').trim(),
        category: body.category || 'server',
        description: String(body.description || '').trim(),
        metrics,
        createdBy: user.id,
        createdAt: now()
      };
      if (!item.name) return json(res, 400, { message: '巡检模板名称不能为空' });
      db.aiInspectionTemplates = db.aiInspectionTemplates || [];
      db.aiInspectionTemplates.push(item);
      appendAuditLog(db, user, 'create', 'aiInspectionTemplate', item.id, `创建智能巡检模板 ${item.name}`, item.projectId || '');
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/ai-inspection/templates/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const templateId = pathname.split('/')[4];
      const index = (db.aiInspectionTemplates || []).findIndex(item => item.id === templateId);
      if (index === -1) return json(res, 404, { message: '巡检模板不存在' });
      const target = db.aiInspectionTemplates[index];
      if (target.createdBy === 'system') return json(res, 400, { message: '内置模板不支持删除' });
      if (user.role !== 'admin' && (target.createdBy !== user.id || !userHasProject(user, target.projectId))) {
        return json(res, 403, { message: '仅支持删除自己创建的巡检模板' });
      }
      const relatedTasks = (db.aiInspectionTasks || []).filter(item => item.templateId === templateId);
      if (relatedTasks.length) {
        return json(res, 400, { message: `该模板有 ${relatedTasks.length} 个关联任务，请先删除或迁移关联任务后再删除模板` });
      }
      db.aiInspectionTemplates.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'aiInspectionTemplate', templateId, `删除智能巡检模板 ${target.name}`, target.projectId || '');
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/ai-inspection/templates/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const templateId = pathname.split('/')[4];
      const index = (db.aiInspectionTemplates || []).findIndex(item => item.id === templateId);
      if (index === -1) return json(res, 404, { message: '巡检模板不存在' });
      const target = db.aiInspectionTemplates[index];
      if (user.role !== 'admin' && (target.createdBy !== user.id || !userHasProject(user, target.projectId))) {
        return json(res, 403, { message: '仅支持修改自己创建的巡检模板' });
      }
      const body = await readBody(req);
      if (body.name !== undefined) target.name = String(body.name || '').trim();
      if (body.category !== undefined) target.category = body.category;
      if (body.metrics !== undefined) {
        const metrics = normalizeAiInspectionMetrics(body.metrics, target.category || 'server');
        if (!metrics.length) return json(res, 400, { message: '巡检模板至少包含一个指标' });
        target.metrics = metrics;
      }
      if (body.description !== undefined) target.description = String(body.description || '').trim();
      appendAuditLog(db, user, 'update', 'aiInspectionTemplate', templateId, `修改智能巡检模板 ${target.name}`, target.projectId || '');
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/tasks') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') {
        const query = Object.fromEntries(reqUrl.searchParams);
        return json(res, 200, paginateResult([], query, user));
      }
      const referenceMs = Date.now();
      const resultMap = new Map();
      let changed = false;
      (db.aiInspectionResults || []).forEach(r => {
        const current = resultMap.get(r.taskId);
        if (!current || String(r.createdAt || '') >= String(current.createdAt || '')) resultMap.set(r.taskId, r);
      });
      (db.aiInspectionTasks || []).forEach(task => {
        if (!task.cycle) return;
        if (task.status === '已停用' || task.status === '执行中') return;
        // 读接口不清理历史结果；仅当任务逾期超过一个完整周期（服务停机漏跑）时才顺延跳过，
        // 逾期在一个周期以内的任务留给调度器补跑，避免打开列表就吞掉本轮巡检。
        if (!isAiTaskOverdueBeyondCycle(task, referenceMs)) return;
        if (!ensureAiTaskFutureExecution(task, referenceMs)) return;
        changed = true;
        if (task.status === '已完成' || task.status === '失败') task.status = '待执行';
      });
      if (changed) await writeDb(db, { silent: true });
      const query = Object.fromEntries(reqUrl.searchParams);
      const list = filterByRecordScope(db.aiInspectionTasks || [], user, query, item => item.createdBy || '').map(task => {
        const result = resultMap.get(task.id);
        if (!result || result.probeError) return task;
        return { ...task, latestResultId: result.id };
      });
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/tasks') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const target = (db.aiInspectionTargets || []).find(item => item.id === body.targetId);
      if (!target) return json(res, 404, { message: '巡检对象不存在' });
      if (user.role !== 'admin' && !userHasProject(user, target.projectId)) return json(res, 403, { message: '无权执行该巡检对象' });
      const template = (db.aiInspectionTemplates || []).find(item => item.id === body.templateId);
      if (!template) return json(res, 404, { message: '巡检模板不存在' });
      if (!canUseAiInspectionTemplate(user, template)) return json(res, 403, { message: '无权使用该巡检模板' });
      if (hasInvalidAiInspectionMetricValue(body.metrics)) return json(res, 400, { message: '指标值必须为有效数字' });
      const metrics = normalizeAiInspectionValues(body.metrics);
      if (!metrics.length) return json(res, 400, { message: '请填写至少一个巡检指标' });
      const cycle = String(body.cycle || '').trim();
      if (cycle && !['daily', 'weekly', 'monthly', 'quarterly'].includes(cycle)) {
        return json(res, 400, { message: '无效的巡检周期' });
      }
      let executedAt = String(body.executedAt || '').trim() || now().slice(0, 16);
      if (parseValidScheduleTime(executedAt) === null) return json(res, 400, { message: '计划执行时间格式无效' });
      const scheduledTask = { cycle, executedAt };
      ensureAiTaskFutureExecution(scheduledTask);
      executedAt = scheduledTask.executedAt;
      const task = {
        id: id('aiTask'),
        projectId: target.projectId,
        targetId: target.id,
        templateId: template.id,
        title: String(body.title || `${target.name} 智能巡检`).trim(),
        executor: String(body.executor || user.name).trim(),
        cycle,
        executedAt,
        metrics,
        status: cycle ? '待执行' : parseAiInspectionScheduleTime(executedAt) > Date.now() ? '待执行' : '已完成',
        completedAt: '',
        createdBy: user.id,
        createdAt: now()
      };
      db.aiInspectionTasks = db.aiInspectionTasks || [];
      db.aiInspectionTasks.push(task);
      appendAuditLog(db, user, 'create', 'aiInspectionTask', task.id, `创建智能巡检任务 ${task.title}，计划执行时间 ${task.executedAt}`, task.projectId);
      let result = null;
      if (task.status === '已完成') {
        result = await executeAiInspectionTask(db, task);
      }
      await writeDb(db);
      return json(res, 201, { task, result, message: result ? '智能巡检已执行完成' : '智能巡检任务已创建，等待计划时间执行' });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/ai-inspection/tasks/') && pathname.endsWith('/execute')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const taskId = pathname.split('/')[4];
      const task = (db.aiInspectionTasks || []).find(item => item.id === taskId);
      if (!task) return json(res, 404, { message: '巡检任务不存在' });
      if (!canManageInspectionRecord(user, task)) return json(res, 403, { message: '无权执行该巡检任务' });
      if (task.status === '已完成' || task.status === '失败') {
        db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => item.taskId !== taskId);
        task.status = '待执行';
      }
      const result = await executeAiInspectionTask(db, task);
      if (!result) return json(res, 400, { message: '巡检任务执行失败' });
      await writeDb(db);
      return json(res, 200, { task, result, message: '智能巡检执行完成' });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/ai-inspection/tasks/') && !pathname.endsWith('/execute')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const taskId = pathname.split('/')[4];
      const target = (db.aiInspectionTasks || []).find(item => item.id === taskId);
      if (!target) return json(res, 404, { message: '巡检任务不存在' });
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权修改该巡检任务' });
      const body = await readBody(req);
      if (body.title !== undefined) target.title = String(body.title || '').trim();
      if (body.executor !== undefined) target.executor = String(body.executor || '').trim();
      if (body.cycle !== undefined) {
        const nextCycle = String(body.cycle || '').trim();
        if (nextCycle && !['daily', 'weekly', 'monthly', 'quarterly'].includes(nextCycle)) {
          return json(res, 400, { message: '无效的巡检周期' });
        }
        target.cycle = nextCycle;
      }
      if (body.status === '已停用') {
        target.status = '已停用';
      } else if (body.status === '已启用') {
        target.status = '待执行';
      }
      // 执行时间与状态互不排斥，需独立处理，避免同时提交时执行时间被静默忽略。
      if (body.executedAt !== undefined) {
        const nextExecutedAt = String(body.executedAt || '').trim();
        if (nextExecutedAt && parseValidScheduleTime(nextExecutedAt) === null) {
          return json(res, 400, { message: '计划执行时间格式无效' });
        }
        target.executedAt = nextExecutedAt;
        const scheduledTime = parseAiInspectionScheduleTime(target.executedAt);
        const hasResult = (db.aiInspectionResults || []).find(item => item.taskId === taskId);
        if (scheduledTime > Date.now()) {
          if (hasResult) {
            db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => item.taskId !== taskId);
          }
          target.status = '待执行';
        } else if (!hasResult) {
          target.status = '待执行';
        }
      }
      if (target.cycle && !target.executedAt) return json(res, 400, { message: '周期巡检任务需要计划执行时间' });
      // 仅在显式修改计划时间时重置历史结果；否则仅编辑标题/执行人不应清空已跑出的历史结果。
      if (body.executedAt !== undefined && target.cycle && target.status !== '已停用' && target.status !== '执行中' && ensureAiTaskFutureExecution(target)) {
        db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => item.taskId !== taskId);
        target.status = '待执行';
      }
      appendAuditLog(db, user, 'update', 'aiInspectionTask', taskId, `修改智能巡检任务 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/ai-inspection/tasks/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const taskId = pathname.split('/')[4];
      const index = (db.aiInspectionTasks || []).findIndex(item => item.id === taskId);
      if (index === -1) return json(res, 404, { message: '巡检任务不存在' });
      const target = db.aiInspectionTasks[index];
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权删除该巡检任务' });
      db.aiInspectionTasks.splice(index, 1);
      db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => item.taskId !== taskId);
      removeNotificationsBySource(db, 'aiInspectionTask', taskId);
      appendAuditLog(db, user, 'delete', 'aiInspectionTask', taskId, `删除智能巡检任务 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/config-backup/plans') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') {
        const query = Object.fromEntries(reqUrl.searchParams);
        return json(res, 200, paginateResult([], query, user));
      }
      const list = filterByProjectScope(db.configBackupPlans || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/config-backup/plans') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const target = (db.aiInspectionTargets || []).find(item => item.id === body.targetId);
      if (!target) return json(res, 404, { message: '巡检对象不存在' });
      if (!canAccessInspectionRecord(user, target)) return json(res, 403, { message: '无权操作该巡检对象' });
      if (!target.assetId || !requireExistingAsset(target.assetId, db)) return json(res, 400, { message: '巡检对象必须关联有效资产' });
      const cycle = String(body.cycle || '').trim();
      if (!['daily', 'weekly', 'monthly', 'quarterly'].includes(cycle)) return json(res, 400, { message: '请选择备份周期' });
      const planExecutedAt = String(body.executedAt || '').trim() || now().slice(0, 16);
      if (parseValidScheduleTime(planExecutedAt) === null) return json(res, 400, { message: '计划执行时间格式无效' });
      const plan = {
        id: id('cfgPlan'),
        projectId: target.projectId,
        targetId: target.id,
        name: String(body.name || `${target.name} 配置备份`).trim(),
        cycle,
        executedAt: planExecutedAt,
        status: '待执行',
        lastBackupAt: '',
        lastStatus: '',
        createdBy: user.id,
        createdAt: now()
      };
      ensureAiTaskFutureExecution(plan);
      db.configBackupPlans = db.configBackupPlans || [];
      db.configBackupPlans.push(plan);
      appendAuditLog(db, user, 'create', 'configBackupPlan', plan.id, `创建配置备份计划 ${plan.name}`, plan.projectId);
      await writeDb(db);
      return json(res, 201, plan);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/ai-inspection/config-backup/plans/') && pathname.endsWith('/execute')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const planId = pathname.split('/')[5];
      const plan = (db.configBackupPlans || []).find(item => item.id === planId);
      if (!plan) return json(res, 404, { message: '配置备份计划不存在' });
      if (!canManageInspectionRecord(user, plan)) return json(res, 403, { message: '无权执行该配置备份计划' });
      plan.status = '执行中';
      const record = await executeConfigBackupPlan(db, plan, { operatorId: user.id });
      plan.status = plan.cycle ? '待执行' : '已完成';
      appendAuditLog(db, user, 'execute', 'configBackupPlan', plan.id, `执行配置备份计划 ${plan.name}，结果 ${record.status}`, plan.projectId);
      await writeDb(db);
      return json(res, 200, { plan, record: { ...record, content: undefined } });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/ai-inspection/config-backup/plans/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const planId = pathname.split('/')[5];
      const plan = (db.configBackupPlans || []).find(item => item.id === planId);
      if (!plan) return json(res, 404, { message: '配置备份计划不存在' });
      if (!canManageInspectionRecord(user, plan)) return json(res, 403, { message: '无权修改该配置备份计划' });
      const body = await readBody(req);
      if (body.status === '已停用') plan.status = '已停用';
      if (body.status === '已启用') plan.status = '待执行';
      if (body.name !== undefined) plan.name = String(body.name || '').trim();
      if (body.cycle !== undefined && ['daily', 'weekly', 'monthly', 'quarterly'].includes(String(body.cycle || '').trim())) plan.cycle = String(body.cycle || '').trim();
      if (body.executedAt !== undefined) {
        const nextExecutedAt = String(body.executedAt || '').trim();
        if (parseValidScheduleTime(nextExecutedAt) === null) return json(res, 400, { message: '计划执行时间格式无效' });
        plan.executedAt = nextExecutedAt;
      }
      if (plan.cycle && plan.status !== '已停用') ensureAiTaskFutureExecution(plan);
      appendAuditLog(db, user, 'update', 'configBackupPlan', plan.id, `修改配置备份计划 ${plan.name}`, plan.projectId);
      await writeDb(db);
      return json(res, 200, plan);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/ai-inspection/config-backup/plans/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const planId = pathname.split('/')[5];
      const index = (db.configBackupPlans || []).findIndex(item => item.id === planId);
      if (index === -1) return json(res, 404, { message: '配置备份计划不存在' });
      const plan = db.configBackupPlans[index];
      if (!canManageInspectionRecord(user, plan)) return json(res, 403, { message: '无权删除该配置备份计划' });
      db.configBackupPlans.splice(index, 1);
      db.configBackupRecords = (db.configBackupRecords || []).filter(item => item.planId !== planId);
      removeNotificationsBySource(db, 'configBackupPlan', planId);
      appendAuditLog(db, user, 'delete', 'configBackupPlan', plan.id, `删除配置备份计划 ${plan.name}`, plan.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/config-backup/records') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') {
        const query = Object.fromEntries(reqUrl.searchParams);
        return json(res, 200, paginateResult([], query, user));
      }
      const list = filterByProjectScope(db.configBackupRecords || [], user, item => item.projectId)
        .map(item => ({ ...item, content: undefined }));
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'POST' && pathname.startsWith('/api/ai-inspection/config-backup/records/') && pathname.endsWith('/download')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const recordId = pathname.split('/')[5];
      const record = (db.configBackupRecords || []).find(item => item.id === recordId);
      if (!record) return json(res, 404, { message: '配置备份记录不存在' });
      if (!canViewProject(user, record.projectId)) return json(res, 403, { message: '无权下载该配置备份' });
      if (record.status !== '成功' || !record.content) return json(res, 400, { message: '失败记录没有可下载文件' });
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.filename || 'config-backup.txt')}`
      }));
      return res.end(record.content);
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/config-backup/records/diff') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const id1 = body.id1 || reqUrl.searchParams.get('id1') || '';
      const id2 = body.id2 || reqUrl.searchParams.get('id2') || '';
      if (!id1 || !id2) return json(res, 400, { message: '请提供两个备份记录ID' });
      const record1 = (db.configBackupRecords || []).find(item => item.id === id1);
      const record2 = (db.configBackupRecords || []).find(item => item.id === id2);
      if (!record1 || !record2) return json(res, 404, { message: '备份记录不存在' });
      if (!canViewProject(user, record1.projectId) || !canViewProject(user, record2.projectId)) return json(res, 403, { message: '无权查看' });
      const lines1 = (record1.content || '').split('\n');
      const lines2 = (record2.content || '').split('\n');
      const maxLen = Math.max(lines1.length, lines2.length);
      const diffLines = [];
      for (let i = 0; i < maxLen; i++) {
        const l1 = i < lines1.length ? lines1[i] : null;
        const l2 = i < lines2.length ? lines2[i] : null;
        if (l1 === l2) {
          diffLines.push({ type: 'same', line: i + 1, a: l1, b: l2 });
        } else if (l1 === null) {
          diffLines.push({ type: 'added', line: i + 1, a: null, b: l2 });
        } else if (l2 === null) {
          diffLines.push({ type: 'removed', line: i + 1, a: l1, b: null });
        } else {
          diffLines.push({ type: 'changed', line: i + 1, a: l1, b: l2 });
        }
      }
      const added = diffLines.filter(d => d.type === 'added').length;
      const removed = diffLines.filter(d => d.type === 'removed').length;
      const changed = diffLines.filter(d => d.type === 'changed').length;
      const hasDrift = added > 0 || removed > 0 || changed > 0;
      return json(res, 200, {
        added, removed, changed, hasDrift,
        record1: { id: record1.id, filename: record1.filename, createdAt: record1.createdAt },
        record2: { id: record2.id, filename: record2.filename, createdAt: record2.createdAt },
        diff: diffLines
      });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/ai-inspection/config-backup/records/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const recordId = pathname.split('/')[5];
      const index = (db.configBackupRecords || []).findIndex(item => item.id === recordId);
      if (index === -1) return json(res, 404, { message: '配置备份记录不存在' });
      const record = db.configBackupRecords[index];
      if (!canManageInspectionRecord(user, record)) return json(res, 403, { message: '无权删除该配置备份记录' });
      db.configBackupRecords.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'configBackupRecord', recordId, `删除配置备份记录 ${record.filename || record.id}`, record.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/results') {
        const user = requireAuth(req, res, db);
        if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let list = filterByRecordScope(db.aiInspectionResults || [], user, query, item => item.createdBy || '');
      if (query.excludeProbeError === '1') list = list.filter(item => !item.probeError);
      if (query.level) list = list.filter(item => item.level === query.level);
      if (query.q) {
        const keyword = String(query.q).toLowerCase();
        list = list.filter(item => {
          const target = (db.aiInspectionTargets || []).find(entry => entry.id === item.targetId);
          const presented = sanitizeAiInspectionResultForViewer(item, user);
          return String(presented.summary || '').toLowerCase().includes(keyword)
            || String(presented.risk || '').toLowerCase().includes(keyword)
            || String(presented.suggestion || '').toLowerCase().includes(keyword)
            || String(target?.name || '').toLowerCase().includes(keyword);
        });
      }
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted.map(item => sanitizeAiInspectionResultForViewer(item, user)), query, user));
    }

    if (req.method === 'GET' && pathname.startsWith('/api/ai-inspection/results/')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const resultId = pathname.split('/')[4];
      const result = (db.aiInspectionResults || []).find(item => item.id === resultId);
      if (!result) return json(res, 404, { message: '巡检结果不存在' });
      if (user.role !== 'admin' && !userHasProject(user, result.projectId)) return json(res, 403, { message: '无权查看该巡检结果' });
      return json(res, 200, sanitizeAiInspectionResultForViewer(result, user));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/ai-inspection/results/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const resultId = pathname.split('/')[4];
      const index = (db.aiInspectionResults || []).findIndex(item => item.id === resultId);
      if (index === -1) return json(res, 404, { message: '巡检结果不存在' });
      const target = db.aiInspectionResults[index];
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权删除该巡检结果' });
      db.aiInspectionResults.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'aiInspectionResult', resultId, `删除智能巡检结果 ${target.level}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/notifications') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (checkExpiryNotifications(db)) await writeDb(db);
      const list = filterByProjectScope(db.notifications || [], user, item => item.projectId)
        .filter(item => !(item.hiddenBy && item.hiddenBy[user.id]));
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      const unreadTotal = list.filter(item => !getNotificationReadAtForUser(item, user.id)).length;
      const presented = sorted.map(item => presentNotification(item, user));
      return json(res, 200, { ...paginateResult(presented, query, user), unreadTotal });
    }

    if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.notifications || [], user, item => item.projectId);
      let marked = 0;
      for (const item of list) {
        if (!getNotificationReadAtForUser(item, user.id) && !(item.hiddenBy && item.hiddenBy[user.id])) {
          markNotificationReadForUser(item, user.id);
          marked += 1;
        }
      }
      if (marked) await writeDb(db);
      return json(res, 200, { message: marked ? `已标记 ${marked} 条通知为已读` : '当前没有未读通知', marked });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/notifications/') && pathname.endsWith('/read')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const notificationId = pathname.split('/')[3];
      const notification = (db.notifications || []).find(item => item.id === notificationId);
      if (!notification) return json(res, 404, { message: '通知不存在' });
      if (user.role !== 'admin' && !userHasProject(user, notification.projectId)) return json(res, 403, { message: '无权处理该通知' });
      // 与批量已读接口保持一致：已隐藏的通知不再回写已读状态。
      if (notification.hiddenBy && notification.hiddenBy[user.id]) {
        return json(res, 200, presentNotification(notification, user));
      }
      markNotificationReadForUser(notification, user.id);
      await writeDb(db);
      return json(res, 200, presentNotification(notification, user));
    }

    if (req.method === 'DELETE' && pathname === '/api/notifications/read') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.notifications || [], user, item => item.projectId);
      let removed = 0;
      for (const item of list) {
        if (!getNotificationReadAtForUser(item, user.id)) continue;
        if (item.hiddenBy && item.hiddenBy[user.id]) continue;
        item.hiddenBy = item.hiddenBy && typeof item.hiddenBy === 'object' ? item.hiddenBy : {};
        item.hiddenBy[user.id] = now();
        item._dirty = true;
        removed += 1;
      }
      if (removed) await writeDb(db);
      return json(res, 200, { message: `已清除 ${removed} 条已读通知`, removed });
    }

    if (req.method === 'POST' && pathname === '/api/notifications') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!requireExistingProject(body.projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const notificationTitle = String(body.title || '').trim();
      if (!notificationTitle) return json(res, 400, { message: '通知标题不能为空' });
      const notificationLevel = body.level === undefined ? 'info' : String(body.level);
      if (!notificationLevelOptions.includes(notificationLevel)) return json(res, 400, { message: '无效的通知级别' });
      const notification = createNotification(db, body.projectId, notificationTitle, body.content || '', notificationLevel, body.category || 'manual');
      appendAuditLog(db, user, 'create', 'notification', notification.id, `发送通知 ${notificationTitle}`, body.projectId);
      await writeDb(db);
      return json(res, 201, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/notification-channels') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const list = (db.notificationChannels || []).map(sanitizeNotificationChannel);
      return json(res, 200, { data: list, total: list.length, events: notificationEventOptions });
    }

    if (req.method === 'POST' && pathname === '/api/notification-channels') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const normalized = normalizeNotificationChannelInput(body);
      if (normalized.error) return json(res, 400, { message: normalized.error });
      const channel = normalized.channel;
      if (channel.projectId && !requireExistingProject(channel.projectId, db)) {
        return json(res, 400, { message: '关联项目不存在' });
      }
      db.notificationChannels = db.notificationChannels || [];
      db.notificationChannels.unshift(channel);
      appendAuditLog(db, user, 'create', 'notificationChannel', channel.id, `创建通知通道 ${channel.name}`, channel.projectId);
      await writeDb(db);
      return json(res, 201, sanitizeNotificationChannel(channel));
    }

    if (req.method && ['PUT', 'DELETE'].includes(req.method) && pathname.match(/^\/api\/notification-channels\/[^/]+$/)) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const channelId = pathname.split('/')[3];
      const existing = (db.notificationChannels || []).find(item => item.id === channelId);
      if (!existing) return json(res, 404, { message: '通知通道不存在' });
      if (req.method === 'DELETE') {
        db.notificationChannels = (db.notificationChannels || []).filter(item => item.id !== channelId);
        appendAuditLog(db, user, 'delete', 'notificationChannel', channelId, `删除通知通道 ${existing.name}`, existing.projectId);
        await writeDb(db);
        return json(res, 200, { ok: true });
      }
      const body = await readBody(req);
      const normalized = normalizeNotificationChannelInput(body, existing);
      if (normalized.error) return json(res, 400, { message: normalized.error });
      const channel = normalized.channel;
      if (channel.projectId && !requireExistingProject(channel.projectId, db)) {
        return json(res, 400, { message: '关联项目不存在' });
      }
      db.notificationChannels = (db.notificationChannels || []).map(item => item.id === channelId ? channel : item);
      appendAuditLog(db, user, 'update', 'notificationChannel', channelId, `修改通知通道 ${channel.name}`, channel.projectId);
      await writeDb(db);
      return json(res, 200, sanitizeNotificationChannel(channel));
    }

    // 测试投递只校验连通与响应，不写入站内通知，避免测试消息污染业务通知列表。
    if (req.method === 'POST' && pathname.match(/^\/api\/notification-channels\/[^/]+\/test$/)) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const channelId = pathname.split('/')[3];
      const channel = (db.notificationChannels || []).find(item => item.id === channelId);
      if (!channel) return json(res, 404, { message: '通知通道不存在' });
      const outcome = await deliverToChannel(channel, {
        id: `test-${Date.now()}`,
        projectId: channel.projectId || '',
        title: '通知通道测试',
        content: `这是一条来自驻场运维系统的测试消息（${channel.name}）`,
        level: 'info',
        category: 'manual',
        createdAt: now()
      });
      channel.lastSentAt = outcome.ok ? now() : channel.lastSentAt;
      channel.lastError = outcome.ok ? '' : String(outcome.message || '发送失败').slice(0, 500);
      appendAuditLog(db, user, 'execute', 'notificationChannel', channelId, `测试通知通道 ${channel.name}`, channel.projectId);
      await writeDb(db, { replaceCollections: ['notificationChannels', 'auditLogs'] });
      return json(res, outcome.ok ? 200 : 502, { ok: outcome.ok, message: outcome.ok ? '测试消息已发送' : (outcome.message || '发送失败') });
    }

    if (req.method === 'GET' && pathname === '/api/audit-logs') {
      const user = requireAuditReader(req, res, db);
      if (!user) return;
      const list = user.role === 'admin'
        ? (db.auditLogs || [])
        : filterByProjectScope(db.auditLogs || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'GET' && pathname === '/api/audit-logs/archive') {
      const user = requireAuditReader(req, res, db);
      if (!user) return;
      return json(res, 200, { data: listAuditArchiveFiles() });
    }

    // 审计日志导出复用在线查询的过滤口径，确保导出结果与页面所见一致。
    if (req.method === 'GET' && pathname === '/api/audit-logs/export') {
      const user = requireAuditReader(req, res, db);
      if (!user) return;
      const query = Object.fromEntries(reqUrl.searchParams);
      let entries = user.role === 'admin'
        ? (db.auditLogs || [])
        : filterByProjectScope(db.auditLogs || [], user, item => item.projectId);
      const filters = buildAuditLogFilters(query);
      entries = entries.filter(item => matchesAuditLogFilters(item, filters));
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, entries, 'createdAt');
      const format = String(query.format || 'csv').toLowerCase();
      appendAuditLog(db, user, 'export', 'auditLog', 'audit-log-export', `导出审计日志（${sorted.length} 条）`,
        userProjectIds(user).length === 1 ? userProjectIds(user)[0] : '');
      await writeDb(db);
      if (format === 'json') {
        res.writeHead(200, buildSecurityHeaders({
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-logs-${formatDateKey(new Date())}.json"`
        }));
        return res.end(JSON.stringify({
          exportedAt: now(),
          exportedBy: user.username,
          filters,
          total: sorted.length,
          data: sorted
        }, null, 2));
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-logs-${formatDateKey(new Date())}.csv"`
      }));
      return res.end(buildAuditLogCsv(sorted));
    }

    if (req.method === 'GET' && pathname === '/api/audit-logs/archive/entries') {
      const user = requireAuditReader(req, res, db);
      if (!user) return;
      const filePath = resolveAuditArchiveFile(reqUrl.searchParams.get('file') || '');
      if (!filePath) return json(res, 400, { message: '无效的归档文件' });
      if (fs.statSync(filePath).size > auditArchiveMaxReadBytes) return json(res, 413, { message: '归档文件过大，无法在线查询' });
      let entries = readAuditArchiveEntries(filePath);
      // 审计员仅能查看本项目的历史审计记录，与在线审计日志接口保持一致。
      if (user.role !== 'admin') {
        entries = filterByProjectScope(entries, user, item => item.projectId);
      }
      const action = reqUrl.searchParams.get('action') || '';
      if (action) entries = entries.filter(item => item.action === action);
      const targetType = reqUrl.searchParams.get('targetType') || '';
      if (targetType) entries = entries.filter(item => item.targetType === targetType);
      const keyword = (reqUrl.searchParams.get('search') || '').trim().toLowerCase();
      if (keyword) {
        entries = entries.filter(item => ['operatorName', 'action', 'targetType', 'targetId', 'detail']
          .some(key => String(item[key] || '').toLowerCase().includes(keyword)));
      }
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, entries, 'createdAt');
      return json(res, 200, paginateResult(sorted, query, user));
    }

    if (req.method === 'GET' && pathname === '/api/work-reports') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = listScopedWorkReports(db, user, {
        status: reqUrl.searchParams.get('status') || '',
        reportType: reqUrl.searchParams.get('reportType') || '',
        projectId: reqUrl.searchParams.get('projectId') || '',
        userId: reqUrl.searchParams.get('userId') || ''
      })
        .sort((a, b) => String(b.rangeStart).localeCompare(String(a.rangeStart)) || String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(item => buildWorkReportResponse(db, item));
      return json(res, 200, { data: list });
    }

    if (req.method === 'GET' && pathname === '/api/reports/work-reports/overview') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const period = String(reqUrl.searchParams.get('period') || 'month').trim();
      const range = getDateRangeFromPeriod(period, reqUrl.searchParams.get('anchorDate') || '', reqUrl.searchParams.get('startDate') || '', reqUrl.searchParams.get('endDate') || '');
      if (!range) return json(res, 400, { message: '无效的统计范围' });
      const overview = buildWorkReportOverview(db, user, {
        ...range,
        status: reqUrl.searchParams.get('status') || '',
        reportType: reqUrl.searchParams.get('reportType') || '',
        projectId: reqUrl.searchParams.get('projectId') || '',
        userId: reqUrl.searchParams.get('userId') || '',
        trendUnit: reqUrl.searchParams.get('trendUnit') || ''
      });
      return json(res, 200, overview);
    }

    if (req.method === 'POST' && pathname === '/api/reports/work-reports/export') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const reports = listScopedWorkReports(db, user, {
        status: reqUrl.searchParams.get('status') || '',
        reportType: reqUrl.searchParams.get('reportType') || '',
        projectId: reqUrl.searchParams.get('projectId') || '',
        userId: reqUrl.searchParams.get('userId') || ''
      })
        .sort((a, b) => String(b.rangeStart).localeCompare(String(a.rangeStart)) || String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(item => buildWorkReportResponse(db, item));
      appendAuditLog(db, user, 'export', 'workReport', 'work-report-list', '导出工作汇报列表', userProjectIds(user).length === 1 ? userProjectIds(user)[0] : '');
      await writeDb(db);
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="work-reports-${formatDateKey(new Date())}.csv"`
      }));
      return res.end(buildWorkReportListCsv(reports));
    }

    if (req.method === 'POST' && pathname === '/api/reports/work-reports/overview/export') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const period = String(reqUrl.searchParams.get('period') || 'month').trim();
      const range = getDateRangeFromPeriod(period, reqUrl.searchParams.get('anchorDate') || '', reqUrl.searchParams.get('startDate') || '', reqUrl.searchParams.get('endDate') || '');
      if (!range) return json(res, 400, { message: '无效的统计范围' });
      const overview = buildWorkReportOverview(db, user, {
        ...range,
        status: reqUrl.searchParams.get('status') || '',
        reportType: reqUrl.searchParams.get('reportType') || '',
        projectId: reqUrl.searchParams.get('projectId') || '',
        userId: reqUrl.searchParams.get('userId') || '',
        trendUnit: reqUrl.searchParams.get('trendUnit') || ''
      });
      appendAuditLog(db, user, 'export', 'workReport', 'work-report-overview', '导出工作汇报管理汇总看板', userProjectIds(user).length === 1 ? userProjectIds(user)[0] : '');
      await writeDb(db);
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="work-report-overview-${range.rangeStart}-${range.rangeEnd}.csv"`
      }));
      return res.end(buildWorkReportOverviewCsv(overview));
    }

    if (req.method === 'POST' && pathname === '/api/work-reports') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const reportType = ['daily', 'weekly', 'monthly'].includes(body.reportType) ? body.reportType : 'daily';
      const targetUserId = user.role === 'admin' && body.userId ? String(body.userId) : user.id;
      // 周期唯一性校验、复用/新建与落库必须在同一临界区内完成，否则并发提交会产生同周期重复记录。
      const outcome = await withDbMutationLock(async () => {
        const lockDb = await readDb();
        const targetUser = requireExistingUser(targetUserId, lockDb);
        if (!targetUser) return { status: 404, message: '汇报人员不存在' };
        const projectId = user.role === 'admin' ? String(body.projectId || targetUser.projectId || '').trim() : resolveWriteProjectId(user, body.projectId);
        if (!projectId) return { status: 400, message: '请选择关联项目' };
        if (!requireExistingProject(projectId, lockDb)) return { status: 400, message: '关联项目不存在' };
        if (user.role !== 'admin' && targetUserId !== user.id) return { status: 403, message: '仅支持创建本人的工作汇报' };
        // 汇报人须属于所选项目：已绑定项目的人员不能为其项目之外的项目写汇报。
        if (userProjectIds(targetUser).length && !userHasProject(targetUser, projectId)) {
          return { status: 400, message: '汇报人不属于所选项目' };
        }
        const periodMeta = getWorkReportPeriodMeta(reportType, body.anchorDate || body.rangeStart || formatDateKey(new Date()));
        if (!periodMeta) return { status: 400, message: '无效的汇报周期' };
        const existing = (lockDb.workReports || []).find(item => item.userId === targetUserId && item.projectId === projectId && item.reportType === reportType && item.periodKey === periodMeta.periodKey);
        if (existing && !canEditWorkReportContent(existing)) {
          return { status: 400, message: existing.status === 'locked' ? '该周期汇报已锁定' : '该周期汇报已提交，仅退回后可修改' };
        }
        const metricsSnapshot = buildWorkloadMetrics(lockDb, { rangeStart: periodMeta.rangeStart, rangeEnd: periodMeta.rangeEnd, userId: targetUserId, projectId });
        const target = existing || {
          id: id('workReport'),
          reportType,
          projectId,
          userId: targetUserId,
          periodKey: periodMeta.periodKey,
          rangeStart: periodMeta.rangeStart,
          rangeEnd: periodMeta.rangeEnd,
          status: 'draft',
          submittedAt: '',
          reviewedAt: '',
          reviewedBy: '',
          reviewComment: '',
          lockedAt: '',
          createdAt: now(),
          updatedAt: now()
        };
        target.reportType = reportType;
        target.projectId = projectId;
        target.userId = targetUserId;
        target.periodKey = periodMeta.periodKey;
        target.rangeStart = periodMeta.rangeStart;
        target.rangeEnd = periodMeta.rangeEnd;
        const reportSectionError = checkTextLength(body.summary, 5000, '工作摘要')
          || checkTextLength(body.completedWork, 5000, '已完成工作')
          || checkTextLength(body.pendingWork, 5000, '待办工作')
          || checkTextLength(body.risks, 5000, '风险与问题')
          || checkTextLength(body.nextPlan, 5000, '下一步计划');
        if (reportSectionError) return { status: 400, message: reportSectionError };
        target.summary = String(body.summary || target.summary || '').trim();
        target.completedWork = String(body.completedWork || target.completedWork || '').trim();
        target.pendingWork = String(body.pendingWork || target.pendingWork || '').trim();
        target.risks = String(body.risks || target.risks || '').trim();
        target.nextPlan = String(body.nextPlan || target.nextPlan || '').trim();
        target.metricsSnapshot = metricsSnapshot;
        target.updatedAt = now();
        if (!existing) lockDb.workReports.push(target);
        appendAuditLog(lockDb, user, existing ? 'update' : 'create', 'workReport', target.id, `${existing ? '更新' : '创建'}${reportType}工作汇报`, projectId);
        await writeDb(lockDb);
        return { status: 200, message: existing ? '工作汇报已更新' : '工作汇报已创建', data: buildWorkReportResponse(lockDb, target) };
      });
      if (outcome.status !== 200) return json(res, outcome.status, { message: outcome.message });
      return json(res, 200, { message: outcome.message, data: outcome.data });
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/work-reports/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const reportId = pathname.split('/')[3];
      const target = (db.workReports || []).find(item => item.id === reportId);
      if (!target) return json(res, 404, { message: '工作汇报不存在' });
      if (!canManageWorkReport(user, target)) return json(res, 403, { message: '无权修改该工作汇报' });
      if (!canEditWorkReportContent(target)) {
        return json(res, 400, { message: target.status === 'locked' ? '该工作汇报已锁定' : '已提交的工作汇报仅退回后可修改' });
      }
      const body = await readBody(req);
      const nextReportType = ['daily', 'weekly', 'monthly'].includes(body.reportType) ? body.reportType : target.reportType;
      const nextProjectId = user.role === 'admin' && body.projectId !== undefined
        ? String(body.projectId || '').trim()
        : target.projectId;
      if (!nextProjectId) return json(res, 400, { message: '请选择关联项目' });
      if (!requireExistingProject(nextProjectId, db)) return json(res, 400, { message: '关联项目不存在' });
      // 与创建保持一致：已绑定项目的汇报人不能把汇报改到其项目之外。
      const reportOwner = requireExistingUser(target.userId, db);
      if (reportOwner && userProjectIds(reportOwner).length && !userHasProject(reportOwner, nextProjectId)) {
        return json(res, 400, { message: '汇报人不属于所选项目' });
      }
      const periodMeta = getWorkReportPeriodMeta(nextReportType, body.anchorDate || body.rangeStart || target.rangeStart);
      if (!periodMeta) return json(res, 400, { message: '无效的汇报周期' });
      const duplicate = (db.workReports || []).find(item => item.id !== target.id
        && item.userId === target.userId
        && item.projectId === nextProjectId
        && item.reportType === nextReportType
        && item.periodKey === periodMeta.periodKey);
      let survivor = target;
      if (duplicate) {
        if (!canEditWorkReportContent(duplicate)) {
          return json(res, 400, { message: duplicate.status === 'locked' ? '该周期汇报已锁定' : '该周期已存在已提交的工作汇报' });
        }
        db.workReports = (db.workReports || []).filter(item => item.id !== target.id);
        survivor = duplicate;
      }
      const reportSectionError = checkTextLength(body.summary, 5000, '工作摘要')
        || checkTextLength(body.completedWork, 5000, '已完成工作')
        || checkTextLength(body.pendingWork, 5000, '待办工作')
        || checkTextLength(body.risks, 5000, '风险与问题')
        || checkTextLength(body.nextPlan, 5000, '下一步计划');
      if (reportSectionError) return json(res, 400, { message: reportSectionError });
      if (body.summary !== undefined) survivor.summary = String(body.summary || '').trim();
      if (body.completedWork !== undefined) survivor.completedWork = String(body.completedWork || '').trim();
      if (body.pendingWork !== undefined) survivor.pendingWork = String(body.pendingWork || '').trim();
      if (body.risks !== undefined) survivor.risks = String(body.risks || '').trim();
      if (body.nextPlan !== undefined) survivor.nextPlan = String(body.nextPlan || '').trim();
      survivor.reportType = nextReportType;
      survivor.projectId = nextProjectId;
      survivor.periodKey = periodMeta.periodKey;
      survivor.rangeStart = periodMeta.rangeStart;
      survivor.rangeEnd = periodMeta.rangeEnd;
      survivor.metricsSnapshot = buildWorkloadMetrics(db, { rangeStart: survivor.rangeStart, rangeEnd: survivor.rangeEnd, userId: survivor.userId, projectId: survivor.projectId });
      survivor.status = body.status === 'draft' ? 'draft' : survivor.status;
      survivor.updatedAt = now();
      appendAuditLog(db, user, 'update', 'workReport', survivor.id, duplicate && survivor.id !== target.id ? '合并工作汇报到已有周期草稿' : '编辑工作汇报', survivor.projectId);
      await writeDb(db);
      return json(res, 200, { message: duplicate && survivor.id !== target.id ? '已合并到该周期已有草稿' : '工作汇报已保存', data: buildWorkReportResponse(db, survivor) });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/work-reports/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const reportId = pathname.split('/')[3];
      const index = (db.workReports || []).findIndex(item => item.id === reportId);
      if (index === -1) return json(res, 404, { message: '工作汇报不存在' });
      const target = db.workReports[index];
      if (!canManageWorkReport(user, target)) return json(res, 403, { message: '无权删除该工作汇报' });
      // 创建者仅能删除草稿；已提交/已确认/已锁定的汇报已进入审核闭环，仅管理员可强制删除，
      // 否则会永久阻断其关联用户/项目的删除。
      if (target.status !== 'draft' && user.role !== 'admin') {
        return json(res, 400, { message: '已提交的工作汇报仅管理员可删除' });
      }
      const wasSubmitted = target.status !== 'draft';
      db.workReports.splice(index, 1);
      // 级联清理该汇报的审核通知，避免遗留指向已删除汇报的空通知。
      removeNotificationsBySource(db, 'workReport', target.id);
      appendAuditLog(db, user, 'delete', 'workReport', target.id, wasSubmitted ? `管理员强制删除${reportTypeLabel(target.reportType)}（原状态 ${target.status}）` : '删除草稿工作汇报', target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true, message: wasSubmitted ? '工作汇报已强制删除' : '工作汇报草稿已删除' });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/work-reports/') && pathname.endsWith('/submit')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const reportId = pathname.split('/')[3];
      const target = (db.workReports || []).find(item => item.id === reportId);
      if (!target) return json(res, 404, { message: '工作汇报不存在' });
      if (!canManageWorkReport(user, target)) return json(res, 403, { message: '无权提交该工作汇报' });
      if (!canSubmitWorkReport(target)) {
        return json(res, 400, { message: target.status === 'locked' ? '该工作汇报已锁定' : '仅草稿或已退回的工作汇报可以提交' });
      }
      if (!String(target.summary || '').trim()) return json(res, 400, { message: '请输入工作总结' });
      if (!String(target.completedWork || '').trim()) return json(res, 400, { message: '请输入已完成事项' });
      if (!String(target.pendingWork || '').trim()) return json(res, 400, { message: '请输入未完成事项' });
      if (!String(target.nextPlan || '').trim()) return json(res, 400, { message: '请输入下一步计划' });
      target.metricsSnapshot = buildWorkloadMetrics(db, { rangeStart: target.rangeStart, rangeEnd: target.rangeEnd, userId: target.userId, projectId: target.projectId });
      target.status = 'submitted';
      target.submittedAt = now();
      // 退回后重新提交时清空上一轮审核信息，避免展示过期的审核人与审核意见。
      target.reviewedBy = '';
      target.reviewedAt = '';
      target.reviewComment = '';
      target.lockedAt = '';
      target.updatedAt = now();
      appendAuditLog(db, user, 'submit', 'workReport', target.id, '提交工作汇报', target.projectId);
      const submitReporter = (db.users || []).find(item => item.id === target.userId);
      createNotification(db, target.projectId, '工作汇报待审核', `${submitReporter ? submitReporter.name : '成员'} 已提交${reportTypeLabel(target.reportType)}，请及时审核`, 'info', 'work-report', 'workReport', target.id);
      await writeDb(db);
      return json(res, 200, { message: '工作汇报已提交', data: buildWorkReportResponse(db, target) });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/work-reports/') && pathname.endsWith('/review')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const reportId = pathname.split('/')[3];
      const target = (db.workReports || []).find(item => item.id === reportId);
      if (!target) return json(res, 404, { message: '工作汇报不存在' });
      // 禁止自审：审核人不得审核本人提交的工作汇报；管理员作为可审核角色予以豁免。
      if (user.role !== 'admin' && user.id === target.userId) {
        return json(res, 403, { message: '不能审核本人提交的工作汇报' });
      }
      const body = await readBody(req);
      const action = String(body.action || '').trim();
      if (!['approved', 'returned', 'locked'].includes(action)) return json(res, 400, { message: '无效的审核动作' });
      if (action === 'approved' && target.status !== 'submitted') {
        return json(res, 400, { message: '仅已提交的工作汇报支持确认' });
      }
      if (action === 'returned' && target.status !== 'submitted' && target.status !== 'approved') {
        return json(res, 400, { message: '仅已提交或已确认的工作汇报支持退回' });
      }
      if (action === 'locked' && target.status !== 'approved') return json(res, 400, { message: '请先确认后再锁定' });
      target.reviewedBy = user.id;
      target.reviewedAt = now();
      target.reviewComment = String(body.comment || '').trim();
      target.updatedAt = now();
      target.status = action;
      if (action === 'locked') {
        target.lockedAt = now();
      }
      if (action === 'returned') {
        target.lockedAt = '';
      }
      appendAuditLog(db, user, action, 'workReport', target.id, `工作汇报${action === 'approved' ? '已确认' : action === 'returned' ? '已退回' : '已锁定'}`, target.projectId);
      if (action === 'approved' || action === 'returned') {
        const notifyContent = action === 'approved'
          ? `您的${reportTypeLabel(target.reportType)}已通过审核`
          : `您的${reportTypeLabel(target.reportType)}已被退回${target.reviewComment ? `：${target.reviewComment}` : ''}`;
        createNotification(db, target.projectId, action === 'approved' ? '工作汇报已确认' : '工作汇报已退回', notifyContent, action === 'approved' ? 'info' : 'warning', 'work-report', 'workReport', target.id);
      }
      await writeDb(db);
      return json(res, 200, { message: action === 'approved' ? '工作汇报已确认' : action === 'returned' ? '工作汇报已退回' : '工作汇报已锁定', data: buildWorkReportResponse(db, target) });
    }

    if (req.method === 'GET' && pathname === '/api/reports/workload') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '当前账号无权查看工作量看板' });
      const period = String(reqUrl.searchParams.get('period') || 'month').trim();
      const projectId = user.role === 'admin' ? String(reqUrl.searchParams.get('projectId') || '').trim() : resolveWriteProjectId(user, reqUrl.searchParams.get('projectId'));
      const range = getDateRangeFromPeriod(period, reqUrl.searchParams.get('anchorDate') || '', reqUrl.searchParams.get('startDate') || '', reqUrl.searchParams.get('endDate') || '');
      if (!range) return json(res, 400, { message: '无效的统计范围' });
      const rows = buildWorkloadRows(db, user, { rangeStart: range.rangeStart, rangeEnd: range.rangeEnd, projectId });
      const previousRange = getPreviousDateRange(range);
      const previousRows = previousRange
        ? buildWorkloadRows(db, user, { rangeStart: previousRange.rangeStart, rangeEnd: previousRange.rangeEnd, projectId })
        : [];
      const summary = buildWorkloadBoardSummary(rows);
      const previousSummary = buildWorkloadBoardSummary(previousRows);
      return json(res, 200, {
        data: rows,
        range,
        previousRange,
        summary,
        previousSummary,
        summaryComparison: buildWorkloadSummaryComparison(summary, previousSummary)
      });
    }

    if (req.method === 'POST' && pathname === '/api/reports/workload/export') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '当前账号无权查看工作量看板' });
      const period = String(reqUrl.searchParams.get('period') || 'month').trim();
      const projectId = user.role === 'admin' ? String(reqUrl.searchParams.get('projectId') || '').trim() : resolveWriteProjectId(user, reqUrl.searchParams.get('projectId'));
      const range = getDateRangeFromPeriod(period, reqUrl.searchParams.get('anchorDate') || '', reqUrl.searchParams.get('startDate') || '', reqUrl.searchParams.get('endDate') || '');
      if (!range) return json(res, 400, { message: '无效的统计范围' });
      const rows = buildWorkloadRows(db, user, { rangeStart: range.rangeStart, rangeEnd: range.rangeEnd, projectId });
      appendAuditLog(db, user, 'export', 'workload', 'workload-board', '导出人员工作量看板', projectId || '');
      await writeDb(db);
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="workload-${range.rangeStart}-${range.rangeEnd}.csv"`
      }));
      return res.end(buildWorkloadCsv(rows));
    }

    if (req.method === 'GET' && pathname === '/api/system/info') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      return json(res, 200, {
        version: packageInfo.version,
        backups: listBackupFiles(),
        systemConfig: db.systemConfig
      });
    }

    if (req.method === 'GET' && pathname === '/api/system/services') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      return json(res, 200, await getSystemServicesStatus(db));
    }

    if (req.method === 'GET' && pathname === '/api/system/load') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      return json(res, 200, getSystemLoad());
    }

    if (req.method === 'POST' && pathname === '/api/system/settings') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const allowedKeys = ['webIdleLogoutMinutes', 'httpsLoginEnabled', 'httpsPort', 'allowRegistration', 'httpLoginDisabled', 'loginRateLimitMaxAttempts', 'loginRateLimitWindowMinutes', 'loginRateLimitLockMinutes', 'timezoneOffset', 'dailyReportReminderHour', 'weeklyReportReminderDays', 'monthlyReportReminderDays', 'dailyLowHoursThreshold', 'dailyHighHoursThreshold', 'noLogStreakDays', 'projectInactiveDays', 'monitorSampleIntervalMinutes', 'monitorHistoryRetentionDays', 'monitorConsecutiveFailures', 'monitorCpuThreshold', 'monitorMemoryThreshold', 'monitorDiskThreshold', 'monitorTargetAllowlist', 'ssoAutoApproveAllowlist', 'ssoDefaultProjectId'];
      const safeBody = {};
      for (const key of allowedKeys) {
        if (body[key] !== undefined) safeBody[key] = body[key];
      }
      // 涉及登录与账号锁定策略的敏感设置需要管理员二次验证，防止会话被盗后放宽防护。
      const sensitiveKeys = ['httpsLoginEnabled', 'httpLoginDisabled', 'allowRegistration', 'loginRateLimitMaxAttempts', 'loginRateLimitWindowMinutes', 'loginRateLimitLockMinutes', 'monitorTargetAllowlist', 'ssoAutoApproveAllowlist', 'ssoDefaultProjectId'];
      if (sensitiveKeys.some(key => safeBody[key] !== undefined) && !verifyAdminStepUp(user, body.password, req)) {
        return json(res, 401, { message: '修改登录安全设置需要管理员密码验证' });
      }
      if (safeBody.monitorTargetAllowlist !== undefined) {
        const invalidEntry = findInvalidMonitorAllowlistEntry(safeBody.monitorTargetAllowlist);
        if (invalidEntry) {
          return json(res, 400, { message: `白名单条目无效：${invalidEntry}，请填写 IP、CIDR 或主机名` });
        }
      }
      if (safeBody.ssoDefaultProjectId !== undefined && String(safeBody.ssoDefaultProjectId).trim() && !requireExistingProject(String(safeBody.ssoDefaultProjectId).trim(), db)) {
        return json(res, 400, { message: 'SSO 默认项目不存在' });
      }
      const previousConfig = db.systemConfig;
      const nextConfig = normalizeSystemConfig({ ...db.systemConfig, ...safeBody });
      // 只有 HTTPS 相关设置变化时才重载监听，避免无关设置保存触发 HTTPS 服务重启。
      const httpsChanged = safeBody.httpsLoginEnabled !== undefined || safeBody.httpsPort !== undefined;
      db.systemConfig = nextConfig;
      systemTimezoneOffsetMinutes = nextConfig.timezoneOffset;
      refreshMonitorTargetPolicy(nextConfig);
      if (httpsChanged) {
        try {
          await applyHttpsServerConfig(nextConfig);
        } catch (error) {
          // HTTPS 启动失败时回滚内存配置，避免内存状态与未落库的持久化状态不一致。
          db.systemConfig = previousConfig;
          systemTimezoneOffsetMinutes = previousConfig.timezoneOffset;
          refreshMonitorTargetPolicy(previousConfig);
          return json(res, 500, { message: `HTTPS 设置未生效：${error.message}` });
        }
      }
      appendAuditLog(db, user, 'update', 'system', '', `更新系统设置`);
      await writeDb(db);
      return json(res, 200, { message: '系统设置已保存', systemConfig: db.systemConfig });
    }

    if (req.method === 'POST' && pathname === '/api/system/https/certificate') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return json(res, 400, { message: '请上传证书和私钥文件' });
      }
      const boundary = parseMultipartBoundary(contentType);
      if (!boundary) return json(res, 400, { message: '无效的上传格式' });
      let rawBody;
      try {
        rawBody = await readMultipartBody(req, 2 * 1024 * 1024, '证书文件不能超过 2MB');
      } catch (error) {
        if (error.status) return json(res, error.status, { message: error.message });
        throw error;
      }
      const parts = parseMultipart(rawBody, boundary);
      const passwordPart = parts.find(part => part.name === 'password' && !part.filename);
      const certPassword = passwordPart ? passwordPart.data.toString('utf8').trim() : '';
      if (!verifyAdminStepUp(user, certPassword, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      const certPart = parts.find(part => part.name === 'cert' && part.filename);
      const keyPart = parts.find(part => part.name === 'key' && part.filename);
      if (!certPart || !keyPart) {
        return json(res, 400, { message: '请同时上传证书文件和私钥文件' });
      }
      const certContent = certPart.data.toString('utf8');
      const keyContent = keyPart.data.toString('utf8');
      let certificateSummary;
      try {
        certificateSummary = validateHttpsCertificatePair(certContent, keyContent);
      } catch (error) {
        return json(res, 400, { message: `证书或私钥无效：${error.message}` });
      }
      fs.writeFileSync(httpsCertPath, certContent, { encoding: 'utf8', mode: 0o600 });
      fs.writeFileSync(httpsKeyPath, keyContent, { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(httpsCertPath, 0o600); } catch (_) {}
      try { fs.chmodSync(httpsKeyPath, 0o600); } catch (_) {}
      db.systemConfig = normalizeSystemConfig({
        ...db.systemConfig,
        httpsCertFilename: path.basename(certPart.filename),
        httpsKeyFilename: path.basename(keyPart.filename),
        httpsCertUploadedAt: now(),
        httpsKeyUploadedAt: now(),
        httpsCertSubject: certificateSummary.subject,
        httpsCertIssuer: certificateSummary.issuer,
        httpsCertValidFrom: certificateSummary.validFrom,
        httpsCertValidTo: certificateSummary.validTo,
        httpsCertFingerprint256: certificateSummary.fingerprint256
      });
      await applyHttpsServerConfig(db.systemConfig);
      appendAuditLog(db, user, 'upload', 'system', '', `上传 HTTPS 登录证书 ${db.systemConfig.httpsCertFilename} 和私钥 ${db.systemConfig.httpsKeyFilename}`);
      await writeDb(db);
      return json(res, 200, { message: 'HTTPS 证书上传成功', systemConfig: db.systemConfig });
    }

    // 一次性维护接口：为历史通知按内容特征补齐 sourceType/sourceId，便于删除实体时级联清理。
    if (req.method === 'POST' && pathname === '/api/system/backfill-notification-sources') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const stats = backfillNotificationSources(db);
      appendAuditLog(db, user, 'backfill', 'notification', '', `回填历史通知来源：扫描 ${stats.scanned} 条，补齐 ${stats.updated} 条`);
      await writeDb(db);
      return json(res, 200, {
        message: `历史通知来源回填完成：扫描 ${stats.scanned} 条，补齐 ${stats.updated} 条，无法匹配 ${stats.unmatched} 条`,
        ...stats
      });
    }

    if (req.method === 'POST' && pathname === '/api/system/import') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req, importBodyLimitBytes);
      if (!verifyAdminStepUp(user, body && body.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      delete body.password;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(res, 400, { message: '导入数据格式无效，需为有效的 JSON 对象' });
      }
      if (!Array.isArray(body.users)) {
        return json(res, 400, { message: '导入数据缺少 users 字段' });
      }
      if (body.users.length > importUserLimit) {
        return json(res, 400, { message: `导入用户数量不能超过 ${importUserLimit}` });
      }
      const unsafeImportId = findUnsafeSnapshotId(body);
      if (unsafeImportId) {
        return json(res, 400, { message: `导入数据校验失败：${unsafeImportId}` });
      }
      for (const key of dbCollectionKeys) {
        if (Array.isArray(body[key]) && body[key].length > importCollectionLimit) {
          return json(res, 400, { message: `导入的 ${key} 数据量超过上限 ${importCollectionLimit}` });
        }
      }
      const sessionToken = getSessionToken(req);
      const currentSession = (db.sessions || []).find(item => item.token === sessionToken) || null;
      const nextDb = buildImportedDbPreservingCurrentSession(fillMissingSnapshotSecrets(body, db), user, sessionToken, currentSession);
      await restoreDocumentAttachments(nextDb, body.documentAttachments || []);
      const backupFilename = `backup-before-import-${now().replace(/[:.]/g, '-')}.json`;
      await writeJsonFileStreaming(path.join(backupDir, backupFilename), await serializeDbSnapshot(db));
      appendAuditLog(nextDb, user, 'import', 'system', '', `导入系统数据，导入前备份 ${backupFilename}`);
      await writeDb(nextDb);
      // 落库成功后清理旧数据残留的资料附件目录，避免导入后磁盘残留不可达附件。
      pruneDocumentAttachmentDirs(nextDb);
      await applyHttpsServerConfig(nextDb.systemConfig || {});
      return json(res, 200, { message: '数据导入成功，当前登录状态已保留', backupFilename });
    }

    if (req.method === 'POST' && pathname === '/api/system/backup') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!verifyAdminStepUp(user, body && body.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      const filename = `backup-${now().replace(/[:.]/g, '-')}.json`;
      await writeJsonFileStreaming(path.join(backupDir, filename), await serializeDbSnapshot(db));
      appendAuditLog(db, user, 'backup', 'system', '', `创建系统备份 ${filename}`);
      await writeDb(db);
      return json(res, 200, {
        filename,
        href: `/api/system/backups/${encodeURIComponent(filename)}`
      });
    }

    if (req.method === 'POST' && pathname === '/api/system/reset') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!verifyAdminStepUp(user, body.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      const sessionToken = getSessionToken(req);
      const currentSession = (db.sessions || []).find(item => item.token === sessionToken) || null;
      const backupFilename = `backup-before-reset-${now().replace(/[:.]/g, '-')}.json`;
      await writeJsonFileStreaming(path.join(backupDir, backupFilename), await serializeDbSnapshot(db));
      const preservedHttpsConfig = normalizeSystemConfig(db.systemConfig || {});
      const nextDb = buildResetDbForNewEnvironment(user, sessionToken, currentSession);
      nextDb.systemConfig = normalizeSystemConfig({
        ...nextDb.systemConfig,
        ...preservedHttpsConfig,
        dailyReportReminderHour: preservedHttpsConfig.dailyReportReminderHour,
        weeklyReportReminderDays: preservedHttpsConfig.weeklyReportReminderDays,
        monthlyReportReminderDays: preservedHttpsConfig.monthlyReportReminderDays,
        dailyLowHoursThreshold: preservedHttpsConfig.dailyLowHoursThreshold,
        dailyHighHoursThreshold: preservedHttpsConfig.dailyHighHoursThreshold,
        noLogStreakDays: preservedHttpsConfig.noLogStreakDays,
        projectInactiveDays: preservedHttpsConfig.projectInactiveDays,
        // 初始化会清空所有项目，指向具体项目的 SSO 默认项目随之失效，必须一并清掉。
        ssoDefaultProjectId: ''
      });
      await writeDb(nextDb);
      // 资料附件存放在磁盘，数据库初始化后 documents 已清空，对应附件文件一并清理，避免占用空间。
      // 放在落库成功之后，避免写库失败时附件已被删除但业务数据未清空。
      clearDirectoryContents(documentsUploadDir);
      let httpsMsg = '';
      try {
        await applyHttpsServerConfig(nextDb.systemConfig || {});
      } catch (e) {
        httpsMsg = `，HTTPS 配置应用失败：${e.message}`;
      }
      return json(res, 200, { message: `数据库已初始化，仅保留当前管理员账号${httpsMsg}`, backupFilename });
    }

    if (req.method === 'POST' && pathname === '/api/system/export') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!verifyAdminStepUp(user, body && body.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      appendAuditLog(db, user, 'export', 'system', '', '导出系统数据');
      await writeDb(db);
      // 导出内容需与磁盘备份/恢复语义一致，包含凭据哈希与设备密钥，
      // 保证导出文件在其它环境导入后账号可登录、资产监控凭据可用。
      return await respondJsonDocument(res, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="onsite-ops-export.json"',
        'Cache-Control': 'no-store'
      }, await serializeDbSnapshot(db));
    }

    if (req.method === 'POST' && pathname.startsWith('/api/system/backups/') && pathname.endsWith('/restore')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const restoreBody = await readBody(req);
      if (!verifyAdminStepUp(user, restoreBody && restoreBody.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      const parts = pathname.split('/');
      const rawFilename = parts[4] || '';
      const archived = reqUrl.searchParams.get('archived') === '1';
      const filePath = resolveBackupFilePath(rawFilename, archived);
      if (!filePath) {
        const decoded = decodeURIComponent(String(rawFilename || ''));
        const filename = path.basename(decoded);
        if (!filename || filename !== decoded || !filename.endsWith('.json')) {
          return json(res, 400, { message: '文件名无效' });
        }
        return json(res, 404, { message: '备份文件不存在' });
      }
      const filename = path.basename(filePath);
      let snapshot;
      try {
        snapshot = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      } catch (_) {
        return json(res, 400, { message: '备份文件不是有效 JSON' });
      }
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.users)) {
        return json(res, 400, { message: '备份数据格式无效' });
      }
      if (snapshot.users.length > importUserLimit) {
        return json(res, 400, { message: `导入用户数量不能超过 ${importUserLimit}` });
      }
      for (const key of dbCollectionKeys) {
        if (Array.isArray(snapshot[key]) && snapshot[key].length > importCollectionLimit) {
          return json(res, 400, { message: `导入的 ${key} 数据量超过上限 ${importCollectionLimit}` });
        }
      }
      const unsafeRestoreId = findUnsafeSnapshotId(snapshot);
      if (unsafeRestoreId) {
        return json(res, 400, { message: `备份数据校验失败：${unsafeRestoreId}` });
      }
      const sessionToken = getSessionToken(req);
      const currentSession = (db.sessions || []).find(item => item.token === sessionToken) || null;
      const nextDb = buildImportedDbPreservingCurrentSession(fillMissingSnapshotSecrets(snapshot, db), user, sessionToken, currentSession);
      await restoreDocumentAttachments(nextDb, snapshot.documentAttachments || []);
      const backupFilename = `backup-before-restore-${now().replace(/[:.]/g, '-')}.json`;
      await writeJsonFileStreaming(path.join(backupDir, backupFilename), await serializeDbSnapshot(db));
      appendAuditLog(nextDb, user, 'restore', 'system', '', `从磁盘备份恢复 ${filename}，恢复前备份 ${backupFilename}`);
      await writeDb(nextDb);
      await applyHttpsServerConfig(nextDb.systemConfig || {});
      return json(res, 200, { message: '磁盘备份恢复成功，当前登录状态已保留', backupFilename, filename });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/system/backups/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!verifyAdminStepUp(user, body && body.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      const rawFilename = pathname.split('/').pop() || '';
      const archived = reqUrl.searchParams.get('archived') === '1';
      const filePath = resolveBackupFilePath(rawFilename, archived);
      if (!filePath) {
        const decoded = decodeURIComponent(String(rawFilename || ''));
        const filename = path.basename(decoded);
        if (!filename || filename !== decoded) {
          return json(res, 400, { message: '文件名无效' });
        }
        return json(res, 404, { message: '备份文件不存在' });
      }
      const filename = path.basename(filePath);
      // 备份文件与导出/恢复保持同一语义：包含可恢复凭据，以便跨环境导入后账号仍可登录。
      const stat = await fs.promises.stat(filePath);
      appendAuditLog(db, user, 'download', 'system', '', `下载${archived ? '归档' : ''}备份 ${filename}`);
      await writeDb(db);
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(stat.size)
      }));
      const stream = fs.createReadStream(filePath);
      stream.once('error', () => {
        if (!res.writableEnded) res.end();
      });
      return stream.pipe(res);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/system/backups/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!verifyAdminStepUp(user, body && body.password, req)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      const rawFilename = pathname.split('/').pop() || '';
      const archived = reqUrl.searchParams.get('archived') === '1';
      const filePath = resolveBackupFilePath(rawFilename, archived);
      if (!filePath) {
        return json(res, 404, { message: '备份文件不存在' });
      }
      const filename = path.basename(filePath);
      fs.rmSync(filePath, { force: true });
      appendAuditLog(db, user, 'delete', 'system', '', `删除${archived ? '归档' : ''}备份 ${filename}`);
      await writeDb(db);
      return json(res, 200, { message: '备份已删除', filename });
    }

    if (req.method === 'GET' && pathname === '/api/reports/summary') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (user.role === 'customer') return json(res, 403, { message: '当前账号无权查看汇总' });
      const period = reqUrl.searchParams.get('period') || 'week';
      const userId = user.role === 'admin' ? reqUrl.searchParams.get('userId') || '' : user.role === 'engineer' ? user.id : '';
      const requestedProjectId = String(reqUrl.searchParams.get('projectId') || '').trim();
      let projectId = '';
      let projectIds = [];
      if (user.role === 'admin') {
        projectId = requestedProjectId;
      } else {
        const scopedProjectIds = userProjectIds(user);
        if (requestedProjectId) {
          if (!scopedProjectIds.includes(requestedProjectId)) {
            return json(res, 403, { message: '无权查看该项目汇总' });
          }
          projectId = requestedProjectId;
        } else {
          projectIds = scopedProjectIds;
        }
        if (!projectId && !projectIds.length) {
          return json(res, 403, { message: '未绑定项目，无权查看汇总' });
        }
      }
      return json(res, 200, buildSummary(db, period, userId, projectId, projectIds));
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/user/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const targetUserId = pathname.split('/')[4];
      const targetUser = requireExistingUser(targetUserId, db);
      if (!targetUser) return json(res, 404, { message: '用户不存在' });
      if (user.role !== 'admin' && user.role !== 'engineer') return json(res, 403, { message: '当前账号仅支持查看数据' });
      if (user.role !== 'admin' && user.id !== targetUserId) return json(res, 403, { message: '仅支持查看本人报表' });
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildOperationalReportHtml(db, 'user', targetUserId, period, user);
      if (!content) return json(res, 404, { message: '报表生成失败' });
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/user/') && pathname.endsWith('/pptx')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const targetUserId = pathname.split('/')[4];
      const targetUser = requireExistingUser(targetUserId, db);
      if (!targetUser) {
        return json(res, 404, { message: '用户不存在' });
      }
      if (user.role !== 'admin' && user.role !== 'engineer') {
        return json(res, 403, { message: '当前账号仅支持查看数据' });
      }
      if (user.role !== 'admin' && user.id !== targetUserId) {
        return json(res, 403, { message: '仅支持导出本人报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildPptxBuffer(db, targetUserId, period, user);
      if (!content) {
        return json(res, 404, { message: '用户不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="report-${targetUserId}.pptx"`
      }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/project/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[4];
      if (!canViewProject(user, projectId)) return json(res, 403, { message: '无权查看其他项目报表' });
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildOperationalReportHtml(db, 'project', projectId, period, user);
      if (!content) return json(res, 404, { message: '项目不存在' });
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    // 服务报告打印页：面向客户交付，只呈现服务过程与结果，打印样式已内置可直接另存 PDF。
    if (req.method === 'GET' && pathname.match(/^\/api\/reports\/service\/[^/]+$/)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[4];
      if (!canViewProject(user, projectId)) return json(res, 403, { message: '无权查看该项目服务报告' });
      const period = String(reqUrl.searchParams.get('period') || 'month');
      const startDate = String(reqUrl.searchParams.get('startDate') || '');
      const endDate = String(reqUrl.searchParams.get('endDate') || '');
      const content = buildServiceReportHtml(db, projectId, { period, startDate, endDate }, user);
      if (!content) return json(res, 404, { message: '项目不存在' });
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/project/') && pathname.endsWith('/pptx')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[4];
      if (!canViewProject(user, projectId)) {
        return json(res, 403, { message: '无权导出其他项目报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildProjectPptxBuffer(db, projectId, period, user);
      if (!content) {
        return json(res, 404, { message: '项目不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="project-report-${projectId}.pptx"`
      }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/inspection/project/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[5];
      if (!canViewProject(user, projectId)) {
        return json(res, 403, { message: '无权查看其他项目巡检报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildInspectionExecutionHtml(db, projectId, period, user);
      if (!content) {
        return json(res, 404, { message: '项目不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/inspection/project/') && pathname.endsWith('/csv')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[5];
      if (!canViewProject(user, projectId)) {
        return json(res, 403, { message: '无权导出其他项目巡检报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildInspectionExecutionCsv(db, projectId, period, user);
      if (!content) {
        return json(res, 404, { message: '项目不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="inspection-report-${projectId}.csv"`
      }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/ai-inspection/results/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const resultId = pathname.split('/')[5];
      const result = (db.aiInspectionResults || []).find(item => item.id === resultId);
      if (!result) return json(res, 404, { message: '巡检结果不存在' });
      if (!canViewProject(user, result.projectId)) {
        return json(res, 403, { message: '无权查看该巡检报告' });
      }
      const content = buildAiInspectionResultHtml(db, resultId, user);
      if (!content) {
        return json(res, 404, { message: '巡检报告生成失败' });
      }
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/reports/ai-inspection/results/') && pathname.endsWith('/pptx')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const resultId = pathname.split('/')[5];
      const result = (db.aiInspectionResults || []).find(item => item.id === resultId);
      if (!result) return json(res, 404, { message: '巡检结果不存在' });
      if (!canViewProject(user, result.projectId)) {
        return json(res, 403, { message: '无权导出该巡检报告' });
      }
      const content = buildAiInspectionResultPptxBuffer(db, resultId, user);
      if (!content) {
        return json(res, 404, { message: '巡检报告生成失败' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="ai-inspection-report-${resultId}.pptx"`
      }));
      return res.end(content);
    }

    if (req.method === 'POST' && pathname === '/api/system/upgrade') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      // pending 与 UPGRADE_READY 路径固定，已有包等待应用时直接拒绝，避免覆盖仍在等待的升级包。
      if (upgradeApplyScheduled) {
        return rejectUpgradeUpload(res, db, user, '', '已有升级包正在等待应用，请等待系统重启后重试', { status: 409 });
      }
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return rejectUpgradeUpload(res, db, user, '', '请上传升级包文件（tar.gz 格式）');
      }
      const boundary = parseMultipartBoundary(contentType);
      if (!boundary) return rejectUpgradeUpload(res, db, user, '', '无效的上传格式');
      let rawBody;
      try {
        rawBody = await readMultipartBody(req, 100 * 1024 * 1024, '升级包不能超过 100MB');
      } catch (error) {
        if (error.status) return rejectUpgradeUpload(res, db, user, '', error.message, { status: error.status });
        throw error;
      }
      const parts = parseMultipart(rawBody, boundary);
      const passwordPart = parts.find(part => part.name === 'password');
      const upgradePassword = passwordPart ? passwordPart.data.toString('utf8').replace(/\r?\n$/, '') : '';
      if (!verifyAdminStepUp(user, upgradePassword, req)) {
        return rejectUpgradeUpload(res, db, user, '', '管理员密码错误', { status: 401 });
      }
      const pkgPart = parts.find(part => (part.name === 'package' || part.name === 'file') && part.filename);
      if (!pkgPart) return rejectUpgradeUpload(res, db, user, '', '请上传升级包文件');
      const upgradeFilename = sanitizeUpgradeFilename(pkgPart.filename);

      const upgradesDir = path.join(dataDir, 'upgrades');
      const pendingDir = path.join(upgradesDir, 'pending');
      // 并发上传时共用固定 pending 目录会互相覆盖，先解压到随机暂存目录，
      // 校验通过后再原子替换 pending。
      const stagingDir = path.join(upgradesDir, `pending-${crypto.randomBytes(8).toString('hex')}`);

      function cleanUpgradeDir(dir) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      }

      const failUpgrade = (message, options) => {
        cleanUpgradeDir(stagingDir);
        return rejectUpgradeUpload(res, db, user, upgradeFilename, message, options);
      };

      // data/upgrades 由 root 创建或被 root 写过时，容器内的 node 用户无法写入。
      // 这里提前给出可操作的提示，避免页面只看到 500。
      try {
        fs.accessSync(upgradesDir, fs.constants.W_OK);
      } catch (_) {
        return rejectUpgradeUpload(res, db, user, upgradeFilename, '升级目录不可写，请在宿主机执行 chown -R 1000:1000 data 后重试');
      }
      try {
        fs.mkdirSync(stagingDir, { recursive: true });
      } catch (error) {
        return rejectUpgradeUpload(res, db, user, upgradeFilename, `无法创建升级暂存目录：${error.message}。请确认 data/upgrades 属于容器内运行用户（node，uid 1000）`);
      }

      const tempArchive = path.join(upgradesDir, `temp-upgrade-${crypto.randomBytes(8).toString('hex')}.tar.gz`);
      fs.writeFileSync(tempArchive, pkgPart.data, { mode: 0o600 });

      const UPGRADE_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
      const UPGRADE_MAX_FILE_COUNT = 20000;
      const oversizedMessage = '升级包解压后体积或文件数超过上限，拒绝安装';

      try {
        const fileList = execFileSync('tar', ['-tzf', tempArchive], { timeout: 10000, encoding: 'utf8' })
          .trim().split('\n').filter(Boolean);
        if (fileList.length > UPGRADE_MAX_FILE_COUNT) return failUpgrade(oversizedMessage);
        for (const entry of fileList) {
          const normalized = entry.replace(/^\.\//, '').replace(/\/+$/, '');
          if (normalized.startsWith('/') || normalized.includes('..')) {
            return failUpgrade(`升级包包含非法路径：${entry}`);
          }
        }
        // 解压前识别符号链接/硬链接/特殊文件，并累计声明体积，避免压缩炸弹写满磁盘。
        const verboseList = execFileSync('tar', ['-tvzf', tempArchive], { timeout: 10000, encoding: 'utf8' }).split('\n');
        let declaredBytes = 0;
        let declaredEntries = 0;
        for (const line of verboseList) {
          if (!line.trim()) continue;
          declaredEntries += 1;
          const typeChar = line.charAt(0);
          if (typeChar === 'l' || typeChar === 'h' || typeChar === 'b' || typeChar === 'c' || typeChar === 'p') {
            return failUpgrade('升级包包含符号链接、硬链接或特殊文件，拒绝解压');
          }
          const sizeMatch = /^\S+\s+\S+\s+(\d+)\s+/.exec(line);
          if (!sizeMatch) {
            return failUpgrade('升级包文件清单格式异常，拒绝解压');
          }
          declaredBytes += Number(sizeMatch[1]) || 0;
          if (declaredBytes > UPGRADE_MAX_UNCOMPRESSED_BYTES || declaredEntries > UPGRADE_MAX_FILE_COUNT) {
            return failUpgrade(oversizedMessage);
          }
        }
        execFileSync('tar', ['-xzf', tempArchive, '-C', stagingDir, '--no-same-owner', '--no-same-permissions'], { timeout: 30000 });
      } catch (error) {
        return failUpgrade(`升级包解压失败：${error.message}`);
      } finally {
        try { fs.unlinkSync(tempArchive); } catch (_) {}
      }

      // tar 头声明可能与实际写入不一致，解压后再实测一次体积与文件数。
      {
        let totalBytes = 0;
        let totalFiles = 0;
        let overflow = false;
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(abs);
            else {
              totalFiles += 1;
              try { totalBytes += fs.statSync(abs).size; } catch (_) {}
            }
            if (totalBytes > UPGRADE_MAX_UNCOMPRESSED_BYTES || totalFiles > UPGRADE_MAX_FILE_COUNT) {
              overflow = true;
              return;
            }
          }
        };
        try { walk(stagingDir); } catch (_) { overflow = true; }
        if (overflow) return failUpgrade(oversizedMessage);
      }

      // 新包完整通过预检后再替换 pending，避免上传失败破坏上一份已校验包。
      // 旧 pending 若属于其他用户会删不掉，rename 随之失败，这里先确认已清空。
      try { fs.rmSync(pendingDir, { recursive: true, force: true }); } catch (_) {}
      if (fs.existsSync(pendingDir)) {
        return failUpgrade('旧升级目录无法删除，请在宿主机删除 data/upgrades/pending 后重试');
      }
      try {
        fs.renameSync(stagingDir, pendingDir);
      } catch (error) {
        return failUpgrade(`升级包暂存失败：${error.message}`);
      }

      {
        const scanForSymlinks = (dir) => {
          const symlinks = [];
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const abs = path.join(dir, entry.name);
              if (entry.isSymbolicLink()) {
                symlinks.push(abs);
              } else if (entry.isDirectory()) {
                symlinks.push(...scanForSymlinks(abs));
              }
            }
          } catch (_) {}
          return symlinks;
        };
        const symlinks = scanForSymlinks(pendingDir);
        if (symlinks.length > 0) {
          cleanUpgradeDir(pendingDir);
          return rejectUpgradeUpload(res, db, user, upgradeFilename, '升级包包含符号链接，拒绝解压');
        }
      }

      if (!fs.existsSync(path.join(pendingDir, 'server.js')) ||
          !fs.existsSync(path.join(pendingDir, 'package.json')) ||
          !fs.statSync(path.join(pendingDir, 'public')).isDirectory()) {
        cleanUpgradeDir(pendingDir);
        return rejectUpgradeUpload(res, db, user, upgradeFilename, '升级包缺少必要文件（server.js / package.json / public/）');
      }

      try {
        validateUpgradePackageIntegrity(pendingDir);
      } catch (error) {
        cleanUpgradeDir(pendingDir);
        return rejectUpgradeUpload(res, db, user, upgradeFilename, error.message);
      }

      let upgradeVersion = 'unknown';
      try {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(pendingDir, 'package.json'), 'utf8'));
        upgradeVersion = pkgJson.version || 'unknown';
      } catch (_) {}
      if (!upgradeVersion || upgradeVersion === 'unknown' || compareSemver(upgradeVersion, packageInfo.version) <= 0) {
        cleanUpgradeDir(pendingDir);
        return rejectUpgradeUpload(res, db, user, upgradeFilename, `不允许安装低于或等于当前版本的升级包（当前 ${packageInfo.version}，升级包 ${upgradeVersion}）`, { toVersion: upgradeVersion });
      }
      try {
        writeUpgradeSha256Sums(pendingDir);
      } catch (error) {
        cleanUpgradeDir(pendingDir);
        return rejectUpgradeUpload(res, db, user, upgradeFilename, `写入 SHA256SUMS 失败：${error.message}`, { toVersion: upgradeVersion });
      }

      const readyFlagPath = path.join(upgradesDir, 'UPGRADE_READY');
      const readyFlagTemp = `${readyFlagPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
      try {
        // 先写临时文件验证目录可写，审计日志落库成功后再切换为正式标记。
        fs.writeFileSync(readyFlagTemp, JSON.stringify({
          version: upgradeVersion,
          timestamp: now(),
          requestedBy: user.username
        }), { mode: 0o600 });
      } catch (error) {
        cleanUpgradeDir(pendingDir);
        return rejectUpgradeUpload(res, db, user, upgradeFilename, `写入升级就绪标记失败：${error.message}。请确认 data/upgrades 属于容器内运行用户（node，uid 1000）`, { toVersion: upgradeVersion });
      }
      upgradeApplyScheduled = true;

      try {
        appendAuditLog(db, user, 'upgrade', 'system', '', `上传升级包 v${upgradeVersion}，系统即将自动重启完成升级`);
        await appendUpgradeLog(db, user, {
          filename: upgradeFilename,
          status: 'accepted',
          toVersion: upgradeVersion,
          message: `升级包 v${upgradeVersion} 已接收，系统将自动应用升级并重启`
        });
        fs.renameSync(readyFlagTemp, readyFlagPath);
      } catch (error) {
        upgradeApplyScheduled = false;
        try { fs.unlinkSync(readyFlagTemp); } catch (_) {}
        cleanUpgradeDir(pendingDir);
        return rejectUpgradeUpload(res, db, user, upgradeFilename, `升级准备失败：${error.message}`, { toVersion: upgradeVersion, status: 500 });
      }

      const applyAndRestart = () => {
        if (!isProduction) {
          console.error('[upgrade] 非生产环境，跳过自动落地与重启。请手动重启服务以应用升级。');
          upgradeApplyScheduled = false;
          return;
        }
        try {
          const appDir = path.resolve(__dirname);
          const pendingDir = path.join(dataDir, 'upgrades', 'pending');
          const readyFlag = path.join(dataDir, 'upgrades', 'UPGRADE_READY');
          const result = applyPendingUpgradeFiles(pendingDir, appDir);
          result.applied.forEach(entry => console.error(`[upgrade] Applied ${entry}`));
          result.unchanged.forEach(entry => console.error(`[upgrade] Unchanged ${entry}`));
          result.failed.forEach(entry => console.error(`[upgrade] 应用失败 ${entry.name}: ${entry.message}`));
          // 关键文件缺失会让新前端配旧后端，属于半升级状态，宁可保留旧进程等人工处理。
          const criticalFailures = result.failed.filter(entry => entry.critical);
          if (criticalFailures.length) {
            console.error(`[upgrade] 升级未完整应用: ${criticalFailures.map(entry => `${entry.name}: ${entry.message}`).join('; ')}`);
            console.error('[upgrade] 升级包已保留在 data/upgrades/pending，修复上述文件权限后重启容器即可重试');
            upgradeApplyScheduled = false;
            return;
          }
          if (result.failed.length) {
            // 非关键文件失败时保留 pending，入口脚本下次启动会再应用一次后归档。
            console.error('[upgrade] 非关键文件未应用，已保留 pending 供下次启动重试');
          } else {
            fs.rmSync(pendingDir, { recursive: true, force: true });
            try { fs.unlinkSync(readyFlag); } catch (_) {}
          }
          console.error(`[upgrade] v${upgradeVersion} 升级完成，即将重启...`);
        } catch (e) {
          console.error(`[upgrade] 升级失败: ${e.message}`);
          upgradeApplyScheduled = false;
          return;
        }
        process.exit(0);
      };

      const body = JSON.stringify({
        message: `升级包 v${upgradeVersion} 已接收，系统将自动应用升级并重启`,
        version: upgradeVersion
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      setTimeout(applyAndRestart, 800);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/system/upgrade/logs') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const logs = [...(db.upgradeLogs || [])]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 50)
        .map(item => ({
          id: item.id,
          operatorName: item.operatorName || '',
          filename: item.filename || '',
          fromVersion: item.fromVersion || '',
          toVersion: item.toVersion || '',
          status: item.status || 'failed',
          message: item.message || '',
          createdAt: item.createdAt || ''
        }));
      return json(res, 200, { data: logs, total: logs.length });
    }

    if (req.method === 'GET' && pathname === '/api/system/upgrade/status') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const upgradesDir = path.join(dataDir, 'upgrades');
      const readyFlag = path.join(upgradesDir, 'UPGRADE_READY');
      const pendingDir = path.join(upgradesDir, 'pending');
      // 升级包/标记文件可能被中断的升级流程写坏，解析失败时按「无」处理，避免状态接口直接 500。
      const readJsonFile = filePath => {
        try {
          if (!fs.existsSync(filePath)) return null;
          return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (_) {
          return null;
        }
      };
      const pendingManifest = readJsonFile(path.join(pendingDir, 'package.json'));
      const pendingVersion = pendingManifest ? (pendingManifest.version || 'unknown') : null;
      const ready = readJsonFile(readyFlag);
      const currentVersion = packageInfo.version;
      return json(res, 200, {
        currentVersion,
        pendingVersion,
        ready,
        hasPending: fs.existsSync(pendingDir) && fs.readdirSync(pendingDir).length > 0
      });
    }

    return await serveStatic(req, res, pathname, db);
  } catch (error) {
    console.error('Request error:', error.message);
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    // 存储不可用时给出 503 与重试间隔，让反向代理和前端能区分「临时故障」与真正的 500。
    if (isTransientStorageError(error)) {
      const retryAfter = Math.max(1, Math.ceil(((mysqlUnavailableUntil || 0) - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return json(res, 503, { message: '数据存储暂时不可用，请稍后重试' });
    }
    const status = Number(error.status) || 500;
    return json(res, status, { message: status < 500 ? error.message : '服务器内部错误' });
  }
};

const server = http.createServer(requestHandler);

// 限制单帧大小，避免已登录连接用超大消息占用内存。
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const wsClients = new Set();

// 会话被撤销（注销、改密、禁用、拒绝、删除、改角色/项目）后，需同步断开该用户已建立的
// WebSocket，否则该连接会按握手时的角色/项目继续接收广播，直到 socket 自行断开。
function closeUserWebSockets(userId) {
  if (!userId) return;
  for (const ws of wsClients) {
    if (ws.userId !== userId) continue;
    try { ws.close(1008, 'session invalidated'); } catch (_) {}
  }
}

function attachWsUpgradeHandler(targetServer) {
  targetServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }
    try {
      const origin = request.headers.origin || '';
      if (origin) {
        const originUrl = new URL(origin);
        const host = request.headers.host || '';
        if (originUrl.host !== host) {
          socket.destroy();
          return;
        }
      }
      const db = readDbInternalSync();
      const user = getAuthUser(request, db);
      if (!user) {
        socket.destroy();
        return;
      }
    } catch (_) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });
}

attachWsUpgradeHandler(server);

wss.on('connection', (ws, request) => {
  ws.isAlive = true;
  try {
    const db = readDbInternalSync();
    const user = getAuthUser(request, db);
    if (!user) {
      ws.close();
      return;
    }
    ws.userId = user.id;
    ws.role = user.role;
    ws.projectId = user.projectId || '';
    ws.projectIds = userProjectIds(user);
    ws.sessionToken = getSessionToken(request);
  } catch (_) {
    ws.close();
    return;
  }
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    } catch (_) {}
  });
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
  try {
    const snapshot = buildTrafficSnapshotForUser(user, db);
    ws.send(JSON.stringify({ type: 'traffic_update', rates: snapshot.rates, portStatus: snapshot.portStatus, timestamp: Date.now() }));
  } catch (_) {}
});

const wsHeartbeatTimer = setInterval(() => {
  const stale = [];
  let db = null;
  try { db = readDbInternalSync(); } catch (_) { db = null; }
  const idleLimitMs = db ? getIdleLimitMs(db) : 0;
  for (const ws of wsClients) {
    // 握手后不再复核会话会导致注销、禁用、空闲超时后连接仍持续接收广播。
    if (db) {
      const session = (db.sessions || []).find(item => item.token === ws.sessionToken);
      const user = session ? (db.users || []).find(item => item.id === session.userId) : null;
      const lastActivityMs = session ? Date.parse(session.lastActivityAt || session.createdAt) : NaN;
      const sessionExpired = !session
        || Date.parse(session.expiresAt) <= Date.now()
        || (Number.isFinite(lastActivityMs) && Date.now() - lastActivityMs > idleLimitMs);
      const enrollmentBlocked = Boolean(user && user.twoFactorEnforced && !user.twoFactorEnabled
        && !String(user.username || '').startsWith('oidc_'));
      if (!user || user.status !== 'active' || sessionExpired || enrollmentBlocked) {
        try { ws.close(1008, 'session invalidated'); } catch (_) {}
        stale.push(ws);
        continue;
      }
      // 角色/项目可能已被管理员调整，广播前同步到最新值。
      ws.role = user.role;
      ws.projectId = user.projectId || '';
      ws.projectIds = userProjectIds(user);
    }
    if (ws.isAlive === false) {
      ws.terminate();
      stale.push(ws);
      continue;
    }
    ws.isAlive = false;
    try {
      if (ws.readyState === 1) ws.ping();
    } catch (_) {
      stale.push(ws);
    }
  }
  for (const ws of stale) wsClients.delete(ws);
}, webSocketHeartbeatIntervalMs);

if (wsHeartbeatTimer.unref) wsHeartbeatTimer.unref();

function broadcastChange(topic, payload = {}) {
  const message = JSON.stringify({ type: 'data-changed', topic, payload, timestamp: Date.now() });
  sendToScopedWs(message, payload && payload.projectId);
}

function broadcastToProject(projectId, payload = {}) {
  const stale = [];
  for (const ws of wsClients) {
    try {
      if (ws.readyState !== 1) continue;
      const isAdmin = ws.role === 'admin';
      const sameProject = Boolean(projectId) && userHasProject({ projectId: ws.projectId, projectIds: ws.projectIds }, projectId);
      if (!isAdmin && !sameProject) continue;
      const body = { type: 'monitor_alert', projectId, ...payload, timestamp: Date.now() };
      if (ws.role === 'customer') {
        delete body.host;
        if (body.message) body.message = String(body.message).replace(/\s*\([^)]*\)/, '');
      }
      ws.send(JSON.stringify(body));
    } catch (_) {
      stale.push(ws);
    }
  }
  for (const ws of stale) wsClients.delete(ws);
}

function sendToScopedWs(message, projectId) {
  const stale = [];
  for (const ws of wsClients) {
    try {
      if (ws.readyState !== 1) continue;
      // 慢客户端堆积时丢弃本次广播，避免服务端内存被单连接拖垮。
      if (ws.bufferedAmount > 1024 * 1024) continue;
      const allowAll = !projectId;
      const isAdmin = ws.role === 'admin';
      const sameProject = Boolean(projectId) && userHasProject({ projectId: ws.projectId, projectIds: ws.projectIds }, projectId);
      if (ws.role === 'customer' && !sameProject) continue;
      if (allowAll || isAdmin || sameProject) ws.send(message);
    } catch (_) {
      stale.push(ws);
    }
  }
  for (const ws of stale) wsClients.delete(ws);
}

const port = Number(process.env.PORT || 3000);

// Clean up stale SSH password temp files from previous crashed processes
try {
  const tmpFiles = fs.readdirSync('/tmp').filter(f => f.startsWith('sshpass-'));
  for (const f of tmpFiles) {
    const abs = path.join('/tmp', f);
    try { fs.unlinkSync(abs); } catch (_) {}
  }
} catch (_) {}

server.on('error', (error) => {
  console.error(`HTTP server error: ${error.message}`);
  // 仅在监听建立失败（如端口占用）时退出；运行期偶发错误不应直接终止服务。
  if (!server.listening) {
    gracefulShutdown('server-error', 1);
  }
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

async function initializeRuntimeServices() {
  try {
    const db = await readDb();
    await applyHttpsServerConfig(db.systemConfig || {});
  } catch (error) {
    httpsServerStatus = {
      status: 'stopped',
      detail: `HTTPS 登录初始化失败：${error.message}`,
      port: defaultHttpsPort,
      checkedAt: now()
    };
  }
}

initializeRuntimeServices().catch(error => {
  logStorageFailure('Runtime services initialization failed', error);
});
recoverInterruptedRunsOnce().catch(error => {
  logStorageFailure('Interrupted run recovery failed', error);
});
runAiInspectionScheduler();
const schedulerIntervalId = setInterval(runAiInspectionScheduler, maintenanceIntervalMs);

const monitorRuntimeState = { statuses: {}, lastRunAt: null, consecutive: {}, samples: {} };

function getMonitorStatus(assetId) {
  return monitorRuntimeState.statuses[assetId] || null;
}

function setMonitorStatus(assetId, status) {
  const prev = monitorRuntimeState.statuses[assetId];
  const entry = { status, lastCheck: Date.now() };
  monitorRuntimeState.statuses[assetId] = entry;
  return { prev, current: entry, changed: !prev || prev.status !== status };
}

function monitorHistoryFilePath(date = new Date()) {
  return path.join(monitorHistoryDir, `${formatDateKey(date)}.jsonl`);
}

// 监控历史独立于业务快照按天追加，避免每 5 分钟采样触发整库重写。
function appendMonitorSamples(samples) {
  if (!Array.isArray(samples) || !samples.length) return;
  const byDate = new Map();
  for (const sample of samples) {
    if (!sample || !sample.assetId || !sample.at) continue;
    const atMs = Date.parse(sample.at);
    if (!Number.isFinite(atMs)) continue;
    const key = formatDateKey(new Date(atMs));
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(sample);
  }
  for (const [dateKey, items] of byDate) {
    ensureDir(monitorHistoryDir);
    const payload = items.map(item => JSON.stringify(item)).join('\n') + '\n';
    fs.appendFileSync(path.join(monitorHistoryDir, `${dateKey}.jsonl`), payload, 'utf8');
  }
}

function readMonitorHistorySamples(assetId, sinceMs, untilMs) {
  const samples = [];
  if (!assetId) return samples;
  let names = [];
  try {
    names = fs.readdirSync(monitorHistoryDir).filter(name => name.endsWith('.jsonl')).sort();
  } catch (_) {
    return samples;
  }
  for (const name of names) {
    const filePath = path.join(monitorHistoryDir, name);
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line) continue;
      let item;
      try {
        item = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (!item || item.assetId !== assetId) continue;
      const atMs = Date.parse(item.at || '');
      if (!Number.isFinite(atMs) || atMs < sinceMs || atMs > untilMs) continue;
      samples.push(item);
    }
  }
  samples.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return samples;
}

function cleanupMonitorHistory(retentionDays) {
  const cutoffMs = nowMs() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  let removed = 0;
  let names = [];
  try {
    names = fs.readdirSync(monitorHistoryDir);
  } catch (_) {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const filePath = path.join(monitorHistoryDir, name);
    try {
      // 以文件名中的自然日判断过期，避免文件写入时间受补采影响而延长保留期。
      const dateMs = Date.parse(`${name.slice(0, 10)}T00:00:00Z`);
      const expired = Number.isFinite(dateMs) ? dateMs < cutoffMs : fs.statSync(filePath).mtimeMs < cutoffMs;
      if (!expired) continue;
      fs.rmSync(filePath, { force: true });
      removed += 1;
    } catch (_) {}
  }
  return removed;
}

const monitorTrendRanges = {
  '1h': { durationMs: 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
  '24h': { durationMs: 24 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000 },
  '7d': { durationMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  '30d': { durationMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 }
};

function resolveMonitorTrendRange(query = {}) {
  const rangeKey = monitorTrendRanges[query.range] ? query.range : '24h';
  const range = monitorTrendRanges[rangeKey];
  const untilMs = Date.now();
  return { rangeKey, sinceMs: untilMs - range.durationMs, untilMs, bucketMs: range.bucketMs };
}

// 按固定时间桶聚合采样点：可用性取在线比例，资源指标取桶内均值。
function buildMonitorTrend(assetId, query = {}) {
  const range = resolveMonitorTrendRange(query);
  const samples = readMonitorHistorySamples(assetId, range.sinceMs, range.untilMs);
  const bucketCount = Math.ceil((range.untilMs - range.sinceMs) / range.bucketMs);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    start: new Date(range.sinceMs + index * range.bucketMs).toISOString(),
    total: 0,
    online: 0,
    cpuSum: 0,
    cpuCount: 0,
    memorySum: 0,
    memoryCount: 0,
    diskSum: 0,
    diskCount: 0
  }));
  for (const sample of samples) {
    const atMs = Date.parse(sample.at || '');
    if (!Number.isFinite(atMs)) continue;
    const index = Math.floor((atMs - range.sinceMs) / range.bucketMs);
    if (index < 0 || index >= buckets.length) continue;
    const bucket = buckets[index];
    bucket.total += 1;
    if (sample.status === 'online') bucket.online += 1;
    const pushMetric = (sumKey, countKey, value) => {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
      bucket[sumKey] += Number(value);
      bucket[countKey] += 1;
    };
    pushMetric('cpuSum', 'cpuCount', sample.cpuPercent);
    pushMetric('memorySum', 'memoryCount', sample.memoryPercent);
    pushMetric('diskSum', 'diskCount', sample.diskPercent);
  }
  const points = buckets.map(bucket => ({
    at: bucket.start,
    samples: bucket.total,
    availability: bucket.total ? Math.round((bucket.online / bucket.total) * 1000) / 10 : null,
    cpuPercent: bucket.cpuCount ? Math.round((bucket.cpuSum / bucket.cpuCount) * 10) / 10 : null,
    memoryPercent: bucket.memoryCount ? Math.round((bucket.memorySum / bucket.memoryCount) * 10) / 10 : null,
    diskPercent: bucket.diskCount ? Math.round((bucket.diskSum / bucket.diskCount) * 10) / 10 : null
  }));
  const onlineSamples = samples.filter(item => item.status === 'online').length;
  return {
    range: range.rangeKey,
    since: new Date(range.sinceMs).toISOString(),
    until: new Date(range.untilMs).toISOString(),
    sampleCount: samples.length,
    availability: samples.length ? Math.round((onlineSamples / samples.length) * 1000) / 10 : null,
    points
  };
}

async function checkAssetPing(host, timeoutMs = 3000) {
  const gate = await resolveMonitorTargetAddress(host);
  if (!gate.ok) return 'offline';
  return new Promise(resolve => {
    try {
      const child = execFile('ping', ['-c', '1', '-W', '2', gate.address], { timeout: timeoutMs }, (err) => {
        resolve(err ? 'offline' : 'online');
      });
      setTimeout(() => { try { child.kill(); } catch (_) {} resolve('offline'); }, timeoutMs);
    } catch (_) {
      resolve('offline');
    }
  });
}

async function checkAssetTcp(host, port, timeoutMs = 3000) {
  if (!validatePort(port)) return 'offline';
  const gate = await resolveMonitorTargetAddress(host);
  if (!gate.ok) return 'offline';
  return new Promise(resolve => {
    try {
      const net = require('net');
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => { socket.destroy(); resolve('online'); });
      socket.on('error', () => { socket.destroy(); resolve('offline'); });
      socket.on('timeout', () => { socket.destroy(); resolve('offline'); });
      socket.connect(Number(port), gate.address);
    } catch (_) {
      resolve('offline');
    }
  });
}

async function checkAssetSnmp(host, asset, timeoutMs = 3000) {
  if (!validateHost(host)) return 'offline';
  const community = String(asset.snmpCommunity || '').trim();
  if (!community) return 'offline';
  const port = parseInt(asset.snmpPort || '161', 10);
  try {
    const vb = await snmpGetUdp(host, port, community, [1, 3, 6, 1, 2, 1, 1, 3, 0], timeoutMs);
    return vb && vb.value !== undefined && vb.value !== null ? 'online' : 'offline';
  } catch (_) {
    return 'offline';
  }
}

function snmpToNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function oidMatches(value, expected) {
  if (Array.isArray(value)) {
    return expected.every((part, index) => value[index] === part) && value.length === expected.length;
  }
  return String(value || '').includes(expected.join('.'));
}

async function collectAssetSnmpMetrics(asset) {
  const host = String(asset.monitorHost || '').trim();
  const community = String(asset.snmpCommunity || '').trim();
  if (!host || !validateHost(host) || !community) return;
  const port = parseInt(asset.snmpPort || '161', 10);
  const timeoutMs = 2000;
  const metrics = emptySnmpMetrics();
  const nowTs = Date.now();
  try {
    const up = await snmpGetUdp(host, port, community, [1, 3, 6, 1, 2, 1, 1, 3, 0], timeoutMs);
    const ticks = snmpToNumber(up && up.value);
    if (ticks !== null) metrics.uptimeSeconds = Math.floor(ticks / 100);
  } catch (_) {}
  try {
    const idle = await snmpGetUdp(host, port, community, [1, 3, 6, 1, 4, 1, 2021, 11, 11, 0], timeoutMs);
    const idlePct = snmpToNumber(idle && idle.value);
    if (idlePct !== null) {
      metrics.cpuPercent = Math.max(0, Math.min(100, 100 - idlePct));
    } else {
      const loads = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 25, 3, 3, 1, 2], timeoutMs, 16);
      const nums = loads.map(item => snmpToNumber(item.value)).filter(value => value !== null);
      if (nums.length) metrics.cpuPercent = nums.reduce((sum, value) => sum + value, 0) / nums.length;
    }
  } catch (_) {}
  let storageTypes = [];
  let storageSizes = [];
  let storageUsed = [];
  try {
    storageTypes = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 25, 2, 3, 1, 2], timeoutMs, 32);
    storageSizes = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 25, 2, 3, 1, 5], timeoutMs, 32);
    storageUsed = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 25, 2, 3, 1, 6], timeoutMs, 32);
  } catch (_) {}
  const sizeMap = new Map(storageSizes.map(item => [item.index, snmpToNumber(item.value)]));
  const usedMap = new Map(storageUsed.map(item => [item.index, snmpToNumber(item.value)]));
  try {
    const total = await snmpGetUdp(host, port, community, [1, 3, 6, 1, 4, 1, 2021, 4, 5, 0], timeoutMs);
    const avail = await snmpGetUdp(host, port, community, [1, 3, 6, 1, 4, 1, 2021, 4, 6, 0], timeoutMs);
    const totalN = snmpToNumber(total && total.value);
    const availN = snmpToNumber(avail && avail.value);
    if (totalN && totalN > 0 && availN !== null) {
      metrics.memoryPercent = Math.max(0, Math.min(100, ((totalN - availN) / totalN) * 100));
    }
  } catch (_) {}
  if (metrics.memoryPercent === null) {
    const hrRam = [1, 3, 6, 1, 2, 1, 25, 2, 1, 2];
    for (const item of storageTypes) {
      if (!oidMatches(item.value, hrRam)) continue;
      const size = sizeMap.get(item.index);
      const used = usedMap.get(item.index);
      if (size && size > 0 && used !== null) {
        metrics.memoryPercent = Math.max(0, Math.min(100, (used / size) * 100));
        break;
      }
    }
  }
  const hrDisk = [1, 3, 6, 1, 2, 1, 25, 2, 1, 4];
  let maxDisk = null;
  for (const item of storageTypes) {
    if (!oidMatches(item.value, hrDisk)) continue;
    const size = sizeMap.get(item.index);
    const used = usedMap.get(item.index);
    if (size && size > 0 && used !== null) {
      const pct = (used / size) * 100;
      if (maxDisk === null || pct > maxDisk) maxDisk = pct;
    }
  }
  if (maxDisk !== null) metrics.diskPercent = Math.max(0, Math.min(100, maxDisk));
  try {
    const statusList = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 2, 2, 1, 8], timeoutMs, 64);
    const typeList = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 2, 2, 1, 3], timeoutMs, 64);
    let inList = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6], timeoutMs, 64);
    let outList = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 10], timeoutMs, 64);
    if (!inList.length && !outList.length) {
      inList = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 2, 2, 1, 10], timeoutMs, 64);
      outList = await snmpWalkSubtreeUdp(host, port, community, [1, 3, 6, 1, 2, 1, 2, 2, 1, 16], timeoutMs, 64);
    }
    const typeMap = new Map(typeList.map(item => [item.index, snmpToNumber(item.value)]));
    const upIndexes = new Set(statusList.filter(item => snmpToNumber(item.value) === 1).map(item => item.index));
    let inSum = 0;
    let outSum = 0;
    let counted = false;
    for (const item of inList) {
      if (!upIndexes.has(item.index) || typeMap.get(item.index) === 24) continue;
      const n = snmpToNumber(item.value);
      if (n !== null) {
        inSum += n;
        counted = true;
      }
    }
    for (const item of outList) {
      if (!upIndexes.has(item.index) || typeMap.get(item.index) === 24) continue;
      const n = snmpToNumber(item.value);
      if (n !== null) outSum += n;
    }
    if (counted) {
      const prev = snmpMetricCache[asset.id];
      if (prev && prev._ts && nowTs > prev._ts) {
        const dt = (nowTs - prev._ts) / 1000;
        let din = inSum - (prev._inOctets || 0);
        let dout = outSum - (prev._outOctets || 0);
        if (din < 0) din = inSum;
        if (dout < 0) dout = outSum;
        metrics.trafficInBps = din / dt;
        metrics.trafficOutBps = dout / dt;
      }
      metrics._inOctets = inSum;
      metrics._outOctets = outSum;
      metrics._ts = nowTs;
    }
  } catch (_) {}
  metrics.collectedAt = new Date(nowTs).toISOString();
  snmpMetricCache[asset.id] = metrics;
}

function monitorSettings(config = {}) {
  const normalized = normalizeSystemConfig(config || {});
  return {
    sampleIntervalMs: normalized.monitorSampleIntervalMinutes * 60 * 1000,
    retentionDays: normalized.monitorHistoryRetentionDays,
    consecutiveFailures: normalized.monitorConsecutiveFailures,
    cpuThreshold: normalized.monitorCpuThreshold,
    memoryThreshold: normalized.monitorMemoryThreshold,
    diskThreshold: normalized.monitorDiskThreshold
  };
}

function isMaintenanceActive(window, asset, atMs = Date.now()) {
  if (!window || window.enabled === false) return false;
  if (window.projectId && window.projectId !== asset.projectId) return false;
  if (Array.isArray(window.assetIds) && window.assetIds.length && !window.assetIds.includes(asset.id)) return false;
  const startMs = Date.parse(window.startAt || '');
  const endMs = Date.parse(window.endAt || '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return atMs >= startMs && atMs <= endMs;
}

function isAlertSilenced(alert, atMs = Date.now()) {
  if (!alert || !alert.silencedUntil) return false;
  const untilMs = Date.parse(alert.silencedUntil);
  return Number.isFinite(untilMs) && untilMs > atMs;
}

function findOpenMonitorAlert(db, assetId, metric) {
  return (db.monitorAlerts || []).find(item => item.assetId === assetId && item.metric === metric && item.status !== 'resolved') || null;
}

function monitorAlertTitle(asset, metric, level) {
  if (metric === 'availability') return `${level === 'error' ? '设备离线' : '设备离线告警'}: ${asset.name || asset.id}`;
  const label = metric === 'cpu' ? 'CPU 使用率' : metric === 'memory' ? '内存使用率' : '磁盘使用率';
  return `${label}超过阈值: ${asset.name || asset.id}`;
}

function monitorAlertContent(asset, metric, value) {
  if (metric === 'availability') return `资产 "${asset.name || asset.id}" 连续探测失败`;
  const label = metric === 'cpu' ? 'CPU 使用率' : metric === 'memory' ? '内存使用率' : '磁盘使用率';
  return `资产 "${asset.name || asset.id}" ${label}为 ${Number(value).toFixed(1)}%`;
}

function fireMonitorAlert(db, asset, metric, options = {}) {
  const at = options.at || now();
  const atMs = Date.parse(at);
  const level = options.level || 'warning';
  const title = monitorAlertTitle(asset, metric, level);
  const content = options.content || monitorAlertContent(asset, metric, options.value);
  const maintenanceWindow = (db.monitorMaintenanceWindows || []).find(item => isMaintenanceActive(item, asset, atMs));
  const existing = findOpenMonitorAlert(db, asset.id, metric);
  if (existing) {
    const reopened = existing.status === 'acknowledged';
    const wasSuppressed = existing.suppressedReason === 'maintenance';
    existing.occurrences = Math.max(1, Number(existing.occurrences || 1)) + 1;
    existing.lastTriggeredAt = at;
    existing.level = level;
    existing.title = title;
    existing.content = content;
    existing.suppressedReason = maintenanceWindow ? 'maintenance' : '';
    const resumed = wasSuppressed && !maintenanceWindow;
    // 未确认的告警在多次触发后仍保持 open；已确认的告警再次触发时退回 open，提醒重新处理。
    if (reopened) existing.status = 'open';
    return { alert: existing, created: false, reopened, resumed, suppressed: Boolean(maintenanceWindow) };
  }
  const alert = {
    id: id('monitorAlert'),
    projectId: asset.projectId || '',
    assetId: asset.id,
    assetName: asset.name || '',
    metric,
    level,
    title,
    content,
    status: 'open',
    occurrences: 1,
    firstTriggeredAt: at,
    lastTriggeredAt: at,
    acknowledgedAt: '',
    acknowledgedBy: '',
    acknowledgedByName: '',
    acknowledgeNote: '',
    resolvedAt: '',
    resolvedReason: '',
    silencedUntil: '',
    silencedBy: '',
    suppressedReason: maintenanceWindow ? 'maintenance' : '',
    createdAt: at
  };
  db.monitorAlerts = db.monitorAlerts || [];
  db.monitorAlerts.unshift(alert);
  return { alert, created: true, suppressed: Boolean(maintenanceWindow) };
}

function resolveMonitorAlert(db, asset, metric, reason, at = now()) {
  const alert = findOpenMonitorAlert(db, asset.id, metric);
  if (!alert) return null;
  alert.status = 'resolved';
  alert.resolvedAt = at;
  alert.resolvedReason = reason || '指标恢复正常';
  return alert;
}

function evaluateAvailability(db, asset, status, settings, at) {
  const state = monitorRuntimeState;
  const failureCount = status === 'offline' ? (state.consecutive[asset.id] || 0) + 1 : 0;
  state.consecutive[asset.id] = failureCount;
  if (status === 'offline' && failureCount >= settings.consecutiveFailures) {
    const fired = fireMonitorAlert(db, asset, 'availability', {
      at,
      level: failureCount >= settings.consecutiveFailures * 2 ? 'error' : 'warning',
      content: `资产 "${asset.name || asset.id}" 连续 ${failureCount} 次探测失败`
    });
    return { ...fired, failureCount, recovered: false };
  }
  if (status === 'online') {
    const resolved = resolveMonitorAlert(db, asset, 'availability', '设备恢复在线', at);
    return { alert: resolved, created: false, suppressed: false, failureCount, recovered: Boolean(resolved) };
  }
  return { alert: null, created: false, suppressed: false, failureCount, recovered: false };
}

function evaluateMetricThreshold(db, asset, metric, value, threshold, settings, at) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const key = `${asset.id}:${metric}`;
  const exceeded = Number(value) >= threshold;
  const count = exceeded ? (monitorRuntimeState.consecutive[key] || 0) + 1 : 0;
  monitorRuntimeState.consecutive[key] = count;
  if (exceeded && count >= settings.consecutiveFailures) {
    const fired = fireMonitorAlert(db, asset, metric, { at, value: Number(value), level: 'warning' });
    return { ...fired, recovered: false };
  }
  if (!exceeded) {
    const resolved = resolveMonitorAlert(db, asset, metric, '指标恢复到阈值以下', at);
    return { alert: resolved, created: false, suppressed: false, recovered: Boolean(resolved) };
  }
  return null;
}

function publishMonitorAlertEvents(db, events) {
  for (const event of events) {
    if (!event || !event.alert) continue;
    // 新告警与已确认后重新触发的告警需要推送；静默期内只记录状态，静默到期后再次触发才恢复播报。
    if ((event.created || event.reopened || event.resumed) && !event.suppressed && !isAlertSilenced(event.alert)) {
      createNotification(
        db,
        event.alert.projectId || '',
        event.alert.title,
        event.alert.content,
        event.alert.level === 'error' ? 'error' : 'warning',
        'monitor-alert',
        'asset',
        event.alert.assetId
      );
      broadcastToProject(event.alert.projectId, {
        type: 'monitor_alert',
        assetId: event.alert.assetId,
        assetName: event.alert.assetName,
        metric: event.alert.metric,
        monitorStatus: 'offline',
        title: event.alert.title,
        message: event.alert.content
      });
    }
    if (event.recovered) {
      const message = `资产 "${event.alert.assetName || event.alert.assetId}" ${event.alert.metric === 'availability' ? '已恢复在线' : '指标已恢复'}`;
      createNotification(db, event.alert.projectId || '', `设备恢复: ${event.alert.assetName}`, message, 'info', 'monitor-alert', 'asset', event.alert.assetId);
      broadcastToProject(event.alert.projectId, {
        type: 'monitor_alert',
        assetId: event.alert.assetId,
        assetName: event.alert.assetName,
        metric: event.alert.metric,
        monitorStatus: 'online',
        title: `设备恢复: ${event.alert.assetName}`,
        message
      });
    }
  }
}

async function checkAssetMonitor(asset) {
  if (!asset.monitorEnabled) return { status: 'unknown', metrics: emptySnmpMetrics() };
  const host = String(asset.monitorHost || '').trim();
  if (!host) {
    setMonitorStatus(asset.id, 'unknown');
    return { status: 'unknown', metrics: emptySnmpMetrics() };
  }
  let status = 'unknown';
  try {
    if (asset.monitorType === 'tcp') {
      const port = Number(asset.monitorPort) || 80;
      status = await checkAssetTcp(host, port);
    } else if (asset.monitorType === 'snmp') {
      status = await checkAssetSnmp(host, asset);
    } else {
      status = await checkAssetPing(host);
    }
  } catch (_) {
    status = 'unknown';
  }
  setMonitorStatus(asset.id, status);
  let metrics = emptySnmpMetrics();
  if (asset.monitorType === 'snmp') {
    try {
      await collectAssetSnmpMetrics(asset);
      metrics = publicSnmpMetrics(asset);
    } catch (_) {}
  }
  return { status, metrics };
}

let assetMonitorSchedulerRunning = false;
let lastMonitorSampleMs = 0;
let lastMonitorHistoryCleanupDate = '';
async function runAssetMonitorScheduler(options = {}) {
  const force = options === true || options.force === true;
  const assetFilter = Array.isArray(options.assetIds) ? new Set(options.assetIds.map(id => String(id || '')).filter(Boolean)) : null;
  if (shuttingDown) return null;
  // 单轮探测可能超过调度间隔，必须防止重叠执行导致重复告警与资源翻倍。
  if (assetMonitorSchedulerRunning) return { skipped: true };
  assetMonitorSchedulerRunning = true;
  try {
    const db = await readDb();
    refreshMonitorTargetPolicy(db.systemConfig);
    const settings = monitorSettings(db.systemConfig);
    // 首次运行后从持久化状态回填，保证重启后仍能展示上次采集时间。
    const persistedLastRunAt = db.runtimeState?.monitoring?.lastRunAt;
    if (!monitorRuntimeState.lastRunAt && persistedLastRunAt) monitorRuntimeState.lastRunAt = persistedLastRunAt;
    const monitoredAssets = (db.assets || []).filter(a => a.monitorEnabled && a.monitorHost && (!assetFilter || assetFilter.has(a.id)));
    const runAt = now();
    const runAtMs = Date.parse(runAt);
    const shouldSample = force || !lastMonitorSampleMs || runAtMs - lastMonitorSampleMs >= settings.sampleIntervalMs;
    const samples = [];
    const events = [];
    for (const asset of monitoredAssets) {
      const result = await checkAssetMonitor(asset);
      if (shouldSample) {
        samples.push({
          assetId: asset.id,
          projectId: asset.projectId || '',
          at: runAt,
          status: result.status,
          cpuPercent: result.metrics.cpuPercent,
          memoryPercent: result.metrics.memoryPercent,
          diskPercent: result.metrics.diskPercent,
          trafficInBps: result.metrics.trafficInBps,
          trafficOutBps: result.metrics.trafficOutBps
        });
      }
      const availability = evaluateAvailability(db, asset, result.status, settings, runAt);
      if (availability) events.push(availability);
      if (shouldSample && asset.monitorType === 'snmp') {
        const thresholdChecks = [
          evaluateMetricThreshold(db, asset, 'cpu', result.metrics.cpuPercent, settings.cpuThreshold, settings, runAt),
          evaluateMetricThreshold(db, asset, 'memory', result.metrics.memoryPercent, settings.memoryThreshold, settings, runAt),
          evaluateMetricThreshold(db, asset, 'disk', result.metrics.diskPercent, settings.diskThreshold, settings, runAt)
        ];
        thresholdChecks.forEach(item => { if (item) events.push(item); });
      }
    }
    if (shouldSample) {
      try {
        appendMonitorSamples(samples);
        lastMonitorSampleMs = runAtMs;
      } catch (error) {
        logStorageFailure('Monitor history append failed', error);
      }
      const todayKey = formatDateKey(new Date());
      if (lastMonitorHistoryCleanupDate !== todayKey) {
        lastMonitorHistoryCleanupDate = todayKey;
        cleanupMonitorHistory(settings.retentionDays);
      }
    }
    // 告警状态变更与通知同批落库，避免只写 runtimeState 而丢失告警生命周期。
    if (events.length) {
      publishMonitorAlertEvents(db, events);
      await writeDb(db, { replaceCollections: ['monitorAlerts', 'notifications'] });
    }
    const finishedAt = now();
    monitorRuntimeState.lastRunAt = finishedAt;
    // 仅落库 runtimeState，避免把本轮读取的整库快照写回造成无谓覆盖。
    try {
      const stateDb = await readDb();
      ensureRuntimeState(stateDb).monitoring = { lastRunAt: finishedAt };
      await writeDb(stateDb, { replaceCollections: ['runtimeState'], silent: true });
    } catch (_) {}
    return { skipped: false, sampled: shouldSample, assets: monitoredAssets.length, alerts: events.length };
  } catch (error) {
    logStorageFailure('Asset monitor scheduler error', error);
    return null;
  } finally {
    assetMonitorSchedulerRunning = false;
  }
}

const monitorIntervalMs = 60000;
const assetMonitorIntervalId = setInterval(runAssetMonitorScheduler, monitorIntervalMs);
setTimeout(() => runAssetMonitorScheduler(), 5000);

const trafficMonitorState = { lastCounters: {}, rates: {}, portStatus: {} };
const portStatusCache = {};

// SNMP 采集以网络往返为主，串行执行会让单轮耗时随链路/资产数量线性增长。
// 这里用固定并发上限的批次执行，既压住单轮耗时，也避免一次性打满对端设备。
async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, list.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(list[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildTrafficSnapshotForUser(user, db) {
  const rates = trafficMonitorState.rates || {};
  const portStatus = trafficMonitorState.portStatus || {};
  if (!user || user.role === 'admin') return { rates, portStatus };
  const projectIds = userProjectIds(user);
  if (!projectIds.length) return { rates: {}, portStatus: {} };
  const assetIds = new Set((db.assets || []).filter(item => projectIds.includes(String(item.projectId || ''))).map(item => item.id));
  const filteredRates = {};
  for (const [key, value] of Object.entries(rates)) {
    if ([...assetIds].some(assetId => key === `${assetId}_` || key.startsWith(`${assetId}_`))) {
      filteredRates[key] = value;
    }
  }
  const relIds = new Set((db.assetRelations || []).filter(item => assetIds.has(item.sourceAssetId) || assetIds.has(item.targetAssetId)).map(item => item.id));
  const filteredPortStatus = {};
  for (const [key, value] of Object.entries(portStatus)) {
    if (relIds.has(key)) filteredPortStatus[key] = value;
  }
  return { rates: filteredRates, portStatus: filteredPortStatus };
}

function broadcastTrafficUpdate(projectId) {
  let db = { assets: [], assetRelations: [] };
  try {
    db = readDbInternalSync();
  } catch (_) {}
  const stale = [];
  for (const ws of wsClients) {
    try {
      if (ws.readyState !== 1) continue;
      if (ws.bufferedAmount > 1024 * 1024) continue;
      const isAdmin = ws.role === 'admin';
      const sameProject = Boolean(projectId) && userHasProject({ projectId: ws.projectId, projectIds: ws.projectIds }, projectId);
      if (!isAdmin && !sameProject) continue;
      const snapshot = buildTrafficSnapshotForUser({ role: ws.role, projectId: ws.projectId || '', projectIds: ws.projectIds || [] }, db);
      ws.send(JSON.stringify({ type: 'traffic_update', projectId, rates: snapshot.rates, portStatus: snapshot.portStatus, timestamp: Date.now() }));
    } catch (_) {
      stale.push(ws);
    }
  }
  for (const ws of stale) wsClients.delete(ws);
}

async function getAssetSnmpPortMap(asset) {
  const key = asset.id;
  const cached = portStatusCache[key];
  if (cached && (Date.now() - cached.timestamp < 120000)) return cached.map;
  const host = String(asset.monitorHost || '').trim();
  const community = String(asset.snmpCommunity || '').trim();
  if (!host || !validateHost(host) || !community) return {};
  try {
    const port = parseInt(asset.snmpPort || '161', 10);
    const [descrList, statusList] = await Promise.all([
      snmpWalkSubtree(host, port, community, [1, 3, 6, 1, 2, 1, 2, 2, 1, 2], 4000),
      snmpWalkSubtree(host, port, community, [1, 3, 6, 1, 2, 1, 2, 2, 1, 8], 4000)
    ]);
    const statusByIndex = new Map(statusList.map(item => [item.index, item.value === 1 ? 'up' : 'down']));
    const map = {};
    descrList.forEach(item => {
      map[String(item.value)] = statusByIndex.get(item.index) || 'unknown';
    });
    portStatusCache[key] = { timestamp: Date.now(), map };
    return map;
  } catch (_) { return {}; }
}

async function updateLinkPortStatuses() {
  try {
    const db = await readDb();
    const relations = db.assetRelations || [];
    const assets = db.assets || [];
    const newPortStatus = {};
    const uniqueAssetIds = new Set();
    relations.forEach(r => {
      if (r.sourcePort || r.targetPort) {
        if (r.sourceAssetId) uniqueAssetIds.add(r.sourceAssetId);
        if (r.targetAssetId) uniqueAssetIds.add(r.targetAssetId);
      }
    });
    const assetPortMaps = {};
    await mapWithConcurrency(uniqueAssetIds, 6, async aid => {
      const asset = assets.find(a => a.id === aid);
      if (asset) assetPortMaps[aid] = await getAssetSnmpPortMap(asset);
    });
    for (const rel of relations) {
      if (!rel.sourcePort && !rel.targetPort) continue;
      const srcMap = assetPortMaps[rel.sourceAssetId] || {};
      const tgtMap = assetPortMaps[rel.targetAssetId] || {};
      const srcStatus = rel.sourcePort ? (srcMap[rel.sourcePort] || 'unknown') : 'unknown';
      const tgtStatus = rel.targetPort ? (tgtMap[rel.targetPort] || 'unknown') : 'unknown';
      newPortStatus[rel.id] = { source: srcStatus, target: tgtStatus };
    }
    trafficMonitorState.portStatus = newPortStatus;
  } catch (_) {}
}

let trafficMonitorSchedulerRunning = false;
async function runTrafficMonitorScheduler() {
  if (shuttingDown) return;
  if (trafficMonitorSchedulerRunning) return;
  trafficMonitorSchedulerRunning = true;
  try {
    const db = await readDb();
    const relations = db.assetRelations || [];
    const assets = db.assets || [];
    const newRates = {};
    const assetById = new Map(assets.map(a => [a.id, a]));
    const samples = await mapWithConcurrency(relations, 8, async rel => {
      const srcAsset = assetById.get(rel.sourceAssetId);
      if (!srcAsset || !srcAsset.monitorHost || !srcAsset.snmpCommunity) return null;
      const host = String(srcAsset.monitorHost || '').trim();
      const community = String(srcAsset.snmpCommunity || '').trim();
      if (!host || !validateHost(host) || !community) return null;
      const port = parseInt(srcAsset.snmpPort || '161', 10);
      try {
        const [inVb, outVb] = await Promise.all([
          snmpGetUdp(host, port, community, [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6, 1], 2000),
          snmpGetUdp(host, port, community, [1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 10, 1], 2000)
        ]);
        return {
          rel,
          inOctets: inVb && Number.isFinite(Number(inVb.value)) ? Number(inVb.value) : undefined,
          outOctets: outVb && Number.isFinite(Number(outVb.value)) ? Number(outVb.value) : undefined,
          nowTs: Date.now()
        };
      } catch (_) { return null; }
    });
    // 并发采集后按原始顺序合并，保证同一资产+端口的并发写入结果与串行一致。
    for (const sample of samples) {
      if (!sample) continue;
      const { rel, inOctets, outOctets, nowTs } = sample;
      const prev = trafficMonitorState.lastCounters[rel.id] || {};
      const srcKey = rel.sourceAssetId + '_' + (rel.sourcePort || '');
      const tgtKey = rel.targetAssetId + '_' + (rel.targetPort || '');
      newRates[srcKey] = { dir: 'out', rate: 0, timestamp: nowTs };
      newRates[tgtKey] = { dir: 'in', rate: 0, timestamp: nowTs };
      const dt = (nowTs - (prev.ts || nowTs)) / 1000;
      if (dt > 0) {
        if (inOctets !== undefined && prev.inOctets !== undefined) {
          let inRate = ((inOctets - prev.inOctets) * 8) / dt;
          if (inRate < 0) inRate = 0;
          newRates[tgtKey].rate = Math.round(inRate);
        }
        if (outOctets !== undefined && prev.outOctets !== undefined) {
          let outRate = ((outOctets - prev.outOctets) * 8) / dt;
          if (outRate < 0) outRate = 0;
          newRates[srcKey].rate = Math.round(outRate);
        }
      }
      trafficMonitorState.lastCounters[rel.id] = { inOctets, outOctets, ts: nowTs };
    }
    trafficMonitorState.rates = newRates;
    await updateLinkPortStatuses();
    const projectIds = [...new Set(relations.map(r => {
      const a = assetById.get(r.sourceAssetId);
      return a ? a.projectId : null;
    }).filter(Boolean))];
    for (const pid of projectIds) {
      broadcastTrafficUpdate(pid);
    }
  } catch (e) {
    logStorageFailure('Traffic monitor scheduler error', e);
  } finally {
    trafficMonitorSchedulerRunning = false;
  }
}

const trafficMonitorIntervalId = setInterval(runTrafficMonitorScheduler, 30000);
setTimeout(() => runTrafficMonitorScheduler(), 15000);

async function runAutoBackup() {
  if (shuttingDown) return;
  try {
    // 通过 readDb() 读取权威快照；readDbInternalSync() 在 MySQL 加载完成前只能拿到本地文件，
    // 启动时直接调用会把陈旧文件内容写入自动备份。
    const db = await readDb();
    const filename = `auto-backup-${now().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(backupDir, filename);
    if (!fs.existsSync(filePath)) {
      if (db) {
        await writeJsonFileStreaming(filePath, await serializeDbSnapshot(db));
      }
    }
    // 所有备份（每日快照、重置/导入/恢复前快照、手动快照）统一按 localBackupRetentionDays
    // （默认 180 天）保留，超期在可恢复区与归档区一并清理。
    cleanupExpiredBackupFiles();
  } catch (e) {
    logStorageFailure('Auto backup failed', e);
    // 自动备份每天只跑一次，启动时数据库未就绪不能等 24 小时，需尽快补跑。
    if (isTransientStorageError(e) && !autoBackupRetryTimer) {
      autoBackupRetryTimer = setTimeout(() => {
        autoBackupRetryTimer = null;
        runAutoBackup().catch(() => {});
      }, 60000);
      autoBackupRetryTimer.unref?.();
    }
  }
}
let autoBackupRetryTimer = null;
runAutoBackup().catch(error => logStorageFailure('Auto backup failed', error));
const backupIntervalId = setInterval(runAutoBackup, 24 * 60 * 60 * 1000);

function gracefulShutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`Received ${signal}, shutting down gracefully...`);
  clearInterval(wsHeartbeatTimer);
  clearInterval(schedulerIntervalId);
  clearInterval(backupIntervalId);
  clearInterval(assetMonitorIntervalId);
  clearInterval(trafficMonitorIntervalId);
  // 关闭前先断开 WebSocket，避免 server.close() 因长连接迟迟不回调。
  for (const client of wsClients) {
    try { client.close(); } catch (_) {}
  }
  server.close(() => {
    console.error('HTTP server closed');
    if (httpsServer) {
      httpsServer.close(() => {
        console.error('HTTPS server closed');
        if (mysqlPool) { mysqlPool.end().catch(() => {}); }
        process.exit(exitCode);
      });
    } else {
      if (mysqlPool) { mysqlPool.end().catch(() => {}); }
      process.exit(exitCode);
    }
  });
  // 保持长连接或慢请求不应拖住发布流程，宽限期后主动断开剩余连接。
  setTimeout(() => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }, 5000).unref();
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, shutting down:', err);
  gracefulShutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
