#!/bin/bash
set -e

DATA_DIR="${DATA_DIR:-/home/fivem/server-data}"
BRANCH="main"

if [ -z "$GIT_TOKEN" ]; then
    echo "ERROR: GIT_TOKEN not set."
    exit 1
fi

AUTH_URL="https://x-access-token:${GIT_TOKEN}@github.com/faccodev/sindicatorp.git"

echo "=== Git Sync ==="
echo "Data: $DATA_DIR"
echo "Branch: $BRANCH"

# ── First run: shallow clone ────────────────────────────────────────────────────
if [ ! -d "$DATA_DIR/.git" ]; then
    echo "[INIT] First run — shallow clone (depth=1)..."
    git clone --depth 1 --branch "$BRANCH" "$AUTH_URL" "$DATA_DIR"
    echo "[INIT] Done."
    git -C "$DATA_DIR" log -1 --format="Commit: %h - %s"
    exit 0
fi

# ── Fetch + fast-forward ───────────────────────────────────────────────────────
git -C "$DATA_DIR" fetch --depth 1 origin "$BRANCH"

CURRENT=$(git -C "$DATA_DIR" rev-parse HEAD)
UPSTREAM=$(git -C "$DATA_DIR" rev-parse "origin/$BRANCH")

if [ "$CURRENT" = "$UPSTREAM" ]; then
    echo "[SKIP] Já está em origin/$BRANCH ($CURRENT) — nada a fazer."
    git -C "$DATA_DIR" log -1 --format="Commit: %h - %s"
    exit 0
fi

echo "[PULL] Atualizando para origin/$BRANCH..."
git -C "$DATA_DIR" merge --ff-only "origin/$BRANCH"

echo ""
echo "=== Sync concluído ==="
git -C "$DATA_DIR" log -1 --format="Commit: %h - %s (%an)"
