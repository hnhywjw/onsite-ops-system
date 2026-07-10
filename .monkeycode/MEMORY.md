# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[GitHub 手动提交版本号同步]
- Date: 2026-07-09
- Context: 用户说明手动提交到 GitHub 时的版本管理要求
- Category: 工作流协作
- Instructions:
  - 每次用户要求手动提交到 GitHub 时，需要同步修改项目版本号。

[生产部署数据库要求]
- Date: 2026-06-19
- Context: Agent 在执行 MySQL 存储改造与生产收敛时更新
- Category: 环境配置
- Instructions:
  - 服务启动依赖 MySQL，连接参数通过 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 提供。
  - 首次启动时若 MySQL 中无业务数据，系统会自动导入 `data/db.json` 作为初始数据。
  - 生产环境默认关闭文件存储回退，仅在 `ALLOW_FILE_DB_FALLBACK=true` 时才允许回退到 `data/db.json`。

[项目启动方式]
- Date: 2026-06-19
- Context: Agent 在执行驻场运维管理系统 MySQL 改造后更新
- Category: 构建方法
- Instructions:
  - 项目使用 `npm start` 启动 Node 服务。
  - 默认监听端口为 `3000`。
  - 生产部署默认通过 `docker-compose.yml` 同时启动应用和 MySQL。

[项目校验命令]
- Date: 2026-06-20
- Context: Agent 在执行平台全面检查与浏览器级 E2E 补充时更新
- Category: 测试方法
- Instructions:
  - 语法与静态校验使用 `npm run lint` 和 `npm run typecheck`。
  - 端到端核心回归使用 `npm run regression`，依赖本地 `3000` 端口服务可访问。
  - 浏览器级冒烟使用 `npm run e2e`，依赖本地 `3000` 端口服务可访问。
  - 发布后自动化冒烟使用 `npm run smoke`，用于快速校验健康检查、登录态和核心读取接口。

[健康检查接口]
- Date: 2026-06-20
- Context: Agent 在补充生产可用性保障时发现
- Category: 排错调试
- Instructions:
  - 存活检查使用 `GET /api/health`。
  - 就绪检查使用 `GET /api/ready`，会校验 MySQL 与备份目录状态。

[Git 推送目标分支]
- Date: 2026-07-02
- Context: 用户指定 GitHub 推送目标分支
- Category: 工作流协作
- Instructions:
  - 所有 git push 操作必须推送到 `main` 分支，不要使用 `master`。
