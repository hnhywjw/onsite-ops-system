# 驻场运维管理系统

驻场运维管理系统是一套面向项目驻场、资产台账、运维记录、自动化巡检、配置备份、资料管理和系统治理的轻量级 Web 应用。

## 功能概览

- 首页仪表板：项目、资产、日志、告警和系统状态概览
- 项目管理：客户项目、合同、服务周期和到期提醒
- 人员管理：管理员与工程师账号、项目权限、密码找回
- 资产管理：设备资产、型号版本、维保状态和关联项目
- 运维日志：日常巡检、故障处理、变更记录和审计追踪
- AI 智能巡检：巡检对象、任务计划、执行记录、HTML/PPT 报告
- 配置备份：CLI/Web 备份计划、备份记录、下载和清理
- 资料管理：设备资料、附件、访问密码、下载审计
- 系统治理：备份恢复、导入导出、系统升级、服务状态、健康检查

## 技术栈

- 后端：Node.js 原生 HTTP 服务
- 前端：单页 HTML/CSS/JavaScript
- 数据库：MySQL 8.x，支持开发环境文件存储回退
- 实时能力：WebSocket
- 部署：Docker Compose 或手动 Node.js 部署

## 目录结构

```text
.
├── README.md                    # 项目说明
├── PRODUCTION_DEPLOY.md         # 生产安装部署说明
├── .env.production.example      # 生产环境变量模板
├── Dockerfile                   # 容器镜像构建
├── docker-compose.prod.yml      # 生产 Docker Compose 编排
├── package.json                 # 项目脚本与依赖
├── package-lock.json            # 依赖锁定
├── server.js                    # 后端主服务与 API
├── public/index.html            # 前端单页应用
└── pptx-template.json           # PPTX 报告模板
```

## 本地运行

```bash
npm install
npm start
```

默认访问地址：`http://localhost:3000`

## 源码仓库常用校验命令

生产部署包仅包含运行文件，自动化校验脚本位于源码仓库 `scripts/` 目录。

```bash
npm run lint
npm run typecheck
npm run smoke
npm run regression
npm run e2e
```

需要指定测试地址时：

```bash
BASE_URL=http://localhost:3000 npm run smoke
BASE_URL=http://localhost:3000 npm run regression
BASE_URL=http://localhost:3000 npm run e2e
```

## 健康检查

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

## 生产部署

推荐使用 Docker Compose：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

生产环境必须配置强密码和密钥，重点环境变量包括：

- `MYSQL_PASSWORD`
- `INITIAL_ADMIN_PASSWORD`
- `INITIAL_ENGINEER_PASSWORD`
- `INITIAL_ADMIN_SECURITY_ANSWER`
- `INITIAL_ENGINEER_SECURITY_ANSWER`
- `ENCRYPTION_KEY`
- `UPGRADE_SIGNING_KEY`

完整部署步骤见 `PRODUCTION_DEPLOY.md`。

## 安全说明

- 登录态使用 HttpOnly Cookie
- 前端请求自动携带 CSRF Token
- 生产模式强制校验初始密码、安全答案和加密密钥
- 系统升级包支持 HMAC 签名与 SHA256 校验
- Web 配置备份包含 SSRF 防护
- CLI 配置备份使用命令白名单控制

## 版本

当前版本：`1.0.4`

### 软件包下载

最新版本：**[v1.0.4 - 部署配置优化](https://github.com/hnhywjw/onsite-ops-system/releases/tag/v1.0.4)**

下载 `onsite-ops-system-v1.0.4-production.tar.gz` 后解压即可部署，SHA256 校验文件随 Release 一同提供。

### v1.0.4 更新说明

部署优化：
- docker-compose.prod.yml 默认 APP_BIND 改为 0.0.0.0，外部可直接访问
- 新增 HTTPS 3443 端口映射，支持 HTTPS 登录服务外部访问
- 数据卷由 Docker 命名卷改为 bind mount (./data:/app/data)，宿主机可直接查看和管理数据
- 新增 HTTPS_PORT 环境变量支持

### v1.0.3 更新说明

新增功能：
- 首页仪表板显示当前在线人数，鼠标悬停查看在线用户列表（姓名/用户名/角色）
- 在线人数按 userId 去重，过滤非活跃和无效用户

### v1.0.2 版本说明

基于 v1.0.1 进行全面安全加固并新增生产级 Docker Compose 部署方案。

安全修复 (20 项)：
- IP 校验补全 CGNAT/IETF 协议保留/文档/测试网段，修复 IPv6 Teredo 精确匹配
- probeHostReachable/executeSSHCheck 命令注入防御 (execFile)
- normalizeDb 角色白名单 (admin/engineer/viewer/auditor/customer)
- 服务器入口密码改用 scrypt 并启用 crypto.timingSafeEqual 防时序攻击
- sanitizeUploadFilename 路径穿越防御
- 全局 uncaughtException/unhandledRejection 异常处理器
- 系统设置 POST 8 字段白名单验证
- 文档详情/下载端点 HMAC token 校验 (签名+ID 绑定+10 分钟过期)
- XSS 防护 (textContent 替换 innerHTML)，Cookie Secure 条件设置
- 注册接口 + 前端注册表单 CAPTCHA 验证码
- gracefulShutdown 可重入保护
- 启动时清理遗留 sshpass 临时文件

新增生产支持：
- Dockerfile (npm ci 可复现构建 + 系统工具依赖)
- docker-compose.prod.yml (MySQL 8.4 编排 + 健康检查)
- .env.production.example (28 项环境变量模板)
- PRODUCTION_DEPLOY.md (完整部署文档)
