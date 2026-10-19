#!/bin/sh
# Docker entrypoint - applies pending upgrades before starting the server
UPGRADE_DIR="/app/data/upgrades"
PENDING_DIR="$UPGRADE_DIR/pending"
READY_FLAG="$UPGRADE_DIR/UPGRADE_READY"
HASHES_FILE="$PENDING_DIR/SHA256SUMS"

if [ -f "$READY_FLAG" ] && [ -d "$PENDING_DIR" ]; then
  echo "[upgrade] Applying upgrade from $PENDING_DIR"

  FILES_COPIED=0

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

  copy_file "$PENDING_DIR/server.js" /app/server.js && FILES_COPIED=$((FILES_COPIED + 1))
  copy_file "$PENDING_DIR/package.json" /app/package.json && FILES_COPIED=$((FILES_COPIED + 1))

  if [ -d "$PENDING_DIR/public" ]; then
    copy_dir "$PENDING_DIR/public" /app/public public && FILES_COPIED=$((FILES_COPIED + 1))
  fi

  if [ -d "$PENDING_DIR/scripts" ]; then
    copy_dir "$PENDING_DIR/scripts" /app/scripts scripts
  fi

  copy_file "$PENDING_DIR/Dockerfile" /app/Dockerfile
  copy_file "$PENDING_DIR/docker-compose.yml" /app/docker-compose.yml
  copy_file "$PENDING_DIR/docker-compose.prod.yml" /app/docker-compose.prod.yml
  copy_file "$PENDING_DIR/pptx-template.json" /app/pptx-template.json
  copy_file "$PENDING_DIR/docker-entrypoint.sh" /app/docker-entrypoint.sh
  # 入口脚本可执行位丢失不会阻止启动（镜像用 sh 显式调用），但仍需尽量纠正。
  [ -f /app/docker-entrypoint.sh ] && chmod 755 /app/docker-entrypoint.sh 2>/dev/null

  if [ -f "$PENDING_DIR/migrate.sh" ]; then
    if [ -f "$HASHES_FILE" ]; then
      EXPECTED=$(grep 'migrate.sh$' "$HASHES_FILE" | awk '{print $1}')
      ACTUAL=$(sha256sum "$PENDING_DIR/migrate.sh" | awk '{print $1}')
      if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ]; then
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
