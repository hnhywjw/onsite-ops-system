# 驻场运维管理系统 v1.0.2 生产安装部署说明

本文档用于在生产环境部署 `onsite-ops-system-v1.0.2`。

## 1. 交付物

生产部署包：`onsite-ops-system-v1.0.2-production.tar.gz`

包内核心文件：

```text
README.md
PRODUCTION_DEPLOY.md
.env.production.example
Dockerfile
docker-compose.prod.yml
package.json
package-lock.json
server.js
public/index.html
pptx-template.json
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
| 3306 | MySQL | 仅容器内网络访问 |

## 3. 推荐部署方式：Docker Compose

### 3.1 上传并解压

```bash
mkdir -p /opt/onsite-ops-system
cd /opt/onsite-ops-system
tar -xzf onsite-ops-system-v1.0.2-production.tar.gz
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
```

密码要求：至少 8 位，包含字母、数字和特殊字符。

`ENCRYPTION_KEY` 与 `UPGRADE_SIGNING_KEY` 建议使用 32 位以上随机字符串。示例生成命令：

```bash
openssl rand -base64 32
```

默认 `APP_BIND=127.0.0.1`，应用只监听宿主机本机地址，生产建议通过反向代理对外提供 HTTPS 服务。需要临时直连访问时，可显式设置 `APP_BIND=0.0.0.0`。

Docker Compose 默认使用 `app-data` 命名卷保存应用运行数据，避免宿主机 `./data` 目录权限导致容器内 `node` 用户无法写入。

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
tar -xzf onsite-ops-system-v1.0.2-production.tar.gz
```

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
- 系统版本显示为 `v1.0.2`
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

### 9.2 `/api/ready` 返回 503

检查 MySQL 连接、`app-data` 命名卷和应用日志。

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

## 10. 回滚

保留旧版本目录时，可切回旧目录并重启服务。

Docker Compose 部署可使用历史备份恢复 MySQL 数据卷和 `app-data` 应用数据卷，然后重新执行：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```
