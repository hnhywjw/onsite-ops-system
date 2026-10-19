# 驻场运维管理系统 v1.0.21 生产安装部署说明

本文档用于在生产环境部署 `onsite-ops-system-v1.0.21`。

## 1. 交付物

完整安装包：`onsite-ops-system-v1.0.21-production.tar.gz`

离线升级包：`onsite-ops-upgrade-v1.0.21.tar.gz`

GitHub Release：https://github.com/hnhywjw/onsite-ops-system/releases/tag/v1.0.21

包内核心文件：

```text
README.md
PRODUCTION_DEPLOY.md
DEPLOY.md
.env.production.example
Dockerfile
docker-compose.yml
docker-compose.prod.yml
docker-entrypoint.sh
package.json
package-lock.json
server.js
public/
scripts/
pptx-template.json
build-upgrade.js
```

## 2. 环境要求

推荐配置：

| 项目 | 建议 |
| --- | --- |
| CPU | 2 核及以上 |
| 内存 | 2 GB 及以上 |
| 磁盘 | 50 GB 及以上 |
| 操作系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ |
| Docker | 24+ |
| Docker Compose | v2 |
| Node.js | 20+，仅手动部署需要 |
| MySQL | 8.x，Docker Compose 部署会自动拉起 |

端口规划：

| 端口 | 用途 | 暴露建议 |
| --- | --- | --- |
| 3000 | 应用 HTTP 服务 | 通过反向代理暴露 |
| 3443 | HTTPS 登录服务 | 按需暴露，用于 Secure Cookie 登录 |
| 3306 | MySQL | 仅容器内网络访问 |

## 3. 推荐部署方式：Docker Compose

### 3.1 上传并解压

```bash
mkdir -p /opt/onsite-ops-system
cd /opt/onsite-ops-system
tar -xzf onsite-ops-system-v1.0.21-production.tar.gz
```

### 3.1.1 创建数据目录并授权

容器以 `node` 用户（UID 1000）运行，bind mount 的 `./data` 目录需要预先创建并授权：

```bash
mkdir -p ./data
chown 1000:1000 ./data
```

若已有旧数据目录，也需确保权限一致：

```bash
chown -R 1000:1000 ./data
```

### 3.2 准备生产环境变量

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`，至少替换以下值：

```text
MYSQL_ROOT_PASSWORD=replace-with-strong-root-password
MYSQL_PASSWORD=replace-with-strong-app-password
INITIAL_ADMIN_PASSWORD=replace-with-admin-password
INITIAL_ENGINEER_PASSWORD=replace-with-engineer-password
INITIAL_ADMIN_SECURITY_ANSWER=replace-with-admin-security-answer
INITIAL_ENGINEER_SECURITY_ANSWER=replace-with-engineer-security-answer
ENCRYPTION_KEY=replace-with-at-least-32-chars-random-key
UPGRADE_SIGNING_KEY=replace-with-at-least-32-chars-random-key
DOCUMENT_TOKEN_SECRET=replace-with-at-least-32-chars-random-key
DOCUMENT_ATTACHMENT_LIMIT_BYTES=10485760
DOCUMENT_QUOTA_PER_USER_BYTES=209715200
DOCUMENT_QUOTA_PER_PROJECT_BYTES=2147483648
INSPECTION_ATTACHMENT_QUOTA_PER_USER_BYTES=104857600
INSPECTION_ATTACHMENT_QUOTA_PER_PROJECT_BYTES=1073741824
```

密码要求：至少 8 位，包含字母、数字和特殊字符。

`ENCRYPTION_KEY`、`UPGRADE_SIGNING_KEY` 与 `DOCUMENT_TOKEN_SECRET` 必须使用 32 位以上随机字符串，生产环境缺失或长度不足会拒绝启动。示例生成命令：

```bash
openssl rand -base64 32
```

附件配额按字节配置，默认单个附件 10MB、个人资料累计 200MB、项目资料累计 2GB、个人巡检附件累计 100MB、项目巡检附件累计 1GB，可按实际磁盘容量调整。

应用默认监听 `0.0.0.0:3000`，可通过 `APP_BIND` 和 `APP_PORT` 环境变量调整。数据目录默认使用 bind mount 映射到宿主机 `./data/` 目录，启动后可直接在宿主机查看备份、证书等运行时文件。

### 3.3 启动服务

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

### 3.4 查看服务状态

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

### 3.5 查看启动日志

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f onsite-ops-system
```

### 3.6 健康检查

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/ready
```

期望返回：

```json
{"ok":true}
```

`/api/ready` 会额外检查 MySQL 与数据目录状态。

## 4. 反向代理配置

生产建议使用 Nginx 或 Caddy 终止 HTTPS，再转发到 `127.0.0.1:3000`。

Nginx 示例：

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

启用 HTTPS 后，请确保反向代理传递 `X-Forwarded-Proto: https`，系统会据此派发 Secure Cookie。

## 5. 手动 Node.js 部署

### 5.1 安装依赖

```bash
cd /opt/onsite-ops-system
npm ci --omit=dev
```

### 5.2 准备 MySQL

```sql
CREATE DATABASE IF NOT EXISTS onsite_ops_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'onsite_ops'@'127.0.0.1' IDENTIFIED BY 'replace-with-strong-app-password';
GRANT CREATE, ALTER, SELECT, INSERT, UPDATE, DELETE, INDEX ON onsite_ops_system.* TO 'onsite_ops'@'127.0.0.1';
FLUSH PRIVILEGES;
```

### 5.3 配置环境变量

```bash
export NODE_ENV=production
export PORT=3000
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=onsite_ops
export MYSQL_PASSWORD=replace-with-strong-app-password
export MYSQL_DATABASE=onsite_ops_system
export ALLOW_FILE_DB_FALLBACK=false
export INITIAL_ADMIN_PASSWORD=replace-with-admin-password
export INITIAL_ENGINEER_PASSWORD=replace-with-engineer-password
export INITIAL_ADMIN_SECURITY_ANSWER=replace-with-admin-security-answer
export INITIAL_ENGINEER_SECURITY_ANSWER=replace-with-engineer-security-answer
export ENCRYPTION_KEY=replace-with-at-least-32-chars-random-key
export UPGRADE_SIGNING_KEY=replace-with-at-least-32-chars-random-key
# 反向代理与系统不在同一主机/容器时填写代理出口 IP 或 CIDR（逗号分隔）
export TRUSTED_PROXY_IPS=
```

### 5.4 启动

```bash
npm start
```

## 6. systemd 托管示例

创建环境文件：

```bash
mkdir -p /etc/onsite-ops-system
cp /opt/onsite-ops-system/.env.production.example /etc/onsite-ops-system/onsite-ops-system.env
```

编辑 `/etc/onsite-ops-system/onsite-ops-system.env`，填入生产变量。

准备运行数据目录并授权给服务用户：

```bash
mkdir -p /opt/onsite-ops-system/data
chown -R www-data:www-data /opt/onsite-ops-system/data
```

创建服务文件：

```ini
[Unit]
Description=Onsite Ops System
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/opt/onsite-ops-system
EnvironmentFile=/etc/onsite-ops-system/onsite-ops-system.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
systemctl daemon-reload
systemctl start onsite-ops-system
systemctl status onsite-ops-system
```

## 7. 升级部署

### 7.1 备份当前数据

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec onsite-ops-system node -e "console.log('请在系统治理页面执行系统备份')"
```

也可以直接备份部署目录中的 `data/` 和 MySQL 数据卷。

### 7.2 替换应用文件

```bash
cd /opt/onsite-ops-system
tar -xzf onsite-ops-system-v1.0.21-production.tar.gz
```

从 v1.0.8 及更早版本升级时，页面升级入口只接受旧格式压缩包，须按本节用完整安装包替换文件，再执行 7.3 重建镜像。仅执行 `docker compose restart` 会继续使用旧镜像，页面版本不会变化。

### 7.2.1 使用离线升级包

已运行的系统可在「系统治理」页面上传 `onsite-ops-upgrade-v1.0.21.tar.gz`。

GitHub 提供的升级包含 `manifest.json` 与 SHA256 清单。生产环境上传前，须用本机 `UPGRADE_SIGNING_KEY`（不少于 32 位）重新执行 `npm run build-upgrade`，生成带 HMAC 签名的包。页面会轮询 `/api/system/upgrade/status`，容器重启后由 `docker-entrypoint.sh` 替换 `server.js`、`public/`、`scripts/` 等文件。

手动准备签名升级包时，可在解压后的安装目录执行：

```bash
UPGRADE_SIGNING_KEY='生产环境密钥' npm run build-upgrade
```

签名密钥的取值、构建参数、包结构与校验规则见 `UPGRADE_GUIDE.md`。

### 7.3 重建并重启

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

### 7.4 验证

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/ready
```

## 8. 验收检查清单

部署后建议逐项确认：

- 首页可访问
- 管理员账号可登录
- `/api/health` 返回正常
- `/api/ready` 返回正常
- 系统版本显示为 `v1.0.21`
- 项目、资产、日志页面可读取数据
- 自动化巡检页面可打开
- 配置备份页面可打开
- 资料管理页面可打开
- 系统治理里的备份功能可用

## 9. 常见问题

### 9.1 启动时报“生产配置不安全”

说明生产必需变量未配置或强度不足。检查：

- `MYSQL_PASSWORD`
- `INITIAL_ADMIN_PASSWORD`
- `INITIAL_ENGINEER_PASSWORD`
- `INITIAL_ADMIN_SECURITY_ANSWER`
- `INITIAL_ENGINEER_SECURITY_ANSWER`
- `ENCRYPTION_KEY`
- `UPGRADE_SIGNING_KEY`
- `DOCUMENT_TOKEN_SECRET`

### 9.2 `/api/ready` 返回 503

检查 MySQL 连接、`./data/` 目录权限和应用日志。

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs mysql
docker compose --env-file .env.production -f docker-compose.prod.yml logs onsite-ops-system
```

### 9.3 HTTPS 后登录态异常

确认反向代理传递：

```text
X-Forwarded-Proto: https
```

### 9.4 配置备份 CLI 执行失败

确认目标命令在 `CONFIG_BACKUP_ALLOWED_COMMANDS` 白名单中。

### 9.5 HTTPS 登录(3443)无法访问

确认防火墙已放行 3443 端口，docker-compose.prod.yml 已映射该端口。

## 10. 回滚

保留旧版本目录时，可切回旧目录并重启服务。

Docker Compose 部署可使用历史备份恢复 MySQL 数据卷和 `./data/` 目录，然后重新执行：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## 11. 动态令牌二次认证

动态令牌按账号可选启用，启用后登录需要依次通过密码、图形验证码和身份验证器动态码。

- 启用方式：登录后点击左侧「账号安全」，输入当前密码开始绑定，使用 Google Authenticator、Microsoft Authenticator 等身份验证器扫描二维码，输入动态码确认
- 恢复码：启用成功后会一次性展示 10 个恢复码，每个只能使用一次；身份验证器丢失时可使用恢复码登录
- 关闭方式：在「账号安全」中输入当前动态码和当前密码；LDAP 账号只需动态码
- 管理员要求：人员管理的新增或修改人员表单可勾选「要求该账号启用动态令牌」，勾选后该账号下次登录时必须先完成绑定，未绑定前只能访问绑定相关接口
- 管理员重置：人员管理列表的「重置令牌」需要管理员密码二次确认；已被要求启用的账号重置后需重新绑定
- 状态查看：人员列表「动态令牌」列显示已启用、未启用或待绑定
- 企业 SSO 账号的二次认证由身份提供方负责，本地不提供绑定入口

`ENCRYPTION_KEY` 同时用于加密动态令牌密钥。更换该密钥会导致既有动态令牌无法解密，相关账号需由管理员重置后重新绑定，请在生产环境固定并妥善备份 `ENCRYPTION_KEY`。

## 12. 敏感操作二次确认

系统备份创建、数据导出、备份下载、备份恢复与备份删除均要求管理员密码二次确认，并写入操作日志。

- 入口：系统管理页「升级与备份」子标签下的管理员密码输入框
- 失败限制：同一管理员账号在 15 分钟内连续 5 次密码校验失败将锁定 5 分钟
- 审计：认证事件（登录成功、登录失败、退出登录、OIDC 单点登录）与备份导出下载均记录来源 IP 与 User-Agent，可在「操作日志」按动作筛选

`DOCUMENT_TOKEN_SECRET` 用于签发资料访问令牌。未设置时会从 `ENCRYPTION_KEY` 派生独立子密钥；显式设置后更换该值会使已签发的资料访问链接立即失效，需要重新打开资料。
