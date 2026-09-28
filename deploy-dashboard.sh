#!/bin/bash
set -e

PROJECT_DIR="/root/sindicato_rp_coolify/dashboard"
DEPLOY_DIR="/home/fivem/dashboard"
PORT=8081

echo "==> Building dashboard..."
cd "$PROJECT_DIR"
npm run build

echo "==> Copying to deploy dir..."
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
cp -r "$PROJECT_DIR/.next" "$DEPLOY_DIR/"
cp "$PROJECT_DIR/package.json" "$DEPLOY_DIR/"
cp -r "$PROJECT_DIR/node_modules" "$DEPLOY_DIR/"

echo "==> Starting dashboard on port $PORT..."
cd "$DEPLOY_DIR"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:?defina DASHBOARD_PASSWORD}" \
GIT_TOKEN="${GIT_TOKEN:?defina GIT_TOKEN}" \
GIT_REPO='https://github.com/faccodev/sindicato_dashboard' \
DATA_DIR='/home/fivem/server-data' \
PORT=$PORT \
node_modules/.bin/next start -p $PORT