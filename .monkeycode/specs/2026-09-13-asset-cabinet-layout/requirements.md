# Requirements Document

## Introduction

在「资产管理」中于「资产拓扑」之后增加「资产布局图」二级菜单。系统按机柜分组展示已安装设备，并在用户悬停或选中设备时展示运行状态与负载摘要。机柜位置使用结构化字段（机柜名称、起始 U 位、占用 U 数）。运行状态使用现有在线监测；CPU、内存、磁盘、网口流量与运行时长仅来自 SNMP 实时快照。Ping/TCP 监测资产以及 SNMP 未采集到的字段显示「暂无数据」。

## Glossary

- **System**: 驻场运维管理系统
- **Asset Layout View**: 「资产管理」下的「资产布局图」二级菜单
- **Cabinet**: 用于物理摆放设备的机柜，由机柜名称标识
- **Rack Unit**: 机柜内 1U 高度的安装位置，用起始 U 位和占用 U 数描述
- **Live Monitor Snapshot**: 资产在线监测得到的运行状态（在线、离线、未监控）
- **Snmp Metric Snapshot**: SNMP 采集得到的运行时长、CPU 负载、内存负载、磁盘利用率、网口流量

## Requirements

### Requirement 1

**User Story:** AS 已登录且可查看项目资产的用户, I want 在资产管理中打开资产布局图, so that 我可以按机柜查看设备摆放，而无需进入资产拓扑。

#### Acceptance Criteria

1. WHEN 用户打开「资产管理」菜单, THE System SHALL 在「资产拓扑」按钮之后展示「资产布局图」二级菜单按钮
2. WHEN 用户选择「资产布局图」, THE System SHALL 展示当前用户项目范围内的机柜布局画布
3. WHILE 用户角色为客户, THE System SHALL 按现有资产脱敏规则展示布局，隐藏监测地址与 SNMP 凭据

### Requirement 2

**User Story:** AS 工程师或管理员, I want 为资产登记机柜名称、起始 U 位和占用 U 数, so that 布局图能把设备放到正确的机柜槽位。

#### Acceptance Criteria

1. WHEN 用户保存资产, THE System SHALL 允许填写机柜名称、起始 U 位、占用 U 数
2. WHEN 资产已填写机柜名称, THE System SHALL 将该资产归入对应机柜
3. IF 资产未填写机柜名称且安装位置包含可识别的机柜片段, THE System SHALL 使用安装位置中的机柜片段作为机柜名称
4. IF 资产既无机柜名称也无安装位置, THE System SHALL 将该资产放入「未分配机柜」分组

### Requirement 3

**User Story:** AS 已登录用户, I want 在布局图中看到每个机柜内的设备槽位, so that 我能识别设备上下位置关系。

#### Acceptance Criteria

1. WHEN 布局图加载完成, THE System SHALL 按机柜名称分组渲染机柜，并在每个机柜内按起始 U 位从上到下排列设备
2. WHEN 设备占用多个 U, THE System SHALL 在该机柜中按占用 U 数显示连续槽位
3. IF 同一机柜内两个设备的 U 位区间重叠, THE System SHALL 同时展示这两个设备并标记槽位冲突
4. WHEN 当前项目范围内没有任何资产, THE System SHALL 显示「暂无资产」空状态

### Requirement 4

**User Story:** AS 已登录用户, I want 悬停或选中设备时看到运行详情, so that 我能快速判断该设备健康状况。

#### Acceptance Criteria

1. WHEN 指针在设备槽位上停留至少 300 毫秒, THE System SHALL 弹出摘要，至少包含资产名称、资产类型、运行状态
2. WHEN 用户点击设备槽位, THE System SHALL 打开详情浮层，字段包括运行状态、运行时长、CPU 负载、内存负载、磁盘利用率、网口流量
3. IF 某项监测指标当前不可用, THE System SHALL 在该字段显示「暂无数据」
4. WHEN 用户移出槽位且未选中该设备, THE System SHALL 关闭摘要弹出层

### Requirement 5

**User Story:** AS 已登录用户, I want 布局图使用现有在线监测与 SNMP 实时数据, so that 我看到的状态与资产监测设置保持一致。

#### Acceptance Criteria

1. WHEN 资产已启用监测, THE System SHALL 使用现有在线监测结果作为运行状态（在线、离线、未监控）
2. WHEN 资产监测方式为 SNMP 且 SNMP 采集成功, THE System SHALL 使用 SNMP 快照填充运行时长、CPU 负载、内存负载、磁盘利用率、网口流量中已采集到的字段
3. IF 资产未启用 SNMP 或某项 SNMP 指标采集失败, THE System SHALL 在对应字段显示「暂无数据」
4. WHEN 客户查看详情浮层, THE System SHALL 按现有客户脱敏规则隐藏 IP 地址与 SNMP 团体字

### Requirement 6

**User Story:** AS 管理员, I want 布局图接口遵循现有项目范围与回归覆盖, so that 该功能与资产管理其他入口权限一致。

#### Acceptance Criteria

1. WHEN 非管理员请求布局数据, THE System SHALL 只返回该用户 `projectId` 下的资产与监测快照
2. WHEN 回归测试运行, THE System SHALL 覆盖布局接口的登录校验、项目隔离和客户脱敏
