#!/bin/bash
# CoThink AI 一键部署脚本
# 用法: bash scripts/deploy.sh
set -e

cd /opt/cothink

echo "=== 1. Git Pull ==="
git pull origin main

echo "=== 2. Build backend image ==="
docker compose build backend
# ai-worker 和 grading-worker 共享 cothink-backend:latest 镜像，无需单独 build

echo "=== 3. Build y-websocket ==="
docker compose build y-websocket

echo "=== 4. Restart services ==="
docker compose up -d --force-recreate

echo "=== 5. Wait for healthy ==="
sleep 10

echo "=== 6. Status ==="
docker compose ps --format "table {{.Name}}\t{{.Status}}"

echo "=== 7. Health check ==="
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/healthz)
echo "healthz: $HEALTH"

if [ "$HEALTH" != "200" ]; then
    echo "WARNING: Health check failed!"
    docker compose logs backend --tail 10
    exit 1
fi

echo "=== Deploy complete ==="
