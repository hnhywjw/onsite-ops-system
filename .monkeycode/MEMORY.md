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
- Date: 2026-09-08
  - Context: Agent 在把整库 JSON 改为 MySQL 集合表，并修复基础数据分页截断时更新
  - Category: 环境配置
  - Instructions:
    - 服务启动依赖 MySQL，连接参数通过 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 提供。
    - 首次启动时若 MySQL 中无业务数据，系统会自动导入 `data/db.json` 作为初始数据。
  - 生产环境默认关闭文件存储回退，仅在 `ALLOW_FILE_DB_FALLBACK=true` 时才允许回退到 `data/db.json`。
  - 业务集合写入 `col_*` InnoDB 表；旧版 `app_state` 仅在集合表为空时迁移一次。
  - 前端基础数据加载走 `?all=1` 全量接口；智能巡检结果/报告改为分页接口（pageSize=5），避免一次拉取数万条结果。
  - `readDb()` 使用内存缓存，命中后不再全表读取 MySQL，也不再对整库 `JSON.stringify`；写入只持久化脏集合。
  - 未设置 `ENCRYPTION_KEY` 时，运行时密钥会写入并复用 `data/encryption.key`，避免重启后无法解密凭据。

[项目启动方式]
- Date: 2026-06-19
- Context: Agent 在执行驻场运维管理系统 MySQL 改造后更新
- Category: 构建方法
- Instructions:
  - 项目使用 `npm start` 启动 Node 服务。
  - 默认监听端口为 `3000`。
  - 生产部署默认通过 `docker-compose.yml` 同时启动应用和 MySQL。

[项目校验命令]
- Date: 2026-09-12
  - Context: Agent 在收尾审查修复并同步点阵验证码测试解码时更新
  - Category: 测试方法
  - Instructions:
    - 语法与静态校验使用 `npm run lint` 和 `npm run typecheck`。
    - 端到端核心回归使用 `npm run regression`，依赖本地 `3000` 端口服务可访问。
    - 浏览器级冒烟使用 `npm run e2e`，依赖本地 `3000` 端口服务可访问。
    - 发布后自动化冒烟使用 `npm run smoke`，用于快速校验健康检查、登录态和核心读取接口。
    - 登录验证码为点阵 SVG，regression / e2e / smoke 使用 `scripts/captcha-glyphs.js` 的 `decodeCaptchaFromSvg` 解码。

[健康检查接口]
- Date: 2026-06-20
- Context: Agent 在补充生产可用性保障时发现
- Category: 排错调试
- Instructions:
  - 存活检查使用 `GET /api/health`。
  - 就绪检查使用 `GET /api/ready`，会校验 MySQL 与备份目录状态。

[回归前服务重启要求]
- Date: 2026-08-19
- Context: Agent 在补充工作汇报提醒回归时发现
- Category: 排错调试
- Instructions:
  - 修改 `server.js` 后需要重启 `npm start` 对应的 `3000` 端口服务，再运行 `npm run regression`，否则回归会继续命中旧进程。

[端到端测试执行顺序]
- Date: 2026-08-20
- Context: Agent 在执行平台新增功能与整体回归检查时发现
- Category: 测试方法
- Instructions:
  - `npm run e2e` 需要与 `npm run regression` 顺序执行，避免并发运行导致浏览器登录链路超时并产生假失败。

[Git 推送目标分支]
- Date: 2026-07-02
- Context: 用户指定 GitHub 推送目标分支
- Category: 工作流协作
- Instructions:
  - 所有 git push 操作必须推送到 `main` 分支，不要使用 `master`。

[回归测试的环境状态治理]
- Date: 2026-09-15
- Context: Agent 修复资产布局图问题后连续运行回归与 e2e 时发现
- Category: 排错调试
- Instructions:
  - `npm run regression` 中途失败会残留测试用户/项目/资产，多次中断会污染库并让后续断言连锁失败；此时可登录后调用 `POST /api/system/backups/{filename}/restore`，恢复到 `data/backups` 下本轮最早的 `backup-*.json` 快照（回归脚本在用例前会创建一次 `backup-*.json`，即本轮最干净的基线）。
  - 恢复接口需要管理员二次验证与 CSRF：请求体传 `{"password":"Admin123!"}`，请求头带登录响应返回的 `csrfToken`（`X-CSRF-Token`），文件名需 `encodeURIComponent`（含 `+` 时尤其重要）。
  - 忘记密码限流（`FP_MAX_ATTEMPTS=5`，锁 30 分钟）是内存态，短时间连续多次运行回归会触发 429 假失败；重启 `npm start` 服务即可清零。
  - `npm run e2e` 的自动登出提示断言存在竞态，偶发失败时重跑一次即可确认。
