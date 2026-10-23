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

[生产部署数据库要求]
- Date: 2026-09-08
- Context: Agent 在把整库 JSON 改为 MySQL 集合表并修复分页截断时更新
- Category: 环境配置
- Instructions:
  - 服务启动依赖 MySQL，连接参数由 `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE` 提供；首次启动无业务数据时自动导入 `data/db.json`。
  - 生产默认关闭文件回退，仅 `ALLOW_FILE_DB_FALLBACK=true` 时回退 `data/db.json`；业务集合写入 `col_*` InnoDB 表，旧版 `app_state` 仅在集合表为空时迁移一次。
  - 基础数据走 `?all=1` 全量接口；智能巡检结果/报告分页（pageSize=5）。`readDb()` 走内存缓存，写入只持久化脏集合。
  - 未设置 `ENCRYPTION_KEY` 时运行时密钥写入并复用 `data/encryption.key`，避免重启后无法解密凭据。

[启动、校验与测试流程]
- Date: 2026-09-30（合并自 2026-06-19/06-20/08-19/08-20/09-12）
- Context: Agent 加固调度器健壮性时合并同类条目
- Category: 构建方法/测试方法
- Instructions:
  - 项目用 `npm start` 启动，默认监听 `3000`；生产部署通过 `docker-compose.yml` 同时启动应用与 MySQL。
  - 存活检查 `GET /api/health`；就绪检查 `GET /api/ready`（校验 MySQL 与备份目录状态）。
  - 静态校验 `npm run lint` + `npm run typecheck`；核心回归 `npm run regression`；浏览器冒烟 `npm run e2e`；发布后冒烟 `npm run smoke`，后三者都依赖本地 `3000` 服务可访问。
  - 修改 `server.js` 后必须重启 `3000` 服务再跑回归，否则命中旧进程；`npm run e2e` 必须与 `npm run regression` 顺序执行，并发会导致登录链路假失败。
  - 登录验证码为点阵 SVG，regression / e2e / smoke 用 `scripts/captcha-glyphs.js` 的 `decodeCaptchaFromSvg` 解码。
  - `server.js` 顶层 `require('./scripts/captcha-glyphs')`，`Dockerfile` 必须 `COPY scripts ./scripts`；v1.0.12 起镜像缺失 `scripts/` 会 `MODULE_NOT_FOUND` 退出并无限重启。
  - 镜像构建后校验 `docker compose exec -T <svc> node -e "console.log(require('/app/package.json').version)"`；`up` 不支持 `--no-cache`，跳过缓存用 `build --no-cache` 后 `up -d --force-recreate --no-deps`。
  - 页面版本号来自 `/api/ready` 与 `/api/system/info` 返回的 `package.json` 版本，判断升级生效以接口返回和容器内文件为准。
  - 验证落库失败回滚：非生产环境用 `FORCE_DB_WRITE_FAILURE_FILE=/path/flag npm start`，文件存在时 `writeDb` 写 MySQL 前抛错；创建文件即注入，移走即恢复，`NODE_ENV=production` 下忽略。

[回归测试的环境状态治理]
- Date: 2026-09-29（合并自 2026-09-15）
- Context: Agent 修复资产布局图问题后连续运行回归与 e2e 时发现
- Category: 排错调试
- Instructions:
  - `npm run regression` 中途失败会残留测试用户/项目/资产并连锁失败；可调用 `POST /api/system/backups/{filename}/restore` 恢复到本轮最早的 `backup-*.json`（需管理员密码与 `X-CSRF-Token`，文件名 `encodeURIComponent`）。
  - 忘记密码限流（`FP_MAX_ATTEMPTS=5`，锁 30 分钟）是内存态，连续回归会触发 429 假失败，重启 `npm start` 清零；重启后立即回归偶发 `fetch failed`，等 `/api/health` 200 后重跑。
  - `regression.js`/`e2e.js` 创建的测试项目与「AI 周期巡检回归任务」不自动清理会累积；项目筛选取登录时 `pageSize=100` 列表，库内项目接近 100 时新项目落到页外导致偶发失败。
  - `npm run e2e` 偶发 30s 超时/竞态重跑即过；AI 巡检探测处 `{ timeout: 90000 }` 被误传为第二参数。若 `data/db.json` 膨胀到数十 MB（万级通知与巡检结果），浏览器主线程会阻塞并稳定卡在导航点击，此时用独立目录复制源码后加 `MYSQL_PORT=1 ALLOW_FILE_DB_FALLBACK=true PORT=3100` 启动文件库实例，再以 `BASE_URL=http://127.0.0.1:3100` 跑 e2e 即可区分数据膨胀与代码回归。
  - 工作汇报用例按合成日期（`2099-11-*`）创建日志，清理必须按「事件+日期+用户」精确匹配，否则同名日期工时翻倍。

[数组集合原地修改必须打脏标记]
- Date: 2026-09-29
- Context: Agent 排查「新用户标记通知已读后刷新又变未读」时发现
- Category: 排错调试
- Instructions:
  - `cloneDbSnapshot` 对 `notifications`、`aiInspectionResults` 等数组集合只做浅拷贝，元素对象与内存缓存共享引用；原地修改字段（如写入 `readBy`/`hiddenBy`）后两侧对象序列化结果完全相同。
  - `collectionChanged` 因此无法靠 `JSON.stringify` 比较发现变更，写入被静默跳过、刷新即回退；此类原地修改必须显式设置元素 `_dirty = true`，由 `arrayHasDirtyItems`/`collectionDirtyItems` 识别后才落库。

[备份文件保留策略与凭据语义]
- Date: 2026-09-29
- Context: Agent 巡检测试数据残留、磁盘占用与导出凭据时发现
- Category: 运维部署
- Instructions:
  - 备份统一保留 `LOCAL_BACKUP_RETENTION_DAYS` 天（默认 180），`cleanupExpiredBackupFiles` 同时清理 `data/backups` 与 `data/archive/backups`，由每日/启动备份和每周维护触发。
  - 备份列表同时返回可恢复区与归档区文件（带 `archived`/`size`/`href`）；归档文件下载/恢复/删除需 `?archived=1` 且管理员密码二次验证。
  - `/api/system/export` 与备份下载返回完整快照（含 `passwordHash`、`snmpCommunity`、资料密钥），保证跨环境导入后账号可登录。
  - 初始化（`/api/system/reset`）清空指向已删项目的 `ssoDefaultProjectId` 并删除资料附件，均在 `writeDb` 成功后执行；导入快照（`/api/system/import`）落库成功后调用 `pruneDocumentAttachmentDirs` 清理孤儿附件目录。

[业务实体删除与通知级联]
- Date: 2026-09-29
- Context: Agent 巡检孤儿数据与通知一致性时补充
- Category: 排错调试
- Instructions:
  - 审批删除：管理员删除变更流程审批时一并删除关联变更记录、同一变更下所有审批及其通知；非管理员仅能作废自己提交、未完成且不在变更流程中的审批。
  - 变更记录删除反向级联：收集 `id===approvalId` 或 `category==='change' && relatedId===recordId` 的全部同变更审批及通知，两个方向保持一致。
  - 删除业务实体必须用 `removeNotificationsBySource(db, sourceType, sourceId)` 清理通知；所有实体通知都要打 `sourceType`/`sourceId`（`aiInspectionTask`、`configBackupPlan`、`inspectionPlan`、`asset`、`sparePart`、`changeRecord`、`approval`、`incident`、`workReport`）。
  - 智能巡检对象删除先收集其任务与配置备份计划 ID，再分别清理通知；资产删除（含 `?cascade=1`）清理 `asset` 及其派生通知；备件删除清理 `sparePart` 通知。
  - 强制删除项目（`?force=1`）级联清理 `assetRelations`（按资产 ID）并失效拓扑/流量运行时状态，落库后清理资料附件目录。
  - 历史通知缺少来源标记时运行 `node scripts/backfill-notification-sources.js`（或 `POST /api/system/backfill-notification-sources`）按内容回填，脚本幂等。

[周期计划时间校验与父记录改项目级联]
- Date: 2026-09-30
- Context: Agent 加固调度器健壮性与跨项目数据一致性时确认
- Category: 排错调试
- Instructions:
  - 周期任务/配置备份计划写入前必须用 `parseValidScheduleTime` 严格校验 `executedAt`（非法或为空即 400），区别于 `parseAiInspectionScheduleTime` 的「非法即视为立即到期」；否则调度器无法推进时间会每周期重跑。
  - 周期巡检任务的 `cycle` 仅允许 `daily/weekly/monthly/quarterly`；周期任务禁止清空计划时间。仅在显式修改 `executedAt` 时才重置历史结果，编辑标题/执行人等元数据不得清空历史。
  - 巡检/备份构建阶段抛错也要调用 `advanceAiTaskNextExecution` 推进周期；`executeAiInspectionTask` 返回 null（对象/模板已删）时标记任务「失败」+`lastError`，避免无限重试。
  - 父记录改归属项目必须同步子记录 `projectId`：巡检计划→`inspectionExecutions`；备件→`sparePartMovements`；巡检对象→派生 `aiInspectionTasks`/`aiInspectionResults`/`configBackupPlans`/`configBackupRecords`（统一用重建数组表达改动，不依赖共享引用 + `_dirty`）。
  - 对外返回对象前必须剥离内部 `_dirty` 标记（含 AI 巡检结果脱敏函数）。

[故障 SLA 人工控制与跃迁通知]
- Date: 2026-09-29
- Context: Agent 实现故障 SLA 超时补发通知时确认
- Category: 业务规则
- Instructions:
  - 故障 `slaStatus` 始终由人工维护，禁止引入自动 SLA 判定或定时改写。
  - 仅在 `slaStatus` 由「正常/预警」跃迁到「超时」时补发一次 `SLA 超时提醒`；重复提交「超时」或仅改其他字段不重复通知，恢复后再超时视为新一次跃迁。

[GitHub 推送凭据来源]
- Date: 2026-09-19
- Context: 用户提供个人 GitHub PAT 并要求后续直接使用
- Category: 环境配置
- Instructions:
  - GitHub 凭据存放在 `/root/.config/gh/hosts.yml`（位于仓库之外），`git push` 与 `gh` 经 `gh auth git-credential` 免密可用；token 值禁止写入仓库文件或在对话中回显。
  - 该 token 仅含 `repo` scope，缺少 `read:org`；仓库读写、push、release 上传正常，涉及组织数据的 `gh` 子命令可能报 scope 错误。
  - `gh auth login --with-token` 因缺少 `read:org` 失败，更新凭据直接改 `hosts.yml`；家目录随环境重建丢失时需用户重新提供 token。

[版本发布与 GitHub Release 流程]
- Date: 2026-09-30
- Context: Agent 发布 v1.0.15 时按 v1.0.14 既有产物结构复现
- Category: 运维部署/工作流协作
- Instructions:
  - 用户要求手动提交到 GitHub 时同步 bump 版本号；所有 `git push` 目标为 `main` 分支。
  - 发布前同步版本号：`package.json`、`package-lock.json`（2 处）、`README.md`（当前版本/下载链接/新增更新说明）、`PRODUCTION_DEPLOY.md`（标题/部署版本/包名/Release 链接/验收版本）；`manifest.json` 被 `.gitignore` 忽略，由构建生成，无需手改。
  - 完整安装包用平铺目录打包（不含父目录、不含 `public/downloads`）：
    `tar -czf onsite-ops-system-v<ver>-production.tar.gz --exclude=public/downloads README.md PRODUCTION_DEPLOY.md DEPLOY.md .env.production.example Dockerfile docker-compose.yml docker-compose.prod.yml docker-entrypoint.sh package.json package-lock.json server.js pptx-template.json build-upgrade.js public scripts`
  - 离线升级包用 `npm run build-upgrade` 生成（写入 `manifest.json` + `onsite-ops-upgrade-v<ver>.tar.gz`）；有 `UPGRADE_SIGNING_KEY`（≥32 位）时 manifest 带 HMAC 签名，否则输出未签名包并提示。
  - 校验和文件为两行（完整包 + 升级包）：`sha256sum <production.tar.gz> <upgrade.tar.gz> > onsite-ops-system-v<ver>.sha256`。
  - `*.tar.gz` 被 `.gitignore` 忽略，产物作为 GitHub Release 资产上传，不提交进仓库；`.sha256` 文件同样仅作发布资产。
  - 推送：`git push origin HEAD:main`，再 `git push origin v<ver>`。
  - 创建 Release：`gh release create v<ver> --repo hnhywjw/onsite-ops-system --title "..." --notes-file <notes.md> <production.tar.gz> <upgrade.tar.gz> <sha256>`。
  - Release Notes 必须含更新内容、交付物与 SHA256、环境要求、Docker Compose 安装、反向代理示例、手动部署、升级部署（含签名要求）与验收清单；用 `gh release edit v<ver> --notes-file <notes.md>` 更新。文档中引用的包文件名版本号必须与当前发布版本一致。

[全量开发包与私有仓库]
- Date: 2026-09-30
- Context: Agent 按要求导出可再次导入开发平台的全量包并上传 GitHub
- Category: 运维部署/工作流协作
- Instructions:
  - 全量开发包含源码、`.git`、`.monkeycode`、`node_modules`、MySQL 导出、`data/db.json` 与密钥；排除 `data/backups`、`data/archive`、`public/downloads`、历史 `onsite-ops-*.tar.gz`/`.sha256`。
  - 因含数据库导出与密钥，只上传到**私有仓库** `hnhywjw/onsite-ops-system-devbox`，不得上传公开仓库；空仓库需先推 README 初始化 `main`，否则 `gh release create` 报 422。
