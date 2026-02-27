#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
#  QuantumClaw Installer
#  One command: curl -fsSL https://install.quantumclaw.dev | bash
#  Or locally: bash install.sh
# ═══════════════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${DIM}$1${NC}"; }

INSTALL_DIR="${QCLAW_DIR:-$HOME/QClaw}"
MIN_NODE=20
REPO="https://github.com/QuantumClaw/QClaw.git"

echo ""
echo -e "${CYAN}${BOLD}"
cat << 'BANNER'
   ╔═══════════════════════════════════════╗
   ║         ◇  QuantumClaw  ◇            ║
   ║   The agent runtime with a brain.    ║
   ╚═══════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── 1. Check Node.js ────────────────────────────────────────────────────

echo -e "${BOLD}Checking prerequisites...${NC}"

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install v${MIN_NODE}+ first:
    ${DIM}https://nodejs.org  or  nvm install ${MIN_NODE}${NC}"
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt "$MIN_NODE" ]; then
  fail "Node.js v${NODE_VER} too old. Need v${MIN_NODE}+.
    ${DIM}nvm install ${MIN_NODE} && nvm use ${MIN_NODE}${NC}"
fi
log "Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
  fail "npm not found. Should come with Node.js."
fi
log "npm $(npm -v)"

# Check git
if ! command -v git &>/dev/null; then
  warn "git not found — will download as zip instead"
  USE_GIT=false
else
  log "git $(git --version | awk '{print $3}')"
  USE_GIT=true
fi

# ── 2. Clone or update ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Setting up QuantumClaw...${NC}"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Existing install found at $INSTALL_DIR"
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || warn "git pull failed — using existing files"
  log "Updated existing installation"
elif [ "$USE_GIT" = true ]; then
  git clone "$REPO" "$INSTALL_DIR" 2>/dev/null || {
    # Private repo? Try with token
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      git clone "https://${GITHUB_TOKEN}@github.com/QuantumClaw/QClaw.git" "$INSTALL_DIR"
    else
      fail "Clone failed. If the repo is private, set GITHUB_TOKEN:
        ${DIM}GITHUB_TOKEN=ghp_xxx bash install.sh${NC}"
    fi
  }
  cd "$INSTALL_DIR"
  log "Cloned to $INSTALL_DIR"
else
  # Fallback: download zip
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  curl -fsSL "https://github.com/QuantumClaw/QClaw/archive/main.zip" -o /tmp/qclaw.zip
  unzip -o /tmp/qclaw.zip -d /tmp/qclaw-extract
  cp -rf /tmp/qclaw-extract/QClaw-main/* .
  rm -rf /tmp/qclaw.zip /tmp/qclaw-extract
  log "Downloaded to $INSTALL_DIR"
fi

# ── 3. Install dependencies ────────────────────────────────────────────

echo ""
echo -e "${BOLD}Installing dependencies...${NC}"

# Clean install for reliability
if [ -d "node_modules" ]; then
  info "Clearing old node_modules..."
  rm -rf node_modules package-lock.json
fi

npm install --no-fund --no-audit 2>&1 | tail -3
log "npm packages installed"

# ── 4. Verify AGEX ─────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Verifying AGEX identity system...${NC}"

AGEX_OK=$(node -e "
  import('@agexhq/sdk').then(m => {
    m.AgexClient.generateAID({ agentName: 'verify' }).then(r => {
      console.log('OK:' + r.aid.aid_id.slice(0, 8));
    }).catch(e => console.log('FAIL:' + e.message));
  }).catch(e => console.log('FAIL:' + e.message));
" 2>&1)

if [[ "$AGEX_OK" == OK:* ]]; then
  AID="${AGEX_OK#OK:}"
  log "AGEX SDK working (test AID: ${AID}...)"
else
  REASON="${AGEX_OK#FAIL:}"
  warn "AGEX verification failed: ${REASON}"
  warn "Agents will work but won't have cryptographic identities"
  info "Try: cd $INSTALL_DIR && npm ls @agexhq/sdk"
fi

# ── 5. Build info dir ──────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR/.qclaw"

# ── 6. Summary ─────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  QuantumClaw installed successfully!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Quick start:${NC}"
echo ""
echo -e "    ${CYAN}cd $INSTALL_DIR${NC}"
echo -e "    ${CYAN}npm run onboard${NC}        ${DIM}# 3-question setup${NC}"
echo -e "    ${CYAN}npm start${NC}              ${DIM}# launch agent + dashboard${NC}"
echo ""
echo -e "  ${BOLD}Dashboard:${NC}  ${CYAN}http://localhost:3000${NC}"
echo -e "  ${BOLD}CLI chat:${NC}   ${CYAN}npx qclaw chat${NC}"
echo ""
echo -e "  ${DIM}Docs: https://github.com/QuantumClaw/QClaw${NC}"
echo ""
