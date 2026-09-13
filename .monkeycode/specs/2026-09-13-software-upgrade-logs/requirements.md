# Requirements Document

## Introduction

管理员在系统治理「软件升级」页上传升级包时，页面需要展示升级操作日志，覆盖接收成功与校验失败，便于追溯操作人、版本与失败原因。

## Glossary

- **Software Upgrade Page**: 系统治理中的软件升级卡片
- **Upgrade Package**: `.tar.gz` 升级包
- **Upgrade Log**: 一条升级尝试记录
- **Administrator**: 角色为 `admin` 的登录用户

## Requirements

### Requirement 1

**User Story:** AS Administrator, I want to see upgrade attempts on the Software Upgrade Page, so that I can trace who uploaded which package and whether the system accepted it.

#### Acceptance Criteria

1. WHEN an Administrator opens the Software Upgrade Page, the System SHALL display Upgrade Logs ordered by `createdAt` descending.
2. WHEN the System displays an Upgrade Log, the System SHALL include created time, operator name, source version, target version, package filename, status, and message.
3. WHILE fewer than 1 Upgrade Log exists, the System SHALL display an empty-state message on the Software Upgrade Page.

### Requirement 2

**User Story:** AS Administrator, I want failed uploads to appear in Upgrade Logs, so that I can diagnose signature, checksum, and package-format errors.

#### Acceptance Criteria

1. WHEN an Administrator uploads an Upgrade Package and validation fails, the System SHALL store an Upgrade Log with status `failed` and the failure message.
2. WHEN an Administrator uploads an Upgrade Package and the System accepts the package, the System SHALL store an Upgrade Log with status `accepted`, the current application version, and the package version.
3. IF a non-administrator requests Upgrade Logs, the System SHALL respond with HTTP 403.

### Requirement 3

**User Story:** AS Administrator, I want Upgrade Logs to persist across page refresh, so that history remains after restart.

#### Acceptance Criteria

1. WHEN the System stores an Upgrade Log, the System SHALL persist the Upgrade Log in the `upgradeLogs` collection.
2. WHEN the `upgradeLogs` collection exceeds 200 records, the System SHALL retain the newest 200 records.
3. WHEN the Software Upgrade Page loads, the System SHALL request Upgrade Logs from `GET /api/system/upgrade/logs`.
