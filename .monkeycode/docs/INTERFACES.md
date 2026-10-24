# 接口与数据模型

## 核心数据集合

- `users`
- `projects`
- `contracts`
- `contractSettlements`
- `assets`
- `logs`
- `knowledgeBase`
- `kbRevisions`
- `documents`
- `inspectionPlans`
- `inspectionExecutions`
- `spareParts`
- `sparePartMovements`
- `sparePartVendors`
- `sparePartPurchases`
- `sparePartInventoryTasks`
- `changeRecords`
- `incidentRecords`
- `tickets`
- `dutyShifts`
- `approvals`
- `notifications`
- `notificationChannels`
- `monitorAlerts`
- `monitorMaintenanceWindows`
- `auditLogs`
- `workReports`
- `aiInspectionTargets`
- `aiInspectionTemplates`
- `aiInspectionTasks`
- `aiInspectionResults`
- `configBackupPlans`
- `configBackupRecords`
- `sessions`
- `systemConfig`
- `runtimeState`

## 认证与会话接口

- `GET /api/captcha`
  - 获取验证码与 `token`。
- `POST /api/login`
  - 账号密码登录。
- `POST /api/auth/ldap`
  - LDAP 登录，已接验证码和限流。
- `POST /api/account/2fa/setup`、`POST /api/account/2fa/disable`
  - 绑定与关闭动态令牌前需复核当前密码，失败按账号锁定。
  - LDAP 账号（`ldap_` 前缀）的本地口令为随机占位值，复核时回源 LDAP 校验域账号密码；LDAP 未配置或校验不通过一律拒绝。
- `GET /api/auth/oidc/login`
  - OIDC 登录入口。
- `GET /api/auth/oidc/callback`
  - OIDC 回调。
- `POST /api/logout`
  - 退出登录。
- `GET /api/session`
  - 获取当前会话与系统配置摘要。
- `GET /api/sessions/online`
  - 获取在线用户数。

## 业务接口分组

### 基础业务

- `GET|POST|PUT|DELETE /api/projects`
- `GET|POST|PUT|DELETE /api/users`
- `GET|POST|PUT|DELETE /api/assets`
- `POST /api/assets/import`
- `GET|POST|PUT|DELETE /api/logs`
  - 日志支持 `attachments` 数组（最多 6 张现场取证图），每项包含 `dataUrl`、`capturedAt`、`location{latitude,longitude,address}` 与 `watermark`。
  - 单张图片上限 3MB，仅接受 PNG/JPEG/WebP dataURL；累计配额由 `LOG_ATTACHMENT_QUOTA_PER_USER_BYTES`（默认 100MB）与 `LOG_ATTACHMENT_QUOTA_PER_PROJECT_BYTES`（默认 1GB）控制，超限返回 413。
- `GET|POST|PUT|DELETE /api/kb`
  - `GET /api/kb` 列表对客户账号只返回标题、分类、标签、项目与创建信息，正文、问题描述、解决方案不下发。
  - `GET /api/kb/:id` 详情对项目内所有角色（含客户）返回完整内容；这是产品既定取舍，客户可通过详情查阅知识条目。
  - 客户仅能看到 `published` 条目；草稿、待审核、已驳回条目不出现在列表，详情返回 403。
  - `GET /api/kb/:id/revisions` 返回版本历史与 `currentVersion`。
  - `POST /api/kb/:id/review` 仅管理员可用，`decision=publish|reject`，非 `pending` 条目重复审核返回 400。
- `GET|POST|PUT|DELETE /api/documents`

### 合同、采购与盘点

- `GET|POST /api/contracts`、`PUT|DELETE /api/contracts/:id`
  - 合同与结算分表存储；列表每行附带 `invoiceAmount`、`receivedAmount`、`costAmount`、`grossProfit`、`grossMargin`。
  - `GET /api/contracts/summary` 支持 `projectId`，按已回款减成本计算毛利。
  - 金额为负数返回 400；客户角色访问返回 403。
- `GET|POST /api/contract-settlements`、`PUT|DELETE /api/contract-settlements/:id`
  - 结算记录归属合同所在项目，删除合同会级联删除其结算。
- `GET|POST /api/spare-part-vendors`、`PUT|DELETE /api/spare-part-vendors/:id`
  - 供应商存在未取消采购申请时删除返回 409。
- `GET|POST /api/spare-part-purchases`
  - 状态机为 `pending -> approved -> received`，`cancelled` 为终态。
  - `POST /api/spare-part-purchases/:id/approve` 仅管理员可调用，其他角色返回 403。
  - `POST /api/spare-part-purchases/:id/receive` 自动把数量写入库存并生成 `inbound` 流水；重复收货返回 400。
  - `POST /api/spare-part-purchases/:id/cancel` 仅允许未入库申请，已收货返回 400。
- `GET|POST /api/spare-part-inventory-tasks`
  - 创建时冻结项目内备件账面快照，状态 `pending`。
  - `POST /api/spare-part-inventory-tasks/:id/record` 登记实盘数量，按差异置 `match`/`mismatch`。
  - `POST /api/spare-part-inventory-tasks/:id/complete` 存在未盘点项返回 400；完成后按实盘回写库存并写入 `adjust` 流水，任务转为 `completed` 后不可继续登记。

### 运维作业

- `GET|POST|PUT|DELETE /api/inspection-plans`
- `GET|POST|PUT|DELETE /api/inspection-executions`
- `GET|POST|PUT|DELETE /api/spare-parts`
- `GET /api/spare-part-movements`
- `POST /api/spare-parts/:id/stock`
- `GET|POST|PUT|DELETE /api/change-records`
- `GET|POST|PUT|DELETE /api/incidents`
- `GET|POST|PUT|DELETE /api/tickets`
- `POST /api/tickets/:id/actions`
  - `action` 支持 `accept`、`transfer`、`resolve`、`close`、`confirm`。
- `GET|POST|PUT|DELETE /api/duty-shifts`
- `POST /api/duty-shifts/:id/handover`
- `POST /api/inspection-executions/:id/recheck`
  - 记录异常复查结论，并把关联工单推进到 `待客户确认`。
- `GET|POST /api/approvals`
- `POST /api/approvals/:id/decision`

### AI 智能巡检与备份

- `GET|POST|PUT|DELETE /api/ai-inspection/targets`
- `GET|POST|PUT|DELETE /api/ai-inspection/templates`
- `GET|POST|PUT|DELETE /api/ai-inspection/tasks`
- `POST /api/ai-inspection/tasks/:id/execute`
- `GET|POST|PUT|DELETE /api/ai-inspection/config-backup/plans`
- `POST /api/ai-inspection/config-backup/plans/:id/execute`
- `GET /api/ai-inspection/config-backup/records`
- `GET /api/ai-inspection/config-backup/records/:id/download`
- `GET /api/ai-inspection/config-backup/records/diff`
- `DELETE /api/ai-inspection/config-backup/records/:id`
- `GET /api/ai-inspection/results`
- `GET /api/ai-inspection/results/:id`
- `DELETE /api/ai-inspection/results/:id`

### 报表与工作汇报

- `GET /api/reports/summary`
- `GET /api/reports/drilldown`
- `GET /api/work-reports`
  - 支持 `status`、`reportType`、`projectId`、`userId` 筛选。
- `POST /api/work-reports`
  - 创建或按周期幂等更新草稿。
- `PUT /api/work-reports/:id`
  - 编辑未锁定工作汇报。
- `POST /api/work-reports/:id/submit`
  - 提交工作汇报。
- `POST /api/work-reports/:id/review`
  - 管理员执行 `approved`、`returned`、`locked`。
- `GET /api/reports/workload`
  - 支持 `period=day|week|month|custom`。
  - 支持 `projectId`、`anchorDate`、`startDate`、`endDate`。
  - `format=csv` 时导出当前结果。

### 系统治理

- `GET /api/health`
- `GET /api/ready`
- `GET /api/system/info`
- `GET /api/system/services`
- `GET /api/system/load`
- `POST /api/system/settings`
- `POST /api/system/backup`
- `GET /api/system/export`
- `POST /api/system/import`
- `POST /api/system/upgrade`
- `GET /api/audit-logs`
- `GET /api/audit-logs/export`
  - `format=csv|json`，支持 `search`、`action`、`targetType`、`projectId` 过滤，导出范围与页面可见范围一致。
  - CSV 对以 `= + - @` 开头的单元格做公式注入中和，表头行不加引号。
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `GET|POST /api/notification-channels`
- `PUT|DELETE /api/notification-channels/:id`
- `POST /api/notification-channels/:id/test`
  - 仅管理员可访问；Webhook 密钥与 SMTP 密码以 `enc:` 前缀加密存储，响应仅返回 `hasWebhookSecret`/`hasSmtpPassword`。
  - `GET` 同时返回 `events` 事件目录；支持事件见下方通知事件表。

### 资产监控

- `GET /api/assets/monitor-status`
- `POST /api/monitor/run`
  - 仅管理员；`assetIds` 可限定采集范围，强制采样不受采样间隔节流限制，已有采集任务运行时返回 409。
- `GET /api/monitor/history`
  - 参数 `assetId`、`range=1h|24h|7d|30d`；数据来自 `data/monitor-history/<date>.jsonl`，按 5 分钟原始粒度落盘。
- `GET /api/monitor/alerts`
  - 支持 `projectId`、`assetId`、`metric`、`status=open` 筛选，返回 `openCount`。
- `POST /api/monitor/alerts/:id/acknowledge`、`POST /api/monitor/alerts/:id/resolve`、`POST /api/monitor/alerts/:id/silence`
- `GET|POST /api/monitor/maintenance-windows`
- `PUT|DELETE /api/monitor/maintenance-windows/:id`

### 全局搜索与服务报告

- `GET /api/search`
  - 参数 `keyword`（至少 2 个字符，否则 400）与 `types`（逗号分隔）。
  - 支持 `assets`、`logs`、`tickets`、`knowledge`、`documents`、`contracts`、`spareParts`、`projects`。
  - 返回 `total`、`counts`、`data`；结果按调用者项目范围过滤，客户不参与合同与备件搜索。
- `GET /api/reports/service/:projectId`
  - 参数 `period=week|month|year`，返回可直接打印的 HTML 服务报告。

## 通知事件

```text
monitor-alert      监控告警
ticket             工单流转
incident           故障记录
approval           审批
inspection         巡检
inventory          备件盘点
project-expiry     项目到期
maintenance-expiry 维保到期
work-report        工作汇报
duty-handover      值班交接
config-backup      配置备份
manual             手动通知
```

## workReports 数据模型

```text
id: string
reportType: daily | weekly | monthly
projectId: string
userId: string
periodKey: string
rangeStart: string
rangeEnd: string
status: draft | submitted | returned | approved | locked
summary: string
completedWork: string
pendingWork: string
risks: string
nextPlan: string
metricsSnapshot:
  logCount: number
  totalHours: number
  inspectionCount: number
  incidentCount: number
  changeCount: number
  knowledgeCount: number
submittedAt: string
reviewedAt: string
reviewedBy: string
reviewComment: string
lockedAt: string
createdAt: string
updatedAt: string
```

## 关键权限规则

- `admin`
  - 可查看所有项目、所有工作汇报、工作量看板与系统治理能力。
- `engineer`
  - 仅可创建和编辑本人所属项目的工作汇报。
  - 可处理所属项目的工单与值班排班；删除工单仅限本人创建。
- `customer`
  - 可见报表基础内容，隐藏工作汇报录入与审核入口。
  - 工单列表仅返回进度、处理结论与 SLA 字段，处理描述等内部信息不返回。
  - 仅可确认本项目的待客户确认工单。

## 工单与值班状态流

```text
待接单 -> 处理中 -> 待客户确认 -> 已完成
待接单/处理中 -> 转派 -> 待接单/处理中
```

```text
待开始 -> 值班中 -> 已交接
```

- SLA 时限按优先级取值：紧急 2 小时、高 4 小时、中 8 小时、低 24 小时。
- 达到时限 75% 记为「预警」，超过时限记为「超时」，同一工单同一阈值只提醒一次。
- 巡检执行存在异常检查项时整单强制为「异常」，自动生成「巡检异常」分类工单并置为「待复查」。

## 第一阶段状态流

```text
draft -> submitted -> approved -> locked
submitted -> returned -> draft -> submitted
```

## P2 状态流与可见性

```text
采购申请: pending -> approved -> received
pending/approved -> cancelled
```

```text
盘点任务: pending -> running -> completed
```

```text
知识条目: draft -> pending -> published
                    pending -> rejected
内容变更后回到 pending，版本号 +1
```

- 项目新增 `customerLogVisible` 开关，默认关闭；开启后客户可读取该项目的服务日志，且仅下发 `process`、`result`、`conclusion` 等安全字段，`userId`、`attachments` 不下发。
- 审批删除：管理员删除已关联变更的审批时级联删除变更并返回 `cascadedChangeId`；非管理员只能作废本人未完成的审批。

## 审计要求

- 工作汇报的创建、编辑、提交、确认、退回、锁定均写入 `auditLogs`。
- 资料下载、变更审批、系统导入导出、升级等关键操作同样写审计。
- 合同、结算、供应商、采购审批与收货、盘点登记与完成、知识库审核、审计导出均写入 `auditLogs`。
