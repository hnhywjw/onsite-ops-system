# Requirements Document

## Introduction

驻场运维系统启动时需一次加载全部业务主数据，并把业务状态按集合持久化到 MySQL 或 MariaDB，避免默认分页截断和整库 JSON 覆盖写入。

## Glossary

- **System**: 驻场运维管理系统
- **Collection**: 一类业务记录，例如项目、人员、资产
- **Unpaged Query**: 带 `all=1` 的列表查询，返回该接口权限范围内的全部记录

## Requirements

### Requirement 1

**User Story:** AS 登录用户, I want 进入系统后看到全部项目和人员, so that 下拉框和关联数据不会因为默认分页丢失

#### Acceptance Criteria

1. WHEN 前端执行基础数据加载, THE System SHALL 请求各列表接口的 Unpaged Query
2. WHEN 列表接口收到 `all=1`, THE System SHALL 返回当前用户权限范围内的全部记录
3. WHEN 列表接口收到 `pageSize=1`, THE System SHALL 只返回一页记录供分页界面使用

### Requirement 2

**User Story:** AS 运维人员, I want 业务数据按集合写入 MySQL 或 MariaDB, so that 单次保存不会用一整份 JSON 覆盖全部集合

#### Acceptance Criteria

1. WHEN System 首次连接到数据库, THE System SHALL 为每个 Collection 创建独立数据表
2. WHEN System 发现旧版 `app_state` 中有数据且集合表为空, THE System SHALL 把旧数据迁移到集合表
3. WHEN System 保存变更, THE System SHALL 只重写发生变化的 Collection 行数据
