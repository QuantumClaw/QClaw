#!/usr/bin/env bash
# Push QClaw to GitHub without failing
# Usage: bash scripts/push.sh "commit message"

set -e

MSG="${1:-feat: MCP tools + API tools + knowledge graph engine}"

cd "$(dirname "$0")/.."

# Stage everything
git add -A

# Check if there's anything to commit
if git diff --cached --quiet; then
  echo "Nothing to commit"
  exit 0
fi

# Commit
git commit -m "$MSG"

# Push (handle both main and master)
BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
git push origin "$BRANCH" 2>&1 || git push origin "$BRANCH" --force-with-lease 2>&1

echo "✓ Pushed to $BRANCH"
