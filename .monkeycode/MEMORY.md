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
- Date: 2026-09-29（合并自 2026-09-15）
- Context: Agent 修复资产布局图问题后连续运行回归与 e2e 时发现
- Category: 排错调试
- Instructions:
  - `npm run regression` 中途失败会残留测试用户/项目/资产，多次中断会污染库并让后续断言连锁失败；此时可登录后调用 `POST /api/system/backups/{filename}/restore`，恢复到 `data/backups` 下本轮最早的 `backup-*.json` 快照（回归脚本在用例前会创建一次 `backup-*.json`，即本轮最干净的基线）。
  - 恢复接口需要管理员二次验证与 CSRF：请求体传 `{"password":"Admin123!"}`，请求头带登录响应返回的 `csrfToken`（`X-CSRF-Token`），文件名需 `encodeURIComponent`（含 `+` 时尤其重要）。
  - 忘记密码限流（`FP_MAX_ATTEMPTS=5`，锁 30 分钟）是内存态，短时间连续多次运行回归会触发 429 假失败；重启 `npm start` 服务即可清零。
  - `npm run regression` 若紧随 `npm start` 重启后立即运行，偶发在最早期请求直接报 `fetch failed`（连接竞态）；等待 `GET /api/health` 返回 200 后重跑即过。
  - `scripts/regression.js` 与 `scripts/e2e.js` 创建的测试项目、`AI 周期巡检回归任务` 等不在用例结束时清理，会随每次运行累积；项目筛选选项来自登录时 `pageSize=100` 的列表，库内项目接近或超过 100 时新建项目会落到该页之外导致偶发失败。排障前先核对库内高频测试名（如「AI 周期巡检回归任务」「布局隔离项目」「提醒回归项目」「时区提醒项目」）规模。
  - `npm run e2e` 有多处偶发 30s 超时/竞态，均由测试数据累积拖慢渲染或登录自动登出竞态引起，重跑一次即可确认、与本轮业务代码无关：自动登出提示断言、`selectOption('#workReportFilterProject')`、`page.click('#refreshWorkloadBtn')`、资料子标签点击、登录后 `page.waitForFunction`（`scripts/e2e.js:169`）；AI 巡检任务探测处 `page.waitForFunction` 的 `{ timeout: 90000 }` 被误传为第二参数，实际按默认 30s 生效。
  - `npm run e2e` 工作汇报用例按合成日期（`2099-11-*`）创建「E2E工作汇报日志」，工作量按日志聚合；日志清理必须按「事件+日期+用户」精确匹配。曾因 `cleanupData` 只删汇报不删日志、内联删除又只按事件名匹配，残留日志令同名日期工时翻倍、工作量导出断言失败。

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
  - 备份统一保留 `LOCAL_BACKUP_RETENTION_DAYS` 天（默认 180），由 `cleanupExpiredBackupFiles` 在可恢复区 `data/backups` 与归档区 `data/archive/backups` 一并清理超期文件；`runAutoBackup`（每日/启动）与 `runMaintenanceTasks`（每周）都会触发。
  - 不再有「30 天归档 + 7 天删除」的旧策略：`data/backups` 内的快照（`auto-backup-*`/`backup-before-*`/`backup-*`）满 180 天直接删除，归档区仅保留历史文件并同样按 180 天清理。
  - 备份列表 `listBackupFiles` 同时返回可恢复区与归档区文件（带 `archived`/`size`/`href`）；归档文件可下载/恢复/删除，接口需带 `?archived=1` 且管理员密码二次验证。
  - `/api/system/export` 与备份下载返回完整快照（含 `passwordHash`、`snmpCommunity`、资料密钥），与磁盘备份/恢复语义一致，保证跨环境导入后账号仍可登录；`redactSnapshotSecrets` 已移除。
  - 初始化（`/api/system/reset`）会清空指向已删项目的 `ssoDefaultProjectId` 并删除 `data/uploads/documents` 下附件，两处均在 `writeDb` 成功之后执行。
  - 导入快照（`/api/system/import`）会整体替换数据，落库成功后需调用 `pruneDocumentAttachmentDirs` 清理旧数据集残留、已不被引用的资料附件目录；凡是替换或删除数据集的路径都要同步清理 `data/uploads/documents` 下的孤儿附件目录。

[业务实体删除与通知级联]
- Date: 2026-09-29
- Context: Agent 巡检孤儿数据与通知一致性时补充
- Category: 排错调试
- Instructions:
  - 审批删除（`DELETE /api/approvals/:id`）：管理员删除变更流程审批时，一并删除关联变更记录、同一变更下的**所有**审批及二者的通知；非管理员仅能作废自己提交、未完成且不在变更流程中的审批（否则 400/403）。
  - 变更记录删除（`DELETE /api/change-records/:id`）反向级联：收集 `id===approvalId` 或 `category==='change' && relatedId===recordId` 的**全部**同变更审批及其通知，两个方向保持一致，避免遗留孤儿审批。
  - 删除会产生通知的业务实体时，必须同步清理其通知：通知统一带 `sourceType`/`sourceId`，用 `removeNotificationsBySource(db, sourceType, sourceId)` 精确移除。
  - 所有由业务实体产生的通知都必须打来源标记，否则删除实体后会残留孤儿通知：`aiInspectionTask`、`configBackupPlan`、`inspectionPlan`（含到期提醒与异常提醒）、`asset`（维保到期、离线告警）、`sparePart`（库存提醒）、`changeRecord`、`approval`、`incident`、`workReport`。
  - 智能巡检对象删除会连带清理其任务与配置备份计划，需先收集这些子实体 ID，再分别清理对应通知，避免遗留空通知。
  - 资产删除（普通与 `?cascade=1` 强制级联）都要清理 `asset` 来源通知，并连带清理其巡检对象派生任务/备份计划的通知；备件删除清理 `sparePart` 来源通知。
  - 强制删除项目（`?force=1`）会级联清理 `assetRelations`（按资产 ID，无 `projectId` 字段）并失效拓扑/流量运行时状态，落库成功后清理资料附件磁盘目录。
  - 历史通知若缺少 `sourceType`/`sourceId`，运行 `node scripts/backfill-notification-sources.js`（管理员接口 `POST /api/system/backfill-notification-sources` 的封装）按内容特征回填；脚本幂等，可重复执行。

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
  - `gh auth login --with-token` 会校验 scope 并因缺少 `read:org` 失败，更新凭据时直接改 `hosts.yml` 即可。
  - 家目录可能随环境重建而丢失；若 `gh auth status` 显示未登录，需要用户重新提供 token。

[写失败回滚验证开关]
- Date: 2026-09-26
- Context: Agent 为验证 `writeDb` 落库失败回滚逻辑新增可控注入开关
- Category: 测试方法
- Instructions:
  - 非生产环境下用 `FORCE_DB_WRITE_FAILURE_FILE=/path/flag npm start` 启动；当该文件存在时，`writeDb` 在写 MySQL 前抛错，用于验证内存回滚与持久层一致。
  - 创建标志文件即注入失败，重命名或移走文件即恢复，不受后台定时写库干扰（数字计数会被启动时的调度器写库消耗，故改用文件开关）。
  - `NODE_ENV=production` 下该开关被忽略，生产环境不会启用注入。
