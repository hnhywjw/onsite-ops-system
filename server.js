const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, execFile, execSync } = require('child_process');
const crypto = require('crypto');
const tls = require('tls');
const { URL } = require('url');
const os = require('os');
const net = require('net');
const dns = require('dns').promises;
const mysql = require('mysql2/promise');
const { WebSocketServer } = require('ws');
const packageInfo = require('./package.json');

const root = __dirname;
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const dbPath = path.join(dataDir, 'db.json');
const backupDir = path.join(dataDir, 'backups');
const archiveDir = path.join(dataDir, 'archive');
const auditArchiveDir = path.join(archiveDir, 'audit');
const backupArchiveDir = path.join(archiveDir, 'backups');
const notificationArchiveDir = path.join(archiveDir, 'notifications');
const httpsCertDir = path.join(dataDir, 'https');
const httpsCertPath = path.join(httpsCertDir, 'login-cert.pem');
const httpsKeyPath = path.join(httpsCertDir, 'login-key.pem');
const pptxTemplatePath = path.join(root, 'pptx-template.json');
const uploadsDir = path.join(dataDir, 'uploads');
const documentsUploadDir = path.join(uploadsDir, 'documents');
const sessionMaxAgeSeconds = parseInt(process.env.SESSION_MAX_AGE_SECONDS, 10) || 7 * 24 * 60 * 60;
const defaultWebIdleLogoutMinutes = parseInt(process.env.WEB_IDLE_LOGOUT_MINUTES, 10) || 30;
const defaultHttpsPort = Number(process.env.HTTPS_PORT || 3443);
const maintenanceIntervalMs = parseInt(process.env.MAINTENANCE_INTERVAL_MS, 10) || 60 * 1000;
let systemTimezoneOffsetMinutes = 480;
const auditArchiveRetentionDays = parseInt(process.env.AUDIT_ARCHIVE_RETENTION_DAYS, 10) || 180;
const notificationArchiveRetentionDays = parseInt(process.env.NOTIFICATION_ARCHIVE_RETENTION_DAYS, 10) || 180;
const localBackupRetentionDays = parseInt(process.env.LOCAL_BACKUP_RETENTION_DAYS, 10) || 30;
const generalNotificationRetentionDays = parseInt(process.env.GENERAL_NOTIFICATION_RETENTION_DAYS, 10) || 30;
const importantNotificationRetentionDays = parseInt(process.env.IMPORTANT_NOTIFICATION_RETENTION_DAYS, 10) || 90;
const dbConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'onsite_ops',
  password: process.env.MYSQL_PASSWORD || 'onsite_ops_password',
  database: process.env.MYSQL_DATABASE || 'onsite_ops_system'
};
const dbCollectionKeys = ['users', 'projects', 'assets', 'logs', 'inspectionPlans', 'inspectionExecutions', 'spareParts', 'sparePartMovements', 'changeRecords', 'incidentRecords', 'approvals', 'notifications', 'auditLogs', 'knowledgeBase', 'documents', 'aiInspectionTargets', 'aiInspectionTemplates', 'aiInspectionTasks', 'aiInspectionResults', 'configBackupPlans', 'configBackupRecords', 'sessions', 'systemConfig', 'runtimeState'];
const allowFileDbFallback = process.env.ALLOW_FILE_DB_FALLBACK === 'true';
const loginRateLimitWindowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000;
const loginRateLimitLockMs = parseInt(process.env.LOGIN_RATE_LIMIT_LOCK_MS, 10) || 15 * 60 * 1000;
const loginRateLimitMaxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 10) || 5;
const webSocketHeartbeatIntervalMs = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS, 10) || 30000;
const isProduction = process.env.NODE_ENV === 'production';
const upgradeSigningKey = process.env.UPGRADE_SIGNING_KEY || '';
const allowedBackupCommands = (process.env.CONFIG_BACKUP_ALLOWED_COMMANDS || 'show running-config,show startup-config,display current-configuration,cat /etc/os-release')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);
let mysqlPool = null;
let mysqlReadyPromise = null;
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
fs.mkdirSync(httpsCertDir, { recursive: true });
fs.mkdirSync(documentsUploadDir, { recursive: true });

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
  if (!upgradeSigningKey || upgradeSigningKey.length < 32) problems.push('UPGRADE_SIGNING_KEY 必须设置且长度不少于 32 位');
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
async function fetchJwks(jwksUri) {
  const current = nowMs();
  if (_jwksCache && current - _jwksCacheTime < 3600000) return _jwksCache;
  const res = await fetch(jwksUri);
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
  if (payload.exp && Number(payload.exp) * 1000 <= nowMs()) throw new Error('ID token expired');
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
    const res = await fetch(url);
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
          eqParts.push(encodeOctetString(0x04, op.value || ''));
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
      return String(val).replace(/[,+\"\\<>;=#]/g, '\\$&');
    }

    conn.on('connect', () => {
      messageId = 1;
      sendLdapMessage(messageId, { type: 'bind', version: 3, name: bindDn || userDn, password: bindDn ? bindPassword : password });
    });

    let bindResultReceived = false;
    conn.on('ldap_result', (result) => {
      if (!bindResultReceived) {
        bindResultReceived = true;
        if (result.resultCode !== 0) {
          conn.end();
          return resolve(null);
        }
        if (bindDn) {
          messageId = 2;
          sendLdapMessage(messageId, { type: 'search', baseObject: baseDn, scope: 2, attribute: 'cn', value: username });
        } else {
          conn.end();
          return resolve({ displayName: username, email: '', phone: '' });
        }
        return;
      }
      conn.end();
      if (result.entries && result.entries.length > 0) {
        const entry = result.entries[0];
        return resolve({
          displayName: (entry.cn && entry.cn[0]) || username,
          email: (entry.mail && entry.mail[0]) || '',
          phone: (entry.telephoneNumber && entry.telephoneNumber[0]) || (entry.mobile && entry.mobile[0]) || ''
        });
      }
      return resolve(null);
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

const captchaCharset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const captchaSecret = crypto.randomBytes(32).toString('hex');

function generateCaptchaCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += captchaCharset[crypto.randomInt(0, captchaCharset.length)];
  }
  return code;
}

function renderCaptchaSvg(code) {
  const w = 140, h = 44;
  const cx = w / 2, cy = h / 2;
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
  for (let i = 0; i < code.length; i++) {
    const x = 20 + i * 30 + (Math.random() - 0.5) * 6;
    const y = 30 + (Math.random() - 0.5) * 8;
    const rot = (Math.random() - 0.5) * 25;
    const size = 24 + Math.random() * 4;
    const color = `hsl(${210 + Math.random() * 30}, 60%, ${30 + Math.random() * 25}%)`;
    letters += `<text x="${x}" y="${y}" transform="rotate(${rot},${x},${y})" font-family="sans-serif" font-weight="700" font-size="${size}" fill="${color}">${code[i]}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#f8fafc" rx="4"/><rect width="${w}" height="${h}" fill="none" stroke="#e2e8f0" rx="4"/>${paths}${dots}${letters}</svg>`;
}

function createCaptchaToken(code) {
  const payload = `${code}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', captchaSecret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyCaptchaToken(token, answer) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const lastColon = decoded.lastIndexOf(':');
    if (lastColon === -1) return false;
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expectedSig = crypto.createHmac('sha256', captchaSecret).update(payload).digest('hex');
    if (sig !== expectedSig) return false;
    const [code, ts] = payload.split(':');
    if (Date.now() - parseInt(ts, 10) > 300000) return false;
    return code.toUpperCase() === String(answer || '').trim().toUpperCase();
  } catch (_) {
    return false;
  }
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
    approvals: [],
    notifications: [],
    auditLogs: [],
    sessions: [],
    systemConfig: {
      webIdleLogoutMinutes: defaultWebIdleLogoutMinutes
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
    documents: []
  };
}

function normalizeSystemConfig(rawSystemConfig = {}) {
  const webIdleLogoutMinutes = Number(rawSystemConfig.webIdleLogoutMinutes);
  const httpsPort = Number(rawSystemConfig.httpsPort);
  const httpsLoginEnabled = rawSystemConfig.httpsLoginEnabled === true || rawSystemConfig.httpsLoginEnabled === 'true';
  const timezoneOffset = Number(rawSystemConfig.timezoneOffset);
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
    timezoneOffset: Number.isFinite(timezoneOffset) ? timezoneOffset : 480
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
  return {
    loginRateLimits,
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
  const validity = config.httpsCertValidTo ? `，有效期至 ${config.httpsCertValidTo}` : '';
  return `${config.httpsCertFilename || 'login-cert.pem'} / ${config.httpsKeyFilename || 'login-key.pem'}，上传时间 ${config.httpsCertUploadedAt}${validity}`;
}

function getLoginRateLimitStateStore(db) {
  const runtimeState = ensureRuntimeState(db);
  const map = new Map();
  for (const item of runtimeState.loginRateLimits) {
    map.set(item.key, { ...item });
  }
  return map;
}

function setLoginRateLimitStateStore(db, store) {
  const runtimeState = ensureRuntimeState(db);
  runtimeState.loginRateLimits = Array.from(store.entries()).map(([key, value]) => ({
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
    const archivedLogs = (db.auditLogs || []).slice(500);
    if (archivedLogs.length) {
      archiveJsonLines(auditArchiveDir, `${todayKey}.jsonl`, archivedLogs);
      db.auditLogs = (db.auditLogs || []).slice(0, 500);
      changed = true;
    }
    runtimeState.maintenance.lastAuditArchiveDate = todayKey;
  }

  if (runtimeState.maintenance.lastBackupCleanupWeek !== weekKey) {
    const backupCutoff = nowMs() - localBackupRetentionDays * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(backupDir)) {
      const filePath = path.join(backupDir, name);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs < backupCutoff) {
        ensureDir(backupArchiveDir);
        fs.renameSync(filePath, path.join(backupArchiveDir, name));
      }
    }
    runtimeState.maintenance.lastBackupCleanupWeek = weekKey;
  }

  if (runtimeState.maintenance.lastNotificationCleanupDate !== todayKey) {
    const notifications = db.notifications || [];
    const retained = [];
    const archived = [];
    for (const item of notifications) {
      const createdAtMs = Date.parse(item.createdAt || '') || nowMs();
      const isRead = Boolean(item.readAt);
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
  checkExpiryNotifications(db);
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

function normalizeAiInspectionMetrics(metrics, category = 'server') {
  const fallback = getAiMetricCatalog(category);
  const source = Array.isArray(metrics) && metrics.length ? metrics : fallback;
  return source.map((item, index) => ({
    key: item.key || `metric_${index + 1}`,
    label: item.label || `指标${index + 1}`,
    unit: item.unit || '',
    warn: Number(item.warn || 0),
    critical: Number(item.critical || 0),
    direction: item.direction === 'low' ? 'low' : 'high',
    description: item.description || ''
  }));
}

function normalizeAiInspectionValues(metrics) {
  return (Array.isArray(metrics) ? metrics : []).map((item, index) => ({
    key: item.key || `metric_${index + 1}`,
    label: item.label || `指标${index + 1}`,
    unit: item.unit || '',
    warn: Number(item.warn || 0),
    critical: Number(item.critical || 0),
    direction: item.direction === 'low' ? 'low' : 'high',
    description: item.description || '',
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
  return base;
}

function sanitizeAiInspectionTarget(item) {
  const { password, privateKey, accessToken, community, ...safe } = item;
  return {
    ...safe,
    credential: '***',
    hasPassword: Boolean(password),
    hasPrivateKey: Boolean(privateKey),
    hasAccessToken: Boolean(accessToken),
    hasCommunity: Boolean(community)
  };
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
const RUNTIME_ENCRYPTION_KEY = ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const DOCUMENT_TOKEN_SECRET = process.env.DOCUMENT_TOKEN_SECRET || RUNTIME_ENCRYPTION_KEY;
const DOCUMENT_TYPES = ['device', 'topology', 'layout', 'proposal', 'config', 'contract', 'acceptance'];
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY) {
  console.warn('WARNING: ENCRYPTION_KEY 环境变量未设置，本进程将使用随机临时密钥，重启后已加密凭据无法解密。请在生产环境中设置 ENCRYPTION_KEY。');
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

function isPrivateOrReservedIp(ip) {
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

async function assertPublicHttpTarget(url, expectedHost) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许 HTTP/HTTPS 地址');
  if (url.username || url.password) throw new Error('备份地址禁止包含用户名或密码');
  if (url.hostname !== expectedHost) throw new Error('Web 备份地址必须与巡检对象地址一致');
  const records = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true });
  const allowLocalTestTarget = !isProduction && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!allowLocalTestTarget && (!records.length || records.some(record => isPrivateOrReservedIp(record.address)))) {
    throw new Error('Web 备份地址指向受限网络');
  }
}

function probeHostReachable(host) {
  if (!validateHost(host)) return Promise.resolve({ reachable: false, latency: null });
  return new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', '2', host], { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve({ reachable: false, latency: null });
      const match = stdout.match(/time=([\d.]+)\s*ms/);
      const latency = match ? parseFloat(match[1]) : null;
      resolve({ reachable: true, latency });
    });
  });
}

function probePortOpen(host, port) {
  if (!validateHost(host) || !validatePort(port)) return Promise.resolve({ open: false });
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port), timeout: 3000 });
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

function executeSSHCheck(host, port, username, password) {
  if (!validateHost(host) || !validatePort(port)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid host or port' });
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(username)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid username' });
  return new Promise((resolve) => {
    const passFile = `/tmp/sshpass-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    fs.writeFileSync(passFile, password || '', { mode: 0o600 });
    const args = [
      '-f', passFile,
      'ssh',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=5',
      '-p', String(port),
      `${username}@${host}`,
      'uptime && df -h && free'
    ];
    execFile('sshpass', args, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      fs.unlink(passFile, () => {});
      if (error) return resolve({ success: false, stdout: '', stderr: stderr || error.message });
      resolve({ success: true, stdout: stdout || '', stderr: '' });
    });
  });
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
    description: project.description || '',
    createdAt: project.createdAt || now()
  }));
  const users = (raw.users || []).map(user => ({
    id: user.id || id('user'),
    username: user.username || '',
    passwordHash: user.passwordHash || hash(crypto.randomUUID()),
    role: ['admin', 'engineer', 'viewer', 'auditor', 'customer'].includes(user.role) ? user.role : 'engineer',
    name: user.name || user.username || '',
    phone: user.phone || '',
    idCard: user.idCard || '',
    email: user.email || '',
    wechat: user.wechat || '',
    projectId: user.projectId || '',
    startDate: user.startDate || '',
    endDate: user.endDate || '',
    securityQuestion: user.securityQuestion || '',
    securityAnswerHash: user.securityAnswerHash || '',
    status: user.status || 'active',
    createdAt: user.createdAt || now()
  }));
  const userProjectMap = new Map(users.map(user => [user.id, user.projectId || '']));
  return {
    users,
    projects,
    assets: (raw.assets || []).map(asset => ({
      id: asset.id || id('asset'),
      projectId: asset.projectId || '',
      type: asset.type || '',
      name: asset.name || '',
      brand: asset.brand || '',
      model: asset.model || '',
      owner: asset.owner || '',
      version: asset.version || '',
      serialNumber: asset.serialNumber || '',
      status: asset.status || '',
      maintainExpiryDate: asset.maintainExpiryDate || '',
      installationLocation: asset.installationLocation || asset.location || '',
      notes: asset.notes || '',
      createdAt: asset.createdAt || now()
    })),
    logs: (raw.logs || []).map(log => ({
      id: log.id || id('log'),
      userId: log.userId || '',
      projectId: log.projectId || '',
      assetId: log.assetId || '',
      date: log.date || '',
      event: log.event || '',
      relatedTarget: log.relatedTarget || '',
      dispatcher: log.dispatcher || '',
      dispatchDepartment: log.dispatchDepartment || '',
      ticketType: log.ticketType || '',
      assignee: log.assignee || '',
      process: log.process || '',
      conclusion: log.conclusion || '',
      remark: log.remark || '',
      durationHours: Number(log.durationHours || 0),
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
      result: item.result || '正常',
      issue: item.issue || '',
      suggestion: item.suggestion || '',
      attachment: normalizeInspectionAttachment(item.attachment),
      nextDate: item.nextDate || '',
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
      location: item.location || '',
      createdAt: item.createdAt || now()
    })),
    sparePartMovements: (raw.sparePartMovements || []).map(item => ({
      id: item.id || id('spareMove'),
      sparePartId: item.sparePartId || '',
      projectId: item.projectId || '',
      assetId: item.assetId || '',
      type: item.type === 'inbound' ? 'inbound' : 'outbound',
      quantity: Number(item.quantity || 0),
      reason: item.reason || '',
      operatorId: item.operatorId || '',
      operatorName: item.operatorName || '',
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
      readAt: item.readAt || '',
      archivedAt: item.archivedAt || '',
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
      tags: Array.isArray(item.tags) ? item.tags : [],
      createdBy: item.createdBy || '',
      projectId: item.projectId || userProjectMap.get(item.createdBy) || '',
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
      attachmentPath: item.attachmentPath || '',
      attachmentSize: item.attachmentSize || 0,
      accessPasswordHash: item.accessPasswordHash || '',
      createdBy: item.createdBy || '',
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
    sessions: (raw.sessions || []).map(item => ({
      token: item.token || '',
      userId: item.userId || '',
      createdAt: item.createdAt || now(),
      expiresAt: item.expiresAt || new Date(currentTime + sessionMaxAgeSeconds * 1000).toISOString()
    })).filter(item => item.token && item.userId && Date.parse(item.expiresAt) > currentTime),
    systemConfig: normalizeSystemConfig(raw.systemConfig),
    runtimeState: normalizeRuntimeState(raw.runtimeState)
  };
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

function serializeDbSnapshot(db) {
  const normalized = normalizeDb(db);
  return { ...normalized, sessions: [], runtimeState: { loginRateLimits: [] } };
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
      expiresAt: currentSession.expiresAt || new Date(Date.now() + sessionMaxAgeSeconds * 1000).toISOString()
    }] : []
  });
  appendAuditLog(nextDb, preservedUser, 'reset', 'system', '', '初始化数据库，保留当前管理员账号');
  return nextDb;
}

function buildImportedDbPreservingCurrentSession(raw, currentUser, currentSessionToken, currentSession) {
  const nextDb = normalizeDb(raw);
  if (currentUser && !(nextDb.users || []).some(item => item.id === currentUser.id)) {
    nextDb.users = [...(nextDb.users || []), currentUser];
  }
  nextDb.sessions = currentSessionToken && currentSession && currentUser ? [{
    token: currentSessionToken,
    userId: currentUser.id,
    createdAt: currentSession.createdAt || now(),
    expiresAt: currentSession.expiresAt || new Date(Date.now() + sessionMaxAgeSeconds * 1000).toISOString()
  }] : [];
  return nextDb;
}

function listBackupFiles() {
  return fs.readdirSync(backupDir)
    .filter(name => name.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .map(name => ({
      name,
      createdAt: fs.statSync(path.join(backupDir, name)).mtime.toISOString().replace('T', ' '),
      href: `/api/system/backups/${encodeURIComponent(name)}`
    }));
}

async function ensureMySqlReady() {
  if (!mysqlReadyPromise) {
    mysqlReadyPromise = (async () => {
      const bootstrapPool = mysql.createPool({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
      await bootstrapPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await bootstrapPool.end();
      mysqlPool = mysql.createPool({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        charset: 'utf8mb4'
      });
      await mysqlPool.query(`
        CREATE TABLE IF NOT EXISTS app_state (
          state_key VARCHAR(64) PRIMARY KEY,
          state_json LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }
  return mysqlReadyPromise;
}

function readDbFromFile() {
  if (!fs.existsSync(dbPath)) {
    const initial = seed();
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const normalized = normalizeDb(raw);
  const current = JSON.stringify(raw);
  const next = JSON.stringify(normalized);
  if (current !== next) {
    fs.writeFileSync(dbPath, JSON.stringify(normalized, null, 2));
  }
  return normalized;
}

function writeDbToFile(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  latestFileDbCache = db;
}

let latestFileDbCache = null;

function readDbInternalSync() {
  if (latestFileDbCache) return latestFileDbCache;
  if (!fs.existsSync(dbPath)) {
    const s = seed();
    latestFileDbCache = s;
    return s;
  }
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const normalized = normalizeDb(raw);
  latestFileDbCache = normalized;
  return normalized;
}

let mysqlResetMutex = Promise.resolve();

async function readDb() {
  try {
    await ensureMySqlReady();
    const [rows] = await mysqlPool.query('SELECT state_key, state_json FROM app_state');
    if (!rows.length) {
      const initial = readDbFromFile();
      await writeDb(initial, { silent: true });
      return initial;
    }
    const raw = {};
    for (const row of rows) {
      try {
        raw[row.state_key] = JSON.parse(row.state_json);
      } catch (error) {
        raw[row.state_key] = [];
      }
    }
    const normalized = normalizeDb(raw);
    const current = JSON.stringify(Object.fromEntries(dbCollectionKeys.map(key => [key, raw[key] || []])));
    const next = JSON.stringify(Object.fromEntries(dbCollectionKeys.map(key => [key, normalized[key]])));
    if (current !== next) {
      await writeDb(normalized, { silent: true });
    }
    normalized._seq = dbSequence;
    return normalized;
  } catch (error) {
    await resetMySqlConnection();
    if (allowFileDbFallback) {
      const fallback = readDbFromFile();
      fallback._seq = dbSequence;
      return fallback;
    }
    throw error;
  }
}

async function resetMySqlConnection() {
  let release;
  const lock = new Promise(resolve => { release = resolve; });
  const previous = mysqlResetMutex;
  mysqlResetMutex = lock;
  await previous;
  try {
    if (mysqlPool) {
      try { await mysqlPool.end(); } catch (_) {}
    }
    mysqlReadyPromise = null;
    mysqlPool = null;
  } finally {
    release();
  }
}

let dbWriteLock = Promise.resolve();
let dbSequence = 0;

async function writeDb(db, options = {}) {
  const previousLock = dbWriteLock;
  let releaseLock;
  dbWriteLock = new Promise(resolve => { releaseLock = resolve; });
  await previousLock;
  try {
    let writeTarget = db;
    if (db._seq !== undefined && db._seq < dbSequence) {
      const latest = readDbInternalSync();
      for (const key of dbCollectionKeys) {
        if (Array.isArray(latest[key]) && Array.isArray(writeTarget[key])) {
          const latestById = new Map(latest[key].map(item => [item.id, item]));
          for (const item of writeTarget[key]) {
            const existing = latestById.get(item.id);
            if (existing) {
              Object.assign(existing, item);
            }
          }
        }
      }
      if (writeTarget.systemConfig) latest.systemConfig = writeTarget.systemConfig;
      if (writeTarget.runtimeState) latest.runtimeState = writeTarget.runtimeState;
      latest.sessions = writeTarget.sessions;
      writeTarget = latest;
    }
    dbSequence++;
    writeTarget._seq = dbSequence;
    const normalized = normalizeDb(writeTarget);
    try {
      await ensureMySqlReady();
      const connection = await mysqlPool.getConnection();
      try {
        await connection.beginTransaction();
        for (const key of dbCollectionKeys) {
          await connection.query(
            'INSERT INTO app_state (state_key, state_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)',
            [key, JSON.stringify(normalized[key] || [])]
          );
        }
        await connection.commit();
        writeDbToFile(normalized);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      await resetMySqlConnection();
      if (allowFileDbFallback) {
        writeDbToFile(normalized);
      } else {
        throw error;
      }
    }
    if (!options.silent) broadcastChange('database', {});
  } finally {
    releaseLock();
  }
}

async function runAiInspectionScheduler() {
  if (aiInspectionSchedulerRunning) return;
  aiInspectionSchedulerRunning = true;
  try {
    const db = await readDb();
    systemTimezoneOffsetMinutes = db.systemConfig?.timezoneOffset ?? 480;
    const pendingTaskChanged = await processPendingAiInspectionTasks(db);
    const pendingConfigBackupChanged = await processPendingConfigBackupPlans(db);
    const maintenanceChanged = runMaintenanceTasks(db);
    if (pendingTaskChanged || pendingConfigBackupChanged || maintenanceChanged) {
      await writeDb(db);
    }
  } catch (error) {
    console.error(`AI inspection scheduler failed: ${error.message}`);
  } finally {
    aiInspectionSchedulerRunning = false;
  }
}

let pptxTemplateCache = null;
let aiInspectionSchedulerRunning = false;

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
  try {
    await ensureMySqlReady();
    await mysqlPool.query('SELECT 1');
    services.push({
      key: 'mysql',
      name: 'MySQL 数据库',
      status: 'running',
      detail: `${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
      checkedAt
    });
  } catch (error) {
    await resetMySqlConnection();
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
        detail: error.message,
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
      detail: backupDir,
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
  const n = nonce || '';
  return `default-src 'self'; script-src 'self' 'unsafe-inline' 'nonce-${n}'; style-src 'self' 'unsafe-inline' 'nonce-${n}'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
}

function buildSecurityHeaders(extraHeaders = {}, nonce = '') {
  const csp = nonce ? buildNonceHeaderValue(nonce) : "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.sheetjs.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': csp,
    ...extraHeaders
  };
  if (isProduction) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, buildSecurityHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }));
  res.end(JSON.stringify(data));
}

function text(res, status, data, extraHeaders = {}) {
  res.writeHead(status, buildSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders }));
  res.end(data);
}

function paginateResult(items, query) {
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

function parseFilterQuery(query, items, filterFields) {
  let result = items;
  for (const field of filterFields) {
    const value = query[field];
    if (value) {
      result = result.filter(item => String(item[field] || '').toLowerCase().includes(String(value).toLowerCase()));
    }
  }
  return result;
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
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let data = '';
    req.on('data', chunk => {
      if (settled) return;
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        settled = true;
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
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
    || pathname === '/api/auth/ldap'
    || pathname === '/api/forgot-password/verify'
    || pathname === '/api/forgot-password/reset'
    || pathname.startsWith('/api/auth/oidc/');
}

function validateCsrf(req, res, db, pathname) {
  if (!isUnsafeMethod(req.method) || isCsrfExemptPath(pathname)) return true;
  const cookies = parseCookies(req);
  const sessionToken = cookies.sessionToken || '';
  const session = (db.sessions || []).find(item => item.token === sessionToken);
  if (!session) return true;
  const expected = getSessionCsrfToken(sessionToken);
  const received = String(req.headers['x-csrf-token'] || '');
  const valid = received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid) {
    json(res, 403, { message: 'CSRF 校验失败，请刷新页面后重试' });
    return false;
  }
  return true;
}

function getAuthUser(req, db) {
  const cookies = parseCookies(req);
  const token = cookies.sessionToken;
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
  const user = db.users.find(item => item.id === session.userId) || null;
  if (!user || user.status === 'disabled' || user.status === 'pending') return null;
  return user;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
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
  return user.role === 'admin' || user.projectId === projectId;
}

function filterByProjectScope(list, user, getProjectId) {
  return user.role === 'admin' ? list : list.filter(item => getProjectId(item) === user.projectId);
}

function appendAuditLog(db, user, action, targetType, targetId, detail, projectId = '') {
  db.auditLogs = db.auditLogs || [];
  db.auditLogs.push({
    id: id('audit'),
    projectId: projectId || user.projectId || '',
    action,
    targetType,
    targetId,
    operatorId: user.id,
    operatorName: user.name,
    detail,
    createdAt: now()
  });
  if (db.auditLogs.length > 10000) {
    db.auditLogs = db.auditLogs.slice(-5000);
  }
}

function createNotification(db, projectId, title, content, level = 'info', category = '') {
  db.notifications = db.notifications || [];
  const notification = {
    id: id('notification'),
    projectId,
    title,
    content,
    level,
    category,
    readAt: '',
    archivedAt: '',
    createdAt: now()
  };
  db.notifications.unshift(notification);
  db.notifications = db.notifications.slice(0, 200);
  return notification;
}

function appendSystemAuditLog(db, action, targetType, targetId, detail, projectId = '') {
  db.auditLogs = db.auditLogs || [];
  db.auditLogs.unshift({
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

function addAiTaskCycleOnce(task) {
  if (!task.cycle || !task.executedAt) return false;
  const parts = task.executedAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!parts) return false;
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5] || '0'), Number(parts[6] || '0'));
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

function getRequestClientIp(req) {
  const remoteAddress = req.socket?.remoteAddress || '';
  const isTrustedProxy = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (isTrustedProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return remoteAddress || 'unknown';
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

const forgotPasswordRateLimitMap = new Map();
const FP_MAX_ATTEMPTS = 5;
const FP_WINDOW_MINUTES = 15;
const FP_LOCK_MINUTES = 30;

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

function shouldUseSecureCookies(req, systemConfig = {}) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim().toLowerCase();
  if (forwardedProto === 'https' || Boolean(req.socket?.encrypted)) return true;
  const httpsLoginEnabled = normalizeSystemConfig(systemConfig).httpsLoginEnabled;
  return httpsLoginEnabled;
}

function buildSessionCookie(req, token, systemConfig = {}, maxAgeSeconds = sessionMaxAgeSeconds) {
  return `sessionToken=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}${shouldUseSecureCookies(req, systemConfig) ? '; Secure' : ''}`;
}

function buildClearSessionCookie(req, systemConfig = {}) {
  return `sessionToken=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${shouldUseSecureCookies(req, systemConfig) ? '; Secure' : ''}`;
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
  try {
    await ensureMySqlReady();
    await mysqlPool.query('SELECT 1');
    readiness.checks.push({ name: 'mysql', ok: true, detail: `${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}` });
  } catch (error) {
    await resetMySqlConnection();
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
    return existing;
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
        const sshResult = await executeSSHCheck(target.address, target.port || 22, target.account, decryptedPassword || decryptedKey || '');
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
      task.executedAt = result.createdAt;
      task.completedAt = result.createdAt;
      const operator = (db.users || []).find(item => item.id === task.createdBy);
      if (operator) {
        appendAuditLog(db, operator, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测失败: ${failureMessage}）`, task.projectId);
      } else {
        appendSystemAuditLog(db, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测失败: ${failureMessage}）`, task.projectId);
      }
      createNotification(db, task.projectId, '自动化巡检提醒', `${task.title} 探测失败: ${failureMessage}`, 'warning', 'ai-inspection');
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
    task.status = '已完成';
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
      createNotification(db, task.projectId, '自动化巡检提醒', `${task.title} 输出 ${result.level} 结果`, result.level === '严重' ? 'warning' : 'info', 'ai-inspection');
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
    task.executedAt = result.createdAt;
    task.completedAt = result.createdAt;
    const operator = (db.users || []).find(item => item.id === task.createdBy);
    if (operator) {
      appendAuditLog(db, operator, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测异常: ${failureMessage}）`, task.projectId);
    } else {
      appendSystemAuditLog(db, 'execute', 'aiInspectionTask', task.id, `执行智能巡检 ${task.title}（探测异常: ${failureMessage}）`, task.projectId);
    }
    createNotification(db, task.projectId, '自动化巡检提醒', `${task.title} 探测异常: ${failureMessage}`, 'warning', 'ai-inspection');
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

function executeSSHCommand(host, port, username, password, command) {
  if (!validateHost(host) || !validatePort(port)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid host or port' });
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(username)) return Promise.resolve({ success: false, stdout: '', stderr: 'Invalid username' });
  const commandValidation = validateBackupCommand(command);
  if (!commandValidation.ok) return Promise.resolve({ success: false, stdout: '', stderr: commandValidation.message });
  return new Promise((resolve) => {
    const passFile = `/tmp/sshpass-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    fs.writeFileSync(passFile, password || '', { mode: 0o600 });
    const args = [
      '-f', passFile,
      'ssh',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=8',
      '-p', String(port),
      `${username}@${host}`,
      commandValidation.command
    ];
    execFile('sshpass', args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      fs.unlink(passFile, () => {});
      if (error) return resolve({ success: false, stdout: '', stderr: stderr || error.message });
      resolve({ success: true, stdout: stdout || '', stderr: '' });
    });
  });
}

async function fetchWebBackup(target, accessToken) {
  const scheme = target.protocol === 'http' ? 'http' : 'https';
  const port = target.port ? `:${target.port}` : '';
  const pathPart = String(target.webBackupPath || '').trim();
  if (!pathPart) return { success: false, content: '', stderr: 'Web backup path is empty' };
  let url;
  try {
    url = /^https?:\/\//i.test(pathPart) ? new URL(pathPart) : new URL(`${scheme}://${target.address}${port}${pathPart.startsWith('/') ? pathPart : '/' + pathPart}`);
    await assertPublicHttpTarget(url, target.address);
  } catch (error) {
    return { success: false, content: '', stderr: error.message };
  }
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { method: target.webBackupMethod || 'GET', headers, redirect: 'manual', signal: controller.signal });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 1024 * 1024) return { success: false, content: '', stderr: 'Web backup response is too large' };
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text|json|xml|octet-stream/i.test(contentType)) return { success: false, content: '', stderr: 'Unsupported content type' };
    const content = await response.text();
    if (content.length > 1024 * 1024) return { success: false, content: '', stderr: 'Web backup response is too large' };
    if (!response.ok) return { success: false, content: '', stderr: `HTTP ${response.status}` };
    return { success: true, content, stderr: '' };
  } catch (error) {
    return { success: false, content: '', stderr: error.message };
  } finally {
    clearTimeout(timer);
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
    createNotification(db, plan.projectId, '配置备份提醒', `${plan.name || '配置备份'} 失败: ${message}`, 'warning', 'config-backup');
    return record;
  };
  if (!target) return fail('巡检对象不存在');
  if (!asset) return fail('巡检对象未关联有效资产');
  if (!target.address) return fail('巡检对象管理地址为空');
  const defaultPortMap = { ssh: 22, telnet: 23, http: 80, https: 443, winrm: 5985, snmp: 161, agent: 22 };
  const port = Number(target.port || defaultPortMap[target.protocol] || 22);
  const mode = ['cli', 'web'].includes(target.backupMode) ? target.backupMode : 'cli';
  let backupPayload = '';
  if (mode === 'cli') {
    if (target.protocol !== 'ssh') return fail('CLI 配置备份当前支持 SSH 协议');
    const password = decryptCredential(target.password || target.privateKey || '');
    const command = target.backupCommand || (target.category === 'server' ? 'cat /etc/os-release' : 'show running-config');
    const commandResult = await executeSSHCommand(target.address, port, target.account, password, command);
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
  const filenameSafeName = String(target.name || asset.name || 'target').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_.-]+/g, '-').slice(0, 80) || 'target';
  const filename = `${filenameSafeName}-${createdAt.replace(/[:\s]/g, '-').slice(0, 19)}.txt`;
  const content = [
    `配置备份名称: ${plan.name || '-'}`,
    `备份方式: ${mode === 'cli' ? '命令行采集' : 'Web 下载'}`,
    `备份时间: ${createdAt}`,
    `巡检对象: ${target.name || '-'}`,
    `关联资产: ${asset.name || '-'}`,
    `资产编号: ${asset.code || '-'}`,
    `设备类别: ${target.category || '-'}`,
    `管理地址: ${target.address}:${port}`,
    `管理协议: ${target.protocol || '-'}`,
    `认证方式: ${target.authType || '-'}`,
    `系统版本: ${target.systemVersion || asset.version || '-'}`,
    `部署位置: ${target.location || asset.location || '-'}`,
    `资产厂商: ${asset.vendor || '-'}`,
    `资产型号: ${asset.model || '-'}`,
    `资产序列号: ${asset.serialNo || '-'}`,
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
    await executeConfigBackupPlan(db, plan);
    plan.status = plan.cycle ? '待执行' : '已完成';
    changed = true;
  }
  return changed;
}

async function processPendingAiInspectionTasks(db) {
  let changed = false;
  for (const task of db.aiInspectionTasks || []) {
    if (task.status === '已完成' || task.status === '失败' || task.status === '执行中' || task.status === '已停用') continue;
    if (parseAiInspectionScheduleTime(task.executedAt) > Date.now()) continue;
    const result = await executeAiInspectionTask(db, task, { persist: true });
    if (result?.changed) changed = true;
  }
  return changed;
}

function checkExpiryNotifications(db) {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (const project of db.projects || []) {
    if (!project.projectEndDate) continue;
    const endTime = new Date(project.projectEndDate).getTime();
    if (isNaN(endTime)) continue;
    const daysLeft = Math.ceil((endTime - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 30 && daysLeft > 0) {
      const existingNotifications = (db.notifications || []).filter(
        n => n.category === 'project-expiry' && n.projectId === project.id && n.createdAt > (now - thirtyDaysMs)
      );
      if (existingNotifications.length === 0) {
        createNotification(db, project.id, '项目即将到期', `${project.name}（客户：${project.customerName || '未知'}）将于 ${project.projectEndDate} 到期，剩余 ${daysLeft} 天`, daysLeft <= 7 ? 'warning' : 'info', 'project-expiry');
      }
    }
  }

  for (const asset of db.assets || []) {
    if (!asset.maintainExpiryDate) continue;
    const expiryTime = new Date(asset.maintainExpiryDate).getTime();
    if (isNaN(expiryTime)) continue;
    const daysLeft = Math.ceil((expiryTime - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 30 && daysLeft > 0) {
      const existingNotifications = (db.notifications || []).filter(
        n => n.category === 'maintenance-expiry' && n.projectId === asset.projectId && String(n.content || '').includes(asset.name) && n.createdAt > (now - thirtyDaysMs)
      );
      if (existingNotifications.length === 0) {
        createNotification(db, asset.projectId, '维保即将到期', `资产 ${asset.name}（${asset.type || '-'}）维保将于 ${asset.maintainExpiryDate} 到期，剩余 ${daysLeft} 天`, daysLeft <= 7 ? 'warning' : 'info', 'maintenance-expiry');
      }
    }
  }

  for (const plan of db.inspectionPlans || []) {
    if (!plan.nextDate || plan.status === '已完成') continue;
    const nextTime = new Date(plan.nextDate).getTime();
    if (isNaN(nextTime)) continue;
    const daysLeft = Math.ceil((nextTime - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 7) {
      const existingNotifications = (db.notifications || []).filter(
        n => n.category === 'inspection-overdue' && n.projectId === plan.projectId && String(n.content || '').includes(plan.title || '-') && n.createdAt > (now - thirtyDaysMs)
      );
      if (existingNotifications.length === 0) {
        createNotification(db, plan.projectId, '巡检计划提醒', `巡检计划 ${plan.title || '-'} 将于 ${plan.nextDate} 到期（${daysLeft < 0 ? '已逾期 ' + Math.abs(daysLeft) + ' 天' : daysLeft === 0 ? '今日到期' : '剩余 ' + daysLeft + ' 天'}）`, daysLeft <= 0 ? 'warning' : 'info', 'inspection-overdue');
      }
    }
  }
}

function requireExistingProject(projectId, db) {
  if (!projectId) return null;
  return db.projects.find(item => item.id === projectId) || null;
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
  if (user.role === 'admin') return true;
  if (approval.currentStage === 'customer') return user.role === 'customer' && user.id === approval.customerId;
  return user.id === approval.approverId;
}

function canDeleteOwnedRecord(user, item, creatorId) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  if (item.projectId !== user.projectId) return false;
  return creatorId === user.id;
}

function canManageInspectionRecord(user, item) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  return item.projectId === user.projectId;
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

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

function getPeriodKey(dateString, period) {
  const normalized = String(dateString || '').slice(0, 10);
  const d = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  if (period === 'year') return `${d.getFullYear()}`;
  if (period === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const w = startOfWeek(d);
  return `${w.getFullYear()}-W${String(Math.ceil((((w - new Date(w.getFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

function buildSummary(db, period, userId, projectId = '') {
  const filteredLogs = db.logs.filter(log => {
    if (userId && log.userId !== userId) return false;
    if (projectId && log.projectId !== projectId) return false;
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

function buildDrilldown(db, user, period, groupBy) {
  const logs = filterByProjectScope(db.logs, user, item => item.projectId).filter(item => getPeriodKey(String(item.date || '').slice(0, 10), period) === getPeriodKey(formatDateKey(new Date()), period));
  const incidents = filterByProjectScope(db.incidentRecords || [], user, item => item.projectId).filter(item => getPeriodKey(String(item.occurredAt || '').slice(0, 10), period) === getPeriodKey(formatDateKey(new Date()), period));
  const buckets = new Map();
  const getKey = log => {
    if (groupBy === 'customer') return db.projects.find(item => item.id === log.projectId)?.customerName || '-';
    if (groupBy === 'user') return db.users.find(item => item.id === log.userId)?.name || '-';
    if (groupBy === 'faultType') return log.event || '-';
    return '-';
  };
  logs.forEach(log => {
    const key = getKey(log);
    const current = buckets.get(key) || { group: key, logCount: 0, totalHours: 0, incidentCount: 0, slaBreached: 0 };
    current.logCount += 1;
    current.totalHours += Number(log.durationHours || 0);
    buckets.set(key, current);
  });
  if (groupBy === 'sla') {
    incidents.forEach(item => {
      const key = item.slaStatus || '-';
      const current = buckets.get(key) || { group: key, logCount: 0, totalHours: 0, incidentCount: 0, slaBreached: 0 };
      current.incidentCount += 1;
      if (item.slaStatus === '超时') current.slaBreached += 1;
      buckets.set(key, current);
    });
  } else if (groupBy === 'faultType') {
    incidents.forEach(item => {
      const key = item.faultType || '-';
      const current = buckets.get(key) || { group: key, logCount: 0, totalHours: 0, incidentCount: 0, slaBreached: 0 };
      current.incidentCount += 1;
      if (item.slaStatus === '超时') current.slaBreached += 1;
      buckets.set(key, current);
    });
  }
  return [...buckets.values()].map(item => ({ ...item, totalHours: Number(item.totalHours.toFixed(2)) }));
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

function buildOperationalReportData(db, scope, targetId, period) {
  const currentPeriod = getPeriodKey(formatDateKey(new Date()), period);
  const periodLabel = ({ week: '每周', month: '每月', year: '每年' }[period] || period);
  const targetUser = scope === 'user' ? db.users.find(item => item.id === targetId) : null;
  const project = scope === 'project'
    ? db.projects.find(item => item.id === targetId)
    : db.projects.find(item => item.id === targetUser?.projectId);
  if (!project || (scope === 'user' && !targetUser)) return null;
  const projectUserIds = (db.users || []).filter(item => item.projectId === project.id).map(item => item.id);
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
  const users = (db.users || []).filter(item => item.projectId === project.id);
  const totalHours = Number(logs.reduce((sum, item) => sum + Number(item.durationHours || 0), 0).toFixed(2));
  return {
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
    abnormalInspectionCount: executions.filter(item => item.result === '异常').length,
    normalInspectionCount: executions.filter(item => item.result === '正常').length,
    openIncidentCount: incidents.filter(item => item.status !== '已关闭' && item.status !== '已解决').length
  };
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
  const metrics = [
    ['运维日志', `${report.logs.length} 条`, '2563EB'],
    ['累计工时', `${report.totalHours} 小时`, '16A34A'],
    ['资产数量', `${report.assets.length} 项`, 'F59E0B'],
    ['知识沉淀', `${report.kb.length} 条`, '7C3AED'],
    ['巡检执行', `${report.executions.length} 次`, '0891B2'],
    ['变更记录', `${report.changes.length} 条`, 'EA580C'],
    ['故障记录', `${report.incidents.length} 条`, 'DC2626'],
    ['资料文档', `${report.documents.length} 份`, '475569']
  ];
  const shapes = createReportHeaderShapes('运营总览', `${report.projectName} · ${report.periodLabel} · ${report.currentPeriod}`);
  metrics.forEach((metric, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const left = 0.7 + col * 3.15;
    const top = 1.45 + row * 1.35;
    const baseId = 20 + index * 5;
    shapes.push(createShape({ id: baseId, x: emu(left), y: emu(top), cx: emu(2.75), cy: emu(1.0), fill: 'FFFFFF', line: 'E2E8F0', preset: 'roundRect' }));
    shapes.push(createShape({ id: baseId + 1, x: emu(left), y: emu(top), cx: emu(0.08), cy: emu(1.0), fill: metric[2], preset: 'roundRect' }));
    shapes.push(createShape({ id: baseId + 2, x: emu(left + 0.25), y: emu(top + 0.18), cx: emu(2.2), cy: emu(0.16), textLines: [metric[0]], textOptions: { size: 1050, color: '64748B' } }));
    shapes.push(createShape({ id: baseId + 3, x: emu(left + 0.25), y: emu(top + 0.48), cx: emu(2.2), cy: emu(0.28), textLines: [metric[1]], textOptions: { size: 2100, color: '0F172A', bold: true } }));
  });
  const summary = `本周期围绕 ${report.projectName} 完成 ${report.logs.length} 条运维日志、${report.executions.length} 次巡检、${report.changes.length} 条变更与 ${report.incidents.length} 条故障记录；当前资产 ${report.assets.length} 项，沉淀知识 ${report.kb.length} 条、文档 ${report.documents.length} 份、备件 ${report.spareParts.length} 类。`;
  shapes.push(createShape({ id: 90, x: emu(0.7), y: emu(4.35), cx: emu(11.9), cy: emu(1.45), fill: 'EFF6FF', line: 'BFDBFE', preset: 'roundRect' }));
  shapes.push(createShape({ id: 91, x: emu(1.0), y: emu(4.7), cx: emu(11.1), cy: emu(0.7), textLines: [summary], textOptions: { size: 1500, color: '0F172A' } }));
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
    createReportListSlide('运维日志明细', '事件、人员、位置、处理过程与结论', report.logs.map(item => [
      item.date || '-', item.event || '-', item.relatedTarget || item.location || '-', item.conclusion || '-', `${Number(item.durationHours || 0)}h`, item.process || '-'
    ]), [
      { label: '日期', width: 1.15, max: 12 }, { label: '事件', width: 2.0, max: 18 }, { label: '资产/位置', width: 1.7, max: 16 }, { label: '结论', width: 2.0, max: 20 }, { label: '工时', width: 0.75, max: 8 }, { label: '处理过程', width: 4.0, max: 40 }
    ]),
    createReportListSlide('资产清单概览', '设备类型、品牌型号、位置、维保与状态', report.assets.map(item => [
      item.name || '-', item.type || '-', [item.brand, item.model].filter(Boolean).join(' / ') || '-', item.installationLocation || item.location || '-', item.maintainExpiryDate || '-', item.status || '-'
    ]), [
      { label: '名称', width: 2.0, max: 18 }, { label: '类型', width: 1.2, max: 10 }, { label: '品牌型号', width: 2.2, max: 22 }, { label: '位置', width: 2.0, max: 18 }, { label: '维保到期', width: 1.3, max: 12 }, { label: '状态', width: 1.2, max: 10 }
    ]),
    createReportListSlide('巡检计划与执行', '周期计划、执行结果、异常说明和整改建议', report.plans.map(plan => {
      const exec = report.executions.find(item => item.planId === plan.id);
      return [plan.title || '-', plan.cycle || '-', plan.nextDate || '-', exec?.executedAt || '-', exec?.result || '-', exec?.issue || exec?.suggestion || '-'];
    }), [
      { label: '计划', width: 2.1, max: 18 }, { label: '周期', width: 0.9, max: 8 }, { label: '下次巡检', width: 1.25, max: 12 }, { label: '执行时间', width: 1.45, max: 16 }, { label: '结果', width: 0.9, max: 8 }, { label: '异常/建议', width: 4.4, max: 42 }
    ]),
    createReportListSlide('变更与故障记录', '变更审批、故障处理与当前状态', [
      ...report.changes.map(item => ['变更', item.title || '-', item.riskLevel || '-', item.status || '-', item.createdAt || '-', item.content || '-']),
      ...report.incidents.map(item => ['故障', item.title || '-', item.faultType || item.severity || '-', item.status || '-', item.occurredAt || item.createdAt || '-', item.resolution || '-'])
    ], [
      { label: '类型', width: 0.85, max: 8 }, { label: '标题', width: 2.2, max: 22 }, { label: '级别/类型', width: 1.2, max: 12 }, { label: '状态', width: 1.1, max: 10 }, { label: '时间', width: 1.5, max: 16 }, { label: '说明', width: 4.1, max: 42 }
    ]),
    createReportListSlide('知识文档与备件', '知识沉淀、项目资料与备件库存', [
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

function buildPptxBuffer(db, targetUserId, period) {
  const report = buildOperationalReportData(db, 'user', targetUserId, period);
  return report ? buildDetailedPptxBufferFromReport(report) : null;
}

function buildProjectPptxBuffer(db, projectId, period) {
  const report = buildOperationalReportData(db, 'project', projectId, period);
  return report ? buildDetailedPptxBufferFromReport(report) : null;
}

function buildOperationalReportHtml(db, scope, targetId, period) {
  const currentPeriod = getPeriodKey(formatDateKey(new Date()), period);
  const periodLabel = ({ week: '每周', month: '每月', year: '每年' }[period] || period);
  const targetUser = scope === 'user' ? db.users.find(item => item.id === targetId) : null;
  const project = scope === 'project'
    ? db.projects.find(item => item.id === targetId)
    : db.projects.find(item => item.id === targetUser?.projectId);
  if (!project || (scope === 'user' && !targetUser)) return null;
  const projectUserIds = (db.users || []).filter(item => item.projectId === project.id).map(item => item.id);
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
  const totalHours = Number(logs.reduce((sum, item) => sum + Number(item.durationHours || 0), 0).toFixed(2));
  const abnormalInspectionCount = executions.filter(item => item.result === '异常').length;
  const openIncidentCount = incidents.filter(item => item.status !== '已关闭' && item.status !== '已解决').length;
  const tableRows = (items, emptyColspan, mapper) => items.map(mapper).join('') || `<tr><td colspan="${emptyColspan}">暂无数据</td></tr>`;
  const reportTitle = scope === 'user' ? `${targetUser.name} 驻场运维完整报表` : `${project.customerName || '-'} / ${project.name || '-'} 运维完整报表`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }
    .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:20px; margin-bottom:16px; }
    .title { font-size:28px; font-weight:700; margin-bottom:8px; }
    .muted { color:#64748b; font-size:14px; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-top:16px; }
    .stat { background:#eff6ff; border-radius:12px; padding:16px; }
    .stat strong { display:block; font-size:24px; margin-top:6px; }
    h2 { margin:0 0 12px; font-size:20px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { border-bottom:1px solid #e2e8f0; padding:9px 8px; text-align:left; vertical-align:top; }
    th { background:#f8fafc; white-space:nowrap; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">${escapeHtml(reportTitle)}</div>
    <div class="muted">项目：${escapeHtml(project.customerName || '-')} / ${escapeHtml(project.name || '-')}</div>
    <div class="muted">统计周期：${escapeHtml(periodLabel)}（${escapeHtml(currentPeriod)}）</div>
    <div class="muted">生成时间：${escapeHtml(now())}</div>
    <div class="stats">
      <div class="stat"><span class="muted">运维日志</span><strong>${logs.length}</strong></div>
      <div class="stat"><span class="muted">累计工时</span><strong>${totalHours}</strong></div>
      <div class="stat"><span class="muted">资产数量</span><strong>${assets.length}</strong></div>
      <div class="stat"><span class="muted">知识沉淀</span><strong>${kb.length}</strong></div>
      <div class="stat"><span class="muted">巡检执行</span><strong>${executions.length}</strong></div>
      <div class="stat"><span class="muted">异常巡检</span><strong>${abnormalInspectionCount}</strong></div>
      <div class="stat"><span class="muted">变更记录</span><strong>${changes.length}</strong></div>
      <div class="stat"><span class="muted">未关闭故障</span><strong>${openIncidentCount}</strong></div>
    </div>
  </div>
  <div class="card"><h2>项目与人员信息</h2><table><tbody>
    <tr><th>客户/项目</th><td>${escapeHtml(project.customerName || '-')} / ${escapeHtml(project.name || '-')}</td><th>项目周期</th><td>${escapeHtml(project.projectStartDate || '-')} 至 ${escapeHtml(project.projectEndDate || '-')}</td></tr>
    <tr><th>统计对象</th><td>${escapeHtml(scope === 'user' ? targetUser.name : '项目整体')}</td><th>项目人员</th><td>${escapeHtml((db.users || []).filter(item => item.projectId === project.id).map(item => item.name).join('、') || '-')}</td></tr>
  </tbody></table></div>
  <div class="card"><h2>运维日志明细</h2><table><thead><tr><th>日期</th><th>事件</th><th>人员</th><th>资产/位置</th><th>处理过程</th><th>结论</th><th>工时</th></tr></thead><tbody>${tableRows(logs, 7, item => `<tr><td>${escapeHtml(item.date || '-')}</td><td>${escapeHtml(item.event || '-')}</td><td>${escapeHtml((db.users || []).find(user => user.id === item.userId)?.name || '-')}</td><td>${escapeHtml(item.relatedTarget || item.location || '-')}</td><td>${escapeHtml(item.process || '-')}</td><td>${escapeHtml(item.conclusion || '-')}</td><td>${escapeHtml(item.durationHours || 0)}</td></tr>`)}</tbody></table></div>
  <div class="card"><h2>资产清单</h2><table><thead><tr><th>名称</th><th>类型</th><th>品牌型号</th><th>位置</th><th>维保到期</th><th>状态</th></tr></thead><tbody>${tableRows(assets, 6, item => `<tr><td>${escapeHtml(item.name || '-')}</td><td>${escapeHtml(item.type || '-')}</td><td>${escapeHtml([item.brand, item.model].filter(Boolean).join(' / ') || '-')}</td><td>${escapeHtml(item.installationLocation || item.location || '-')}</td><td>${escapeHtml(item.maintainExpiryDate || '-')}</td><td>${escapeHtml(item.status || '-')}</td></tr>`)}</tbody></table></div>
  <div class="card"><h2>巡检计划与执行</h2><table><thead><tr><th>计划</th><th>周期</th><th>下次巡检</th><th>状态</th><th>本周期执行时间</th><th>结果</th><th>异常说明</th><th>整改建议</th></tr></thead><tbody>${tableRows(plans, 8, plan => { const exec = executions.find(item => item.planId === plan.id); return `<tr><td>${escapeHtml(plan.title || '-')}</td><td>${escapeHtml(plan.cycle || '-')}</td><td>${escapeHtml(plan.nextDate || '-')}</td><td>${escapeHtml(plan.status || '-')}</td><td>${escapeHtml(exec?.executedAt || '-')}</td><td>${escapeHtml(exec?.result || '-')}</td><td>${escapeHtml(exec?.issue || '-')}</td><td>${escapeHtml(exec?.suggestion || '-')}</td></tr>`; })}</tbody></table></div>
  <div class="card"><h2>变更与故障</h2><table><thead><tr><th>类型</th><th>标题</th><th>级别/类型</th><th>状态</th><th>时间</th><th>说明</th></tr></thead><tbody>${tableRows([...changes.map(item => ({ kind: '变更', title: item.title, type: item.riskLevel, status: item.status, time: item.createdAt, note: item.content })), ...incidents.map(item => ({ kind: '故障', title: item.title, type: item.faultType || item.severity, status: item.status, time: item.occurredAt || item.createdAt, note: item.resolution }))], 6, item => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.title || '-')}</td><td>${escapeHtml(item.type || '-')}</td><td>${escapeHtml(item.status || '-')}</td><td>${escapeHtml(item.time || '-')}</td><td>${escapeHtml(item.note || '-')}</td></tr>`)}</tbody></table></div>
  <div class="card"><h2>知识库、文档与备件</h2><table><thead><tr><th>类别</th><th>名称</th><th>关键字段</th><th>状态/数量</th><th>创建时间</th></tr></thead><tbody>${tableRows([...kb.map(item => ({ kind: '知识库', name: item.title, key: item.keywords, status: item.solution, createdAt: item.createdAt })), ...documents.map(item => ({ kind: '资料文档', name: item.title, key: item.type, status: item.attachmentName || '-', createdAt: item.createdAt })), ...spareParts.map(item => ({ kind: '备件', name: item.name, key: item.model || item.spec || '-', status: item.quantity ?? item.stock ?? '-', createdAt: item.createdAt }))], 5, item => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.name || '-')}</td><td>${escapeHtml(item.key || '-')}</td><td>${escapeHtml(item.status || '-')}</td><td>${escapeHtml(item.createdAt || '-')}</td></tr>`)}</tbody></table></div>
</body>
</html>`;
}

function toCsvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildInspectionExecutionCsv(db, projectId, period) {
  const project = db.projects.find(item => item.id === projectId);
  if (!project) return null;
  const currentPeriod = getPeriodKey(formatDateKey(new Date()), period);
  const executions = (db.inspectionExecutions || [])
    .filter(item => item.projectId === projectId)
    .filter(item => getPeriodKey(item.executedAt, period) === currentPeriod)
    .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
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
    ].map(toCsvCell).join(',');
  });
  const header = ['执行时间', '计划名称', '关联资产', '执行人', '巡检结果', '下次巡检日', '异常说明', '整改建议', '附件名称'].map(toCsvCell).join(',');
  return `\uFEFF${[header, ...rows].join('\n')}`;
}

function buildInspectionExecutionHtml(db, projectId, period) {
  const project = db.projects.find(item => item.id === projectId);
  if (!project) return null;
  const currentPeriod = getPeriodKey(formatDateKey(new Date()), period);
  const periodLabel = ({ week: '每周', month: '每月', year: '每年' }[period] || period);
  const plans = (db.inspectionPlans || []).filter(item => item.projectId === projectId);
  const assets = (db.assets || []).filter(item => item.projectId === projectId);
  const executions = (db.inspectionExecutions || [])
    .filter(item => item.projectId === projectId)
    .filter(item => getPeriodKey(item.executedAt, period) === currentPeriod)
    .sort((a, b) => String(b.executedAt || '').localeCompare(String(a.executedAt || '')));
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
  <title>巡检执行完整报表</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-bottom: 16px; }
    .title { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .muted { color: #64748b; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .stat { background: #eff6ff; border-radius: 12px; padding: 16px; }
    .stat strong { display: block; font-size: 24px; margin-top: 6px; }
    h2 { margin: 0 0 12px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 9px 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; white-space: nowrap; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .success { background: #dcfce7; color: #166534; }
    .danger { background: #fee2e2; color: #991b1b; }
    .summary { line-height: 1.8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">巡检执行完整报表</div>
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

function buildAiInspectionResultHtml(db, resultId) {
  const payload = getAiInspectionReportPayload(db, resultId);
  if (!payload) return null;
  const { result, task, target, template, project, metrics } = payload;
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
      ? `${Number(result.realData[item.label])}${item.unit || ''}（实测）`
      : '-';
    const displayStatus = hasRealData ? status : '状态未知';
    const color = hasRealData ? statusColor(status) : '#94a3b8';
    const advice = getMetricAdvice(item, hasRealData);
    return `<tr><td>${escapeHtml(item.label || '-')}</td><td>${escapeHtml(item.unit || '-')}</td><td>${valueDisplay}</td><td>${escapeHtml(Number.isFinite(Number(item.warn)) ? item.warn : '-')}</td><td>${escapeHtml(Number.isFinite(Number(item.critical)) ? item.critical : '-')}</td><td>${escapeHtml(advice)}</td><td style="color:${color};font-weight:600;">${escapeHtml(displayStatus)}</td><td>${escapeHtml(item.description || '-')}</td></tr>`;
  }).join('') || '<tr><td colspan="8">暂无指标</td></tr>';
  const abnormalRows = (result.abnormalItems || []).map(item => `<li>${escapeHtml(item)}</li>`).join('') || '<li>本次巡检未发现异常项</li>';
  const templateMetricText = templateMetrics.length
    ? templateMetrics.map(m => `${escapeHtml(m.label)}（阈值: ${m.warn ?? '-'}/${m.critical ?? '-'} ${m.unit || ''}，${m.direction === 'low' ? '越低越好' : m.direction === 'high' ? '越高越好' : '无方向'}）`).join('<br />')
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
    <div class="muted">巡检对象：${escapeHtml(target.name || '-')} | 地址：${escapeHtml(target.address || '-')}:${escapeHtml(String(target.port || '-'))}</div>
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

function buildAiInspectionResultPptxBuffer(db, resultId) {
  const payload = getAiInspectionReportPayload(db, resultId);
  if (!payload) return null;
  const { result, task, target, project, metrics } = payload;
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

function serveStatic(req, res, pathname) {
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
  const ext = path.extname(normalized).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  const contentType = types[ext] || 'application/octet-stream';
  res.writeHead(200, buildSecurityHeaders({ 'Content-Type': contentType }));
  fs.createReadStream(normalized).pipe(res);
}

const requestHandler = async (req, res) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(reqUrl.pathname);
  if (pathname === '/ws') return;
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, getHealthPayload());
    }
    if (req.method === 'GET' && pathname === '/api/ready') {
      const readiness = await getSystemReadinessAsync();
      return json(res, readiness.ok ? 200 : 503, { ok: readiness.ok, checkedAt: readiness.checkedAt, version: readiness.version });
    }
    const db = await readDb();
    systemTimezoneOffsetMinutes = db.systemConfig?.timezoneOffset ?? 480;
    if (!validateCsrf(req, res, db, pathname)) return;

    tryLazyInitHttps(db);

    if (db.systemConfig?.httpLoginDisabled && !req.socket.encrypted) {
      const loginPaths = ['/api/login', '/api/register', '/api/forgot-password', '/api/captcha', '/api/auth'];
      if (loginPaths.some(p => pathname.startsWith(p))) {
        return json(res, 403, { message: 'HTTP 登录已禁用，请使用 HTTPS 登录' });
      }
    }


    if (req.method === 'GET' && pathname === '/api/captcha') {
      const code = generateCaptchaCode();
      const token = createCaptchaToken(code);
      const svg = renderCaptchaSvg(code);
      return json(res, 200, { token, svg: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      if (!verifyCaptchaToken(body.captchaToken, body.captcha)) {
        return json(res, 401, { message: '验证码错误' });
      }
      const rateLimitState = getLoginRateLimitState(db, req, username);
      if (rateLimitState.blocked) {
        return json(res, 429, { message: loginBlockedMessage(rateLimitState.retryAfterMs) }, rateLimitResponseHeaders(rateLimitState.retryAfterMs));
      }
      const user = db.users.find(item => item.username === username && verifyPassword(body.password, item.passwordHash));
      if (!user) {
        const failedState = registerLoginFailure(db, req, username);
        await writeDb(db, { silent: true });
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
      clearLoginFailures(db, req, username);
      if (!String(user.passwordHash).startsWith('$scrypt$')) {
        user.passwordHash = hash(body.password);
      }
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(nowMs() + sessionMaxAgeSeconds * 1000).toISOString();
      db.sessions = (db.sessions || []).filter(item => item.userId !== user.id && Date.parse(item.expiresAt) > nowMs());
      db.sessions.push({ token, userId: user.id, createdAt: now(), expiresAt });
      await writeDb(db, { silent: true });
      return json(res, 200, { user: sanitizeUser(user), systemConfig: db.systemConfig, csrfToken: getSessionCsrfToken(token) }, { 'Set-Cookie': buildSessionCookie(req, token, db.systemConfig) });
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
      if (!verifyPassword(body.oldPassword, user.passwordHash)) {
        return json(res, 401, { message: '当前密码错误' });
      }
      user.passwordHash = hash(body.newPassword);
      db.sessions = (db.sessions || []).filter(item => item.userId !== user.id);
      appendAuditLog(db, user, 'update', 'user', user.id, '修改个人密码');
      await writeDb(db);
      return json(res, 200, { message: '密码修改成功' });
    }

    if (req.method === 'POST' && pathname === '/api/forgot-password/verify') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const clientIp = getRequestClientIp(req);
      const rateKey = `forgot:verify:${clientIp}:${username}`;
      const rateState = getForgotPasswordRateLimitState(db, rateKey);
      if (rateState.blocked) {
        return json(res, 429, { message: `尝试次数过多，请在 ${Math.max(1, Math.ceil(rateState.retryAfterMs / 60000))} 分钟后重试` }, rateLimitResponseHeaders(rateState.retryAfterMs));
      }
      recordForgotPasswordAttempt(db, rateKey);
      const user = db.users.find(item => item.username === username && item.status !== 'disabled');
      if (!user || !user.securityQuestion) {
        return json(res, 200, { question: '', message: '如账号存在且已设置安全问题，将返回对应验证问题' });
      }
      return json(res, 200, { question: user.securityQuestion });
    }

    if (req.method === 'POST' && pathname === '/api/forgot-password/reset') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const clientIp = getRequestClientIp(req);
      const rateKey = `forgot:reset:${clientIp}:${username}`;
      const rateState = getForgotPasswordRateLimitState(db, rateKey);
      if (rateState.blocked) {
        return json(res, 429, { message: `尝试次数过多，请在 ${Math.max(1, Math.ceil(rateState.retryAfterMs / 60000))} 分钟后重试` }, rateLimitResponseHeaders(rateState.retryAfterMs));
      }
      recordForgotPasswordAttempt(db, rateKey);
      const user = db.users.find(item => item.username === username && item.status !== 'disabled');
      if (!user) {
        return json(res, 200, { message: '如验证信息正确，密码将被重置' });
      }
      if (!user.securityAnswerHash || !verifyPassword(body.securityAnswer, user.securityAnswerHash)) {
        return json(res, 401, { message: '验证信息错误' });
      }
      if (!body.newPassword || String(body.newPassword).length < 8) {
        return json(res, 400, { message: '密码长度不能少于 8 位' });
      }
      if (!/[a-zA-Z]/.test(body.newPassword) || !/[0-9]/.test(body.newPassword) || !/[^a-zA-Z0-9]/.test(body.newPassword)) {
        return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
      }
      user.passwordHash = hash(body.newPassword);
      db.sessions = (db.sessions || []).filter(item => item.userId !== user.id);
      appendAuditLog(db, user, 'update', 'user', user.id, '通过安全问题重置密码');
      await writeDb(db);
      return json(res, 200, { message: '密码重置成功，请使用新密码登录' });
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
      if (!db.systemConfig.allowRegistration) {
        return json(res, 403, { message: '管理员已关闭自主注册功能' });
      }
      if (db.users.some(item => item.username === username)) {
        return json(res, 400, { message: '账号已存在' });
      }
      if (!body.password || String(body.password).length < 8) {
        return json(res, 400, { message: '密码长度不能少于 8 位' });
      }
      if (!/[a-zA-Z]/.test(body.password) || !/[0-9]/.test(body.password) || !/[^a-zA-Z0-9]/.test(body.password)) {
        return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
      }
      const created = {
        id: id('user'),
        username,
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
        status: 'pending',
        createdAt: now()
      };
      db.users.push(created);
      appendAuditLog(db, created, 'create', 'user', created.id, `自注册账号 ${created.name}`);
      await writeDb(db);
      return json(res, 201, { message: '注册成功，请等待管理员审批' });
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
      res.writeHead(302, buildSecurityHeaders({ Location: authUrl.toString() }));
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
      delete db.runtimeState.oidcState[state];
      const oidcConfig = await fetchOidcConfig(issuer);
      if (!oidcConfig) {
        return json(res, 502, { message: '无法获取 OIDC 配置' });
      }
      try {
        const tokenRes = await fetch(oidcConfig.token_endpoint, {
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
            projectId: '',
            startDate: '',
            endDate: '',
            securityQuestion: '',
            securityAnswerHash: '',
            status: 'active',
            createdAt: now()
          };
          db.users.push(localUser);
        }
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(nowMs() + sessionMaxAgeSeconds * 1000).toISOString();
        db.sessions = (db.sessions || []).filter(item => item.userId !== localUser.id && Date.parse(item.expiresAt) > nowMs());
        db.sessions.push({ token, userId: localUser.id, createdAt: now(), expiresAt });
        await writeDb(db);
        res.writeHead(302, buildSecurityHeaders({
          Location: '/',
          'Set-Cookie': buildSessionCookie(req, token, db.systemConfig)
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
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) {
        return json(res, 400, { message: '请输入用户名和密码' });
      }
      try {
        const ldapUser = await ldapAuthenticate(ldapUrl, ldapBaseDn, ldapBindDn, ldapBindPassword, username, password);
        if (!ldapUser) {
          return json(res, 401, { message: 'LDAP 认证失败' });
        }
        let createdLocalUser = false;
        let localUser = db.users.find(item => item.username === 'ldap_' + username);
        if (!localUser) {
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
            projectId: '',
            startDate: '',
            endDate: '',
            securityQuestion: '',
            securityAnswerHash: '',
            status: 'active',
            createdAt: now()
          };
          db.users.push(localUser);
          createdLocalUser = true;
        }
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(nowMs() + sessionMaxAgeSeconds * 1000).toISOString();
        db.sessions = (db.sessions || []).filter(item => item.userId !== localUser.id && Date.parse(item.expiresAt) > nowMs());
        db.sessions.push({ token, userId: localUser.id, createdAt: now(), expiresAt });
        await writeDb(db, { silent: !createdLocalUser });
        return json(res, 200, { user: sanitizeUser(localUser), csrfToken: getSessionCsrfToken(token) }, { 'Set-Cookie': buildSessionCookie(req, token, db.systemConfig) });
      } catch (err) {
        return json(res, 502, { message: 'LDAP 认证服务不可用' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      const cookies = parseCookies(req);
      if (cookies.sessionToken) {
        db.sessions = (db.sessions || []).filter(item => item.token !== cookies.sessionToken);
        await writeDb(db, { silent: true });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': buildClearSessionCookie(req, db.systemConfig) });
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      const user = getAuthUser(req, db);
      const cookies = parseCookies(req);
      return json(res, 200, { user: sanitizeUser(user), systemConfig: user ? db.systemConfig : {}, csrfToken: user ? getSessionCsrfToken(cookies.sessionToken) : '' });
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
          onlineUsers.push({ id: u.id, username: u.username, name: u.name, role: u.role });
        }
      }
      return json(res, 200, { count: onlineUsers.length, users: onlineUsers });
    }

    if (req.method === 'GET' && pathname === '/api/projects') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = user.role === 'admin' ? db.projects : db.projects.filter(item => item.id === user.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/projects') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!String(body.name || '').trim()) return json(res, 400, { message: '项目名称不能为空' });
      const project = {
        id: id('project'),
        name: body.name,
        customerName: body.customerName || body.name,
        projectStartDate: body.projectStartDate || '',
        projectEndDate: body.projectEndDate || '',
        notifyBefore: body.notifyBefore || '',
        paymentMethod: body.paymentMethod || '',
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
      project.name = body.name || project.name;
      project.customerName = body.customerName || body.name || project.customerName;
      project.projectStartDate = body.projectStartDate || '';
      project.projectEndDate = body.projectEndDate || '';
      project.notifyBefore = body.notifyBefore || '';
      project.paymentMethod = body.paymentMethod || '';
      project.description = body.description || '';
      appendAuditLog(db, user, 'update', 'project', project.id, `修改项目 ${project.name}`, project.id);
      await writeDb(db);
      return json(res, 200, project);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/projects/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[3];
      const projectRelationCollections = ['users','assets','logs','knowledgeBase','documents','inspectionPlans','inspectionExecutions','spareParts','sparePartMovements','changeRecords','incidentRecords','approvals','notifications','aiInspectionTargets','aiInspectionTasks','aiInspectionResults','configBackupPlans','configBackupRecords'];
      const relationNames = projectRelationCollections.filter(key => (db[key] || []).some(item => item.projectId === projectId));
      if (relationNames.length) {
        return json(res, 400, { message: `该项目存在关联数据(${relationNames.join(', ')})，请先清理后再删除` });
      }
      const index = db.projects.findIndex(item => item.id === projectId);
      if (index === -1) {
        return json(res, 404, { message: '项目不存在' });
      }
      db.projects.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'project', projectId, '删除项目', projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/users') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = user.role === 'admin'
        ? db.users.map(sanitizeUser)
        : user.role === 'customer'
          ? db.users.filter(item => item.projectId === user.projectId).map(sanitizeUser)
          : db.users.filter(item => item.projectId === user.projectId).map(sanitizeUser);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/users') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (db.users.some(item => item.username === body.username)) {
        return json(res, 400, { message: '账号已存在' });
      }
      if (!body.password) {
        return json(res, 400, { message: '创建人员时必须填写密码' });
      }
      if (String(body.password).length < 8) {
        return json(res, 400, { message: '密码长度不能少于 8 位' });
      }
      if (!/[a-zA-Z]/.test(body.password) || !/[0-9]/.test(body.password) || !/[^a-zA-Z0-9]/.test(body.password)) {
        return json(res, 400, { message: '密码必须包含字母、数字和特殊字符' });
      }
      if (body.projectId && !requireExistingProject(body.projectId, db)) {
        return json(res, 400, { message: '关联项目不存在' });
      }
      const created = {
        id: id('user'),
        username: body.username,
        passwordHash: hash(body.password),
        role: body.role || 'engineer',
        name: body.name,
        phone: body.phone || '',
        idCard: body.idCard || '',
        email: body.email || '',
        wechat: body.wechat || '',
        projectId: body.projectId || '',
        startDate: body.startDate || '',
        endDate: body.endDate || '',
        status: 'active',
        createdAt: now()
      };
      db.users.push(created);
      appendAuditLog(db, user, 'create', 'user', created.id, `创建人员 ${created.name}`, created.projectId);
      await writeDb(db);
      return json(res, 201, sanitizeUser(created));
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
      target.status = 'active';
      appendAuditLog(db, approver, 'update', 'user', target.id, `审批通过自注册账号 ${target.name}`, target.projectId);
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
      appendAuditLog(db, approver, 'update', 'user', target.id, `拒绝自注册账号 ${target.name}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { message: '已拒绝该注册申请', user: sanitizeUser(target) });
    }

    if (req.method === 'PUT' && pathname.endsWith('/disable') && pathname.startsWith('/api/users/')) {
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      const targetUserId = pathname.split('/')[3];
      const target = db.users.find(item => item.id === targetUserId);
      if (!target) {
        return json(res, 404, { message: '人员不存在' });
      }
      if (target.status === 'disabled') {
        return json(res, 400, { message: '该账号已处于禁用状态' });
      }
      if (target.role === 'admin' && admin.id !== target.id) {
        return json(res, 403, { message: '不能禁用其他管理员账号' });
      }
      target.status = 'disabled';
      db.sessions = (db.sessions || []).filter(item => item.userId !== target.id);
      appendAuditLog(db, admin, 'update', 'user', target.id, `禁用账号 ${target.name}`, target.projectId);
      await writeDb(db);
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
      const body = await readBody(req);
      if (db.users.some(item => item.username === body.username && item.id !== targetUserId)) {
        return json(res, 400, { message: '账号已存在' });
      }
      if (body.projectId && !requireExistingProject(body.projectId, db)) {
        return json(res, 400, { message: '关联项目不存在' });
      }
      target.username = body.username || target.username;
      target.role = body.role || target.role;
      target.name = body.name || target.name;
      target.phone = body.phone || '';
      target.idCard = body.idCard || '';
      target.email = body.email || '';
      target.wechat = body.wechat || '';
      target.projectId = body.projectId || '';
      target.startDate = body.startDate || '';
      target.endDate = body.endDate || '';
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
      await writeDb(db);
      return json(res, 200, sanitizeUser(target));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/users/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const targetUserId = pathname.split('/')[3];
      if (user.id === targetUserId) {
        return json(res, 400, { message: '当前登录账号不能删除自己' });
      }
      const hasRelations = db.logs.some(item => item.userId === targetUserId)
        || db.knowledgeBase.some(item => item.createdBy === targetUserId);
      if (hasRelations) {
        return json(res, 400, { message: '该人员已关联日志或知识库，暂时不能删除' });
      }
      const index = db.users.findIndex(item => item.id === targetUserId);
      if (index === -1) {
        return json(res, 404, { message: '人员不存在' });
      }
      db.users.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'user', targetUserId, '删除人员');
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/assets') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.assets, user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/assets') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const item = {
        id: id('asset'),
        projectId,
        type: body.type || '',
        name: body.name || '',
        brand: body.brand || '',
        model: body.model || '',
        owner: body.owner || '',
        version: body.version || '',
        serialNumber: body.serialNumber || '',
        status: body.status || '',
        maintainExpiryDate: body.maintainExpiryDate || '',
        installationLocation: body.installationLocation || '',
        notes: body.notes || '',
        createdBy: user.id,
        createdAt: now()
      };
      db.assets.push(item);
      appendAuditLog(db, user, 'create', 'asset', item.id, `创建资产 ${item.name}`, projectId);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'POST' && pathname === '/api/assets/import') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const rows = Array.isArray(body.assets) ? body.assets : [];
      if (!rows.length) return json(res, 400, { message: '导入数据为空' });
      const results = { created: 0, skipped: 0, errors: [] };
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowLabel = `第${i + 2}行`;
        const name = (row.name || row['资产名称'] || '').trim();
        if (!name) { results.errors.push(`${rowLabel}: 资产名称为空`); results.skipped++; continue; }
        let projectId = user.projectId;
        const projectName = (row.projectName || row['关联项目'] || '').trim();
        if (user.role === 'admin' && projectName) {
          const p = db.projects.find(prj => prj.name === projectName);
          if (p) {
            projectId = p.id;
          } else {
            const available = db.projects.map(prj => prj.name).join('、');
            results.errors.push(`${rowLabel}: 项目"${projectName}"不存在，已归入默认项目。可用项目：${available || '无'}`);
          }
        }
        if (!db.projects.find(prj => prj.id === projectId)) { results.errors.push(`${rowLabel}: 关联项目不存在`); results.skipped++; continue; }
        const rawDate = row.maintainExpiryDate ?? row['维保到期日'];
        let maintainExpiryDate = '';
        if (rawDate != null && rawDate !== '') {
          if (typeof rawDate === 'number') {
            const excelEpoch = new Date(1899, 11, 30);
            const d = new Date(excelEpoch.getTime() + rawDate * 86400000);
            maintainExpiryDate = d.toISOString().slice(0, 10);
          } else {
            const str = String(rawDate).trim();
            const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
            if (m) {
              maintainExpiryDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
            } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(str)) {
              const parts = str.split(/[\/\-]/);
              maintainExpiryDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            } else {
              results.errors.push(`${rowLabel}: 维保到期日格式无效"${str}"，请使用YYYY-MM-DD格式`);
            }
          }
        }
        if (rawDate != null && rawDate !== '' && !maintainExpiryDate && !results.errors.slice(-1)[0]?.includes('维保到期日')) {
          results.errors.push(`${rowLabel}: 维保到期日格式无法识别，请使用YYYY-MM-DD格式`);
        }
        const item = {
          id: id('asset'),
          projectId,
          type: row.type || row['资产类型'] || '',
          name,
          brand: row.brand || row['品牌'] || '',
          model: row.model || row['规格型号'] || '',
          owner: row.owner || row['责任人'] || row['责任人/部门'] || '',
          version: row.version || row['版本'] || '',
          serialNumber: row.serialNumber || row['序列号'] || '',
          status: row.status || row['状态'] || '',
          maintainExpiryDate,
          installationLocation: row.installationLocation || row['安装位置'] || '',
          notes: row.notes || row['备注'] || '',
          createdBy: user.id,
          createdAt: now()
        };
        db.assets.push(item);
        results.created++;
      }
      appendAuditLog(db, user, 'import', 'asset', '', `批量导入资产 ${results.created} 条`, user.projectId);
      await writeDb(db);
      return json(res, 200, results);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/assets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const assetId = pathname.split('/')[3];
      const target = db.assets.find(item => item.id === assetId);
      if (!target) return json(res, 404, { message: '资产不存在' });
      if (user.role !== 'admin' && target.projectId !== user.projectId) return json(res, 403, { message: '无权修改该资产' });
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? (body.projectId || target.projectId) : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      target.projectId = projectId;
      target.type = body.type || target.type;
      target.name = body.name || target.name;
      target.brand = body.brand || '';
      target.model = body.model || '';
      target.owner = body.owner || '';
      target.version = body.version || '';
      (db.aiInspectionTargets || []).forEach(item => {
        if (item.assetId === target.id) item.systemVersion = target.version;
      });
      target.serialNumber = body.serialNumber || '';
      target.status = body.status || '';
      target.maintainExpiryDate = body.maintainExpiryDate || '';
      target.installationLocation = body.installationLocation !== undefined ? body.installationLocation : target.installationLocation;
      target.notes = body.notes || '';
      appendAuditLog(db, user, 'update', 'asset', target.id, `修改资产 ${target.name}`, projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/assets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const assetId = pathname.split('/')[3];
      const index = db.assets.findIndex(item => item.id === assetId);
      if (index === -1) return json(res, 404, { message: '资产不存在' });
      const target = db.assets[index];
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持删除自己创建的资产' });
      const aiTargetRefs = (db.aiInspectionTargets || []).filter(item => item.assetId === assetId);
      const sparePartMoveRefs = (db.sparePartMovements || []).filter(item => item.assetId === assetId);
      const changeRecordRefs = (db.changeRecords || []).filter(item => item.assetId === assetId);
      const warnings = [];
      if (aiTargetRefs.length) warnings.push(`有 ${aiTargetRefs.length} 个巡检对象引用了该资产`);
      if (sparePartMoveRefs.length) warnings.push(`有 ${sparePartMoveRefs.length} 条备件出入库记录引用了该资产`);
      if (changeRecordRefs.length) warnings.push(`有 ${changeRecordRefs.length} 条变更记录引用了该资产`);
      if (warnings.length) {
        return json(res, 409, { message: '该资产存在关联数据: ' + warnings.join('; ') + '。请先删除关联数据后再删除资产。' });
      }
      db.assets.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'asset', assetId, `删除资产 ${target.name}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/logs') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      let list = filterByProjectScope(db.logs || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      if (query.projectId) list = list.filter(item => item.projectId === query.projectId);
      if (query.userId) list = list.filter(item => item.userId === query.userId);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/logs') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (body.durationHours !== undefined && Number(body.durationHours) < 0) return json(res, 400, { message: '工单用时不能为负数' });
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const asset = requireExistingAsset(body.assetId || '', db);
      if (body.assetId && (!asset || asset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或不属于当前项目' });
      const item = {
        id: id('log'),
        userId: user.id,
        projectId,
        assetId: body.assetId || '',
        date: body.date || '',
        event: body.event || '',
        relatedTarget: body.relatedTarget || '',
        dispatcher: body.dispatcher || '',
        dispatchDepartment: body.dispatchDepartment || '',
        ticketType: body.ticketType || '',
        assignee: body.assignee || user.name,
        process: body.process || '',
        conclusion: body.conclusion || '',
        remark: body.remark || '',
        durationHours: Number(body.durationHours || 0),
        createdAt: now()
      };
      db.logs.push(item);
      appendAuditLog(db, user, 'create', 'log', item.id, `创建日志 ${item.event}`, projectId);
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/logs/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const logId = pathname.split('/')[3];
      const target = db.logs.find(item => item.id === logId);
      if (!target) return json(res, 404, { message: '日志不存在' });
      if (user.role !== 'admin' && target.userId !== user.id) return json(res, 403, { message: '仅日志创建者或管理员可以编辑' });
      const body = await readBody(req);
      if (body.durationHours !== undefined && Number(body.durationHours) < 0) return json(res, 400, { message: '工单用时不能为负数' });
      if (body.title !== undefined) target.title = String(body.title || '').trim() || target.title;
      if (body.event !== undefined) target.event = String(body.event || '').trim();
      if (body.process !== undefined) target.process = String(body.process || '').trim();
      if (body.conclusion !== undefined) target.conclusion = String(body.conclusion || '').trim();
      if (body.remark !== undefined) target.remark = String(body.remark || '').trim();
      if (body.durationHours !== undefined) target.durationHours = Number(body.durationHours || 0);
      if (body.projectId !== undefined) target.projectId = body.projectId;
      if (body.ticketType !== undefined) target.ticketType = String(body.ticketType || '').trim();
      if (body.relatedTarget !== undefined) target.relatedTarget = String(body.relatedTarget || '').trim();
      if (body.dispatchDepartment !== undefined) target.dispatchDepartment = String(body.dispatchDepartment || '').trim();
      if (body.dispatcher !== undefined) target.dispatcher = String(body.dispatcher || '').trim();
      if (body.assignee !== undefined) target.assignee = String(body.assignee || '').trim();
      if (body.date !== undefined) target.date = body.date;
      appendAuditLog(db, user, 'update', 'log', logId, `编辑日志 ${target.event || target.title || logId}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
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
      if (keyword) {
        list = list.filter(item => [item.title, item.keywords, item.problem, item.solution].some(field => String(field || '').toLowerCase().includes(keyword)));
      }
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/kb') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const item = {
        id: id('kb'),
        title: body.title || '',
        content: body.content || '',
        category: body.category || '',
        tags: body.tags || '',
        keywords: body.keywords || '',
        problem: body.problem || '',
        solution: body.solution || '',
        createdBy: user.id,
        projectId: user.role === 'admin' ? (body.projectId || user.projectId) : user.projectId,
        createdAt: now()
      };
      db.knowledgeBase.push(item);
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
      if (body.title !== undefined) target.title = body.title;
      if (body.content !== undefined) target.content = body.content;
      if (body.category !== undefined) target.category = body.category;
      if (body.tags !== undefined) target.tags = body.tags;
      if (body.keywords !== undefined) target.keywords = body.keywords;
      if (body.problem !== undefined) target.problem = body.problem;
      if (body.solution !== undefined) target.solution = body.solution;
      if (user.role === 'admin' && body.projectId !== undefined) target.projectId = body.projectId;
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
      appendAuditLog(db, user, 'delete', 'kb', kbId, `删除知识条目 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
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
      const sanitized = sorted.map(item => {
        const { accessPasswordHash, loginPasswordHash, loginPasswordEncrypted, attachmentPath, serialNumber, managementIp, managementPort, loginAccount, managementMethod, ...rest } = item;
        return rest;
      });
      return json(res, 200, paginateResult(sanitized, query));
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/documents\/([^/]+)$/) && !pathname.includes('/verify-password') && !pathname.includes('/download')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (user.role !== 'admin' && target.projectId !== user.projectId) return json(res, 403, { message: '无权访问该资料' });
      if (target.accessPasswordHash) {
        const rawToken = reqUrl.searchParams.get('token') || '';
        try {
          const decoded = Buffer.from(rawToken, 'base64url').toString('utf8');
          const lastColon = decoded.lastIndexOf(':');
          if (lastColon === -1) return json(res, 403, { message: '访问令牌无效' });
          const payload = decoded.slice(0, lastColon);
          const sig = decoded.slice(lastColon + 1);
          const expectedSig = crypto.createHmac('sha256', DOCUMENT_TOKEN_SECRET).update(payload).digest('hex');
          if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return json(res, 403, { message: '访问令牌无效' });
          const parts = payload.split(':');
          if (parts[0] !== docId || parts[1] !== user.id) return json(res, 403, { message: '访问令牌与资料不匹配' });
          const tokenTime = parseInt(parts[2], 10);
          if (nowMs() - tokenTime > 10 * 60 * 1000) return json(res, 403, { message: '访问链接已过期，请重新验证密码' });
        } catch (_) {
          return json(res, 403, { message: '访问令牌无效' });
        }
      }
      const sanitized = { ...target };
      delete sanitized.accessPasswordHash;
      delete sanitized.loginPasswordHash;
      delete sanitized.loginPasswordEncrypted;
      delete sanitized.attachmentPath;
      return json(res, 200, sanitized);
    }

    if (req.method === 'POST' && pathname === '/api/documents') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return json(res, 400, { message: '请使用 multipart/form-data 提交资料' });
      }
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) return json(res, 400, { message: '无效的上传格式' });
      const rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        let exceeded = false;
        req.on('data', chunk => {
          chunks.push(chunk);
          if (!exceeded && Buffer.concat(chunks).length > 20 * 1024 * 1024) {
            exceeded = true;
            reject({ status: 413, message: '附件不能超过 20MB' });
          }
        });
        req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
        req.on('error', reject);
      }).catch(err => {
        if (err.status) return json(res, err.status, { message: err.message });
        throw err;
      });
      const parts = parseMultipart(rawBody, boundary);
      const getField = (name) => {
        const part = parts.find(p => p.name === name && !p.filename);
        return part ? part.data.toString('utf8').trim() : '';
      };
      const projectId = user.role === 'admin' ? getField('projectId') : user.projectId;
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
      const sanitized = { ...item };
      delete sanitized.accessPasswordHash;
      delete sanitized.loginPasswordHash;
      delete sanitized.loginPasswordEncrypted;
      return json(res, 201, sanitized);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/documents/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持修改自己创建的资料' });
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) return json(res, 400, { message: '无效的上传格式' });
        const rawBody = await new Promise((resolve, reject) => {
          const chunks = [];
          let exceeded = false;
          req.on('data', chunk => {
            chunks.push(chunk);
            if (!exceeded && Buffer.concat(chunks).length > 20 * 1024 * 1024) {
              exceeded = true;
              reject({ status: 413, message: '附件不能超过 20MB' });
            }
          });
          req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
          req.on('error', reject);
        }).catch(err => {
          if (err.status) return json(res, err.status, { message: err.message });
          throw err;
        });
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
        if (getField('loginPassword')) {
          target.loginPasswordHash = hash(getField('loginPassword'));
          const encKey = getField('accessPassword') || getField('_encryptionKey');
          if (encKey) target.loginPasswordEncrypted = encryptLoginPassword(getField('loginPassword'), encKey);
        }
        if (getField('accessPassword')) {
          target.accessPasswordHash = hash(getField('accessPassword'));
          if (getField('loginPassword')) {
            target.loginPasswordEncrypted = encryptLoginPassword(getField('loginPassword'), getField('accessPassword'));
          }
        }
        if (user.role === 'admin' && getField('projectId')) target.projectId = getField('projectId');
        const newType = getField('type') || target.type;
        if (newType && !DOCUMENT_TYPES.includes(newType)) {
          return json(res, 400, { message: '无效的资料类型' });
        }
        if (getField('type')) target.type = newType;
        const filePart = parts.find(p => p.name === 'attachment' && p.filename);
        if (filePart && filePart.filename) {
          const docDir = path.join(documentsUploadDir, docId);
          fs.mkdirSync(docDir, { recursive: true });
          target.attachmentName = sanitizeUploadFilename(filePart.filename);
          target.attachmentPath = resolveSafeChildPath(docDir, target.attachmentName);
          fs.writeFileSync(target.attachmentPath, filePart.data);
          target.attachmentSize = filePart.data.length;
        }
        target.updatedAt = now();
        appendAuditLog(db, user, 'update', 'document', docId, `修改资料 ${target.title}`, target.projectId);
        await writeDb(db);
        const sanitized = { ...target };
        delete sanitized.accessPasswordHash;
        delete sanitized.loginPasswordHash;
        delete sanitized.loginPasswordEncrypted;
        return json(res, 200, sanitized);
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
      if (body.title !== undefined) target.title = String(body.title || '').trim();
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
      if (body.loginPassword !== undefined && body.loginPassword) {
        target.loginPasswordHash = hash(body.loginPassword);
        const encKey = body.accessPassword || body._encryptionKey;
        if (encKey) target.loginPasswordEncrypted = encryptLoginPassword(body.loginPassword, encKey);
      }
      if (body.accessPassword !== undefined && body.accessPassword) {
        target.accessPasswordHash = hash(body.accessPassword);
        if (body.loginPassword) target.loginPasswordEncrypted = encryptLoginPassword(body.loginPassword, body.accessPassword);
      }
      if (user.role === 'admin' && body.projectId !== undefined) target.projectId = body.projectId;
      target.updatedAt = now();
      appendAuditLog(db, user, 'update', 'document', docId, `修改资料 ${target.title}`, target.projectId);
      await writeDb(db);
      const sanitized = { ...target };
      delete sanitized.accessPasswordHash;
      delete sanitized.loginPasswordHash;
      delete sanitized.loginPasswordEncrypted;
      return json(res, 200, sanitized);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/documents/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const index = db.documents.findIndex(item => item.id === docId);
      if (index === -1) return json(res, 404, { message: '资料不存在' });
      const target = db.documents[index];
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持删除自己创建的资料' });
      if (target.attachmentPath) {
        try {
          const docDir = path.join(documentsUploadDir, docId);
          fs.rmSync(docDir, { recursive: true, force: true });
        } catch (_) {}
      }
      db.documents.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'document', docId, `删除资料 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/documents\/([^/]+)\/verify-password$/)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (user.role !== 'admin' && target.projectId !== user.projectId) return json(res, 403, { message: '无权访问该资料' });
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
      return json(res, 200, { ok: true, token, hasLoginPassword: Boolean(target.loginPasswordEncrypted) });
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/documents\/([^/]+)\/download$/)) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const docId = pathname.split('/')[3];
      const target = db.documents.find(item => item.id === docId);
      if (!target) return json(res, 404, { message: '资料不存在' });
      if (user.role !== 'admin' && target.projectId !== user.projectId) return json(res, 403, { message: '无权访问该资料' });
      const rawToken = reqUrl.searchParams.get('token') || '';
      try {
        const decoded = Buffer.from(rawToken, 'base64url').toString('utf8');
        const lastColon = decoded.lastIndexOf(':');
        if (lastColon === -1) return json(res, 403, { message: '访问令牌无效' });
        const payload = decoded.slice(0, lastColon);
        const sig = decoded.slice(lastColon + 1);
        const expectedSig = crypto.createHmac('sha256', DOCUMENT_TOKEN_SECRET).update(payload).digest('hex');
        if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return json(res, 403, { message: '访问令牌无效' });
        const parts = payload.split(':');
        if (parts[0] !== docId || parts[1] !== user.id) return json(res, 403, { message: '访问令牌与资料不匹配' });
        const tokenTime = parseInt(parts[2], 10);
        if (nowMs() - tokenTime > 10 * 60 * 1000) return json(res, 403, { message: '访问链接已过期，请重新验证密码' });
      } catch (_) {
        return json(res, 403, { message: '访问令牌无效' });
      }
      if (!target.attachmentPath || !fs.existsSync(target.attachmentPath)) {
        return json(res, 404, { message: '附件文件不存在' });
      }
      appendAuditLog(db, user, 'access', 'document', docId, `下载资料附件 ${target.title}`, target.projectId);
      await writeDb(db);
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(target.attachmentName || 'download')}`,
        'Content-Length': target.attachmentSize || fs.statSync(target.attachmentPath).size
      }));
      return fs.createReadStream(target.attachmentPath).pipe(res);
    }

    if (req.method === 'GET' && pathname === '/api/inspection-plans') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const today = formatDateKey(new Date());
      (db.inspectionPlans || []).forEach(plan => {
        if (!plan.nextDate || plan.nextDate >= today) return;
        const cycleAdd = { daily: 1, weekly: 7, monthly: 30, quarterly: 91 }[plan.cycle] || 30;
        let d = new Date(plan.nextDate + 'T00:00:00');
        if (plan.cycle === 'monthly' || plan.cycle === 'quarterly') {
          const incMonths = plan.cycle === 'quarterly' ? 3 : 1;
          while (formatDateKey(d) < today) {
            d.setMonth(d.getMonth() + incMonths);
          }
        } else {
          while (formatDateKey(d) < today) {
            d.setDate(d.getDate() + cycleAdd);
          }
        }
        plan.nextDate = formatDateKey(d);
      });
      const list = filterByProjectScope(db.inspectionPlans || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/inspection-plans') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const asset = requireExistingAsset(body.assetId || '', db);
      if (body.assetId && (!asset || asset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或归属不一致' });
      const plan = { id: id('inspection'), projectId, assetId: body.assetId || '', title: body.title || '', cycle: body.cycle || 'monthly', nextDate: body.nextDate || '', owner: body.owner || user.name, status: body.status || '待执行', createdBy: user.id, createdAt: now() };
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
      const newProjectId = (user.role === 'admin' && body.projectId !== undefined) ? body.projectId : target.projectId;
      if (body.assetId !== undefined) {
        const asset = requireExistingAsset(body.assetId, db);
        if (!asset || asset.projectId !== newProjectId) return json(res, 400, { message: '关联资产不存在或归属不一致' });
        target.assetId = body.assetId;
      }
      if (user.role === 'admin' && body.projectId !== undefined) target.projectId = body.projectId;
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
      appendAuditLog(db, user, 'delete', 'inspectionPlan', planId, `删除巡检计划 ${target.title}，同时移除 ${removedExecutionCount} 条执行记录`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/inspection-executions') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.inspectionExecutions || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/inspection-executions') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const plan = (db.inspectionPlans || []).find(item => item.id === body.planId);
      if (!plan) return json(res, 404, { message: '巡检计划不存在' });
      if (user.role !== 'admin' && plan.projectId !== user.projectId) {
        return json(res, 403, { message: '无权执行该巡检计划' });
      }
      const execution = {
        id: id('inspectionExec'),
        planId: plan.id,
        projectId: plan.projectId,
        assetId: plan.assetId || '',
        executedAt: body.executedAt || now().slice(0, 16),
        executor: body.executor || user.name,
        checklist: body.checklist || '',
        result: body.result || '正常',
        issue: body.issue || '',
        suggestion: body.suggestion || '',
        attachment: normalizeInspectionAttachment(body.attachment),
        nextDate: body.nextDate || plan.nextDate || '',
        createdBy: user.id,
        createdAt: now()
      };
      db.inspectionExecutions = db.inspectionExecutions || [];
      db.inspectionExecutions.push(execution);
      plan.status = execution.result === '异常' ? '异常待处理' : '已执行';
      if (execution.nextDate) {
        plan.nextDate = execution.nextDate;
      }
      appendAuditLog(db, user, 'execute', 'inspectionPlan', plan.id, `执行巡检 ${plan.title}，结果 ${execution.result}`, plan.projectId);
      if (execution.result === '异常') {
        createNotification(db, plan.projectId, '巡检异常提醒', `${plan.title} 巡检发现异常`, 'warning', 'inspection');
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
      const body = await readBody(req);
      if (body.executedAt !== undefined) target.executedAt = body.executedAt;
      if (body.executor !== undefined) target.executor = body.executor;
      if (body.result !== undefined) target.result = body.result;
      if (body.checklist !== undefined) target.checklist = body.checklist;
      if (body.issue !== undefined) target.issue = body.issue;
      if (body.suggestion !== undefined) target.suggestion = body.suggestion;
      if (body.nextDate !== undefined) target.nextDate = body.nextDate;
      const attachment = normalizeInspectionAttachment(body.attachment);
      if (attachment.fileName) target.attachment = attachment;
      const plan = (db.inspectionPlans || []).find(item => item.id === target.planId);
      if (plan) {
        plan.status = target.result === '异常' ? '异常待处理' : '已执行';
        if (target.nextDate) plan.nextDate = target.nextDate;
      }
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

    if (req.method === 'GET' && pathname === '/api/spare-parts') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.spareParts || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'GET' && pathname === '/api/spare-part-movements') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.sparePartMovements || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/spare-parts') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const item = { id: id('spare'), projectId, assetId: body.assetId || '', name: body.name || '', model: body.model || '', quantity: Number(body.quantity || 0), safeStock: Number(body.safeStock || 0), location: body.location || '', createdAt: now() };
      db.spareParts.push(item);
      appendAuditLog(db, user, 'create', 'sparePart', item.id, `创建备件 ${item.name}`, projectId);
      if (item.quantity <= item.safeStock) createNotification(db, projectId, '备件库存提醒', `${item.name} 库存达到安全阈值`, 'warning', 'inventory');
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/spare-parts/') && !pathname.endsWith('/stock')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const sparePartId = pathname.split('/')[3];
      const target = (db.spareParts || []).find(item => item.id === sparePartId);
      if (!target) return json(res, 404, { message: '备件不存在' });
      if (user.role !== 'admin' && target.projectId !== user.projectId) {
        return json(res, 403, { message: '无权操作该备件' });
      }
      const body = await readBody(req);
      if (body.name !== undefined) target.name = body.name;
      if (body.model !== undefined) target.model = body.model;
      if (body.quantity !== undefined) target.quantity = Number(body.quantity || 0);
      if (body.safeStock !== undefined) target.safeStock = Number(body.safeStock || 0);
      if (body.unit !== undefined) target.unit = body.unit;
      if (body.location !== undefined) target.location = body.location;
      if (body.notes !== undefined) target.notes = body.notes;
      if (body.assetId !== undefined) target.assetId = body.assetId;
      if (user.role === 'admin' && body.projectId !== undefined) target.projectId = body.projectId;
      appendAuditLog(db, user, 'update', 'sparePart', sparePartId, `修改备件 ${target.name}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/spare-parts/') && !pathname.endsWith('/stock')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const sparePartId = pathname.split('/')[3];
      const index = (db.spareParts || []).findIndex(item => item.id === sparePartId);
      if (index === -1) return json(res, 404, { message: '备件不存在' });
      const target = db.spareParts[index];
      if (user.role !== 'admin' && target.projectId !== user.projectId) {
        return json(res, 403, { message: '无权操作该备件' });
      }
      const removedMovementCount = (db.sparePartMovements || []).filter(item => item.sparePartId === sparePartId).length;
      db.spareParts.splice(index, 1);
      db.sparePartMovements = (db.sparePartMovements || []).filter(item => item.sparePartId !== sparePartId);
      appendAuditLog(db, user, 'delete', 'sparePart', sparePartId, `删除备件 ${target.name}，同时移除 ${removedMovementCount} 条出入库流水`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname.startsWith('/api/spare-parts/') && pathname.endsWith('/stock')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const sparePartId = pathname.split('/')[3];
      const target = (db.spareParts || []).find(item => item.id === sparePartId);
      if (!target) return json(res, 404, { message: '备件不存在' });
      if (user.role !== 'admin' && target.projectId !== user.projectId) {
        return json(res, 403, { message: '无权操作该备件' });
      }
      const body = await readBody(req);
      const type = body.type === 'inbound' ? 'inbound' : 'outbound';
      const quantity = Number(body.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return json(res, 400, { message: '数量必须大于 0' });
      }
      if (type === 'outbound' && target.quantity < quantity) {
        return json(res, 400, { message: '库存不足，无法消耗' });
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
      db.sparePartMovements = db.sparePartMovements || [];
      db.sparePartMovements.push(movement);
      appendAuditLog(db, user, 'stock', 'sparePart', target.id, `${type === 'inbound' ? '入库' : '消耗'}备件 ${target.name} 数量 ${quantity}`, target.projectId);
      if (target.quantity <= target.safeStock) {
        createNotification(db, target.projectId, '备件库存提醒', `${target.name} 当前库存 ${target.quantity}，已达到安全阈值`, 'warning', 'inventory');
      }
      await writeDb(db);
      return json(res, 200, { item: target, movement });
    }

    if (req.method === 'GET' && pathname === '/api/change-records') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const rejectionMap = new Map();
      (db.approvals || []).forEach(a => {
        if (a.category === 'change' && a.status === '已驳回' && a.rejectionReason) {
          rejectionMap.set(a.relatedId, a.rejectionReason);
        }
      });
      (db.changeRecords || []).forEach(item => {
        if (!item.rejectionReason && rejectionMap.has(item.id)) {
          item.rejectionReason = rejectionMap.get(item.id);
        }
      });
      const list = filterByProjectScope(db.changeRecords || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/change-records') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      if (!title || !content) return json(res, 400, { message: '变更标题和变更内容不能为空' });
      const project = requireExistingProject(projectId, db);
      if (!project) return json(res, 400, { message: '关联项目不存在' });
      const asset = requireExistingAsset(body.assetId, db);
      if (body.assetId && (!asset || asset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或不属于当前项目' });
      const approver = requireExistingUser(body.approverId, db);
      if (!approver || !canViewProject(approver, projectId) || approver.role === 'customer') return json(res, 400, { message: '审批人不存在或无权限审批当前项目' });
      const customer = requireExistingUser(body.customerId, db);
      if (!customer || customer.projectId !== projectId || customer.role !== 'customer') return json(res, 400, { message: '甲方客户不存在或不属于当前项目' });
      const item = {
        id: id('change'),
        projectId,
        assetId: body.assetId || '',
        title: title,
        content: content,
        riskLevel: body.riskLevel || '中',
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
      createNotification(db, projectId, '变更待审批', `${item.title} 已提交给 ${approver.name} 审批`, 'warning', 'approval');
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/change-records/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const recordId = pathname.split('/')[3];
      const target = (db.changeRecords || []).find(item => item.id === recordId);
      if (!target) return json(res, 404, { message: '变更记录不存在' });
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持修改自己创建的变更记录' });
      if (target.status !== '待运维审批' && target.status !== '已驳回') return json(res, 400, { message: '仅草稿或已驳回状态的变更记录支持修改' });
      const wasRejected = target.status === '已驳回';
      const oldStatus = target.status;
      const body = await readBody(req);
      if (body.title !== undefined) target.title = String(body.title || '').trim() || target.title;
      if (body.content !== undefined) target.content = String(body.content || '').trim() || target.content;
      if (body.riskLevel !== undefined) target.riskLevel = body.riskLevel;
      if (body.assetId !== undefined) target.assetId = body.assetId;
      if (body.approverId !== undefined) {
        const approver = requireExistingUser(body.approverId, db);
        if (!approver || !canViewProject(approver, target.projectId) || approver.role === 'customer') return json(res, 400, { message: '审批人不存在或无权限审批当前项目' });
        target.approverId = approver.id;
        target.approverName = approver.name;
      }
      if (body.customerId !== undefined) {
        const customer = requireExistingUser(body.customerId, db);
        if (!customer || customer.projectId !== target.projectId || customer.role !== 'customer') return json(res, 400, { message: '甲方客户不存在或不属于当前项目' });
        target.customerId = customer.id;
        target.customerName = customer.name;
      }
      if (user.role === 'admin' && body.projectId !== undefined) target.projectId = body.projectId;
      if (wasRejected) {
        target.status = '待运维审批';
        const approver = (db.users || []).find(u => u.id === target.approverId);
        createNotification(db, target.projectId, '变更待审批', `${target.title} 已重新提交${oldStatus === '已驳回' ? '（原已驳回）' : ''}，待${approver ? approver.name : '审批人'}审批`, 'warning', 'approval');
        const approval = (db.approvals || []).find(a => a.relatedId === target.id && a.category === 'change');
        if (approval) {
          approval.status = '待运维审批';
          approval.currentStage = 'approver';
          approval.updatedAt = now();
        }
      }
      appendAuditLog(db, user, 'update', 'changeRecord', recordId, `修改变更记录 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/change-records/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const recordId = pathname.split('/')[3];
      const index = (db.changeRecords || []).findIndex(item => item.id === recordId);
      if (index === -1) return json(res, 404, { message: '变更记录不存在' });
      const target = db.changeRecords[index];
      if (!canDeleteOwnedRecord(user, target, target.createdBy || '')) return json(res, 403, { message: '仅支持删除自己创建的变更记录' });
      db.changeRecords.splice(index, 1);
      if (target.approvalId) {
        try {
          db.approvals = (db.approvals || []).filter(item => item.id !== target.approvalId);
        } catch (error) {
          appendAuditLog(db, user, 'system', 'approval', target.approvalId, `变更记录 ${target.title} 删除时级联删除审批失败: ${error.message}`, target.projectId);
        }
      }
      appendAuditLog(db, user, 'delete', 'changeRecord', recordId, `删除变更记录 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/incidents') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.incidentRecords || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/incidents') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const item = { id: id('incident'), projectId, assetId: body.assetId || '', title: body.title || '', faultType: body.faultType || '', severity: body.severity || '中', slaStatus: body.slaStatus || '正常', status: body.status || '处理中', description: body.description || '', occurredAt: body.occurredAt || '', resolution: body.resolution || '', createdBy: user.id, createdAt: now() };
      db.incidentRecords.push(item);
      appendAuditLog(db, user, 'create', 'incident', item.id, `登记故障 ${item.title}`, projectId);
      if (item.slaStatus === '超时') createNotification(db, projectId, 'SLA 超时提醒', `${item.title} 已超时`, 'error', 'incident');
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
      if (body.title !== undefined) target.title = body.title;
      if (body.faultType !== undefined) target.faultType = body.faultType;
      if (body.severity !== undefined) target.severity = body.severity;
      if (body.slaStatus !== undefined) target.slaStatus = body.slaStatus;
      if (body.status !== undefined) target.status = body.status;
      if (body.description !== undefined) target.description = body.description;
      if (body.occurredAt !== undefined) target.occurredAt = body.occurredAt;
      if (body.resolution !== undefined) target.resolution = body.resolution;
      if (body.assetId !== undefined) target.assetId = body.assetId;
      if (user.role === 'admin' && body.projectId !== undefined) target.projectId = body.projectId;
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
      appendAuditLog(db, user, 'delete', 'incident', incidentId, `删除故障记录 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/approvals') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.approvals || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/approvals') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const approver = requireExistingUser(body.approverId, db);
      if (!approver || !canViewProject(approver, projectId) || approver.role === 'customer') return json(res, 400, { message: '审批人不存在或无权限审批当前项目' });
      const customer = requireExistingUser(body.customerId, db);
      if (!customer || customer.projectId !== projectId || customer.role !== 'customer') return json(res, 400, { message: '甲方客户不存在或不属于当前项目' });
      const item = { id: id('approval'), projectId, category: body.category || '', title: body.title || '', content: body.content || '', status: '待运维审批', requestedBy: user.id, approvedBy: '', approverId: approver.id, customerId: customer.id, currentStage: 'approver', relatedId: body.relatedId || '', createdAt: now(), updatedAt: now() };
      db.approvals.push(item);
      appendAuditLog(db, user, 'create', 'approval', item.id, `提交审批 ${item.title}`, projectId);
      createNotification(db, projectId, '审批待处理', `${item.title} 等待 ${approver.name} 审批`, 'warning', 'approval');
      await writeDb(db);
      return json(res, 201, item);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/approvals/') && pathname.endsWith('/decision')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const approvalId = pathname.split('/')[3];
      const item = (db.approvals || []).find(entry => entry.id === approvalId);
      if (!item) return json(res, 404, { message: '审批记录不存在' });
      if (!canDecideApproval(user, item)) return json(res, 403, { message: '当前账号无权处理该审批' });
      const body = await readBody(req);
      if (body.status === 'approved') {
        if (item.currentStage === 'approver') {
          item.status = '待客户确认';
          item.currentStage = 'customer';
          item.approvedBy = user.id;
          createNotification(db, item.projectId, '审批流转通知', `${item.title} 已通过运维审批，等待甲方客户确认`, 'warning', 'approval');
        } else {
          item.status = '已通过';
          item.currentStage = 'completed';
          item.approvedBy = user.id;
          createNotification(db, item.projectId, '审批结果通知', `${item.title} 已完成客户确认`, 'info', 'approval');
        }
      } else {
        item.status = '已驳回';
        item.currentStage = 'completed';
        item.approvedBy = user.id;
        item.rejectionReason = body.reason || '';
        createNotification(db, item.projectId, '审批结果通知', `${item.title} 已驳回${item.rejectionReason ? '：' + item.rejectionReason : ''}`, 'warning', 'approval');
      }
      item.updatedAt = now();
      if (body.relatedType === 'changeRecord' || item.category === 'change') {
        const target = (db.changeRecords || []).find(entry => entry.id === item.relatedId);
        if (target) { target.status = item.status; target.rejectionReason = item.rejectionReason || ''; }
      }
      appendAuditLog(db, user, 'decision', 'approval', item.id, `${item.title} ${item.status}`, item.projectId);
      await writeDb(db);
      return json(res, 200, item);
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/targets') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const assetVersionMap = new Map((db.assets || []).map(item => [item.id, item.version || '']));
      const list = filterByProjectScope(db.aiInspectionTargets || [], user, item => item.projectId)
        .map(item => sanitizeAiInspectionTarget({ ...item, systemVersion: item.assetId && assetVersionMap.has(item.assetId) ? assetVersionMap.get(item.assetId) : item.systemVersion }));
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/targets') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const projectId = user.role === 'admin' ? body.projectId : user.projectId;
      if (!requireExistingProject(projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const asset = requireExistingAsset(body.assetId || '', db);
      if (body.assetId && (!asset || asset.projectId !== projectId)) return json(res, 400, { message: '关联资产不存在或归属不一致' });
      if (!String(body.name || '').trim() || !String(body.address || '').trim()) return json(res, 400, { message: '巡检对象名称和管理地址不能为空' });
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
      return json(res, 201, sanitizeAiInspectionTarget(item));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/ai-inspection/targets/')) {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const targetId = pathname.split('/')[4];
      const index = (db.aiInspectionTargets || []).findIndex(item => item.id === targetId);
      if (index === -1) return json(res, 404, { message: '巡检对象不存在' });
      const target = db.aiInspectionTargets[index];
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权删除该巡检对象' });
      db.aiInspectionTargets.splice(index, 1);
      db.aiInspectionTasks = (db.aiInspectionTasks || []).filter(item => item.targetId !== targetId);
      db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => item.targetId !== targetId);
      db.configBackupPlans = (db.configBackupPlans || []).filter(item => item.targetId !== targetId);
      db.configBackupRecords = (db.configBackupRecords || []).filter(item => item.targetId !== targetId);
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
      if (body.name !== undefined) target.name = String(body.name || '').trim();
      if (body.category !== undefined) target.category = ['network', 'security'].includes(body.category) ? body.category : 'server';
      if (body.address !== undefined || body.managementAddress !== undefined) {
        target.address = String(body.address || body.managementAddress || '').trim();
      }
      if (body.protocol !== undefined) {
        target.protocol = normalizeAiInspectionProtocol(body.protocol, target.category);
      }
      if (body.port !== undefined || body.managementPort !== undefined) {
        target.port = Number(body.port ?? body.managementPort ?? 0);
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
      if (body.password !== undefined) {
        target.password = encryptCredential(String(body.password || ''));
      }
      if (body.privateKey !== undefined) {
        target.privateKey = encryptCredential(String(body.privateKey || ''));
      }
      if (body.accessToken !== undefined) {
        target.accessToken = encryptCredential(String(body.accessToken || ''));
      }
      if (body.community !== undefined) {
        target.community = encryptCredential(String(body.community || ''));
      }
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
      if (user.role === 'admin' && body.projectId !== undefined) target.projectId = nextProjectId;
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
      return json(res, 200, sanitizeAiInspectionTarget(target));
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/templates') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = (db.aiInspectionTemplates || []);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/templates') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const metrics = normalizeAiInspectionMetrics(body.metrics, body.category || 'server');
      if (!metrics.length) return json(res, 400, { message: '巡检模板至少包含一个指标' });
      const item = {
        id: id('aiTpl'),
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
      appendAuditLog(db, user, 'create', 'aiInspectionTemplate', item.id, `创建智能巡检模板 ${item.name}`, user.projectId || '');
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
      const relatedTasks = (db.aiInspectionTasks || []).filter(item => item.templateId === templateId);
      if (relatedTasks.length) {
        return json(res, 400, { message: `该模板有 ${relatedTasks.length} 个关联任务，请先删除或迁移关联任务后再删除模板` });
      }
      db.aiInspectionTemplates.splice(index, 1);
      appendAuditLog(db, user, 'delete', 'aiInspectionTemplate', templateId, `删除智能巡检模板 ${target.name}`, user.projectId || '');
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
      const body = await readBody(req);
      if (body.name !== undefined) target.name = String(body.name || '').trim();
      if (body.category !== undefined) target.category = body.category;
      if (body.metrics !== undefined) {
        const metrics = normalizeAiInspectionMetrics(body.metrics, target.category || 'server');
        if (!metrics.length) return json(res, 400, { message: '巡检模板至少包含一个指标' });
        target.metrics = metrics;
      }
      if (body.description !== undefined) target.description = String(body.description || '').trim();
      appendAuditLog(db, user, 'update', 'aiInspectionTemplate', templateId, `修改智能巡检模板 ${target.name}`, user.projectId || '');
      await writeDb(db);
      return json(res, 200, target);
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/tasks') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const referenceMs = Date.now();
      const resultMap = new Map();
      let changed = false;
      (db.aiInspectionResults || []).forEach(r => resultMap.set(r.taskId, r));
      (db.aiInspectionTasks || []).forEach(task => {
        if (!task.cycle) return;
        if (task.status === '已停用' || task.status === '执行中') return;
        if (!ensureAiTaskFutureExecution(task, referenceMs)) return;
        changed = true;
        if (resultMap.has(task.id)) {
          db.aiInspectionResults = (db.aiInspectionResults || []).filter(item => item.taskId !== task.id);
          resultMap.delete(task.id);
        }
        if (task.status === '已完成' || task.status === '失败') task.status = '待执行';
      });
      if (changed) await writeDb(db, { silent: true });
      const list = filterByProjectScope(db.aiInspectionTasks || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/tasks') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const target = (db.aiInspectionTargets || []).find(item => item.id === body.targetId);
      if (!target) return json(res, 404, { message: '巡检对象不存在' });
      if (user.role !== 'admin' && target.projectId !== user.projectId) return json(res, 403, { message: '无权执行该巡检对象' });
      const template = (db.aiInspectionTemplates || []).find(item => item.id === body.templateId);
      if (!template) return json(res, 404, { message: '巡检模板不存在' });
      if (hasInvalidAiInspectionMetricValue(body.metrics)) return json(res, 400, { message: '指标值必须为有效数字' });
      const metrics = normalizeAiInspectionValues(body.metrics);
      if (!metrics.length) return json(res, 400, { message: '请填写至少一个巡检指标' });
      let executedAt = body.executedAt || now().slice(0, 16);
      const cycle = String(body.cycle || '').trim();
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
      if (body.cycle !== undefined) target.cycle = String(body.cycle || '').trim();
      if (body.status === '已停用') {
        target.status = '已停用';
      } else if (body.status === '已启用') {
        target.status = '待执行';
      } else if (body.executedAt !== undefined) {
        target.executedAt = String(body.executedAt || '').trim();
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
      if (target.cycle && target.status !== '已停用' && target.status !== '执行中' && ensureAiTaskFutureExecution(target)) {
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
      appendAuditLog(db, user, 'delete', 'aiInspectionTask', taskId, `删除智能巡检任务 ${target.title}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/config-backup/plans') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.configBackupPlans || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname === '/api/ai-inspection/config-backup/plans') {
      const user = requireEditor(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const target = (db.aiInspectionTargets || []).find(item => item.id === body.targetId);
      if (!target) return json(res, 404, { message: '巡检对象不存在' });
      if (!canManageInspectionRecord(user, target)) return json(res, 403, { message: '无权操作该巡检对象' });
      if (!target.assetId || !requireExistingAsset(target.assetId, db)) return json(res, 400, { message: '巡检对象必须关联有效资产' });
      const cycle = String(body.cycle || '').trim();
      if (!['daily', 'weekly', 'monthly', 'quarterly'].includes(cycle)) return json(res, 400, { message: '请选择备份周期' });
      const plan = {
        id: id('cfgPlan'),
        projectId: target.projectId,
        targetId: target.id,
        name: String(body.name || `${target.name} 配置备份`).trim(),
        cycle,
        executedAt: String(body.executedAt || now().slice(0, 16)).trim(),
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
      if (body.executedAt !== undefined) plan.executedAt = String(body.executedAt || '').trim();
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
      appendAuditLog(db, user, 'delete', 'configBackupPlan', plan.id, `删除配置备份计划 ${plan.name}`, plan.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/ai-inspection/config-backup/records') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.configBackupRecords || [], user, item => item.projectId)
        .map(item => ({ ...item, content: undefined }));
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'GET' && pathname.startsWith('/api/ai-inspection/config-backup/records/') && pathname.endsWith('/download')) {
      const user = requireAuth(req, res, db);
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
        const list = filterByProjectScope(db.aiInspectionResults || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'GET' && pathname.startsWith('/api/ai-inspection/results/')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const resultId = pathname.split('/')[4];
      const result = (db.aiInspectionResults || []).find(item => item.id === resultId);
      if (!result) return json(res, 404, { message: '巡检结果不存在' });
      if (user.role !== 'admin' && result.projectId !== user.projectId) return json(res, 403, { message: '无权查看该巡检结果' });
      return json(res, 200, result);
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
      db.aiInspectionTasks = (db.aiInspectionTasks || []).filter(item => item.id !== target.taskId);
      appendAuditLog(db, user, 'delete', 'aiInspectionResult', resultId, `删除智能巡检结果 ${target.level}`, target.projectId);
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/notifications') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = filterByProjectScope(db.notifications || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'POST' && pathname.startsWith('/api/notifications/') && pathname.endsWith('/read')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const notificationId = pathname.split('/')[3];
      const notification = (db.notifications || []).find(item => item.id === notificationId);
      if (!notification) return json(res, 404, { message: '通知不存在' });
      if (user.role !== 'admin' && notification.projectId !== user.projectId) return json(res, 403, { message: '无权处理该通知' });
      notification.readAt = notification.readAt || now();
      await writeDb(db);
      return json(res, 200, notification);
    }

    if (req.method === 'DELETE' && pathname === '/api/notifications/read') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const before = (db.notifications || []).length;
      if (user.role === 'admin') {
        db.notifications = (db.notifications || []).filter(item => !item.readAt);
      } else {
        db.notifications = (db.notifications || []).filter(item => !item.readAt || item.projectId !== user.projectId);
      }
      const removed = before - (db.notifications || []).length;
      await writeDb(db);
      return json(res, 200, { message: `已清除 ${removed} 条已读通知`, removed });
    }

    if (req.method === 'POST' && pathname === '/api/notifications') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!requireExistingProject(body.projectId, db)) return json(res, 400, { message: '关联项目不存在' });
      const notification = createNotification(db, body.projectId, body.title || '', body.content || '', body.level || 'info', body.category || 'manual');
      appendAuditLog(db, user, 'create', 'notification', notification.id, `发送通知 ${body.title}`, body.projectId);
      await writeDb(db);
      return json(res, 201, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/audit-logs') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const list = user.role === 'admin' ? (db.auditLogs || []) : filterByProjectScope(db.auditLogs || [], user, item => item.projectId);
      const query = Object.fromEntries(reqUrl.searchParams);
      if (!query.sortDirection) query.sortDirection = 'desc';
      const sorted = parseSortQuery(query, list, 'createdAt');
      return json(res, 200, paginateResult(sorted, query));
    }

    if (req.method === 'GET' && pathname === '/api/reports/drilldown') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const period = reqUrl.searchParams.get('period') || 'month';
      const groupBy = reqUrl.searchParams.get('groupBy') || 'customer';
      return json(res, 200, buildDrilldown(db, user, period, groupBy));
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
      const allowedKeys = ['webIdleLogoutMinutes', 'httpsLoginEnabled', 'httpsPort', 'allowRegistration', 'httpLoginDisabled', 'loginRateLimitMaxAttempts', 'loginRateLimitWindowMinutes', 'loginRateLimitLockMinutes', 'timezoneOffset'];
      const safeBody = {};
      for (const key of allowedKeys) {
        if (body[key] !== undefined) safeBody[key] = body[key];
      }
      db.systemConfig = normalizeSystemConfig({ ...db.systemConfig, ...safeBody });
      systemTimezoneOffsetMinutes = db.systemConfig.timezoneOffset;
      await applyHttpsServerConfig(db.systemConfig);
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
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) return json(res, 400, { message: '无效的上传格式' });
      const rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => {
          chunks.push(chunk);
          if (Buffer.concat(chunks).length > 2 * 1024 * 1024) {
            reject(new Error('证书文件不能超过 2MB'));
          }
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      const parts = parseMultipart(rawBody, boundary);
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
      fs.writeFileSync(httpsCertPath, certContent, 'utf8');
      fs.writeFileSync(httpsKeyPath, keyContent, 'utf8');
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

    if (req.method === 'POST' && pathname === '/api/system/import') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(res, 400, { message: '导入数据格式无效，需为有效的 JSON 对象' });
      }
      if (!Array.isArray(body.users)) {
        return json(res, 400, { message: '导入数据缺少 users 字段' });
      }
      if (body.users.length > 2000) {
        return json(res, 400, { message: '导入用户数量不能超过 2000' });
      }
      for (const key of dbCollectionKeys) {
        if (Array.isArray(body[key]) && body[key].length > 5000) {
          return json(res, 400, { message: `导入的 ${key} 数据量超过上限 5000` });
        }
      }
      const cookies = parseCookies(req);
      const sessionToken = cookies.sessionToken || '';
      const currentSession = (db.sessions || []).find(item => item.token === sessionToken) || null;
      const nextDb = buildImportedDbPreservingCurrentSession(body, user, sessionToken, currentSession);
      nextDb.systemConfig = db.systemConfig ? { ...db.systemConfig } : normalizeSystemConfig({});
      const backupFilename = `backup-before-import-${now().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(path.join(backupDir, backupFilename), JSON.stringify(serializeDbSnapshot(db), null, 2));
      appendAuditLog(nextDb, user, 'import', 'system', '', `导入系统数据，导入前备份 ${backupFilename}`);
      await writeDb(nextDb);
      await applyHttpsServerConfig(nextDb.systemConfig || {});
      return json(res, 200, { message: '数据导入成功，当前登录状态已保留', backupFilename });
    }

    if (req.method === 'POST' && pathname === '/api/system/backup') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const filename = `backup-${now().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(serializeDbSnapshot(db), null, 2));
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
      if (!body.password || !verifyPassword(body.password, user.passwordHash)) {
        return json(res, 401, { message: '管理员密码错误' });
      }
      const cookies = parseCookies(req);
      const sessionToken = cookies.sessionToken || '';
      const currentSession = (db.sessions || []).find(item => item.token === sessionToken) || null;
      const backupFilename = `backup-before-reset-${now().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(path.join(backupDir, backupFilename), JSON.stringify(serializeDbSnapshot(db), null, 2));
      const preservedHttpsConfig = normalizeSystemConfig(db.systemConfig || {});
      const nextDb = buildResetDbForNewEnvironment(user, sessionToken, currentSession);
      nextDb.systemConfig = normalizeSystemConfig({ ...nextDb.systemConfig, httpsLoginEnabled: preservedHttpsConfig.httpsLoginEnabled, httpLoginDisabled: preservedHttpsConfig.httpLoginDisabled, httpsPort: preservedHttpsConfig.httpsPort, httpsCertFilename: preservedHttpsConfig.httpsCertFilename, httpsKeyFilename: preservedHttpsConfig.httpsKeyFilename, httpsCertUploadedAt: preservedHttpsConfig.httpsCertUploadedAt, httpsKeyUploadedAt: preservedHttpsConfig.httpsKeyUploadedAt, httpsCertSubject: preservedHttpsConfig.httpsCertSubject, httpsCertIssuer: preservedHttpsConfig.httpsCertIssuer, httpsCertValidFrom: preservedHttpsConfig.httpsCertValidFrom, httpsCertValidTo: preservedHttpsConfig.httpsCertValidTo, httpsCertFingerprint256: preservedHttpsConfig.httpsCertFingerprint256, loginRateLimitMaxAttempts: preservedHttpsConfig.loginRateLimitMaxAttempts, loginRateLimitWindowMinutes: preservedHttpsConfig.loginRateLimitWindowMinutes, loginRateLimitLockMinutes: preservedHttpsConfig.loginRateLimitLockMinutes, allowRegistration: preservedHttpsConfig.allowRegistration, webIdleLogoutMinutes: preservedHttpsConfig.webIdleLogoutMinutes, timezoneOffset: preservedHttpsConfig.timezoneOffset });
      await writeDb(nextDb);
      let httpsMsg = '';
      try {
        await applyHttpsServerConfig(nextDb.systemConfig || {});
      } catch (e) {
        httpsMsg = `，HTTPS 配置应用失败：${e.message}`;
      }
      return json(res, 200, { message: `数据库已初始化，仅保留当前管理员账号${httpsMsg}`, backupFilename });
    }

    if (req.method === 'GET' && pathname === '/api/system/export') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      appendAuditLog(db, user, 'export', 'system', '', '导出系统数据');
      await writeDb(db);
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="onsite-ops-export.json"'
      }));
      return res.end(JSON.stringify(serializeDbSnapshot(db), null, 2));
    }

    if (req.method === 'GET' && pathname.startsWith('/api/system/backups/')) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const rawFilename = pathname.split('/').pop() || '';
      const filename = path.basename(decodeURIComponent(rawFilename));
      if (!filename || filename !== decodeURIComponent(rawFilename)) {
        return json(res, 400, { message: '文件名无效' });
      }
      const filePath = path.join(backupDir, filename);
      if (!filePath.startsWith(backupDir + path.sep) || !fs.existsSync(filePath)) {
        return json(res, 404, { message: '备份文件不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }));
      return fs.createReadStream(filePath).pipe(res);
    }

    if (req.method === 'GET' && pathname === '/api/reports/summary') {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const period = reqUrl.searchParams.get('period') || 'week';
      const userId = user.role === 'admin' ? reqUrl.searchParams.get('userId') || '' : user.role === 'engineer' ? user.id : '';
      const projectId = user.role === 'admin' ? reqUrl.searchParams.get('projectId') || '' : user.projectId;
      return json(res, 200, buildSummary(db, period, userId, projectId));
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/user/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const targetUserId = pathname.split('/')[4];
      const targetUser = requireExistingUser(targetUserId, db);
      if (!targetUser) return json(res, 404, { message: '用户不存在' });
      if (user.role !== 'admin' && user.role !== 'engineer') return json(res, 403, { message: '当前账号仅支持查看数据' });
      if (user.role !== 'admin' && targetUser.projectId !== user.projectId) return json(res, 403, { message: '无权查看其他人员报表' });
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildOperationalReportHtml(db, 'user', targetUserId, period);
      if (!content) return json(res, 404, { message: '报表生成失败' });
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/user/') && pathname.endsWith('/pptx')) {
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
      if (user.role !== 'admin' && targetUser.projectId !== user.projectId) {
        return json(res, 403, { message: '无权导出其他人员报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildPptxBuffer(db, targetUserId, period);
      if (!content) {
        return json(res, 404, { message: '用户不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="report-${targetUserId}.pptx"`
      }));
      return res.end(content);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/project/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[4];
      if (user.role !== 'admin' && user.projectId !== projectId) return json(res, 403, { message: '无权查看其他项目报表' });
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildOperationalReportHtml(db, 'project', projectId, period);
      if (!content) return json(res, 404, { message: '项目不存在' });
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/project/') && pathname.endsWith('/pptx')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[4];
      if (user.role !== 'admin' && user.projectId !== projectId) {
        return json(res, 403, { message: '无权导出其他项目报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildProjectPptxBuffer(db, projectId, period);
      if (!content) {
        return json(res, 404, { message: '项目不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="project-report-${projectId}.pptx"`
      }));
      return res.end(content);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/inspection/project/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[5];
      if (user.role !== 'admin' && user.projectId !== projectId) {
        return json(res, 403, { message: '无权查看其他项目巡检报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildInspectionExecutionHtml(db, projectId, period);
      if (!content) {
        return json(res, 404, { message: '项目不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/inspection/project/') && pathname.endsWith('/csv')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projectId = pathname.split('/')[5];
      if (user.role !== 'admin' && user.projectId !== projectId) {
        return json(res, 403, { message: '无权导出其他项目巡检报表' });
      }
      const period = reqUrl.searchParams.get('period') || 'month';
      const content = buildInspectionExecutionCsv(db, projectId, period);
      if (!content) {
        return json(res, 404, { message: '项目不存在' });
      }
      res.writeHead(200, buildSecurityHeaders({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="inspection-report-${projectId}.csv"`
      }));
      return res.end(content);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/ai-inspection/results/') && pathname.endsWith('/html')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const resultId = pathname.split('/')[5];
      const result = (db.aiInspectionResults || []).find(item => item.id === resultId);
      if (!result) return json(res, 404, { message: '巡检结果不存在' });
      if (user.role !== 'admin' && result.projectId !== user.projectId) {
        return json(res, 403, { message: '无权查看该巡检报告' });
      }
      const content = buildAiInspectionResultHtml(db, resultId);
      if (!content) {
        return json(res, 404, { message: '巡检报告生成失败' });
      }
      res.writeHead(200, buildSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      return res.end(content);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/reports/ai-inspection/results/') && pathname.endsWith('/pptx')) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const resultId = pathname.split('/')[5];
      const result = (db.aiInspectionResults || []).find(item => item.id === resultId);
      if (!result) return json(res, 404, { message: '巡检结果不存在' });
      if (user.role !== 'admin' && result.projectId !== user.projectId) {
        return json(res, 403, { message: '无权导出该巡检报告' });
      }
      const content = buildAiInspectionResultPptxBuffer(db, resultId);
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
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return json(res, 400, { message: '请上传升级包文件（tar.gz 格式）' });
      }
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) return json(res, 400, { message: '无效的上传格式' });
      const rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        const maxBytes = 100 * 1024 * 1024;
        let totalLength = 0;
        req.on('data', chunk => {
          totalLength += chunk.length;
          if (totalLength > maxBytes) {
            reject(new Error('升级包不能超过 100MB'));
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      const parts = parseMultipart(rawBody, boundary);
      const pkgPart = parts.find(part => part.name === 'package' && part.filename);
      if (!pkgPart) return json(res, 400, { message: '请上传升级包文件' });

      const upgradesDir = path.join(dataDir, 'upgrades');
      const pendingDir = path.join(upgradesDir, 'pending');
      fs.mkdirSync(pendingDir, { recursive: true });

      function cleanUpgradeDir(dir) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      }

      const tempArchive = path.join(upgradesDir, 'temp-upgrade.tar.gz');
      fs.writeFileSync(tempArchive, pkgPart.data);

      try {
        const fileList = execSync(`tar -tzf "${tempArchive}"`, { timeout: 10000, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
        for (const entry of fileList) {
          const normalized = entry.replace(/^\.\//, '').replace(/\/+$/, '');
          if (normalized.startsWith('/') || normalized.includes('..')) {
            try { fs.unlinkSync(tempArchive); } catch (_) {}
            return json(res, 400, { message: `升级包包含非法路径：${entry}` });
          }
        }
        execSync(`tar -xzf "${tempArchive}" -C "${pendingDir}"`, { timeout: 30000 });
      } catch (error) {
        try { fs.unlinkSync(tempArchive); } catch (_) {}
        cleanUpgradeDir(pendingDir);
        return json(res, 400, { message: `升级包解压失败：${error.message}` });
      } finally {
        try { fs.unlinkSync(tempArchive); } catch (_) {}
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
          return json(res, 400, { message: '升级包包含符号链接，拒绝解压' });
        }
      }

      if (!fs.existsSync(path.join(pendingDir, 'server.js')) ||
          !fs.existsSync(path.join(pendingDir, 'package.json')) ||
          !fs.statSync(path.join(pendingDir, 'public')).isDirectory()) {
        cleanUpgradeDir(pendingDir);
        return json(res, 400, { message: '升级包缺少必要文件（server.js / package.json / public/）' });
      }

      let upgradeVersion = 'unknown';
      try {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(pendingDir, 'package.json'), 'utf8'));
        upgradeVersion = pkgJson.version || 'unknown';
      } catch (_) {}

      fs.writeFileSync(path.join(upgradesDir, 'UPGRADE_READY'), JSON.stringify({
        version: upgradeVersion,
        timestamp: now(),
        requestedBy: user.username
      }));

      appendAuditLog(db, user, 'upgrade', 'system', '', `上传升级包 v${upgradeVersion}，将在下次容器重启后生效`);
      await writeDb(db);

      return json(res, 200, {
        message: `升级包 v${upgradeVersion} 已就绪，重启容器即可完成升级`,
        version: upgradeVersion
      });
    }

    if (req.method === 'GET' && pathname === '/api/system/upgrade/status') {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const upgradesDir = path.join(dataDir, 'upgrades');
      const readyFlag = path.join(upgradesDir, 'UPGRADE_READY');
      const pendingDir = path.join(upgradesDir, 'pending');
      const pendingVersion = fs.existsSync(path.join(pendingDir, 'package.json'))
        ? JSON.parse(fs.readFileSync(path.join(pendingDir, 'package.json'), 'utf8')).version || 'unknown'
        : null;
      const ready = fs.existsSync(readyFlag)
        ? JSON.parse(fs.readFileSync(readyFlag, 'utf8'))
        : null;
      const currentVersion = packageInfo.version;
      return json(res, 200, {
        currentVersion,
        pendingVersion,
        ready,
        hasPending: fs.existsSync(pendingDir) && fs.readdirSync(pendingDir).length > 0
      });
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error('Request error:', error.message);
    return json(res, 500, { message: '服务器内部错误' });
  }
};

const server = http.createServer(requestHandler);

const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();

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

wss.on('connection', (ws) => {
  ws.isAlive = true;
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
});

const wsHeartbeatTimer = setInterval(() => {
  const stale = [];
  for (const ws of wsClients) {
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
  const stale = [];
  for (const ws of wsClients) {
    try {
      if (ws.readyState === 1) ws.send(message);
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
  console.error(`Runtime services initialization failed: ${error.message}`);
});
runAiInspectionScheduler();
const schedulerIntervalId = setInterval(runAiInspectionScheduler, maintenanceIntervalMs);

function runAutoBackup() {
  try {
    const filename = `auto-backup-${now().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(backupDir, filename);
    if (!fs.existsSync(filePath)) {
      const db = readDbInternalSync();
      if (db) {
        fs.writeFileSync(filePath, JSON.stringify(serializeDbSnapshot(db), null, 2));
      }
    }
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(backupDir)) {
      if (!file.startsWith('auto-backup-')) continue;
      const fp = path.join(backupDir, file);
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
    }
  } catch (e) {
    console.error('Auto backup failed:', e.message);
  }
}
runAutoBackup();
const backupIntervalId = setInterval(runAutoBackup, 24 * 60 * 60 * 1000);

let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`Received ${signal}, shutting down gracefully...`);
  clearInterval(wsHeartbeatTimer);
  clearInterval(schedulerIntervalId);
  clearInterval(backupIntervalId);
  server.close(() => {
    console.error('HTTP server closed');
    if (httpsServer) {
      httpsServer.close(() => {
        console.error('HTTPS server closed');
        if (mysqlPool) { mysqlPool.end().catch(() => {}); }
        process.exit(0);
      });
    } else {
      if (mysqlPool) { mysqlPool.end().catch(() => {}); }
      process.exit(0);
    }
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, shutting down:', err);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
