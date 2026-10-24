# 系统架构

## 总览

系统采用单体应用架构：一个 Node.js 进程同时提供静态页面、业务 API、WebSocket 推送和部分系统运维能力。运行时默认使用 MySQL 存储，开发环境可通过 `ALLOW_FILE_DB_FALLBACK=true` 使用 `data/db.json` 作为回退来源。

## 主要组成

### 1. 服务入口

- `server.js`
  - 启动 HTTP 服务。
  - 按配置懒加载 HTTPS 登录服务。
  - 初始化数据目录、备份目录、上传目录和 MySQL 连接池。
  - 注册全部 REST 风格 API。
  - 维护 WebSocket 连接与心跳。

### 2. 前端单页应用

- `public/index.html`
  - 页面结构、样式和全部浏览器端脚本集中在单文件内。
  - 通过全局 `state` 持有项目、人员、资产、日志、工作汇报、审批、巡检等数据集合。
  - 通过 `fetch` 调用 `/api/*` 接口，使用 `state.csrfToken` 处理写操作防护。

### 3. 数据持久化

- MySQL
  - 连接参数由 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 提供。
  - 通过 `mysql2/promise` 访问。
- 文件回退
  - 本地数据位于 `data/db.json`。
  - 启动时若 MySQL 中无业务数据，系统可导入文件数据作为初始内容。

### 4. 自动化脚本

- `scripts/lint.js`
  - 检查尾随空白、Tab、`debugger` 和调试输出。
- `scripts/typecheck.js`
  - 运行语法和类型层面的静态检查。
- `scripts/smoke.js`
  - 健康检查、登录态和基础接口快速回归。
- `scripts/regression.js`
  - 核心业务接口回归，包括升级、导入导出、工作汇报、审批等。
- `scripts/e2e.js`
  - Playwright 浏览器级端到端回归。

## 模块划分

### 项目与组织域

- 项目管理：项目、服务周期、到期提醒。
- 用户管理：管理员、工程师、客户账号与权限。

### 运维业务域

- 资产台账与资产关系。
- 运维日志、知识库、资料管理。
- 巡检计划、巡检执行、备件管理。
- 变更记录、故障记录、审批流。
- 工单中心：受理、转派、回单、客户确认与 SLA 预警。
- 值班交接：排班、开始值班、交接记录。

巡检执行支持按计划模板逐项记录结果，存在异常项时自动生成整改工单，并在复查后联动推进工单状态。

### 智能运维域

- AI 巡检对象、模板、任务、结果。
- 配置备份计划与备份记录。
- 资产监控：定时采集 ping/TCP/SNMP 指标，连续阈值触发告警，历史采样按天落盘。
- 通知外发：站内通知统一按事件组归并，支持 Webhook 与 SMTP 邮件两种通道。

### 报表与治理域

- 仪表板汇总。
- 传统报表导出。
- 第一阶段工作量看板与工作汇报审核流。
- 审计日志、通知、系统升级、备份恢复。

## 第一阶段新增架构点

- 新增 `workReports` 集合承载日报、周报、月报。
- 新增统一周期计算与 `buildWorkloadMetrics()` 统计函数。
- 工作量看板和工作汇报快照共用同一口径。
- 审核动作接入审计日志集合。

## v1.2.0 新增架构点

- 资产监控调度：`runAssetMonitorScheduler()` 以 `assetMonitorSchedulerRunning` 互斥，手动采集走 `force:true`，冲突时返回 409。
- 监控历史：采样写入 `data/monitor-history/<date>.jsonl`，保留 30 天，趋势查询按 5 分钟原始粒度重桶到 5 分钟至 6 小时。
- 告警状态机：连续 N 次异常（默认 3）触发，维护窗口内标记 `suppressedReason='maintenance'`，静默期内只记事件不再外发。
- 通知通道：`notificationChannels` 集中存放 Webhook/SMTP 配置，密钥以 `enc:` 前缀加密；投递使用 `setImmediate` 异步执行，失败仅记录 `lastError`。
- 日志取证附件：图片压缩到长边 1600 后以 dataURL 内联，烧录时间/地点/记录人水印，受单张 3MB、6 张、用户 100MB、项目 1GB 四层配额约束。
- PWA：`public/sw.js` 采用壳缓存加网络优先导航，跳过 `/api/`、`/ws`、`/downloads/`；离线草稿按用户隔离写入 localStorage，仅恢复不自动重放。

## 运行时数据流

1. 用户访问 `public/index.html`，前端初始化并请求 `/api/session`。
2. 登录后前端批量拉取基础数据集合。
3. 页面操作通过 `/api/*` 写接口更新业务数据。
4. 后端调用 `writeDb()` 持久化到 MySQL，并在需要时同步回文件存储。
5. 部分写操作触发审计日志、通知或 WebSocket 刷新。

## 关键约束

- 后端是单文件单体，新增能力优先沿用既有模式，减少横向拆分。
- 客户角色可见性受限，报表模块不展示工作汇报录入和审核入口。
- 已锁定工作汇报禁止再次编辑。
- 生产模式要求强密码与密钥校验。
