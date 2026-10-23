# 项目文档索引

## 项目概览

驻场运维管理系统是一套单仓、单体 Node.js Web 应用，覆盖项目管理、人员与资产台账、运维日志、资料管理、AI 智能巡检、配置备份、审批治理，以及工作汇报与管理汇总看板能力。

## 文档目录

- `ARCHITECTURE.md`
  - 系统结构、运行时组件、数据流和模块边界。
- `INTERFACES.md`
  - 主要 HTTP API、核心数据集合、权限与状态流。
- `DEVELOPER_GUIDE.md`
  - 本地运行、测试命令、开发约定和交付检查。

## 当前实现重点

- 后端入口集中在 `server.js`，包含 HTTP 路由、数据读写、权限校验、MySQL 持久化、WebSocket 推送和系统管理逻辑。
- 前端入口集中在 `public/index.html`，为纯 HTML/CSS/JavaScript 单页应用。
- 自动化脚本位于 `scripts/`，当前包括 `lint`、`typecheck`、`smoke`、`regression` 和 `e2e`。
  - 工作汇报规格位于 `当前工作区/.monkeycode/specs/2026-08-19-work-report-phase-1/` 与 `当前工作区/.monkeycode/specs/2026-08-19-work-report-phase-2/`。

## 最近阶段成果

- 已完成 MySQL-only 运行模式收敛。
  - 已完成第一阶段“工作汇报与工作量看板”和第二阶段“管理汇总看板”后端、前端与自动化闭环。
  - 已覆盖工作汇报主链路、退回重提、趋势/排行/待审核汇总、CSV 导出、审计日志和前端 E2E。
