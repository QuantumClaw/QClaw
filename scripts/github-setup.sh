#!/bin/bash
#
# Run this ONCE after creating the GitHub repo to set:
# - Description
# - Topics
# - Homepage
# - Settings (issues, discussions, wiki, projects)
#
# Usage: GITHUB_TOKEN=ghp_xxx ./scripts/github-setup.sh
#
# You can also set these manually in the repo Settings page.

REPO="QuantumClaw/QClaw"
TOKEN="${GITHUB_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Set GITHUB_TOKEN first: export GITHUB_TOKEN=ghp_xxx"
  echo ""
  echo "Or set these manually at: https://github.com/$REPO/settings"
  echo ""
  echo "Description: Open-source AI agent runtime with a knowledge graph for a brain. Runs anywhere."
  echo ""
  echo "Topics: ai-agent, knowledge-graph, cognee, personal-assistant, autonomous-agents,"
  echo "        telegram-bot, self-hosted, nodejs, open-source, business-automation"
  echo ""
  echo "Homepage: https://github.com/$REPO#readme"
  exit 1
fi

echo "Setting repo description and homepage..."
curl -s -X PATCH "https://api.github.com/repos/$REPO" \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d '{
    "description": "Open-source AI agent runtime with a knowledge graph for a brain. Runs anywhere.",
    "homepage": "https://github.com/QuantumClaw/QClaw#readme",
    "has_issues": true,
    "has_discussions": true,
    "has_wiki": false,
    "has_projects": false,
    "allow_squash_merge": true,
    "allow_merge_commit": false,
    "allow_rebase_merge": true,
    "delete_branch_on_merge": true
  }' | jq '.full_name, .description' 2>/dev/null || echo "Done (install jq for pretty output)"

echo ""
echo "Setting topics..."
curl -s -X PUT "https://api.github.com/repos/$REPO/topics" \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.mercy-preview+json" \
  -d '{
    "names": [
      "ai-agent",
      "knowledge-graph",
      "cognee",
      "personal-assistant",
      "autonomous-agents",
      "telegram-bot",
      "self-hosted",
      "nodejs",
      "open-source",
      "business-automation"
    ]
  }' | jq '.names' 2>/dev/null || echo "Done"

echo ""
echo "Enabling vulnerability alerts..."
curl -s -X PUT "https://api.github.com/repos/$REPO/vulnerability-alerts" \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.dorian-preview+json"

echo ""
echo "Done! Check: https://github.com/$REPO"
echo ""
echo "Manual steps still needed:"
echo "  1. Upload social preview image (Settings → Social preview)"
echo "     Recommended: 1280x640px with QuantumClaw logo + tagline"
echo "  2. Enable Discussions (Settings → Features → Discussions)"
echo "  3. Set default branch protection (Settings → Branches)"
echo "     Recommended: Require PR reviews + CI passing for main"
echo "  4. Pin important issues/discussions"
echo "  5. Add Discord link to repo About sidebar: https://discord.gg/37x3wRha"
