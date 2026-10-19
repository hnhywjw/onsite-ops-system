# 驻场运维管理系统构建与升级手册

本文中的 `<version>` 指 `package.json` 中的当前版本号，可用下面的命令取值：

```bash
V=$(node -e "console.log(require('./package.json').version)")
```

本文档说明如何在本地构建完整安装包与离线升级包，以及如何把升级包应用到已运行的系统。生产首次部署请先阅读 `PRODUCTION_DEPLOY.md`。

## 1. 交付物

| 文件 | 用途 | 是否含依赖 |
| --- | --- | --- |
| `onsite-ops-system-v<version>-production.tar.gz` | 全新安装、跨版本替换 | 否，镜像构建时 `npm ci` |
| `onsite-ops-upgrade-v<version>.tar.gz` | 已运行系统在线升级 | 否，只替换应用文件 |
| `onsite-ops-system-v<version>.sha256` | 两个产物的校验和 | - |

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
tar -czf "onsite-ops-system-v$V-production.tar.gz" \
  --exclude=public/downloads \
  README.md PRODUCTION_DEPLOY.md UPGRADE_GUIDE.md DEPLOY.md \
  .env.production.example Dockerfile docker-compose.yml docker-compose.prod.yml \
  docker-entrypoint.sh package.json package-lock.json server.js \
  pptx-template.json build-upgrade.js public scripts
```

检查包内容，确认没有父级目录、没有 `data/`、没有 `node_modules/`：

```bash
tar -tzf "onsite-ops-system-v$V-production.tar.gz" | head -20
```

## 4. 制作离线升级包

离线升级包由仓库内的 `build-upgrade.js` 生成，入口是 `npm run build-upgrade`。本节覆盖从取得密钥到本地自检的完整流程。

### 4.1 为什么提示「升级包缺少签名」

生产环境（`NODE_ENV=production`）上传升级包时会强制校验 HMAC 签名。Release 中的升级包可能由发布方用构建密钥签名，而每个部署环境的 `UPGRADE_SIGNING_KEY` 各不相同，签名对不上时同样会被拒绝，提示「升级包缺少签名」或「升级包签名校验失败」。

这是设计如此：签名密钥不能进入公开仓库，任何拿到密钥的人都能伪造升级包。每个部署环境必须用自己的密钥在本地重新构建升级包。

相关校验逻辑：

- 生产环境：`signature` 缺失直接拒绝；签名不匹配拒绝
- 非生产环境：`signature` 缺失时放行，存在时仍会校验
- 服务端未配置不少于 32 位的签名密钥时，报「系统未配置升级签名密钥」

### 4.2 准备条件

- 与目标版本一致的源码目录（完整安装包解压即可，例如 `onsite-ops-system-v<version>-production.tar.gz`）
- Node.js 20 LTS 及以上，`tar` 可用
- 目标服务器当前的 `UPGRADE_SIGNING_KEY`
- 目标服务器当前版本低于待安装版本，服务端不接受平级或降级包

构建过程不安装依赖、不连接数据库，只需 Node 标准库和 `tar`。

### 4.3 取得生产环境的签名密钥

密钥必须与目标服务器运行时的 `UPGRADE_SIGNING_KEY` 逐字符一致。按部署方式选择取值方式。

方式一：从 `.env.production` 读取。

```bash
cd /opt/onsite-ops-system
KEY=$(sed -n 's/^UPGRADE_SIGNING_KEY=//p' .env.production | tail -1 | tr -d '"'"'"'')
printf 'key length: %s\n' "${#KEY}"
```

方式二：从运行中的容器读取，适用于密钥由编排平台注入、未落在文件里的场景。

```bash
cd /opt/onsite-ops-system
KEY=$(docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T onsite-ops-system printenv UPGRADE_SIGNING_KEY | tr -d '\r\n')
printf 'key length: %s\n' "${#KEY}"
```

`exec` 必须带 `-T`。缺少该参数时输出会带 `\r`，签出来的包必然校验失败。

方式三：密钥存放在密码管理器或 KMS 中，直接注入到构建命令的环境变量。

```bash
read -rs UPGRADE_SIGNING_KEY
export UPGRADE_SIGNING_KEY
printf 'key length: %s\n' "${#UPGRADE_SIGNING_KEY}"
```

三点注意：

- 生产环境不会回退到 `data/upgrade-signing.key`，该文件仅在非生产环境生效；生产环境缺失密钥会在启动时直接失败
- 密钥经 `.trim()` 处理后参与计算，前后空格会被去掉，取值时不必手工清理
- 不要把密钥写进命令行历史。用 `read -rs` 或从文件读取，避免 `export KEY='明文'` 留在 `history`

### 4.4 生成新环境的签名密钥

首次部署或需要轮换时生成，长度 64 个十六进制字符，满足不少于 32 位的要求。

```bash
openssl rand -hex 32
```

写入 `.env.production` 后必须重建容器才会生效：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

密钥变更后，此前用旧密钥签名的升级包全部失效，需要用新密钥重新构建。

### 4.5 构建签名升级包

在源码目录中执行，`UPGRADE_SIGNING_KEY` 通过环境变量传入，不修改任何文件。

```bash
cd /tmp/build-$V
UPGRADE_SIGNING_KEY="$KEY" UPGRADE_REQUIRE_SIGNATURE=1 npm run build-upgrade
```

`UPGRADE_REQUIRE_SIGNATURE=1` 会在密钥缺失或不足 32 位时直接失败，避免误产出未签名包。发布流水线建议始终带上该变量。

宿主机没有 Node 时，用官方镜像挂载源码目录构建：

```bash
docker run --rm -v /tmp/build-$V:/src -w /src \
  -e UPGRADE_SIGNING_KEY="$KEY" -e UPGRADE_REQUIRE_SIGNATURE=1 \
  node:20-slim node build-upgrade.js
```

容器以 root 写入产物，上传前把属主改回当前用户：

```bash
sudo chown "$(id -u):$(id -g)" "/tmp/build-$V/onsite-ops-upgrade-v$V.tar.gz" \
  "/tmp/build-$V/manifest.json"
```

### 4.6 构建输出

成功时输出如下，关键行是 `Upgrade package signed with UPGRADE_SIGNING_KEY`：

```text
  SHA256 server.js: 00d62488e748e4cd...
  SHA256 public/index.html: ffd015d5f5a70797...
Upgrade package signed with UPGRADE_SIGNING_KEY
Upgrade package created: onsite-ops-upgrade-v<version>.tar.gz (0.7 MB)
Version: <version>
  manifest.json written (19 files)
```

出现 `manifest has no signature` 说明密钥没有传进构建进程，检查命令前缀是否正确、变量是否为空。`manifest.json` 被 `.gitignore` 忽略，只随压缩包分发。

### 4.7 上传前本地自检

用同一个密钥在本地复算签名，确认包能被生产端接受：

```bash
UPGRADE_SIGNING_KEY="$KEY" npm run verify-upgrade -- "onsite-ops-upgrade-v$V.tar.gz"
```

通过时输出：

```text
校验通过：版本 <version>，19 个文件，签名有效
```

自检覆盖清单文件一致性、每个文件的 SHA256、清单是否存在未声明条目与文件，以及 HMAC 签名是否与当前密钥匹配。任何一项不通过都会以非零退出码结束并指出具体原因。

### 4.8 生成校验和

两个产物都要写入 `onsite-ops-system-v<version>.sha256`，每行一个文件：

```bash
sha256sum "onsite-ops-system-v$V-production.tar.gz" \
  "onsite-ops-upgrade-v$V.tar.gz" > "onsite-ops-system-v$V.sha256"
```

下载后校验：

```bash
sha256sum -c "onsite-ops-system-v$V.sha256"
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
  "version": "<version>",
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
2. 上传 `onsite-ops-upgrade-v<version>.tar.gz`
3. 上传完成后重启容器，由 `docker-entrypoint.sh` 应用升级

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart
```

重启后查看升级日志：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  logs --tail=100 onsite-ops-system
```

日志中出现 `[upgrade] Upgrade complete. Current version: <version>` 表示应用成功。旧文件会归档到 `data/upgrades/<时间戳>/`。

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
tar -xzf "onsite-ops-system-v$V-production.tar.gz"
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
- 管理员可登录，侧栏版本号与 `package.json` 一致
- 资产、巡检、资料、系统备份各打开一次
- 「系统治理 - 软件升级」显示当前版本与升级记录

## 9. 回滚

1. 停止服务
2. 用上一版本完整安装包覆盖 `server.js`、`public/`、`scripts/` 等文件
3. 恢复升级前的 `data/` 目录
4. 重新构建并启动

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
tar -xzf "onsite-ops-system-v<上一版本>-production.tar.gz"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

数据库结构变更由升级包内的 `migrate.sh` 执行，回滚到旧版本前必须先恢复对应的数据备份。

## 10. 常见问题

### 10.1 上传提示「升级包缺少签名」

生产环境，但包是无签名构建，或包内的签名与服务器密钥不匹配。按第 4.3 到 4.5 节取得密钥并重新构建。

### 10.2 上传提示「升级包签名校验失败」

构建用的 `UPGRADE_SIGNING_KEY` 与服务器不一致。用第 4.3 节的方式二从容器取值，重新构建后再用 `npm run verify-upgrade` 自检。常见原因是取了 `.env.production` 里被注释掉的旧值，或 `exec` 没加 `-T` 导致密钥尾部带 `\r`。

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

### 10.8 重启报 `/app/docker-entrypoint.sh permission denied`

升级包里的 `docker-entrypoint.sh` 若没有可执行位，落地时会覆盖镜像内原本 0755 的脚本，容器下次启动直接失败：

```text
exec: "/app/docker-entrypoint.sh": permission denied
```

早期版本的升级逻辑用 `copyFileSync` 落地文件，会沿用包内权限；当时的仓库把该脚本记录为 0644。容器已经在运行，因此上传升级包时不会报错，重启才暴露。

恢复方式一，重建镜像：

```bash
cd /opt/onsite-ops-system
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

`Dockerfile` 中的 `RUN chmod +x /app/docker-entrypoint.sh` 会恢复权限。`data/` 是绑定挂载，数据不受影响。

恢复方式二，不重建镜像，直接补回权限：

```bash
cd /opt/onsite-ops-system
CID=$(docker compose --env-file .env.production -f docker-compose.prod.yml ps -aq onsite-ops-system)
install -m 755 docker-entrypoint.sh /tmp/docker-entrypoint.sh
docker cp /tmp/docker-entrypoint.sh "$CID":/app/docker-entrypoint.sh
docker compose --env-file .env.production -f docker-compose.prod.yml start onsite-ops-system
```

`install -m 755` 先生成本机一份带可执行位的副本，`docker cp` 会沿用该权限。容器已停止时仍可执行 `docker cp`。

后续版本已修复：仓库中该文件改为 100755，`npm run lint` 会检查可执行位，`build-upgrade.js` 打包前纠正权限，服务端落地后强制 `chmod 0o755`，`Dockerfile` 改用 `ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]` 兜底。

### 10.9 容器反复重启

查看 `docker compose logs`。常见原因是缺少 `DOCUMENT_TOKEN_SECRET`、`ENCRYPTION_KEY`、`UPGRADE_SIGNING_KEY`，或密钥长度不足 32 位。

## 11. 构建自检清单

- `package.json` 版本号与产物文件名一致
- `npm run lint` 通过
- `npm run typecheck` 通过
- `npm run regression` 通过
- 完整安装包解压后为平铺结构，不含 `data/`、`node_modules/`
- 升级包带 `signature` 字段，签名密钥与目标环境一致
- `npm run verify-upgrade -- <包>` 输出「校验通过」
- `.sha256` 文件包含完整包与升级包两行
- Release 附件与校验和文件来自同一次构建
