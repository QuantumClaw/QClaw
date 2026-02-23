#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# QuantumClaw — Cognee Brain Server
#
# Run this on your PC, laptop, or Raspberry Pi to give your phone
# agent the full Cognee knowledge graph brain.
#
# One-line install:
#   curl -sL https://raw.githubusercontent.com/QuantumClaw/QClaw/main/scripts/cognee-server.sh | bash
#
# What it does:
#   1. Installs Python 3.11+ and Cognee
#   2. Starts Cognee API on port 8000
#   3. Creates a tunnel so your phone can reach it from anywhere
#   4. Gives you a URL to paste into: qclaw setup-cognee
#
# Requirements:
#   - Any Linux, macOS, or WSL machine
#   - Python 3.10+ (installed automatically if missing)
#   - ~500MB disk space
#   - Internet connection
#
# Your data stays on YOUR machine. Nothing touches our servers.
# ═══════════════════════════════════════════════════════════════════
set -e

# Colors
R='\033[0;31m'; G='\033[0;32m'; B='\033[0;34m'
Y='\033[0;33m'; C='\033[0;36m'; D='\033[0;90m'
RS='\033[0m'; BOLD='\033[1m'

ok()   { echo -e "  ${G}✓${RS} $1"; }
fail() { echo -e "  ${R}✗${RS} $1"; }
info() { echo -e "  ${C}ℹ${RS} $1"; }
warn() { echo -e "  ${Y}!${RS} $1"; }

echo ""
echo -e "  ${BOLD}⚛ QUANTUMCLAW — Cognee Brain Server${RS}"
echo -e "  ────────────────────────────────────────"
echo -e "  This installs the Cognee knowledge graph on this"
echo -e "  machine so your phone agent has a full brain."
echo -e ""
echo -e "  ${D}Your data stays on this machine. Nothing is shared.${RS}"
echo ""

# ── Detect OS ──────────────────────────────────────────────
OS="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then OS="macos"
elif grep -qi microsoft /proc/version 2>/dev/null; then OS="wsl"
fi
echo -e "  Platform: ${B}$OS${RS} ($(uname -m))"

# ── Check/Install Python ──────────────────────────────────
echo ""
echo -e "  ${BOLD}[1/4] Python${RS}"

PY=""
for p in python3.11 python3.12 python3.13 python3; do
    if command -v "$p" &>/dev/null; then
        VER=$($p --version 2>&1 | grep -oP '\d+\.\d+' | head -1)
        MAJOR=$(echo "$VER" | cut -d. -f1)
        MINOR=$(echo "$VER" | cut -d. -f2)
        if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 10 ]; then
            PY="$p"
            break
        fi
    fi
done

if [ -z "$PY" ]; then
    warn "Python 3.10+ not found. Installing..."
    if [ "$OS" = "macos" ]; then
        brew install python@3.11 2>/dev/null || { fail "Install Python 3.11 manually: brew install python@3.11"; exit 1; }
        PY="python3.11"
    elif [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
        sudo apt-get update -qq 2>/dev/null
        sudo apt-get install -y python3 python3-venv python3-pip 2>/dev/null || \
        sudo dnf install -y python3 python3-pip 2>/dev/null || \
        { fail "Install Python 3.10+ manually"; exit 1; }
        PY="python3"
    fi
fi
ok "Python: $($PY --version)"

# ── Create Cognee venv ─────────────────────────────────────
echo ""
echo -e "  ${BOLD}[2/4] Installing Cognee${RS}"

INSTALL_DIR="$HOME/.quantumclaw-cognee"
VENV="$INSTALL_DIR/venv"

mkdir -p "$INSTALL_DIR"

if [ -d "$VENV" ] && "$VENV/bin/python" -c "import cognee" 2>/dev/null; then
    ok "Cognee already installed"
else
    info "Creating virtual environment..."
    $PY -m venv "$VENV"
    
    "$VENV/bin/pip" install --upgrade pip -q 2>&1 | tail -1
    
    info "Installing Cognee + dependencies (this takes 1-3 minutes)..."
    "$VENV/bin/pip" install cognee uvicorn -q 2>&1 | tail -3
    
    if "$VENV/bin/python" -c "import cognee" 2>/dev/null; then
        ok "Cognee installed"
    else
        # Try uv as fallback resolver
        warn "pip had issues, trying uv..."
        "$VENV/bin/pip" install uv -q 2>/dev/null
        "$VENV/bin/uv" pip install --python "$VENV/bin/python" cognee uvicorn 2>&1 | tail -5
        "$VENV/bin/python" -c "import cognee" || { fail "Cognee install failed"; exit 1; }
        ok "Cognee installed (via uv)"
    fi
fi

# ── Create systemd service / launch script ─────────────────
echo ""
echo -e "  ${BOLD}[3/4] Setting up Cognee server${RS}"

# Create start script
cat > "$INSTALL_DIR/start.sh" << 'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$DIR/venv"

# Load env if exists
[ -f "$DIR/.env" ] && set -a && source "$DIR/.env" && set +a

# Defaults
export DB_PROVIDER="${DB_PROVIDER:-sqlite}"
export VECTOR_DB_PROVIDER="${VECTOR_DB_PROVIDER:-lancedb}"
export GRAPH_DATABASE_PROVIDER="${GRAPH_DATABASE_PROVIDER:-kuzu}"
export REQUIRE_AUTHENTICATION="${REQUIRE_AUTHENTICATION:-False}"
export ENABLE_BACKEND_ACCESS_CONTROL="${ENABLE_BACKEND_ACCESS_CONTROL:-False}"
export TELEMETRY_DISABLED=1

echo "Starting Cognee on http://0.0.0.0:8000"
exec "$VENV/bin/python" -m uvicorn cognee.api.server:app --host 0.0.0.0 --port 8000
EOF
chmod +x "$INSTALL_DIR/start.sh"

# Create stop script
cat > "$INSTALL_DIR/stop.sh" << 'EOF'
#!/usr/bin/env bash
PID=$(lsof -ti:8000 2>/dev/null || ss -tlnp 2>/dev/null | grep :8000 | grep -oP 'pid=\K\d+')
[ -n "$PID" ] && kill "$PID" && echo "Stopped Cognee (PID $PID)" || echo "Cognee not running"
EOF
chmod +x "$INSTALL_DIR/stop.sh"

# Create .env template
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" << 'EOF'
# QuantumClaw Cognee Server Config
# Set your LLM API key here (same one you use in QClaw)
# LLM_API_KEY=sk-...
# LLM_PROVIDER=openai
# LLM_MODEL=openai/gpt-4o-mini
EOF
fi

# Try to create systemd user service (Linux only, optional)
if [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"
    cat > "$SYSTEMD_DIR/quantumclaw-cognee.service" << EOF
[Unit]
Description=QuantumClaw Cognee Knowledge Graph
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/start.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    
    if systemctl --user daemon-reload 2>/dev/null; then
        systemctl --user enable quantumclaw-cognee 2>/dev/null || true
        systemctl --user start quantumclaw-cognee 2>/dev/null || true
        
        sleep 2
        if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
            ok "Cognee running as systemd service (auto-starts on boot)"
        else
            warn "systemd service created but Cognee hasn't started yet"
            info "Start manually: bash $INSTALL_DIR/start.sh"
        fi
    else
        # No systemd — start directly
        bash "$INSTALL_DIR/start.sh" &
        sleep 3
    fi
else
    # macOS — start directly
    bash "$INSTALL_DIR/start.sh" &
    sleep 3
fi

# Verify
if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ok "Cognee API running on http://localhost:8000"
else
    warn "Cognee hasn't started yet"
    info "Start it manually: bash $INSTALL_DIR/start.sh"
    info "Then continue with step 4 below"
fi

# ── Get accessible URL ─────────────────────────────────────
echo ""
echo -e "  ${BOLD}[4/4] Making it accessible to your phone${RS}"
echo ""

# Get local IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LOCAL_IP" ] && LOCAL_IP=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1 | awk '{print $2}')

echo -e "  ${BOLD}Choose how your phone connects:${RS}"
echo ""
echo -e "  ${G}A) Same WiFi network${RS} (easiest)"
if [ -n "$LOCAL_IP" ]; then
echo -e "     Your Cognee URL: ${BOLD}http://${LOCAL_IP}:8000${RS}"
fi
echo -e "     ${D}Phone and PC must be on the same WiFi${RS}"
echo ""
echo -e "  ${C}B) From anywhere${RS} (tunnel — works on 4G, different networks)"
echo -e "     Install cloudflared, then run:"
echo -e "     ${D}cloudflared tunnel --url http://localhost:8000${RS}"
echo -e "     It will give you a URL like: https://xxx.trycloudflare.com"
echo ""

echo -e "  ────────────────────────────────────────────────────"
echo ""
echo -e "  ${BOLD}On your phone, run:${RS}"
echo ""
echo -e "     ${C}qclaw setup-cognee${RS}"
echo ""
echo -e "  Then paste the URL when asked."
echo ""
echo -e "  ────────────────────────────────────────────────────"
echo ""
echo -e "  ${BOLD}Useful commands:${RS}"
echo -e "  Start:  ${D}bash $INSTALL_DIR/start.sh${RS}"
echo -e "  Stop:   ${D}bash $INSTALL_DIR/stop.sh${RS}"
echo -e "  Config: ${D}nano $INSTALL_DIR/.env${RS}"
echo -e "  Logs:   ${D}journalctl --user -u quantumclaw-cognee -f${RS}"
echo ""
echo -e "  ${G}✓ Your Cognee brain server is ready.${RS}"
echo ""
