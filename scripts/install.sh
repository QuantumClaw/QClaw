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

QCLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="$HOME/.quantumclaw"
AGEX_DIR="$HOME/.agex"

echo ""
echo -e "  ${B}⚛ QuantumClaw Installer${RS}"
$IS_TERMUX && echo -e "  ${D}Android / Termux${RS}"
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
if command -v qclaw &>/dev/null; then
    ok "qclaw command ready"
else
    warn "Link failed — use: npx qclaw"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [4/5] COGNEE
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[4/5] Cognee${RS}"

mkdir -p "$CONFIG_DIR"
COGNEE_META="$CONFIG_DIR/cognee-install.json"

if echo "$@" | grep -q "skip-cognee"; then
    info "Skipped"; echo '{"method":"skipped"}' > "$COGNEE_META"
elif curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ok "Running"
elif $IS_TERMUX; then
    info "Skipped on Android (lancedb has no ARM64 wheels)"
    info "Agent uses local memory — works fine"
    echo '{"method":"skipped","reason":"termux"}' > "$COGNEE_META"
else
    DONE=false

    # Docker
    if ! $DONE && command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
        info "Docker pull..."
        docker pull cognee/cognee:latest 2>&1 | tail -2
        docker rm -f quantumclaw-cognee 2>/dev/null || true
        docker run -d --name quantumclaw-cognee --restart unless-stopped \
            -p 8000:8000 -e VECTOR_DB_PROVIDER=lancedb \
            -e ENABLE_BACKEND_ACCESS_CONTROL=false \
            -v quantumclaw-cognee-data:/app/cognee/.cognee_system \
            cognee/cognee:latest >/dev/null
        DONE=true; ok "Docker"
    fi

    # pip (Linux/Mac only)
    if ! $DONE; then
        PIP=""
        command -v pip3 &>/dev/null && PIP="pip3"
        [ -z "$PIP" ] && command -v pip &>/dev/null && PIP="pip"

        if [ -n "$PIP" ]; then
            info "$PIP install cognee..."
            if $PIP install cognee uvicorn 2>&1 | tail -3; then
                PY="python3"; command -v python3 &>/dev/null || PY="python"
                nohup $PY -m uvicorn cognee.api.server:app --host 0.0.0.0 --port 8000 \
                    > "$CONFIG_DIR/cognee.log" 2>&1 &
                echo $! > "$CONFIG_DIR/cognee.pid"
                DONE=true; ok "pip"
            else
                warn "pip install failed"
            fi
        fi
    fi

    if $DONE; then
        info "Waiting..."
        for i in $(seq 1 20); do
            curl -sf http://localhost:8000/health >/dev/null 2>&1 && { ok "Healthy"; echo '{"method":"auto"}' > "$COGNEE_META"; break; }
            sleep 1
        done
    else
        warn "No Docker — local memory only"
        echo '{"method":"skipped"}' > "$COGNEE_META"
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [5/5] AGEX
# ═══════════════════════════════════════════════════════════════════
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
echo -e "  ${C}qclaw onboard${RS}  — setup (30 seconds)"
echo -e "  ${C}qclaw start${RS}    — start agent + tunnel"
echo -e "  ${C}qclaw tui${RS}      — terminal chat (Android)"
echo ""
