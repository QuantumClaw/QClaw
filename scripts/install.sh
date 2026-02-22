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
    # ── Cognee on Android via proot-distro Ubuntu ──
    # LanceDB/Kuzu need glibc (manylinux wheels). Termux uses Bionic.
    # proot-distro gives us a real Ubuntu where everything just works.
    # Cognee runs as HTTP API on localhost:8000, QClaw talks to it.

    COGNEE_MARKER="$CONFIG_DIR/cognee-proot-ready"

    if [ -f "$COGNEE_MARKER" ] && curl -sf http://localhost:8000/health >/dev/null 2>&1; then
        ok "Cognee running (proot Ubuntu)"
        echo '{"method":"proot-ubuntu"}' > "$COGNEE_META"
    elif [ -f "$COGNEE_MARKER" ]; then
        # Installed but not running — restart it
        info "Starting Cognee..."
        bash "$QCLAW_DIR/scripts/cognee-start.sh" &
        for i in $(seq 1 30); do
            curl -sf http://localhost:8000/health >/dev/null 2>&1 && { ok "Cognee started"; echo '{"method":"proot-ubuntu"}' > "$COGNEE_META"; break; }
            sleep 1
        done
    else
        info "Installing Cognee via proot-distro Ubuntu..."
        info "This takes 5-10 minutes (one time only)"
        echo ""

        # Step 1: Install proot-distro if not present
        if ! command -v proot-distro &>/dev/null; then
            info "  Installing proot-distro..."
            pkg install -y proot proot-distro 2>&1 | tail -2
        fi

        # Step 2: Install Ubuntu if not present
        if ! proot-distro list 2>/dev/null | grep -q "ubuntu.*installed"; then
            info "  Installing Ubuntu (headless, ~400MB)..."
            proot-distro install ubuntu 2>&1 | tail -3
        fi
        ok "Ubuntu ready"

        # Step 3: Install Python + Cognee inside Ubuntu
        info "  Installing Python + Cognee inside Ubuntu..."
        proot-distro login ubuntu -- bash -c '
            set -e
            export DEBIAN_FRONTEND=noninteractive

            # System deps
            apt-get update -qq
            apt-get install -y -qq python3 python3-pip python3-venv curl > /dev/null 2>&1

            # Create isolated venv for Cognee
            VENV=/opt/cognee-venv
            if [ ! -d "$VENV" ]; then
                python3 -m venv "$VENV"
            fi

            # Install Cognee with Groq support (matches QClaw default provider)
            "$VENV/bin/pip" install --quiet cognee uvicorn 2>&1 | tail -5

            echo "COGNEE_INSTALLED=true"
        ' 2>&1 | tail -10

        if proot-distro login ubuntu -- bash -c '/opt/cognee-venv/bin/python3 -c "import cognee; print(cognee.__version__)"' 2>/dev/null; then
            ok "Cognee installed"
        else
            warn "Cognee install may have issues — agent uses local memory as fallback"
            echo '{"method":"skipped","reason":"proot-install-failed"}' > "$COGNEE_META"
        fi

        # Step 4: Create the Cognee startup script
        cat > "$QCLAW_DIR/scripts/cognee-start.sh" << 'COGNEE_START'
#!/data/data/com.termux/files/usr/bin/bash
# Start Cognee API server inside proot Ubuntu
# Called by: install.sh, start.sh, qclaw start

CONFIG_DIR="$HOME/.quantumclaw"
COGNEE_ENV="$CONFIG_DIR/cognee.env"
VENV="/opt/cognee-venv"

# Build env vars from QClaw config
LLM_KEY=""
[ -f "$COGNEE_ENV" ] && source "$COGNEE_ENV"

# Start Cognee API server in background
proot-distro login ubuntu -- bash -c "
    export LLM_API_KEY=\"${LLM_KEY:-placeholder}\"
    export LLM_PROVIDER=\"${LLM_PROVIDER:-openai}\"
    export LLM_MODEL=\"${LLM_MODEL:-gpt-4o-mini}\"
    export DB_PROVIDER=sqlite
    export VECTOR_DB_PROVIDER=lancedb
    export GRAPH_DATABASE_PROVIDER=kuzu
    export REQUIRE_AUTHENTICATION=False
    export ENABLE_BACKEND_ACCESS_CONTROL=False
    export TELEMETRY_DISABLED=1

    cd /opt
    $VENV/bin/python3 -m uvicorn cognee.api.server:app --host 0.0.0.0 --port 8000
" > "$CONFIG_DIR/cognee.log" 2>&1 &

echo $! > "$CONFIG_DIR/cognee-proot.pid"
COGNEE_START
        chmod +x "$QCLAW_DIR/scripts/cognee-start.sh"

        # Step 5: Create the Cognee env writer (called during onboard to pass API keys)
        cat > "$QCLAW_DIR/scripts/cognee-configure.sh" << 'COGNEE_CONF'
#!/data/data/com.termux/files/usr/bin/bash
# Write Cognee env vars from QClaw secrets
# Usage: bash cognee-configure.sh <provider> <api_key> [model]

PROVIDER="${1:-openai}"
API_KEY="${2:-}"
MODEL="${3:-}"

CONFIG_DIR="$HOME/.quantumclaw"
mkdir -p "$CONFIG_DIR"

# Map QClaw provider names to Cognee provider names
case "$PROVIDER" in
    anthropic) COGNEE_PROVIDER="anthropic"; [ -z "$MODEL" ] && MODEL="anthropic/claude-sonnet-4-5-20250929" ;;
    openai)    COGNEE_PROVIDER="openai";    [ -z "$MODEL" ] && MODEL="openai/gpt-4o-mini" ;;
    groq)      COGNEE_PROVIDER="groq";      [ -z "$MODEL" ] && MODEL="groq/llama-3.3-70b-versatile" ;;
    google)    COGNEE_PROVIDER="gemini";    [ -z "$MODEL" ] && MODEL="gemini/gemini-2.0-flash" ;;
    ollama)    COGNEE_PROVIDER="ollama";    [ -z "$MODEL" ] && MODEL="ollama/llama3.3" ;;
    *)         COGNEE_PROVIDER="openai";    [ -z "$MODEL" ] && MODEL="openai/gpt-4o-mini" ;;
esac

cat > "$CONFIG_DIR/cognee.env" << EOF
LLM_KEY="$API_KEY"
LLM_PROVIDER="$COGNEE_PROVIDER"
LLM_MODEL="$MODEL"
EOF

# Also write .env inside proot for direct use
proot-distro login ubuntu -- bash -c "
    mkdir -p /opt
    cat > /opt/cognee.env << ENVEOF
LLM_API_KEY=$API_KEY
LLM_PROVIDER=$COGNEE_PROVIDER
LLM_MODEL=$MODEL
DB_PROVIDER=sqlite
VECTOR_DB_PROVIDER=lancedb
GRAPH_DATABASE_PROVIDER=kuzu
REQUIRE_AUTHENTICATION=False
ENABLE_BACKEND_ACCESS_CONTROL=False
TELEMETRY_DISABLED=1
ENVEOF
" 2>/dev/null
COGNEE_CONF
        chmod +x "$QCLAW_DIR/scripts/cognee-configure.sh"

        # Step 6: Start Cognee and verify
        info "  Starting Cognee API..."
        bash "$QCLAW_DIR/scripts/cognee-start.sh" &
        sleep 2

        HEALTHY=false
        for i in $(seq 1 30); do
            if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
                HEALTHY=true; break
            fi
            sleep 1
        done

        if $HEALTHY; then
            ok "Cognee API healthy on :8000"
            echo '{"method":"proot-ubuntu"}' > "$COGNEE_META"
            touch "$COGNEE_MARKER"
        else
            warn "Cognee API didn't start — agent uses local knowledge store"
            echo '{"method":"skipped","reason":"api-timeout"}' > "$COGNEE_META"
        fi
    fi
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
