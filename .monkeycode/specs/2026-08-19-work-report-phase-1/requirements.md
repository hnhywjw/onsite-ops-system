# Requirements Document

## Introduction

为现有驻场运维管理系统新增第一阶段“工作汇报与工作量看板”能力。第一阶段聚焦三类能力：运维人员按日/周/月独立提交工作汇报、管理员审核工作汇报、管理员按日/周/月及自定义时间范围查看各运维人员工作内容与工作量。

## Glossary

- **工作汇报**: 运维人员围绕某个周期提交的结构化工作总结，包含自动汇总指标和人工填写内容。
- **日报**: 以单日为统计范围的工作汇报。
- **周报**: 以自然周为统计范围的工作汇报。
- **月报**: 以自然月为统计范围的工作汇报。
- **工作量看板**: 面向管理员的统计界面，用于按人员查看日志数、工时、巡检数、故障数、变更数和知识数。
- **统计口径**: 工作量指标的计算规则与数据来源。

## Requirements

### Requirement 1

**User Story:** AS 运维人员, I want 提交日报、周报和月报, so that I can 形成完整的驻场工作台账。

#### Acceptance Criteria

1. WHEN 管理员或工程师打开报表模块, the system SHALL 提供工作汇报录入入口。
2. WHEN 运维人员创建工作汇报, the system SHALL 支持选择日报、周报或月报。
3. WHEN 系统保存工作汇报, the system SHALL 保存周期类型、周期范围、关联项目、提交人、工作总结、已完成事项、未完成事项、风险阻塞和下一步计划。
4. WHEN 运维人员保存工作汇报草稿, the system SHALL 将工作汇报状态标记为草稿。
5. WHEN 运维人员提交工作汇报, the system SHALL 将工作汇报状态标记为已提交并记录提交时间。

### Requirement 2

**User Story:** AS 运维人员, I want 工作汇报自动带出周期内的工作量指标, so that I can 减少重复填写并统一统计口径。

#### Acceptance Criteria

1. WHEN 系统创建或更新工作汇报, the system SHALL 自动汇总对应周期内的日志数和累计工时。
2. WHEN 系统创建或更新工作汇报, the system SHALL 自动汇总对应周期内的巡检执行数、故障数、变更数和知识数。
3. IF 工作汇报周期内无业务数据, the system SHALL 返回零值指标并允许提交文字总结。
4. WHEN 系统展示工作汇报详情, the system SHALL 同时展示自动汇总指标与人工填写内容。
5. WHEN 工作汇报被再次保存为草稿, the system SHALL 刷新自动汇总指标快照。

### Requirement 3

**User Story:** AS 管理员, I want 审核工作汇报, so that I can 确认驻场人员的周期工作内容。

#### Acceptance Criteria

1. WHEN 管理员查看工作汇报列表, the system SHALL 支持按状态、汇报类型、人员和项目筛选。
2. WHEN 管理员确认工作汇报, the system SHALL 将工作汇报状态标记为已确认并记录审核人、审核时间和审核意见。
3. WHEN 管理员退回工作汇报, the system SHALL 将工作汇报状态标记为已退回并记录退回意见。
4. WHEN 管理员锁定已确认工作汇报, the system SHALL 阻止运维人员继续修改该工作汇报。
5. WHILE 工作汇报处于草稿、已提交或已退回状态, the system SHALL 允许工作汇报创建人编辑内容。

### Requirement 4

**User Story:** AS 管理员, I want 按日、周、月和自定义时间范围查看人员工作量, so that I can 对比不同人员的工作投入。

#### Acceptance Criteria

1. WHEN 管理员进入工作量看板, the system SHALL 支持按日、周、月和自定义时间范围切换统计口径。
2. WHEN 管理员查看工作量看板, the system SHALL 按人员展示日志数、累计工时、巡检数、故障数、变更数和知识数。
3. WHEN 管理员切换项目筛选条件, the system SHALL 按项目范围缩小工作量统计结果。
4. WHEN 管理员输入自定义开始日期和结束日期, the system SHALL 基于该时间范围重新计算看板数据。
5. WHEN 工作量看板展示统计结果, the system SHALL 支持导出当前结果为 CSV 文件。

### Requirement 5

**User Story:** AS 管理员, I want 统一工作量统计口径, so that I can 基于一致的数据口径进行考核。

#### Acceptance Criteria

1. WHEN 系统计算工作量, the system SHALL 将运维日志视为工时和工作内容的主来源。
2. WHEN 系统计算工作量, the system SHALL 将巡检执行数、故障数、变更数和知识数视为周期产出指标。
3. WHEN 系统展示综合工作量看板, the system SHALL 不将资产总量、资料总量和备件库存计入周期工作量。
4. WHEN 系统展示不同报表维度, the system SHALL 为每个指标使用与数据含义一致的列标题。
5. WHEN 系统生成工作汇报或工作量看板, the system SHALL 使用相同的统计口径。

### Requirement 6

**User Story:** AS 系统管理员, I want 第一阶段能力接入现有权限和审计体系, so that I can 保证数据安全与操作可追溯。

#### Acceptance Criteria

1. WHEN 工程师创建工作汇报, the system SHALL 将关联项目限定为工程师所属项目。
2. WHILE 管理员浏览工作汇报和工作量看板, the system SHALL 支持查看全部项目范围内的数据。
3. WHILE 客户角色浏览报表模块, the system SHALL 不显示工作汇报录入和审核入口。
4. WHEN 用户保存、提交、确认、退回或锁定工作汇报, the system SHALL 写入审计日志。
5. WHEN 系统加载基础数据, the system SHALL 同步加载工作汇报数据集合。
