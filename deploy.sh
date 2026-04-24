#!/bin/bash
set -e

echo "=== VivaFrutaz Deploy Script ==="
echo ""

# Check required env vars
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "[OK] Loaded .env"
fi

# Create backup before deploy
BACKUP_DIR="backups/system/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "[BACKUP] Saved to $BACKUP_DIR"

# Install dependencies
echo "[INSTALL] Installing dependencies..."
npm ci --omit=dev

# Push database schema
echo "[DB] Pushing schema..."
npm run db:push

# Build (if applicable)
if [ -f "tsconfig.json" ]; then
  echo "[BUILD] Building..."
  npm run build 2>/dev/null || echo "[WARN] Build step skipped (dev mode)"
fi

# Start or restart application
if command -v pm2 &>/dev/null; then
  echo "[PM2] Starting with PM2..."
  pm2 startOrRestart ecosystem.config.js --env production
  pm2 save
else
  echo "[START] Starting application..."
  NODE_ENV=production node dist/index.js &
  echo "[OK] Application started (PID $!)"
fi

echo ""
echo "=== Deploy complete! ==="
