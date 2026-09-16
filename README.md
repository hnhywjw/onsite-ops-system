# 驻场运维管理系统

驻场运维管理系统是一套面向项目驻场、资产台账、运维记录、自动化巡检、配置备份、资料管理和系统治理的轻量级 Web 应用。

## 功能概览

- 首页仪表板：项目、资产、日志、告警和系统状态概览
- 项目管理：客户项目、合同、服务周期和到期提醒
- 人员管理：管理员与工程师账号、项目权限、密码找回
- 资产管理：设备资产、型号版本、维保状态和关联项目
- 运维日志：日常巡检、故障处理、变更记录和审计追踪
- AI 智能巡检：巡检对象、任务计划、执行记录、HTML/PPT 报告
- 配置备份：CLI/Web 备份计划、备份记录、下载和清理
- 资料管理：设备资料、附件、访问密码、下载审计
- 系统治理：备份恢复、导入导出、系统升级、服务状态、健康检查

## 技术栈

- 后端：Node.js 原生 HTTP 服务
- 前端：单页 HTML/CSS/JavaScript
- 数据库：MySQL 8.x，支持开发环境文件存储回退
- 实时能力：WebSocket
- 部署：Docker Compose 或手动 Node.js 部署

## 目录结构

```text
.
├── README.md                    # 项目说明
├── PRODUCTION_DEPLOY.md         # 生产安装部署说明
├── .env.production.example      # 生产环境变量模板
├── Dockerfile                   # 容器镜像构建
├── docker-compose.prod.yml      # 生产 Docker Compose 编排
├── package.json                 # 项目脚本与依赖
├── package-lock.json            # 依赖锁定
├── server.js                    # 后端主服务与 API
├── public/index.html            # 前端单页应用
└── pptx-template.json           # PPTX 报告模板
```

## 本地运行

```bash
npm install
npm start
```

默认访问地址：`http://localhost:3000`

## 源码仓库常用校验命令

生产部署包仅包含运行文件，自动化校验脚本位于源码仓库 `scripts/` 目录。

```bash
npm run lint
npm run typecheck
npm run smoke
npm run regression
npm run e2e
```

需要指定测试地址时：

```bash
BASE_URL=http://localhost:3000 npm run smoke
BASE_URL=http://localhost:3000 npm run regression
BASE_URL=http://localhost:3000 npm run e2e
```

## 健康检查

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

## 生产部署

推荐使用 Docker Compose：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

生产环境必须配置强密码和密钥，重点环境变量包括：

- `MYSQL_PASSWORD`
- `INITIAL_ADMIN_PASSWORD`
- `INITIAL_ENGINEER_PASSWORD`
- `INITIAL_ADMIN_SECURITY_ANSWER`
- `INITIAL_ENGINEER_SECURITY_ANSWER`
- `ENCRYPTION_KEY`
- `UPGRADE_SIGNING_KEY`

完整部署步骤见 `PRODUCTION_DEPLOY.md`。

## 安全说明

- 登录态使用 HttpOnly Cookie
- 前端请求自动携带 CSRF Token
- 生产模式强制校验初始密码、安全答案和加密密钥
- 系统升级包支持 HMAC 签名与 SHA256 校验
- Web 配置备份包含 SSRF 防护
- CLI 配置备份使用命令白名单控制

## 版本

当前版本：`1.0.14`

### 软件包下载

最新版本：**[v1.0.14](https://github.com/hnhywjw/onsite-ops-system/releases/tag/v1.0.14)**

- 完整安装包 `onsite-ops-system-v1.0.14-production.tar.gz`
- 离线升级包 `onsite-ops-upgrade-v1.0.14.tar.gz`
- SHA256 校验文件
- 部署说明见仓库 `PRODUCTION_DEPLOY.md`

### v1.0.14 更新说明

资产布局图：
- 机柜改为立体金属机柜外观，机柜名称统一两行高度，长短名称对齐
- 工具栏收窄项目下拉宽度，搜索框移到批量归位按钮之前
- 槽位冲突改为按区间分列展示，支持部分重叠与 3 台以上同区间设备各自占列
- 批量归位：勾选设备后统一设置机柜与起始 U 位，按占用 U 数依次排布
- 机柜名与设备名按数字大小排序，未分配机柜显示数量与占用 U 位
- 监控告警实时刷新布局，轮询刷新增加去抖，避免批量离线时重复拉取
- 多项目环境机柜标题带项目名，管理员可按项目过滤；项目下拉加签名缓存
- 布局图支持按设备名搜索定位，命中设备高亮并滚动到可视区域
- 设备详情补充机柜/U 位/品牌型号/责任人/维保到期日/序列号，并可跳转编辑
- 只填写占用 U 数、未填起始 U 位时返回 400，不再静默落到 U1
- 客户布局不再下发 SNMP 性能指标，安装位置与序列号继续脱敏

资产列表：
- 列宽改为固定布局：项目名称收窄，资产类型显示 4 个中文字符，资产名称与规格型号各显示 5 个中文字符，维保到期日单行显示完整日期
- 超长内容省略号截断并保留悬停提示；列多时表格横向滚动，操作列固定在最右侧

### v1.0.13 更新说明

资产管理：
- 新增资产布局图，按机柜和 U 位展示设备，悬停摘要、点击查看 SNMP 详情
- 「资产拓扑」更名为「资产拓扑图」
- 资产导入写入监控与机柜字段，非法 U 位整行跳过
- 删除资产时级联清理拓扑关系和布局坐标
- 资产列表增加机柜/U位列

安全加固：
- 创建资产必须填写名称；启用监控必须填写合法监控地址
- SNMP 团体字不再默认 public
- 存活探测只使用监控地址
- 资产导入单次最多 500 条；拓扑布局坐标做范围限制
- 客户隐藏新增资产、批量删除和拓扑编辑，详情不再展示监控地址等敏感字段

系统治理：
- 软件升级日志在系统治理页面展示

### v1.0.12 更新说明

权限与脱敏：
- 新用户审批默认只读 `viewer`，需要工程师权限时再编辑人员
- 客户角色隐藏监测地址、安装位置、日志列表、报表汇总/下钻、通知中的地址
- 巡检 HTML 报告对客户隐藏地址；非管理员用户列表去掉账号与微信
- 结果筛选项统一为正常/关注/异常/严重

安全加固：
- 备件名、巡检对象名、告警标题等动态 HTML 统一转义
- 资料附件下载限制在上传目录内
- 配置备份 SSH 使用 `StrictHostKeyChecking=yes` 与隔离的 `known_hosts`
- 资产 Ping 存活检测改为 `execFile`
- 密码策略文案与注册/创建人员安全问题对齐

能力补齐：
- 工作汇报第二阶段：待审核定位、审批流与客户已提交记录可见
- 巡检结果分页；管理汇总仅管理员
- SNMP 存活用 GET `sysUpTime`，优先 `snmp-native`
- 验证码改为 5x7 点阵 SVG；SheetJS 改为本地 `public/vendor`
- 系统治理升级状态轮询；巡检报告支持导出 PPT

### v1.0.4 更新说明

部署优化：
- docker-compose.prod.yml 默认 APP_BIND 改为 0.0.0.0，外部可直接访问
- 新增 HTTPS 3443 端口映射，支持 HTTPS 登录服务外部访问
- 数据卷由 Docker 命名卷改为 bind mount (./data:/app/data)，宿主机可直接查看和管理数据
- 新增 HTTPS_PORT 环境变量支持

### v1.0.3 更新说明

新增功能：
- 首页仪表板显示当前在线人数，鼠标悬停查看在线用户列表（姓名/用户名/角色）
- 在线人数按 userId 去重，过滤非活跃和无效用户

### v1.0.2 版本说明

基于 v1.0.1 进行全面安全加固并新增生产级 Docker Compose 部署方案。

安全修复 (20 项)：
- IP 校验补全 CGNAT/IETF 协议保留/文档/测试网段，修复 IPv6 Teredo 精确匹配
- probeHostReachable/executeSSHCheck 命令注入防御 (execFile)
- normalizeDb 角色白名单 (admin/engineer/viewer/auditor/customer)
- 服务器入口密码改用 scrypt 并启用 crypto.timingSafeEqual 防时序攻击
- sanitizeUploadFilename 路径穿越防御
- 全局 uncaughtException/unhandledRejection 异常处理器
- 系统设置 POST 8 字段白名单验证
- 文档详情/下载端点 HMAC token 校验 (签名+ID 绑定+10 分钟过期)
- XSS 防护 (textContent 替换 innerHTML)，Cookie Secure 条件设置
- 注册接口 + 前端注册表单 CAPTCHA 验证码
- gracefulShutdown 可重入保护
- 启动时清理遗留 sshpass 临时文件

新增生产支持：
- Dockerfile (npm ci 可复现构建 + 系统工具依赖)
- docker-compose.prod.yml (MySQL 8.4 编排 + 健康检查)
- .env.production.example (28 项环境变量模板)
- PRODUCTION_DEPLOY.md (完整部署文档)
