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
    return $exit_code
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
echo -e "  ${B}[4/5] Cognee${RS}"

mkdir -p "$CONFIG_DIR"
COGNEE_META="$CONFIG_DIR/cognee-install.json"

if echo "$@" | grep -q "skip-cognee"; then
    info "Skipped"; echo '{"method":"skipped"}' > "$COGNEE_META"
elif curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ok "Running"
elif $IS_TERMUX; then
    # ── Cognee on Android via proot-distro Ubuntu ──────────────
    # LanceDB/Kuzu need glibc. Termux uses Bionic (Android).
    # proot-distro gives real Ubuntu where manylinux wheels work.
    # Cognee runs as HTTP API on localhost:8000, QClaw talks to it.
    #
    # PERSISTENCE: proot Ubuntu lives at ~/.local/share/proot-distro/
    #   and survives QClaw updates. The install check is idempotent:
    #   - proot-distro already installed? → skip
    #   - Ubuntu already installed?       → skip
    #   - Cognee venv already exists?     → skip
    #   - API already running on :8000?   → skip
    #   Only first install takes 5-10 min. Updates take seconds.

    COGNEE_MARKER="$CONFIG_DIR/cognee-proot-ready"

    # ── Always write helper scripts (so updates can fix them) ──
    mkdir -p "$QCLAW_DIR/scripts"

    cat > "$QCLAW_DIR/scripts/cognee-start.sh" << 'COGNEE_START'
#!/data/data/com.termux/files/usr/bin/bash
# Start Cognee API server inside proot Ubuntu
# Called by: install.sh, start.sh, qclaw start, boot script

# Don't start if already running
curl -sf http://localhost:8000/health >/dev/null 2>&1 && exit 0

CONFIG_DIR="$HOME/.quantumclaw"
COGNEE_ENV="$CONFIG_DIR/cognee.env"
VENV="/opt/cognee-venv"

# Load env vars from QClaw config (set during onboard)
LLM_KEY="placeholder"
LLM_PROVIDER="openai"
LLM_MODEL="openai/gpt-4o-mini"
[ -f "$COGNEE_ENV" ] && source "$COGNEE_ENV"

# Start Cognee API server in background inside proot Ubuntu
proot-distro login ubuntu -- bash -c "
    export LLM_API_KEY='${LLM_KEY}'
    export LLM_PROVIDER='${LLM_PROVIDER}'
    export LLM_MODEL='${LLM_MODEL}'
    export DB_PROVIDER=sqlite
    export VECTOR_DB_PROVIDER=lancedb
    export GRAPH_DATABASE_PROVIDER=kuzu
    export REQUIRE_AUTHENTICATION=False
    export ENABLE_BACKEND_ACCESS_CONTROL=False
    export TELEMETRY_DISABLED=1
    cd /opt
    $VENV/bin/python -m uvicorn cognee.api.server:app --host 0.0.0.0 --port 8000
" > "$CONFIG_DIR/cognee.log" 2>&1 &

echo $! > "$CONFIG_DIR/cognee-proot.pid"
COGNEE_START
    chmod +x "$QCLAW_DIR/scripts/cognee-start.sh"

    cat > "$QCLAW_DIR/scripts/cognee-configure.sh" << 'COGNEE_CONF'
#!/data/data/com.termux/files/usr/bin/bash
# Pass QClaw API keys to Cognee. Called during onboard.
# Usage: bash cognee-configure.sh <provider> <api_key> [model]

PROVIDER="${1:-openai}"
API_KEY="${2:-}"
MODEL="${3:-}"

CONFIG_DIR="$HOME/.quantumclaw"
mkdir -p "$CONFIG_DIR"

case "$PROVIDER" in
    anthropic) CP="anthropic"; [ -z "$MODEL" ] && MODEL="anthropic/claude-sonnet-4-5-20250929" ;;
    openai)    CP="openai";    [ -z "$MODEL" ] && MODEL="openai/gpt-4o-mini" ;;
    groq)      CP="groq";      [ -z "$MODEL" ] && MODEL="groq/llama-3.3-70b-versatile" ;;
    google)    CP="gemini";    [ -z "$MODEL" ] && MODEL="gemini/gemini-2.0-flash" ;;
    ollama)    CP="ollama";    [ -z "$MODEL" ] && MODEL="ollama/llama3.3" ;;
    *)         CP="openai";    [ -z "$MODEL" ] && MODEL="openai/gpt-4o-mini" ;;
esac

cat > "$CONFIG_DIR/cognee.env" << EOF
LLM_KEY="$API_KEY"
LLM_PROVIDER="$CP"
LLM_MODEL="$MODEL"
EOF

# Write .env inside proot for direct use
proot-distro login ubuntu -- bash -c "
    cat > /opt/cognee.env << ENVEOF
LLM_API_KEY=$API_KEY
LLM_PROVIDER=$CP
LLM_MODEL=$MODEL
DB_PROVIDER=sqlite
VECTOR_DB_PROVIDER=lancedb
GRAPH_DATABASE_PROVIDER=kuzu
REQUIRE_AUTHENTICATION=False
ENABLE_BACKEND_ACCESS_CONTROL=False
TELEMETRY_DISABLED=1
ENVEOF
" 2>/dev/null

echo "Cognee configured for $PROVIDER"
COGNEE_CONF
    chmod +x "$QCLAW_DIR/scripts/cognee-configure.sh"

    # ── Now decide what to do ──────────────────────────────────

    # Auto-repair: if marker exists but Cognee doesn't actually work, nuke the venv
    if [ -f "$COGNEE_MARKER" ]; then
        if ! proot-distro login ubuntu -- bash -c '/opt/cognee-venv/bin/python -c "import cognee" 2>/dev/null' 2>/dev/null; then
            warn "Previous Cognee install is broken — repairing automatically..."
            proot-distro login ubuntu -- rm -rf /opt/cognee-venv 2>/dev/null || true
            rm -f "$COGNEE_MARKER"
        fi
    fi

    if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
        # Already running — nothing to do
        ok "Cognee running (proot Ubuntu)"
        echo '{"method":"proot-ubuntu"}' > "$COGNEE_META"

    elif [ -f "$COGNEE_MARKER" ]; then
        # Installed before but not running — just start it
        info "Knowledge graph installed — starting it..."
        bash "$QCLAW_DIR/scripts/cognee-start.sh" &
        STARTED=false
        for i in $(seq 1 20); do
            curl -sf http://localhost:8000/health >/dev/null 2>&1 && { STARTED=true; break; }
            sleep 1
        done
        if $STARTED; then
            ok "Knowledge graph started"
        else
            warn "Didn't start yet — will retry when agent launches"
            info "This is normal after a phone restart"
        fi
        echo '{"method":"proot-ubuntu"}' > "$COGNEE_META"

    else
        # ── FIRST TIME INSTALL (only happens once) ────────────
        echo ""
        echo -e "  ${B}🧠 Installing Knowledge Graph${RS}"
        echo -e "  ${D}┌─────────────────────────────────────────────────┐${RS}"
        echo -e "  ${D}│${RS} This installs your agent's brain — a knowledge   ${D}│${RS}"
        echo -e "  ${D}│${RS} graph that remembers everything about you and    ${D}│${RS}"
        echo -e "  ${D}│${RS} your business. It runs locally on your phone.    ${D}│${RS}"
        echo -e "  ${D}│${RS}                                                  ${D}│${RS}"
        echo -e "  ${D}│${RS} ${Y}This is a one-time setup (5-10 minutes).${RS}        ${D}│${RS}"
        echo -e "  ${D}│${RS} ${G}Future updates will skip this entirely.${RS}         ${D}│${RS}"
        echo -e "  ${D}│${RS}                                                  ${D}│${RS}"
        echo -e "  ${D}│${RS} ${B}DO NOT close Termux or lock your phone.${RS}         ${D}│${RS}"
        echo -e "  ${D}│${RS} The screen may appear frozen — ${G}that's normal.${RS}   ${D}│${RS}"
        echo -e "  ${D}│${RS} Large packages download silently.                ${D}│${RS}"
        echo -e "  ${D}└─────────────────────────────────────────────────┘${RS}"
        echo ""

        # Ensure wake lock is active
        command -v termux-wake-lock &>/dev/null && termux-wake-lock 2>/dev/null || true

        # 1/4 — proot-distro
        if ! command -v proot-distro &>/dev/null; then
            pkg install -y proot proot-distro > ${TMPDIR:-/tmp}/qc-proot.log 2>&1 &
            spinner $! "Installing proot-distro..."
            ok "proot-distro installed"
        else
            ok "proot-distro (already installed)"
        fi

        # 2/4 — Ubuntu
        if ! proot-distro list 2>/dev/null | grep -q "ubuntu.*installed"; then
            echo ""
            echo -e "  ${C}⬇${RS}  Downloading Ubuntu (~400MB)..."
            echo -e "  ${D}   This is the longest step. Your phone is working hard.${RS}"
            echo -e "  ${D}   WiFi recommended. On 4G this may take longer.${RS}"
            echo ""
            proot-distro install ubuntu > ${TMPDIR:-/tmp}/qc-ubuntu.log 2>&1 &
            spinner $! "Downloading and extracting Ubuntu..."
            if proot-distro list 2>/dev/null | grep -q "ubuntu.*installed"; then
                ok "Ubuntu installed"
            else
                fail "Ubuntu install failed. Check ${TMPDIR:-/tmp}/qc-ubuntu.log"
                echo '{"method":"skipped","reason":"ubuntu-install-failed"}' > "$COGNEE_META"
                # Continue — they still get the local knowledge store
            fi
        else
            ok "Ubuntu (already installed)"
        fi

        # 3/4 — Python + Cognee inside Ubuntu
        echo ""
        echo -e "  ${C}🐍${RS} Installing Python + Cognee inside Ubuntu..."
        echo -e "  ${D}   Downloading ~200 Python packages. This takes 3-5 minutes.${RS}"
        echo -e "  ${D}   The screen will look frozen — it's not. Just wait.${RS}"
        echo ""

        proot-distro login ubuntu -- bash -c '
            set -e
            export DEBIAN_FRONTEND=noninteractive

            # System deps — get Python 3.11 (Cognee has dependency conflicts on 3.12+)
            apt-get update -qq 2>/dev/null
            apt-get install -y -qq software-properties-common curl > /dev/null 2>&1
            add-apt-repository -y ppa:deadsnakes/ppa > /dev/null 2>&1 || true
            apt-get update -qq 2>/dev/null

            # Try Python 3.11 first, fall back to system python3
            apt-get install -y -qq python3.11 python3.11-venv python3.11-dev > /dev/null 2>&1 || \
            apt-get install -y -qq python3 python3-pip python3-venv > /dev/null 2>&1

            PY="python3"
            command -v python3.11 > /dev/null 2>&1 && PY="python3.11"

            # Create venv
            VENV=/opt/cognee-venv
            [ ! -d "$VENV" ] && $PY -m venv "$VENV"

            # Upgrade pip first
            "$VENV/bin/pip" install --upgrade pip > /dev/null 2>&1

            # Install uv (much better dependency resolver than pip)
            "$VENV/bin/pip" install --quiet uv 2>&1 | tail -2

            # Install Cognee via uv (handles conflicts that break pip)
            if "$VENV/bin/uv" pip install --python "$VENV/bin/python" cognee uvicorn 2>&1 | tail -5; then
                echo "__COGNEE_DONE__"
            else
                # Fallback: pip with relaxed resolver
                echo "uv failed, trying pip..."
                "$VENV/bin/pip" install cognee uvicorn 2>&1 | tail -5 || true
                echo "__COGNEE_DONE__"
            fi
        ' > ${TMPDIR:-/tmp}/qc-cognee.log 2>&1 &
        spinner $! "Installing Cognee (this is the slow bit)..."

        # Verify
        if proot-distro login ubuntu -- bash -c '/opt/cognee-venv/bin/python -c "import cognee; print(cognee.__version__)"' 2>/dev/null; then
            ok "Cognee installed"
        else
            warn "Cognee install may have issues"
            info "Check log: cat ${TMPDIR:-/tmp}/qc-cognee.log"
            info "Local knowledge store active as fallback — your agent still works"
            echo '{"method":"skipped","reason":"proot-install-failed"}' > "$COGNEE_META"
        fi

        # 4/4 — Start and verify
        echo ""
        echo -e "  ${C}🚀${RS} Starting knowledge graph API..."
        bash "$QCLAW_DIR/scripts/cognee-start.sh" &
        sleep 2

        HEALTHY=false
        for i in $(seq 1 30); do
            curl -sf http://localhost:8000/health >/dev/null 2>&1 && { HEALTHY=true; break; }
            [ $((i % 5)) -eq 0 ] && printf "\r  ${D}  Still starting... (%ss)${RS}  " "$i"
            sleep 1
        done
        printf "\r                                          \r"

        if $HEALTHY; then
            ok "Knowledge graph running on localhost:8000"
            echo '{"method":"proot-ubuntu"}' > "$COGNEE_META"
            touch "$COGNEE_MARKER"
            echo ""
            echo -e "  ${G}┌─────────────────────────────────────────────────┐${RS}"
            echo -e "  ${G}│${RS} ${B}Knowledge graph installed successfully!${RS}         ${G}│${RS}"
            echo -e "  ${G}│${RS} Your agent now has a brain that remembers.       ${G}│${RS}"
            echo -e "  ${G}│${RS} This will ${B}never need to install again${RS} —         ${G}│${RS}"
            echo -e "  ${G}│${RS} updates just pull new code in seconds.           ${G}│${RS}"
            echo -e "  ${G}└─────────────────────────────────────────────────┘${RS}"
        else
            warn "Knowledge graph API didn't start"
            info "This sometimes happens on first boot. It will retry on next start."
            info "Your agent still works — it uses the local knowledge store."
            info "Run 'qclaw start' and it will try Cognee again automatically."
            echo '{"method":"skipped","reason":"api-timeout"}' > "$COGNEE_META"
            touch "$COGNEE_MARKER"  # Mark as installed so it doesn't re-download
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
