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
