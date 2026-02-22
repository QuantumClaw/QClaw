#!/usr/bin/env bash
set -e

# ═══════════════════════════════════════════════════════════════════
# QuantumClaw — Install
# ═══════════════════════════════════════════════════════════════════
# git clone https://github.com/QuantumClaw/QClaw.git
# cd QClaw && bash scripts/install.sh
# qclaw onboard
# qclaw start
# ═══════════════════════════════════════════════════════════════════

IS_TERMUX=false; [ -d "/data/data/com.termux" ] && IS_TERMUX=true
IS_MAC=false; [ "$(uname)" = "Darwin" ] && IS_MAC=true

G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; C='\033[0;36m'
D='\033[0;37m'; B='\033[1m'; RS='\033[0m'
ok()   { echo -e "  ${G}✓${RS} $1"; }
warn() { echo -e "  ${Y}!${RS} $1"; }
fail() { echo -e "  ${R}✗${RS} $1"; }
info() { echo -e "  ${D}$1${RS}"; }

# Progress spinner for long-running tasks
# Usage: long_command & spinner $! "Installing things..."
spinner() {
    local pid=$1
    local msg="${2:-Working...}"
    local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0
    local start=$(date +%s)
    while kill -0 "$pid" 2>/dev/null; do
        local elapsed=$(( $(date +%s) - start ))
        local mins=$(( elapsed / 60 ))
        local secs=$(( elapsed % 60 ))
        local time_str=""
        [ $mins -gt 0 ] && time_str="${mins}m ${secs}s" || time_str="${secs}s"
        printf "\r  ${C}${chars:i%${#chars}:1}${RS} ${msg} ${D}(${time_str})${RS}  "
        i=$(( i + 1 ))
        sleep 0.2 2>/dev/null || sleep 1
    done
    wait "$pid" 2>/dev/null
    local exit_code=$?
    printf "\r                                                          \r"
    return 0  # Callers check success themselves — don't propagate failures
}

QCLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="$HOME/.quantumclaw"
AGEX_DIR="$HOME/.agex"

echo ""
echo -e "  ${B}⚛ QuantumClaw Installer${RS}"
if $IS_TERMUX; then
    echo -e "  ${D}Android / Termux${RS}"
    echo ""
    echo -e "  ${Y}📱 IMPORTANT — Read before continuing:${RS}"
    echo -e "  ${D}┌─────────────────────────────────────────────────┐${RS}"
    echo -e "  ${D}│${RS} 1. ${B}Keep your screen on${RS} during install            ${D}│${RS}"
    echo -e "  ${D}│${RS} 2. ${B}Plug in your charger${RS} if possible              ${D}│${RS}"
    echo -e "  ${D}│${RS} 3. ${B}Disable battery optimization${RS} for Termux       ${D}│${RS}"
    echo -e "  ${D}│${RS}    Settings → Apps → Termux → Battery → ${C}Unrestricted${RS} ${D}│${RS}"
    echo -e "  ${D}│${RS} 4. First install takes ${Y}5-10 minutes${RS}              ${D}│${RS}"
    echo -e "  ${D}│${RS}    ${G}Future updates take seconds.${RS}                  ${D}│${RS}"
    echo -e "  ${D}│${RS} 5. If it looks frozen, ${B}it's not${RS} — just wait     ${D}│${RS}"
    echo -e "  ${D}│${RS}    Large downloads run silently in background    ${D}│${RS}"
    echo -e "  ${D}└─────────────────────────────────────────────────┘${RS}"
    echo ""

    # Acquire wake lock immediately to prevent Android killing us
    command -v termux-wake-lock &>/dev/null && termux-wake-lock 2>/dev/null || true
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [1/5] SYSTEM PACKAGES
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[1/5] System${RS}"

if $IS_TERMUX; then
    NEED=""
    command -v node    &>/dev/null || NEED="$NEED nodejs-lts"
    command -v python3 &>/dev/null || NEED="$NEED python"
    command -v git     &>/dev/null || NEED="$NEED git"
    command -v make    &>/dev/null || NEED="$NEED make"
    command -v cmake   &>/dev/null || NEED="$NEED cmake"
    command -v clang   &>/dev/null || NEED="$NEED clang"
    command -v rustc   &>/dev/null || NEED="$NEED rust"
    command -v go      &>/dev/null || NEED="$NEED golang"
    command -v curl    &>/dev/null || NEED="$NEED curl"
    pkg list-installed 2>/dev/null | grep -q openssl   || NEED="$NEED openssl"
    pkg list-installed 2>/dev/null | grep -q libsodium || NEED="$NEED libsodium"

    [ -n "$NEED" ] && { info "pkg install$NEED"; pkg update -y 2>&1 | tail -1; pkg install -y $NEED; }

    # termux extras
    command -v termux-wake-lock &>/dev/null || pkg install -y termux-api 2>/dev/null || true
    [ -d "$HOME/storage" ] || termux-setup-storage 2>/dev/null || true
    command -v termux-wake-lock &>/dev/null && termux-wake-lock 2>/dev/null || true

    # pm2
    command -v pm2 &>/dev/null || { info "Installing pm2..."; npm install -g pm2 2>&1 | tail -1; }

    # boot script
    mkdir -p "$HOME/.termux/boot"
    cat > "$HOME/.termux/boot/start-quantumclaw.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
export DB_PATH=$HOME/.agex/agex.db

# Start Cognee (knowledge graph) if installed
COGNEE_START="$QCLAW_DIR/scripts/cognee-start.sh"
[ -f "\$COGNEE_START" ] && [ -f "$CONFIG_DIR/cognee-proot-ready" ] && bash "\$COGNEE_START" &

# Start QClaw agent
pm2 resurrect 2>/dev/null || true
EOF
    chmod +x "$HOME/.termux/boot/start-quantumclaw.sh"
else
    if ! command -v node &>/dev/null; then
        fail "Node.js not found. Install from https://nodejs.org"
        exit 1
    fi
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[ "$NODE_VER" -lt 20 ] && { fail "Node.js $(node -v) too old (need 20+)"; exit 1; }
ok "Node $(node -v)"
command -v python3 &>/dev/null && ok "Python $(python3 --version 2>&1 | cut -d' ' -f2)"
$IS_TERMUX && command -v pm2 &>/dev/null && ok "pm2"
echo ""

# ═══════════════════════════════════════════════════════════════════
# [2/5] NODE DEPENDENCIES
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[2/5] Dependencies${RS}"

cd "$QCLAW_DIR"
if [ ! -d "node_modules" ] || [ ! -d "node_modules/grammy" ]; then
    info "npm install..."
    npm install --progress 2>&1 || {
        warn "Retrying without native modules..."
        npm install --ignore-scripts --progress 2>&1
    }
    ok "Installed"
else
    ok "Present"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [3/5] CLI LINK
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[3/5] CLI${RS}"

npm link 2>/dev/null || npm link --force 2>/dev/null || true
if ! command -v qclaw &>/dev/null; then
    # npm link sometimes fails on Termux — create symlink manually
    GLOBAL_BIN=$(npm config get prefix 2>/dev/null)/bin
    [ ! -d "$GLOBAL_BIN" ] && GLOBAL_BIN="$HOME/.npm-global/bin"
    [ ! -d "$GLOBAL_BIN" ] && mkdir -p "$GLOBAL_BIN"

    # Create manual symlink to the CLI entry point
    BIN_TARGET="$QCLAW_DIR/src/cli/index.js"
    if [ -f "$BIN_TARGET" ]; then
        ln -sf "$BIN_TARGET" "$GLOBAL_BIN/qclaw" 2>/dev/null || true
        chmod +x "$BIN_TARGET" 2>/dev/null || true
        # Make sure the shebang is there
        head -1 "$BIN_TARGET" | grep -q '^#!' || sed -i '1i#!/usr/bin/env node' "$BIN_TARGET"
    fi

    # If still not found, add to PATH
    if ! command -v qclaw &>/dev/null; then
        if [ -f "$GLOBAL_BIN/qclaw" ]; then
            export PATH="$GLOBAL_BIN:$PATH"
            # Persist in shell profile
            for rc in "$HOME/.bashrc" "$HOME/.profile"; do
                [ -f "$rc" ] && ! grep -q 'npm-global/bin' "$rc" 2>/dev/null && \
                    echo "export PATH=\"$GLOBAL_BIN:\$PATH\"" >> "$rc"
            done
        fi
    fi
fi
if command -v qclaw &>/dev/null; then
    ok "qclaw command ready"
else
    warn "Link failed — use: node ~/QClaw/src/cli/index.js"
    info "Or add to .bashrc: alias qclaw='node ~/QClaw/src/cli/index.js'"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [4/5] COGNEE
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[4/5] Knowledge Engine${RS}"

mkdir -p "$CONFIG_DIR"
COGNEE_META="$CONFIG_DIR/cognee-install.json"

# Cognee is optional — failures here must NOT kill the installer
set +e

if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    # Cognee already running (local or remote)
    ok "Cognee running"
    echo '{"method":"cognee-api"}' > "$COGNEE_META"
elif [ -f "$CONFIG_DIR/config.json" ] && grep -q '"cognee"' "$CONFIG_DIR/config.json" 2>/dev/null && grep -q '"url"' "$CONFIG_DIR/config.json" 2>/dev/null; then
    # Remote Cognee configured — check if reachable
    COGNEE_URL=$(grep -oP '"url"\s*:\s*"\K[^"]+' "$CONFIG_DIR/config.json" 2>/dev/null | head -1)
    if [ -n "$COGNEE_URL" ] && curl -sf "$COGNEE_URL/health" >/dev/null 2>&1; then
        ok "Cognee connected: $COGNEE_URL"
        echo '{"method":"cognee-remote","url":"'$COGNEE_URL'"}' > "$COGNEE_META"
    else
        info "Remote Cognee configured but not reachable: $COGNEE_URL"
        info "Using local knowledge graph (will retry Cognee when agent starts)"
    fi
fi

# Local knowledge graph ALWAYS available as base layer
ok "Local knowledge graph (Node.js — works on all devices)"
info "Entities, relationships, semantic/episodic/procedural memory"

if $IS_TERMUX; then
    echo ""
    echo -e "  ${D}┌──────────────────────────────────────────────────┐${RS}"
    echo -e "  ${D}│${RS} ${B}Want the full Cognee knowledge graph brain?${RS}      ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                  ${D}│${RS}"
    echo -e "  ${D}│${RS} Run this on your PC/laptop/Pi:                   ${D}│${RS}"
    echo -e "  ${D}│${RS} ${C}curl -sL qclaw.dev/cognee | bash${RS}                ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                  ${D}│${RS}"
    echo -e "  ${D}│${RS} Then on your phone:                              ${D}│${RS}"
    echo -e "  ${D}│${RS} ${C}qclaw setup-cognee${RS}                              ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                  ${D}│${RS}"
    echo -e "  ${D}│${RS} ${D}Your data stays on YOUR machine. Free forever.${RS} ${D}│${RS}"
    echo -e "  ${D}└──────────────────────────────────────────────────┘${RS}"
else
    # Desktop/server — try to install Cognee locally via pip/docker
    DONE=false

    # Docker
    if ! $DONE && command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
        info "Docker found — installing Cognee..."
        docker pull cognee/cognee:latest 2>&1 | tail -2
        docker rm -f quantumclaw-cognee 2>/dev/null || true
        docker run -d --name quantumclaw-cognee --restart unless-stopped \
            -p 8000:8000 -e VECTOR_DB_PROVIDER=lancedb \
            -e ENABLE_BACKEND_ACCESS_CONTROL=false \
            -v quantumclaw-cognee-data:/app/cognee/.cognee_system \
            cognee/cognee:latest >/dev/null
        DONE=true; ok "Cognee (Docker)"
    fi

    # pip (Linux/Mac only)
    if ! $DONE; then
        PIP=""
        command -v pip3 &>/dev/null && PIP="pip3"
        [ -z "$PIP" ] && command -v pip &>/dev/null && PIP="pip"

        if [ -n "$PIP" ]; then
            info "Installing Cognee via pip..."
            if $PIP install cognee uvicorn 2>&1 | tail -3; then
                PY="python3"; command -v python3 &>/dev/null || PY="python"
                nohup $PY -m uvicorn cognee.api.server:app --host 0.0.0.0 --port 8000 \
                    > "$CONFIG_DIR/cognee.log" 2>&1 &
                echo $! > "$CONFIG_DIR/cognee.pid"
                DONE=true; ok "Cognee (pip)"
            else
                warn "pip install failed"
            fi
        fi
    fi

    if $DONE; then
        info "Waiting for Cognee API..."
        for i in $(seq 1 20); do
            curl -sf http://localhost:8000/health >/dev/null 2>&1 && { ok "Cognee healthy"; echo '{"method":"auto"}' > "$COGNEE_META"; break; }
            sleep 1
        done
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [5/5] AGEX
# ═══════════════════════════════════════════════════════════════════
set -e  # Re-enable strict mode after optional Cognee section
echo -e "  ${B}[5/5] AGEX${RS}"

mkdir -p "$AGEX_DIR/aids" "$AGEX_DIR/creds"
export DB_PATH="$AGEX_DIR/agex.db"

curl -sf https://hub.agexhq.com/health >/dev/null 2>&1 && ok "Hub: hub.agexhq.com" || info "Hub offline (local secrets)"

# Local hub if cloned
if [ -d "$HOME/AGEX" ] && ! echo "$@" | grep -q "skip-agex"; then
    if ! curl -sf http://localhost:4891/health >/dev/null 2>&1; then
        ENTRY=""; [ -f "$HOME/AGEX/src/index.js" ] && ENTRY="$HOME/AGEX/src/index.js"
        if [ -n "$ENTRY" ] && command -v pm2 &>/dev/null; then
            DB_PATH="$DB_PATH" pm2 start "$ENTRY" --name agex-hub 2>/dev/null
            pm2 save 2>/dev/null || true
            ok "Local hub started"
        fi
    else
        ok "Local hub running"
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# DONE
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${G}════════════════════════════════════════${RS}"
echo ""
ok "Install complete"
echo ""

if [ ! -f "$CONFIG_DIR/config.json" ]; then
    # First time — guide them to onboard
    echo -e "  ${B}What's next?${RS}"
    echo ""
    echo -e "  ${C}qclaw onboard${RS}  — set up your agent (30 seconds)"
    echo ""
    echo -e "  ${D}This is where you pick your AI provider, name your${RS}"
    echo -e "  ${D}agent, and optionally connect Telegram.${RS}"
else
    # Returning user — guide them to start
    echo -e "  ${B}What's next?${RS}"
    echo ""
    echo -e "  ${C}qclaw start${RS}    — start your agent"
    echo -e "  ${C}qclaw tui${RS}      — terminal chat"
    echo -e "  ${C}qclaw update${RS}   — pull latest (one command)"
fi
echo ""
