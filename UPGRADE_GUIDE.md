# 驻场运维管理系统 v1.0.16 构建与升级手册

本文档说明如何在本地构建完整安装包与离线升级包，以及如何把升级包应用到已运行的系统。生产首次部署请先阅读 `PRODUCTION_DEPLOY.md`。

## 1. 交付物

| 文件 | 用途 | 是否含依赖 |
| --- | --- | --- |
| `onsite-ops-system-v1.0.16-production.tar.gz` | 全新安装、跨版本替换 | 否，镜像构建时 `npm ci` |
| `onsite-ops-upgrade-v1.0.16.tar.gz` | 已运行系统在线升级 | 否，只替换应用文件 |
| `onsite-ops-system-v1.0.16.sha256` | 两个产物的校验和 | - |

两个压缩包都按平铺目录打包，解压后直接得到 `server.js`、`public/` 等文件，不会产生额外的父级目录。

## 2. 构建环境

- Node.js 20 LTS（与 `Dockerfile` 的 `node:20-slim` 保持一致）
- npm 10 及以上
- `tar`、`sha256sum`
- 一份可运行的源码目录，包含 `package-lock.json`

构建前先安装依赖，确保 `node_modules` 存在，且 `npm run lint`、`npm run typecheck` 能通过：

```bash
npm ci
npm run lint
npm run typecheck
```

`node_modules`、`data/`、`manifest.json`、`*.tar.gz` 都不会进入两个交付包。运行依赖由镜像内的 `npm ci --omit=dev` 安装。

## 3. 在本地构建完整安装包

确认 `package.json` 中的 `version` 已经是本次发布版本：

```bash
node -e "console.log(require('./package.json').version)"
```

在源码根目录执行打包，注意保持平铺结构并排除本地数据与下载目录：

```bash
tar -czf onsite-ops-system-v1.0.16-production.tar.gz \
  --exclude=public/downloads \
  README.md PRODUCTION_DEPLOY.md UPGRADE_GUIDE.md DEPLOY.md \
  .env.production.example Dockerfile docker-compose.yml docker-compose.prod.yml \
  docker-entrypoint.sh package.json package-lock.json server.js \
  pptx-template.json build-upgrade.js public scripts
```

检查包内容，确认没有父级目录、没有 `data/`、没有 `node_modules/`：

```bash
tar -tzf onsite-ops-system-v1.0.16-production.tar.gz | head -20
```

## 4. 在本地构建离线升级包

离线升级包由仓库内的 `build-upgrade.js` 生成，入口是 `npm run build-upgrade`。

### 4.1 无签名构建（仅限测试环境）

```bash
npm run build-upgrade
```

产物为 `onsite-ops-upgrade-v<version>.tar.gz`，同时生成 `manifest.json`。未设置 `UPGRADE_SIGNING_KEY` 时 manifest 不含 `signature` 字段，脚本会打印提示。生产环境上传这类包会被拒绝。

### 4.2 带签名构建（生产环境必须）

签名密钥必须与目标服务器上运行的 `UPGRADE_SIGNING_KEY` 完全一致，长度不少于 32 位：

```bash
UPGRADE_SIGNING_KEY='与生产环境一致且不少于32位的随机密钥' npm run build-upgrade
```

生成密钥的参考命令：

```bash
openssl rand -hex 32
```

签名密钥的三种来源，优先级从高到低：

1. 容器或进程环境变量 `UPGRADE_SIGNING_KEY`
2. 非生产环境下回退到 `data/upgrade-signing.key`
3. 都没有时，生产环境启动直接失败

已运行的生产系统如果使用了回退密钥文件，用下面命令取出同一份密钥再构建：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec onsite-ops-system cat /app/data/upgrade-signing.key
```

### 4.3 构建输出

成功时输出示例如下：

```text
  SHA256 server.js: 00d62488e748e4cd...
  SHA256 public/index.html: ffd015d5f5a70797...
Upgrade package signed with UPGRADE_SIGNING_KEY
Upgrade package created: onsite-ops-upgrade-v1.0.16.tar.gz (0.7 MB)
Version: 1.0.16
  manifest.json written (18 files)
```

`manifest.json` 会被 `.gitignore` 忽略，只随压缩包分发。

### 4.4 生成校验和

两个产物都要写入 `onsite-ops-system-v1.0.16.sha256`，每行一个文件：

```bash
sha256sum onsite-ops-system-v1.0.16-production.tar.gz \
  onsite-ops-upgrade-v1.0.16.tar.gz > onsite-ops-system-v1.0.16.sha256
```

下载后校验：

```bash
sha256sum -c onsite-ops-system-v1.0.16.sha256
```

## 5. 升级包结构

升级包固定包含以下内容：

- `server.js`
- `package.json`
- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `docker-entrypoint.sh`
- `pptx-template.json`
- `public/`（排除 `public/downloads`）
- `scripts/`
- `manifest.json`

`manifest.json` 结构：

```json
{
  "version": "1.0.16",
  "files": ["server.js", "public/index.html", "..."],
  "sha256": {
    "server.js": "64 位十六进制摘要",
    "public/index.html": "64 位十六进制摘要"
  },
  "signature": "64 位十六进制 HMAC"
}
```

签名算法：

1. 取 `version`、`files`、`sha256` 三个字段
2. 对 JSON 对象的键递归排序后序列化
3. 用 `UPGRADE_SIGNING_KEY` 做 `HMAC-SHA256`
4. 结果以小写十六进制写入 `signature`

服务端接收升级包时会依次校验：

- 压缩包解压后体积不超过 512 MB，文件数不超过 20000
- 每个文件必须出现在 `manifest.files` 中，不允许存在未声明文件
- 每个文件的 SHA256 必须与清单一致，且清单不能包含未声明的额外条目
- 生产环境必须带签名，签名不匹配直接拒绝

校验不通过时接口返回 400，错误信息写入升级日志，页面「系统治理 - 软件升级」可查看。

## 6. 通过页面执行在线升级

1. 用管理员账号登录，进入「系统治理 - 软件升级」
2. 上传 `onsite-ops-upgrade-v1.0.16.tar.gz`
3. 上传完成后重启容器，由 `docker-entrypoint.sh` 应用升级

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart
```

重启后查看升级日志：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  logs --tail=100 onsite-ops-system
```

日志中出现 `[upgrade] Upgrade complete. Current version: 1.0.16` 表示应用成功。旧文件会归档到 `data/upgrades/<时间戳>/`。

`docker compose restart` 只重启容器，不会重建镜像。升级包替换的是容器内的 `/app` 目录，属于临时层；要让变更在重新创建容器后继续生效，还需按第 7 节重建镜像。

## 7. 通过完整安装包升级

适用于跨大版本升级，或需要重建镜像的场景。

### 7.1 备份

先在系统内执行一次系统备份，并保留上一版本的完整安装包与 `data/` 目录：

```bash
cd /opt/onsite-ops-system
cp -a data data.backup.$(date +%Y%m%d%H%M%S)
```

### 7.2 替换文件并重建

```bash
cd /opt/onsite-ops-system
tar -xzf onsite-ops-system-v1.0.16-production.tar.gz
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

`up -d --build` 会重新执行 `npm ci --omit=dev` 并复制新的 `public/`、`scripts/`。仅执行 `restart` 时容器继续使用旧镜像。

### 7.3 手动 Node.js 部署

```bash
npm ci --omit=dev
systemctl restart onsite-ops-system
```

## 8. 升级后验证

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

页面侧确认：

- 登录页可正常加载，浏览器控制台无 CSP 报错
- 管理员可登录，侧栏版本号显示 `1.0.16`
- 资产、巡检、资料、系统备份各打开一次
- 「系统治理 - 软件升级」显示当前版本与升级记录

## 9. 回滚

1. 停止服务
2. 用上一版本完整安装包覆盖 `server.js`、`public/`、`scripts/` 等文件
3. 恢复升级前的 `data/` 目录
4. 重新构建并启动

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
tar -xzf onsite-ops-system-v1.0.15-production.tar.gz
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

数据库结构变更由升级包内的 `migrate.sh` 执行，回滚到旧版本前必须先恢复对应的数据备份。

## 10. 常见问题

### 10.1 上传提示「升级包缺少签名」

当前是生产环境，但包是无签名构建。用生产密钥重新执行第 4.2 节。

### 10.2 上传提示「升级包签名校验失败」

构建用的 `UPGRADE_SIGNING_KEY` 与服务器不一致。核对两边的密钥值，或从服务器 `data/upgrade-signing.key` 取回密钥后重新构建。

### 10.3 上传提示「升级包 SHA256 校验失败」

构建后手工修改过包内文件，或传输过程中损坏。重新构建，并重新生成 `.sha256` 文件。

### 10.4 上传提示「升级包存在未声明文件」

打包时额外塞入了 `manifest.json` 之外的文件。只使用 `npm run build-upgrade` 生成的压缩包，不要手工追加文件。

### 10.5 重启后版本没有变化

依次确认：升级包已上传成功；容器确实执行过重启；日志中有 `[upgrade] Applying upgrade`；`data/upgrades/pending/UPGRADE_READY` 在重启前存在。如果使用完整包升级，确认执行的是 `up -d --build`。

### 10.6 页面升级入口只接受旧格式压缩包

v1.0.8 及更早版本不支持当前清单格式，按第 7 节用完整安装包替换文件并重建镜像。

### 10.7 解压报「File exists」「Permission denied」

宿主机 `data/upgrades/pending` 由 root 创建或被 root 写过，容器内的 `node`（uid 1000）无法清理和覆盖，旧版本会把删除失败吞掉，随后解压报大量 `Cannot open: File exists` 与 `Cannot mkdir: Permission denied`。

在宿主机上清理并纠正属主后重试：

```bash
cd /opt/onsite-ops-system
sudo rm -rf data/upgrades/pending data/upgrades/temp-upgrade.tar.gz
sudo chown -R 1000:1000 data
```

解压失败时不会写入 `UPGRADE_READY`，容器不会应用半成品包，清理后重新上传即可。避免在宿主机用 `sudo` 直接解压升级包，或在容器内以 `-u root` 执行操作。

### 10.8 容器反复重启

查看 `docker compose logs`。常见原因是缺少 `DOCUMENT_TOKEN_SECRET`、`ENCRYPTION_KEY`、`UPGRADE_SIGNING_KEY`，或密钥长度不足 32 位。

## 11. 构建自检清单

- `package.json` 版本号与产物文件名一致
- `npm run lint` 通过
- `npm run typecheck` 通过
- `npm run regression` 通过
- 完整安装包解压后为平铺结构，不含 `data/`、`node_modules/`
- 升级包带 `signature` 字段，签名密钥与目标环境一致
- `.sha256` 文件包含完整包与升级包两行
- Release 附件与校验和文件来自同一次构建
