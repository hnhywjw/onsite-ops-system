# Requirements Document

## Introduction

为现有驻场运维管理系统增加“AI智能巡检”菜单，用于对服务器、网络设备和安全设备维护接入信息、定义巡检模板、创建巡检任务，并基于采集或人工录入的技术指标自动生成巡检结论、风险等级和整改建议。

## Glossary

- **AI智能巡检**: 基于指标阈值和设备类型规则自动生成巡检结果的功能模块。
- **巡检对象**: 需要被巡检的服务器、网络设备或安全设备。
- **巡检模板**: 针对某类设备预定义的指标集合、阈值和检查说明。
- **巡检任务**: 针对单个巡检对象发起的一次巡检执行请求。
- **巡检结果**: 巡检任务执行后输出的健康评分、状态、异常项和建议。

## Requirements

### Requirement 1

**User Story:** AS 运维人员, I want 维护巡检对象接入信息, so that I can 为设备建立智能巡检基础。

#### Acceptance Criteria

1. WHEN 管理员或工程师打开 AI智能巡检菜单, the system SHALL 显示巡检对象管理界面。
2. WHEN 管理员提交巡检对象表单, the system SHALL 保存对象名称、设备类别、关联项目、关联资产、管理地址、管理协议、端口、认证方式、系统版本和位置说明。
3. WHEN 工程师提交巡检对象表单, the system SHALL 使用工程师所属项目作为巡检对象项目归属。
4. IF 巡检对象关联资产与项目归属不一致, the system SHALL 阻止保存并返回错误提示。
5. WHILE 用户浏览巡检对象列表, the system SHALL 仅显示用户有权限访问项目下的巡检对象。

### Requirement 2

**User Story:** AS 运维人员, I want 维护不同设备类型的巡检模板, so that I can 标准化巡检指标和阈值。

#### Acceptance Criteria

1. WHEN 用户进入巡检模板界面, the system SHALL 提供服务器、网络设备、安全设备三类默认模板。
2. WHEN 管理员或工程师创建模板, the system SHALL 保存模板名称、设备类别、适用说明和指标定义。
3. WHEN 系统保存指标定义, the system SHALL 为每个指标保存名称、单位、告警阈值、严重阈值和检查说明。
4. IF 模板未包含任何指标, the system SHALL 阻止保存并返回错误提示。
5. WHILE 用户浏览模板列表, the system SHALL 展示模板对应的设备类别和指标数量。

### Requirement 3

**User Story:** AS 运维人员, I want 创建并执行智能巡检任务, so that I can 快速生成标准巡检结果。

#### Acceptance Criteria

1. WHEN 管理员或工程师创建巡检任务, the system SHALL 保存关联项目、巡检对象、巡检模板、执行时间和执行人。
2. WHEN 系统创建巡检任务, the system SHALL 自动根据模板生成待填写的指标输入项。
3. WHEN 运维人员提交巡检任务指标值, the system SHALL 基于模板阈值计算健康评分、整体状态和异常项数量。
4. IF 任一指标达到严重阈值, the system SHALL 将整体状态标记为“严重”。
5. IF 任一指标达到告警阈值且未达到严重阈值, the system SHALL 将整体状态标记为“异常”或“关注”。

### Requirement 4

**User Story:** AS 运维人员, I want 自动生成巡检分析结论, so that I can 输出可读的巡检报告。

#### Acceptance Criteria

1. WHEN 巡检任务执行完成, the system SHALL 生成巡检结果记录。
2. WHEN 系统生成巡检结果记录, the system SHALL 输出健康评分、整体状态、异常指标列表、AI结论、风险影响和整改建议。
3. WHEN 巡检结果存在异常项, the system SHALL 按设备类别输出针对性的处置建议。
4. WHILE 用户浏览巡检结果列表, the system SHALL 支持查看任务信息、设备信息和结果摘要。
5. IF 巡检结果状态为“异常”或“严重”, the system SHALL 生成一条项目通知提醒。

### Requirement 5

**User Story:** AS 管理人员, I want 将 AI智能巡检接入现有权限和审计体系, so that I can 保证操作可追溯。

#### Acceptance Criteria

1. WHEN 用户创建或删除巡检对象、模板、任务或结果, the system SHALL 写入操作审计日志。
2. WHILE 客户角色浏览系统, the system SHALL 查看本项目的巡检对象、任务和结果。
3. WHILE 客户角色浏览系统, the system SHALL 不显示创建和删除按钮。
4. WHEN 系统加载基础数据, the system SHALL 同步加载 AI智能巡检相关数据集合。
5. WHEN 用户打开主导航, the system SHALL 显示“AI智能巡检”一级菜单。
