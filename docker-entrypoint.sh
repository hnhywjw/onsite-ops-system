#!/bin/sh
# Docker entrypoint - applies pending upgrades before starting the server
UPGRADE_DIR="/app/data/upgrades"
PENDING_DIR="$UPGRADE_DIR/pending"
READY_FLAG="$UPGRADE_DIR/UPGRADE_READY"
HASHES_FILE="$PENDING_DIR/SHA256SUMS"

mkdir -p "$UPGRADE_DIR" 2>/dev/null

if [ -f "$READY_FLAG" ] && [ -d "$PENDING_DIR" ]; then
  echo "[upgrade] Applying upgrade from $PENDING_DIR"

  CRITICAL_FAILED=0

  # 包内容必须与上传时生成的 SHA256SUMS 一致，避免 data 目录被篡改后启动即执行。
  if [ ! -f "$HASHES_FILE" ]; then
    echo "[upgrade] 缺少 SHA256SUMS，保留 pending 且不应用升级" >&2
    exec node /app/server.js
  fi
  if ! (cd "$PENDING_DIR" && sha256sum -c "$HASHES_FILE" >/dev/null 2>&1); then
    echo "[upgrade] SHA256 校验失败，保留 pending 且不应用升级" >&2
    exec node /app/server.js
  fi

  copy_file() {
    local src="$1"
    local dest="$2"
    [ -f "$src" ] || return 1
    if [ -f "$dest" ] && [ "$(sha256sum "$src" | awk '{print $1}')" = "$(sha256sum "$dest" | awk '{print $1}')" ]; then
      echo "[upgrade] Unchanged $(basename "$src")"
      return 0
    fi
    local tmp="${dest}.upgrade.$$"
    # 直接覆盖可能因目标文件属主为 root 而 EACCES，先写临时文件再 rename 只依赖目录写权限。
    if cp "$src" "$tmp" 2>/dev/null && mv -f "$tmp" "$dest" 2>/dev/null; then
      echo "[upgrade] Copied $(basename "$src")"
      return 0
    fi
    rm -f "$tmp" 2>/dev/null
    echo "[upgrade] Failed to copy $(basename "$src")" >&2
    return 1
  }

  copy_dir() {
    local src="$1"
    local dest="$2"
    local name="$3"
    local staged="${dest}.upgrade.$$"
    local backup="${dest}.upgrade-old.$$"
    rm -rf "$staged" 2>/dev/null
    if ! cp -r "$src" "$staged"; then
      rm -rf "$staged" 2>/dev/null
      echo "[upgrade] Failed to copy $name/" >&2
      return 1
    fi
    if [ -e "$dest" ] && ! mv "$dest" "$backup"; then
      rm -rf "$staged" 2>/dev/null
      echo "[upgrade] Failed to replace $name/" >&2
      return 1
    fi
    if ! mv "$staged" "$dest"; then
      [ -e "$backup" ] && mv "$backup" "$dest" 2>/dev/null
      rm -rf "$staged" 2>/dev/null
      echo "[upgrade] Failed to activate $name/" >&2
      return 1
    fi
    rm -rf "$backup" 2>/dev/null
    echo "[upgrade] Copied $name/"
    return 0
  }

  copy_file "$PENDING_DIR/server.js" /app/server.js || CRITICAL_FAILED=1
  copy_file "$PENDING_DIR/package.json" /app/package.json || CRITICAL_FAILED=1

  if [ -d "$PENDING_DIR/public" ]; then
    copy_dir "$PENDING_DIR/public" /app/public public || CRITICAL_FAILED=1
  fi

  if [ -d "$PENDING_DIR/scripts" ]; then
    copy_dir "$PENDING_DIR/scripts" /app/scripts scripts || CRITICAL_FAILED=1
  fi

  copy_file "$PENDING_DIR/Dockerfile" /app/Dockerfile
  copy_file "$PENDING_DIR/docker-compose.yml" /app/docker-compose.yml
  copy_file "$PENDING_DIR/docker-compose.prod.yml" /app/docker-compose.prod.yml
  copy_file "$PENDING_DIR/pptx-template.json" /app/pptx-template.json
  copy_file "$PENDING_DIR/docker-entrypoint.sh" /app/docker-entrypoint.sh
  # 入口脚本可执行位丢失不会阻止启动（镜像用 sh 显式调用），但仍需尽量纠正。
  [ -f /app/docker-entrypoint.sh ] && chmod 755 /app/docker-entrypoint.sh 2>/dev/null

  # 关键文件失败时保留 pending 并启动旧代码，避免新前端配旧后端的半升级状态。
  if [ "$CRITICAL_FAILED" -eq 1 ]; then
    echo "[upgrade] 关键文件应用失败，保留 pending 等待下次重启重试" >&2
    exec node /app/server.js
  fi

  if [ -f "$PENDING_DIR/migrate.sh" ]; then
    if [ -f "$HASHES_FILE" ]; then
      EXPECTED=$(grep 'migrate.sh$' "$HASHES_FILE" | awk '{print $1}')
      ACTUAL=$(sha256sum "$PENDING_DIR/migrate.sh" | awk '{print $1}')
      if [ -z "$EXPECTED" ]; then
        echo "[upgrade] migrate.sh 未在 SHA256SUMS 中声明，跳过执行" >&2
      elif [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "[upgrade] migrate.sh SHA256 mismatch, skipping migration" >&2
      else
        echo "[upgrade] Running migration script"
        sh "$PENDING_DIR/migrate.sh" && echo "[upgrade] Migration completed" || echo "[upgrade] Migration failed" >&2
      fi
    else
      echo "[upgrade] No SHA256SUMS found, skipping migration for safety" >&2
    fi
  fi

  TIMESTAMP=$(date +%Y%m%d%H%M%S)
  ARCHIVE_DIR="$UPGRADE_DIR/$TIMESTAMP"
  mkdir -p "$ARCHIVE_DIR"
  mv "$PENDING_DIR" "$ARCHIVE_DIR/pending_backup" || echo "[upgrade] Failed to archive pending dir" >&2
  mv "$READY_FLAG" "$ARCHIVE_DIR/UPGRADE_READY" || echo "[upgrade] Failed to archive ready flag" >&2
  NEW_VER=$(node -e "try{const p=require('/app/package.json');console.log(p.version||'')}catch(_){console.log('')}")
  echo "[upgrade] Upgrade complete. Current version: ${NEW_VER:-N/A}"
fi

exec node /app/server.js
