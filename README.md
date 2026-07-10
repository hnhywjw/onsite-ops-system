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

当前版本：`1.0.1`
