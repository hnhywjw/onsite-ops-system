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
    if [ -f "$src" ]; then
      if cp "$src" "$dest"; then
        echo "[upgrade] Copied $(basename "$src")"
        return 0
      else
        echo "[upgrade] Failed to copy $(basename "$src")" >&2
        return 1
      fi
    fi
    return 1
  }

  copy_file "$PENDING_DIR/server.js" /app/server.js && FILES_COPIED=$((FILES_COPIED + 1))
  copy_file "$PENDING_DIR/package.json" /app/package.json && FILES_COPIED=$((FILES_COPIED + 1))

  if [ -d "$PENDING_DIR/public" ]; then
    if cp -r "$PENDING_DIR/public" /app/public.new && rm -rf /app/public && mv /app/public.new /app/public; then
      echo "[upgrade] Copied public/"
      FILES_COPIED=$((FILES_COPIED + 1))
    else
      echo "[upgrade] Failed to copy public/" >&2
      rm -rf /app/public.new 2>/dev/null
    fi
  fi

  if [ -d "$PENDING_DIR/scripts" ]; then
    if cp -r "$PENDING_DIR/scripts" /app/scripts.new && rm -rf /app/scripts && mv /app/scripts.new /app/scripts; then
      echo "[upgrade] Copied scripts/"
    else
      echo "[upgrade] Failed to copy scripts/" >&2
      rm -rf /app/scripts.new 2>/dev/null
    fi
  fi

  copy_file "$PENDING_DIR/Dockerfile" /app/Dockerfile
  copy_file "$PENDING_DIR/docker-compose.yml" /app/docker-compose.yml
  copy_file "$PENDING_DIR/docker-compose.prod.yml" /app/docker-compose.prod.yml
  copy_file "$PENDING_DIR/pptx-template.json" /app/pptx-template.json
  copy_file "$PENDING_DIR/docker-entrypoint.sh" /app/docker-entrypoint.sh

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
  mv "$PENDING_DIR" "$ARCHIVE_DIR/pending_backup" 2>/dev/null
  mv "$READY_FLAG" "$ARCHIVE_DIR/UPGRADE_READY" 2>/dev/null
  NEW_VER=$(node -e "try{const p=require('/app/package.json');console.log(p.version||'')}catch(_){console.log('')}")
  echo "[upgrade] Upgrade complete. Current version: ${NEW_VER:-N/A}"
fi

exec node /app/server.js
