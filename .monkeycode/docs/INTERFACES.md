# 接口与数据模型

## 核心数据集合

- `users`
- `projects`
- `assets`
- `logs`
- `knowledgeBase`
- `documents`
- `inspectionPlans`
- `inspectionExecutions`
- `spareParts`
- `sparePartMovements`
- `changeRecords`
- `incidentRecords`
- `tickets`
- `dutyShifts`
- `approvals`
- `notifications`
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
- `GET|POST|PUT|DELETE /api/kb`
  - `GET /api/kb` 列表对客户账号只返回标题、分类、标签、项目与创建信息，正文、问题描述、解决方案不下发。
  - `GET /api/kb/:id` 详情对项目内所有角色（含客户）返回完整内容；这是产品既定取舍，客户可通过详情查阅知识条目。
- `GET|POST|PUT|DELETE /api/documents`

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
- `GET /api/notifications`
- `POST /api/notifications/:id/read`

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

## 审计要求

- 工作汇报的创建、编辑、提交、确认、退回、锁定均写入 `auditLogs`。
- 资料下载、变更审批、系统导入导出、升级等关键操作同样写审计。
