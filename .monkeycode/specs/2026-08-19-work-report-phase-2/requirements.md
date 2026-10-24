# Requirements Document

## Introduction

为驻场运维管理系统新增第二阶段“工作汇报管理看板增强”能力。第二阶段聚焦管理员视角的趋势与汇总，补齐跨周期统计、人员与项目对比、待审核汇总和工作汇报导出能力，帮助管理员从单次审核转向阶段性分析与管理。

## Glossary

- **工作汇报趋势**: 按日、周、月或连续周期聚合后的工作汇报和工作量变化结果。
- **汇总看板**: 面向管理员展示汇报数量、审核状态、人员排名、项目排名和周期趋势的统计界面。
- **待审核汇总**: 当前筛选范围内处于 `submitted` 状态的工作汇报聚合结果。
- **跨周期对比**: 对多个连续周期的人员或项目工作量进行并列比较。
- **汇报导出**: 按当前筛选条件导出工作汇报列表或汇总统计结果。

## Requirements

### Requirement 1

**User Story:** AS 管理员, I want 查看跨周期工作汇报趋势, so that I can 识别团队工作量变化和审核节奏。

#### Acceptance Criteria

1. WHEN 管理员进入报表模块, the system SHALL 提供工作汇报趋势与汇总入口。
2. WHEN 管理员选择日、周或月统计口径, the system SHALL 返回连续周期的工作汇报数量、已提交数量、已确认数量、已锁定数量和累计工时。
3. WHEN 管理员切换项目筛选条件, the system SHALL 按项目范围重新计算趋势数据。
4. IF 当前周期范围内没有工作汇报, the system SHALL 返回零值趋势结果。

### Requirement 2

**User Story:** AS 管理员, I want 对比人员和项目的阶段性产出, so that I can 识别投入分布与重点项目。

#### Acceptance Criteria

1. WHEN 管理员查看汇总看板, the system SHALL 提供按人员的累计日志数、累计工时、汇报数和待审核数排行。
2. WHEN 管理员查看汇总看板, the system SHALL 提供按项目的累计日志数、累计工时、汇报数和待审核数排行。
3. WHEN 管理员输入自定义开始日期和结束日期, the system SHALL 基于该范围重新计算人员与项目排行。
4. WHILE 管理员浏览排行结果, the system SHALL 使用与第一阶段工作量看板一致的统计口径。

### Requirement 3

**User Story:** AS 管理员, I want 快速看到待审核汇报汇总, so that I can 优先处理积压工作。

#### Acceptance Criteria

1. WHEN 管理员打开汇总看板, the system SHALL 展示当前筛选范围内待审核工作汇报总数。
2. WHEN 管理员查看待审核汇总, the system SHALL 展示按人员和按项目聚合的待审核数量。
3. WHEN 管理员从待审核汇总进入工作汇报列表, the system SHALL 自动带入对应筛选条件。
4. IF 待审核数量为零, the system SHALL 明确展示零值状态。

### Requirement 4

**User Story:** AS 管理员, I want 导出工作汇报列表与汇总结果, so that I can 用于阶段汇报和线下归档。

#### Acceptance Criteria

1. WHEN 管理员在工作汇报列表执行导出, the system SHALL 按当前筛选条件导出工作汇报明细 CSV。
2. WHEN 管理员在汇总看板执行导出, the system SHALL 按当前筛选条件导出趋势与排行 CSV。
3. WHEN 系统生成导出内容, the system SHALL 包含筛选范围、统计口径和导出时间。
4. IF 导出范围内无数据, the system SHALL 生成仅包含表头和范围说明的文件。

### Requirement 5

**User Story:** AS 系统管理员, I want 第二阶段能力继续接入权限与审计体系, so that I can 保持操作可追溯。

#### Acceptance Criteria

1. WHILE 管理员访问趋势与汇总接口, the system SHALL 支持查看全部项目范围数据。
2. WHILE 工程师或客户访问趋势与汇总接口, the system SHALL 返回符合角色范围的只读结果或权限提示。
3. WHEN 管理员导出工作汇报明细或汇总结果, the system SHALL 写入审计日志。
4. WHEN 系统返回趋势与排行结果, the system SHALL 使用明确的周期标签与列标题。
