#!/bin/sh
# Docker entrypoint - applies pending upgrades before starting the server
UPGRADE_DIR="/app/data/upgrades"
PENDING_DIR="$UPGRADE_DIR/pending"
READY_FLAG="$UPGRADE_DIR/UPGRADE_READY"

if [ -f "$READY_FLAG" ] && [ -d "$PENDING_DIR" ]; then
  echo "[upgrade] Applying upgrade from $PENDING_DIR"

  FILES_COPIED=0
  for src in "$PENDING_DIR/server.js" "$PENDING_DIR/package.json"; do
    if [ -f "$src" ]; then
      cp "$src" "/app/$src" 2>/dev/null && echo "[upgrade] Copied $(basename "$src")" && FILES_COPIED=$((FILES_COPIED + 1))
    fi
  done

  if [ -d "$PENDING_DIR/public" ]; then
    rm -rf /app/public 2>/dev/null
    cp -r "$PENDING_DIR/public" /app/public 2>/dev/null && echo "[upgrade] Copied public/" && FILES_COPIED=$((FILES_COPIED + 1))
  fi

  if [ -d "$PENDING_DIR/scripts" ]; then
    cp -r "$PENDING_DIR/scripts" /app/scripts 2>/dev/null && echo "[upgrade] Copied scripts/"
  fi

  if [ -f "$PENDING_DIR/Dockerfile" ]; then
    cp "$PENDING_DIR/Dockerfile" /app/Dockerfile 2>/dev/null && echo "[upgrade] Copied Dockerfile"
  fi

  if [ -f "$PENDING_DIR/docker-compose.prod.yml" ]; then
    cp "$PENDING_DIR/docker-compose.prod.yml" /app/docker-compose.prod.yml 2>/dev/null && echo "[upgrade] Copied docker-compose.prod.yml"
  fi

  if [ -f "$PENDING_DIR/migrate.sh" ]; then
    echo "[upgrade] Running migration script"
    sh "$PENDING_DIR/migrate.sh" && echo "[upgrade] Migration completed" || echo "[upgrade] Migration failed"
  fi

  TIMESTAMP=$(date +%Y%m%d%H%M%S)
  ARCHIVE_DIR="$UPGRADE_DIR/$TIMESTAMP"
  if [ $FILES_COPIED -gt 0 ]; then
    mkdir -p "$ARCHIVE_DIR"
    mv "$PENDING_DIR" "$ARCHIVE_DIR/pending_backup" 2>/dev/null
    mv "$READY_FLAG" "$ARCHIVE_DIR/UPGRADE_READY" 2>/dev/null
    NEW_VER=$(node -e "try{const p=require('/app/package.json');console.log(p.version||'')}catch(_){console.log('')}")
    echo "[upgrade] Upgrade complete. Current version: ${NEW_VER:-N/A}"
  else
    echo "[upgrade] No file changes detected, skipping upgrade"
  fi
fi

exec node /app/server.js
