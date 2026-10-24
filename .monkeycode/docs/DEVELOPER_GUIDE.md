# 开发者指南

## 本地运行

### 依赖安装

```bash
npm install
```

### 启动服务

```bash
npm start
```

默认监听 `3000` 端口。

## MySQL 运行要求

- 默认连接参数：
  - `MYSQL_HOST=127.0.0.1`
  - `MYSQL_PORT=3306`
  - `MYSQL_USER=onsite_ops`
  - `MYSQL_PASSWORD=onsite_ops_password`
  - `MYSQL_DATABASE=onsite_ops_system`
- 生产部署默认关闭文件回退，使用 `ALLOW_FILE_DB_FALLBACK=false`。

## 测试与校验命令

```bash
npm run lint
npm run typecheck
npm run smoke
npm run regression
npm run e2e
```

若服务运行在非默认地址，使用：

```bash
BASE_URL="http://127.0.0.1:3000" npm run smoke
BASE_URL="http://127.0.0.1:3000" npm run regression
BASE_URL="http://127.0.0.1:3000" npm run e2e
```

## 代码组织约定

- 后端主逻辑集中在 `server.js`。
- 前端主逻辑集中在 `public/index.html`。
- 自动化脚本集中在 `scripts/`。
- 特性规格文档集中在 `当前工作区/.monkeycode/specs/`。
- 项目级文档集中在 `当前工作区/.monkeycode/docs/`。

## 开发建议

- 现有项目偏向最小增量修改，新增能力优先遵循既有函数和状态管理方式。
- 前端分离端口预览场景需要保留 `/api` 请求兼容能力。
- 涉及工作汇报与工作量看板时，必须复用统一统计口径。
- 涉及工单 SLA 时，统一用 `ticketSlaHoursByPriority` 与 `resolveTicketSlaStatus` 计算，避免各入口口径分叉。
- 巡检执行写入的 `checklistItems` 与 `checklist` 文本需同时维护，历史记录仍按文本导出。
- 涉及登录、审批、升级、资料访问等关键路径时，需关注审计日志是否写入。

## v1.2.0 开发约定

- 监控采集统一走 `runAssetMonitorScheduler()`，不要直接调用 `checkAssetPing`/`checkAssetTcp`/`checkAssetSnmp` 绕过互斥与告警判定。
- 新增告警指标时同步更新 `monitorTrendRanges` 与前端趋势图字段，保持桶粒度一致。
- 通知外发统一使用 `queueExternalNotification()`，新增事件先登记 `notificationEventOptions` 与 `notificationEventGroups`。
- 通道密钥只以 `enc:` 密文保存；接口响应通过 `hasWebhookSecret`/`hasSmtpPassword` 暴露状态，禁止回显明文。
- 日志附件必须经 `validateLogAttachments()` 校验配额与类型；前端先用 `buildLogAttachment()` 压缩并烧录水印。
- 修改 `public/sw.js` 时递增 `CACHE_NAME` 版本号，否则旧壳缓存不会失效。
- 离线草稿键格式为 `onsiteOpsDraft:${type}:${userId}`，草稿只恢复不自动提交。

## v1.3.0 开发约定

- 新增集合必须同时加入 `dbCollectionKeys`、`normalizeDb()` 返回对象与 `sanitizeImportedData()` 的关联清理，否则读写会丢失该集合。
- 合同金额统一走 `normalizeMoney()`，毛利只在 `summarizeContract()` 中计算，列表与汇总不要各自实现口径。
- 采购状态变更必须经 `/approve` 与 `/receive` 接口，收货入库与流水写入放在同一事务性写库流程内。
- 盘点任务的 `items` 是创建时快照，登记与完成都基于快照计算差异，不要把实时库存当作账面数量。
- 知识库内容变更用 `snapshotKbRevision()` 记录版本；只有内容字段变化才递增版本，状态切换不污染版本历史。
- 全局搜索结果必须复用列表的可见范围判断，新增可搜索类型时同步更新 `SEARCH_TYPE_TABS` 与前端结果渲染。
- 审计导出与页面列表共用过滤函数，新增字段时同步更新 CSV 表头与公式注入中和逻辑。
- E2E 中表单提交后先调用 `waitForSubmitIdle()`，等提交按钮解锁再切换标签页，避免被提交处理函数的后续刷新覆盖导航。

## 回归注意事项

- `regression` 与 `e2e` 必须顺序执行，二者并发会争用监控采集锁与会话表。
- 回归中断会留下 `monitorEnabled:true` 的测试资产，`cleanupRegressionArtifacts()` 会在每轮开始时按名称前缀清理。
- 本地账号：`admin/Admin123!`、`engineer1/Engineer123!`；验证码由 `scripts/captcha-glyphs.js` 解码。

## 交付检查

提交前至少完成以下检查：

1. `npm run lint`
2. `npm run typecheck`
3. 与本次改动相关的 `smoke`、`regression` 或 `e2e`

## 当前阶段说明

- 第一阶段“工作汇报与工作量看板”规格目录：
  - `当前工作区/.monkeycode/specs/2026-08-19-work-report-phase-1/`
- 当前阶段已经具备：
  - 日报 / 周报 / 月报录入与审核
  - 管理员工作量看板
  - 工作汇报筛选、CSV 导出、审计日志
  - 接口回归与前端 E2E 自动化覆盖
