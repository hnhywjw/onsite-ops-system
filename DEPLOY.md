# 驻场运维管理系统 - 安装部署说明

---

## 1. 交付物清单

| 文件名 | 用途 |
|--------|------|
| `onsite-ops-system-prod-20260702.tar.gz` | 生产部署包，含运行时全部文件 |
| `onsite-ops-system-dev-20260702.tar.gz` | 开发源码包，生产包全部 + scripts/ + .monkeycode/ + .gitignore |
| `DEPLOY.md` | 本文件 |

### 生产包内容

```
├── server.js                  # 后端主服务（4640 行单体应用）
├── public/
│   └── index.html             # 前端 SPA（纯 HTML/CSS/JS，无框架依赖）
├── package.json               # 依赖声明
├── package-lock.json          # 依赖锁定
├── Dockerfile                 # 容器镜像构建文件
├── docker-compose.yml         # Docker Compose 编排（含 MySQL 8.4）
├── pptx-template.json         # PPTX 报表导出模板
└── DEPLOY.md                  # 本文件
```

### 开发包额外内容

```
├── scripts/                   # 质量脚本
│   ├── lint.js                # 语法静态校验
│   ├── typecheck.js           # 类型检查
│   ├── regression.js          # 端到端核心回归
│   ├── e2e.js                 # 浏览器级端到端（Playwright）
│   └── smoke.js               # 冒烟测试
├── .monkeycode/               # 项目元数据与特性规格
├── .gitignore
└── .dockerignore
```

---

## 2. 环境要求

### 硬件

| 资源 | 最低 | 推荐 |
|------|------|------|
| CPU | 1 核 | 2 核 |
| 内存 | 512 MB | 2 GB |
| 磁盘 | 10 GB | 50 GB |

### 软件

| 组件 | 版本 | 说明 |
|------|------|------|
| 操作系统 | Linux x86_64 | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ |
| Node.js | 20+ | 运行时 |
| MySQL | 8.0+ | 数据库（生产必选） |
| Docker | 24.0+ | 容器运行时（使用 Compose 部署时） |
| Nginx / Caddy | 任意 | 反向代理（可选，推荐） |

### 网络端口

| 端口 | 协议 | 用途 |
|------|------|------|
| 3000 | HTTP | 应用服务（页面 + API） |
| 3443 | HTTPS | 可选，内置 HTTPS 登录专用 |
| 3306 | TCP | MySQL 数据库 |

---

## 3. 方式一：Docker Compose 部署（推荐）

### 3.1 上传解压

```bash
mkdir -p /opt/onsite-ops-system
cd /opt/onsite-ops-system
tar -xzf onsite-ops-system-prod-YYYYMMDD.tar.gz
```

### 3.2 修改数据库密码

编辑 `docker-compose.yml`，将以下值替换为你自己的强密码：

```yaml
# mysql 服务
MYSQL_ROOT_PASSWORD: Alpass@2026       # 改为你自己的 root 密码
MYSQL_PASSWORD: Alpass@2026           # 改为你自己的应用密码

# onsite-ops-system 服务
MYSQL_PASSWORD: Alpass@2026           # 与上方保持一致
```

### 3.3 启动服务

```bash
docker compose up -d --build
```

### 3.4 查看状态

```bash
# 服务状态
docker compose ps

# 实时日志
docker compose logs -f

# 健康检查
curl http://localhost:3000/api/health
```

### 3.5 停止服务

```bash
docker compose down
```

---

## 4. 方式二：手动部署

### 4.1 安装 Node.js 20+

```bash
# Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# CentOS / RHEL
dnf module install nodejs:20
```

### 4.2 解压并安装依赖

```bash
mkdir -p /opt/onsite-ops-system
cd /opt/onsite-ops-system
tar -xzf onsite-ops-system-prod-YYYYMMDD.tar.gz
npm ci --omit=dev
```

### 4.3 准备 MySQL 数据库

```sql
CREATE DATABASE IF NOT EXISTS onsite_ops_system
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'onsite_ops'@'127.0.0.1'
  IDENTIFIED BY 'Alpass@2026';

GRANT CREATE, ALTER, SELECT, INSERT, UPDATE, DELETE, INDEX
  ON onsite_ops_system.* TO 'onsite_ops'@'127.0.0.1';

FLUSH PRIVILEGES;
```

服务首次启动时会自动创建表结构和初始化数据。

### 4.4 配置环境变量

```bash
cat > /opt/onsite-ops-system/.env << 'EOF'
NODE_ENV=production
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=onsite_ops
MYSQL_PASSWORD=Alpass@2026
MYSQL_DATABASE=onsite_ops_system
ALLOW_FILE_DB_FALLBACK=false
HTTPS_PORT=3443
ENCRYPTION_KEY=your-32-byte-random-key-here
SESSION_MAX_AGE_SECONDS=604800
WS_HEARTBEAT_INTERVAL_MS=30000
BACKUP_RETENTION_DAYS=30
AUDIT_ARCHIVE_RETENTION_DAYS=180
WEB_IDLE_LOGOUT_MINUTES=30
AI_INSPECTION_INTERVAL_MS=60000
LOGIN_RATE_LIMIT_COUNT=5
LOGIN_RATE_LIMIT_WINDOW_SECONDS=600
LOGIN_LOCKOUT_SECONDS=900
EOF
```

### 4.5 创建系统服务（systemd）

```bash
cat > /etc/systemd/system/onsite-ops-system.service << 'EOF'
[Unit]
Description=驻场运维管理系统
After=network.target mysql.service

[Service]
Type=simple
User=www
WorkingDirectory=/opt/onsite-ops-system
EnvironmentFile=/opt/onsite-ops-system/.env
ExecStart=/usr/bin/node /opt/onsite-ops-system/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 创建运行用户
useradd -r -s /bin/false www
chown -R www:www /opt/onsite-ops-system

# 启用并启动
systemctl daemon-reload
systemctl enable onsite-ops-system
systemctl start onsite-ops-system
systemctl status onsite-ops-system
```

---

## 5. 反向代理配置

### 5.1 Nginx 示例

```nginx
server {
    listen 80;
    server_name ops.your-company.com;

    # 可选：重定向 HTTP 到 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ops.your-company.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 静态资源与页面
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket —— 必须透传 Upgrade / Connection 头
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
}
```

### 5.2 Caddy 示例

```
ops.your-company.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 自动处理 HTTPS 和 WebSocket 透传，无需额外配置。

---

## 6. HTTPS 登录配置

平台支持内置 HTTPS 登录服务（端口 3443），登录时下发 Secure Cookie，增强安全性。

### 启用步骤

1. 使用默认管理员账号（admin / admin123）登录系统
2. 进入「系统管理」
3. 找到「HTTPS 登录配置」区域
4. 上传证书与私钥文件
5. 打开「HTTPS 登录开关」
6. 确认服务器 `3443` 端口对外可访问

证书文件保存在 `data/https/` 目录：
- `login-cert.pem` —— 证书文件
- `login-key.pem` —— 私钥文件

---

## 7. 数据库说明

### 7.1 双模式架构

平台支持两种存储模式，通过环境变量 `ALLOW_FILE_DB_FALLBACK` 控制：

| 模式 | ALLOW_FILE_DB_FALLBACK | 存储后端 | 适用场景 |
|------|----------------------|---------|---------|
| 生产模式 | `false` | MySQL | 生产部署 |
| 文件模式 | `true` | `data/db.json` | 开发调试 / 无 MySQL 环境 |

### 7.2 自动初始化

首次连接 MySQL 时，服务会自动：
- 创建表 `app_state`（键值存储）
- 初始化默认管理员账号
- 导入 `data/db.json` 中的初始数据（如果存在）

### 7.3 数据集合（19 个）

用户、项目、资产、日志、巡检计划、巡检执行、备件、备件变动、变更记录、事件记录、审批、通知、审计日志、知识库、AI智能巡检对象、AI巡检模板、AI巡检任务、AI巡检结果、会话、系统配置、运行时状态。

### 7.4 数据库权限要求

```sql
CREATE, ALTER, SELECT, INSERT, UPDATE, DELETE, INDEX
```

---

## 8. 环境变量参考

### 8.1 数据库

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MYSQL_HOST` | `127.0.0.1` | MySQL 主机地址 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | `onsite_ops` | MySQL 用户名 |
| `MYSQL_PASSWORD` | (必填) | MySQL 密码 |
| `MYSQL_DATABASE` | `onsite_ops_system` | MySQL 数据库名 |
| `ALLOW_FILE_DB_FALLBACK` | `true` | MySQL 不可用时是否退回到 JSON 文件存储 |

### 8.2 网络

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 服务端口 |
| `HTTPS_PORT` | `3443` | 内置 HTTPS 登录端口 |

### 8.3 安全

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENCRYPTION_KEY` | 固定回退值 | AES-256-GCM 凭据加密密钥。**生产环境必须设置**，建议 32 字节随机字符串 |
| `SESSION_MAX_AGE_SECONDS` | `604800` | 会话有效期（秒），默认 7 天 |
| `LOGIN_RATE_LIMIT_COUNT` | `5` | 登录限速：时间窗口内最大尝试次数 |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `600` | 登录限速：时间窗口（秒） |
| `LOGIN_LOCKOUT_SECONDS` | `900` | 登录锁定：超限后锁定时长（秒） |

### 8.4 运维

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket 心跳间隔（毫秒），用于检测并清理僵尸连接 |
| `BACKUP_RETENTION_DAYS` | `30` | 自动备份保留天数 |
| `AUDIT_ARCHIVE_RETENTION_DAYS` | `180` | 审计日志归档保留天数 |
| `WEB_IDLE_LOGOUT_MINUTES` | `30` | 控制台空闲自动登出时间（分钟） |
| `AI_INSPECTION_INTERVAL_MS` | `60000` | AI 巡检调度器轮询间隔（毫秒） |

### 8.5 OIDC 单点登录

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OIDC_ISSUER` | (空) | OIDC 提供方 Issuer URL，例如 `https://accounts.example.com` |
| `OIDC_CLIENT_ID` | (空) | OIDC 客户端 ID |
| `OIDC_CLIENT_SECRET` | (空) | OIDC 客户端密钥 |
| `OIDC_REDIRECT_URI` | (空) | OIDC 回调地址，例如 `https://ops.your-company.com/api/auth/oidc/callback` |

以上四项全部配置后，登录页"企业SSO"按钮可用。未配置时点击提示"管理员尚未配置企业 SSO"。

OIDC 认证使用 PKCE (S256) 流程，首次登录自动创建用户（`oidc_` 前缀 + 用户名），状态直接设为 active。

### 8.6 LDAP 目录认证

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LDAP_URL` | (空) | LDAP 服务器地址，例如 `ldap://ldap.example.com:389` |
| `LDAP_BASE_DN` | (空) | LDAP 搜索基准 DN，例如 `dc=example,dc=com` |
| `LDAP_BIND_DN` | (空) | 绑定 DN（可选），不填则使用用户 DN 直接绑定 |
| `LDAP_BIND_PASSWORD` | (空) | 绑定密码（可选） |

以上 LDAP_URL 和 LDAP_BASE_DN 配置后，登录页"企业LDAP"按钮可用。内置纯 Node.js ASN.1 BER LDAP 客户端实现，无外部 LDAP 库依赖。首次认证成功自动创建用户，状态直接设为 active。

### 8.7 凭据加密说明

巡检对象（SSH 密码、私钥、API Token、SNMP Community）使用 AES-256-GCM 加密存储。API 返回凭据时统一脱敏为 `***`。解密仅在巡检执行时发生。

生产环境必须通过 `ENCRYPTION_KEY` 环境变量设置自定义密钥。如果环境变量未设置，系统使用硬编码回退值 —— 仅适合开发调试场景。

---

## 9. 备份与恢复

### 9.1 在线备份

登录后台 → 系统管理 → 点击「创建备份」

备份文件存储在 `data/backups/` 目录。

### 9.2 在线导出（JSON）

登录后台 → 系统管理 → 点击「导出数据」

导出文件包含全部业务数据（JSON 格式），可下载到本地保存。

### 9.3 在线恢复

登录后台 → 系统管理 → 点击「导入数据」→ 选择之前导出的 JSON 文件

系统会在导入前自动创建快照备份。

### 9.4 手动数据库备份（MySQL）

```bash
mysqldump -u onsite_ops -p onsite_ops_system > /backup/onsite_ops_$(date +%Y%m%d).sql
```

### 9.5 运行目录说明

| 目录 | 用途 |
|------|------|
| `data/` | 运行时数据目录 |
| `data/backups/` | 自动备份（保留 30 天） |
| `data/archive/` | 归档目录 |
| `data/archive/audit/` | 审计日志归档（180 天） |
| `data/archive/backups/` | 旧备份归档 |
| `data/https/` | HTTPS 证书文件 |

---

## 10. 默认账号与用户管理

| 账号 | 密码 | 角色 | 说明 |
|------|------|------|------|
| admin | admin123 | 管理员 | 拥有全部权限 |

上线后请立即修改默认管理员密码。

### 用户状态说明

系统用户有三种状态：

| 状态 | 含义 | 登录行为 |
|------|------|---------|
| `active` | 正常 | 允许登录 |
| `pending` | 待审批 | 拒绝登录，提示"账号尚未通过管理员审批" |
| `rejected` | 已拒绝 | 拒绝登录 |

管理员手动创建的用户默认为 active。通过自注册功能注册的用户默认为 pending，需管理员在人员管理页审批通过后方可登录。OIDC / LDAP 认证自动创建的用户直接设为 active（IdP 已验证身份）。

---

## 11. 健康检查

| 接口 | 方法 | 用途 | 响应示例 |
|------|------|------|---------|
| `/api/health` | GET | 存活检查 | `{"ok":true,"uptimeSeconds":3600}` |
| `/api/ready` | GET | 就绪检查（含 MySQL + 备份目录） | `{"ok":true,"checks":[...]}` |

Kubernetes / Docker 就绪探针示例：

```yaml
# Docker Compose
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
  interval: 30s
  timeout: 5s
  retries: 3

# Kubernetes
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
readinessProbe:
  httpGet:
    path: /api/ready
    port: 3000
  initialDelaySeconds: 10
```

---

## 12. 安全建议

### 12.1 密码策略

- 修改默认管理员密码
- MySQL 使用强密码
- 定期轮换数据库密码

### 12.2 网络安全

- 生产环境务必配置 Nginx/Caddy 反向代理，不直接暴露 Node.js 端口
- 启用 HTTPS，使用 Let's Encrypt 或企业 CA 证书
- 限制防火墙仅开放 80/443（和可选的 3443）
- WebSocket `/ws` 路径不需要独立端口，通过反向代理即可

### 12.3 会话安全

- 会话 Cookie 名称：`sessionToken`
- 有效期：7 天无操作自动过期
- HttpOnly + SameSite=Strict
- HTTPS 登录启用时下发 Secure Cookie
- 登录限速：单 IP 5 次 / 10 分钟，超限锁定 15 分钟

### 12.4 数据安全

- 每日自动备份，保留 30 天
- 审计日志归档，保留 180 天
- 容器化部署时将 `data/` 目录挂载为持久化卷

---

## 13. 升级流程

1. 导出当前数据（系统管理 → 导出数据）
2. 关闭服务
3. 备份 `data/` 目录
4. 解压新包覆盖
5. 如有数据迁移需求，启动后通过导入功能恢复数据
6. 验证 `/api/health` 和 `/api/ready`

---

## 14. 故障排查

### 服务无法启动

```bash
# 检查端口占用
ss -tlnp | grep 3000

# 检查环境变量
cat /opt/onsite-ops-system/.env

# 手动启动查看错误
cd /opt/onsite-ops-system && node server.js
```

### 数据库连接失败

```bash
# 测试 MySQL 连通性
mysql -h 127.0.0.1 -u onsite_ops -p onsite_ops_system -e "SELECT 1"

# 确认用户权限
mysql -u root -p -e "SHOW GRANTS FOR 'onsite_ops'@'127.0.0.1'"
```

### WebSocket 推送不工作

确认反向代理的 `/ws` 路径配置了 `Upgrade` 和 `Connection` 头透传（参考第 5 节）。

### 页面空白 / JS 报错

检查浏览器 Console 是否有错误。常见原因：
- 反向代理未正确设置 `X-Forwarded-Proto`
- 会话 Cookie 被浏览器阻止（SameSite 策略）
- 反向代理未转发 `/api/*` 请求

---

## 15. 后续开发

如需继续开发，使用开发源码包：

```bash
tar -xzf onsite-ops-system-dev-YYYYMMDD.tar.gz
npm install
npm start
```

质量校验命令：

```bash
npm run lint        # 语法校验
npm run typecheck   # 类型检查
npm run regression  # 核心回归（需服务运行）
npm run e2e         # 浏览器端到端（需服务运行 + Playwright）
npm run smoke       # 冒烟测试（需服务运行）
```

---

## 16. 身份认证扩展功能

### 16.1 忘记密码

登录页点击"忘记密码"进入重置流程：

1. 输入用户名 → 系统返回预置的安全问题
2. 回答安全问题 → 验证通过后设置新密码
3. 新密码不得与原密码相同
4. 重置成功后可用新密码登录

已有用户需要管理员预先为其设置安全问题。未设置安全问题的用户点击"忘记密码"时提示联系管理员重置。

### 16.2 自注册与审批

**启用条件**：管理员在系统设置的"允许自主注册"开关中开启。

自注册流程：

1. 用户点击登录页"注册账号"，填写用户名、密码、安全问题及答案
2. 系统创建用户，状态为 `pending`
3. 管理员在人员管理页面可看到"待审批"标签，点击"通过"或"拒绝"
4. 通过 → 状态变为 `active`，用户可正常登录
5. 拒绝 → 状态变为 `rejected`，用户无法登录

注册开关关闭时，"注册账号"按钮隐藏。所有注册/审批操作均写入审计日志。

### 16.3 企业 SSO（OIDC PKCE）

使用场景：对接企业内部统一认证平台。

认证流程：

1. 用户点击登录页"企业SSO"按钮
2. 系统生成 PKCE code_challenge + state，重定向到 IdP 授权页
3. 用户在 IdP 完成认证后，回跳到系统回调地址
4. 系统用 code + code_verifier 换取 access_token / id_token
5. 解析 id_token 中的 sub / preferred_username 等信息
6. 自动创建或匹配已有用户（`oidc_` 前缀），状态设为 active
7. 生成会话 Cookie，跳转到系统首页

OIDC 环境变量未全部配置时，点击"企业SSO"按钮弹出友好提示"管理员尚未配置企业 SSO"。

### 16.4 LDAP 目录认证

使用场景：对接企业内部 Active Directory 或 OpenLDAP。

认证流程：

1. 用户点击登录页"LDAP"按钮，输入域账号和密码
2. 系统连接到 LDAP 服务器
3. 如果配置了 BIND_DN，先用服务账号查询用户 DN，再用用户凭据绑定
4. 未配置 BIND_DN 时，用用户提供的凭据直接绑定
5. 认证成功后，自动创建或匹配已有用户，状态设为 active
6. 生成会话 Cookie，跳转到系统首页

LDAP 环境变量未配置时，点击"LDAP"按钮弹出友好提示。LDAP 认证使用纯 Node.js 原生实现（net/tls），完整 ASN.1 BER 编解码，10 秒连接超时。

### 16.5 Logo 方案选择

系统内置 11 个 Logo 设计方案，访问 `public/logo-selector.html` 可预览全部方案。

| 方案 | 风格 |
|------|------|
| 方案一 | 盾牌 + 服务器机架 |
| 方案二 | 圆形渐变徽标 |
| 方案三 | 现代简约风格 |
| 方案四 | 深色主题 |
| 方案五 | 六边形图标 |
| 方案六 | 蓝色调专业风格 |
| 方案七 | 几何构图 |
| 方案八 | 服务器图标 |
| 方案九 | 亮色面板 + 品牌文字（当前默认） |
| 方案十 | 渐变图标 |
| 方案十一 | 盾型面板 + ONSITE-OPS-SYSTEM 全称 |

选择方案后，需要手动替换登录页和侧边栏中的对应 SVG 代码。

### 16.6 记住用户名

登录页"记住用户名"复选框默认不勾选。勾选后用户名存入 localStorage，下次打开自动填入但保持复选框未勾选状态。清除浏览器缓存可清除记住的用户名。
