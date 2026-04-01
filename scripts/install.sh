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
IS_LINUX=false; [ "$(uname)" = "Linux" ] && ! $IS_TERMUX && IS_LINUX=true

G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; C='\033[0;36m'
D='\033[0;37m'; B='\033[1m'; RS='\033[0m'
ok()   { echo -e "  ${G}✓${RS} $1"; }
warn() { echo -e "  ${Y}!${RS} $1"; }
fail() { echo -e "  ${R}✗${RS} $1"; }
info() { echo -e "  ${D}$1${RS}"; }

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
    printf "\r                                                          \r"
    return 0
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
    command -v termux-wake-lock &>/dev/null && termux-wake-lock 2>/dev/null || true
elif $IS_MAC; then
    echo -e "  ${D}macOS${RS}"
elif $IS_LINUX; then
    echo -e "  ${D}Linux${RS}"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# SAFETY WARNING — User must acknowledge before install proceeds
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${Y}┌─────────────────────────────────────────────────────────────┐${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${R}${B}⚠  IMPORTANT — PLEASE READ BEFORE CONTINUING${RS}              ${Y}│${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}│${RS}  QuantumClaw is an ${B}autonomous AI agent runtime${RS} that:       ${Y}│${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}│${RS}  • Runs AI models that make decisions on your behalf        ${Y}│${RS}"
echo -e "  ${Y}│${RS}  • Installs Docker, Python, and Cognee (knowledge engine)   ${Y}│${RS}"
echo -e "  ${Y}│${RS}  • Can access files, APIs, and external tools when enabled  ${Y}│${RS}"
echo -e "  ${Y}│${RS}  • Stores conversations and knowledge locally on device     ${Y}│${RS}"
echo -e "  ${Y}│${RS}  • Uses your API keys to make calls to AI providers         ${Y}│${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${B}Security is built in${RS} (encryption, trust rules, audit log) ${Y}│${RS}"
echo -e "  ${Y}│${RS}  but as with all powerful technology, there are risks:       ${Y}│${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${R}•${RS} AI can make mistakes or misunderstand instructions       ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${R}•${RS} Tool access means the agent can take real actions        ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${R}•${RS} API keys grant access to paid services (costs money)     ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${R}•${RS} Open-source software may contain undiscovered bugs       ${Y}│${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${G}We recommend:${RS} Start with the dashboard only. Enable       ${Y}│${RS}"
echo -e "  ${Y}│${RS}  tools one at a time. Review the trust rules in VALUES.md.  ${Y}│${RS}"
echo -e "  ${Y}│${RS}  Set spending limits on your AI provider accounts.          ${Y}│${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${B}You are responsible for how you use this software.${RS}        ${Y}│${RS}"
echo -e "  ${Y}│${RS}  ${D}Full license: LICENSE (MIT) | Security: SECURITY.md${RS}       ${Y}│${RS}"
echo -e "  ${Y}│${RS}                                                             ${Y}│${RS}"
echo -e "  ${Y}└─────────────────────────────────────────────────────────────┘${RS}"
echo ""

# Skip confirmation if --yes flag passed (for CI/automation)
if ! echo "$@" | grep -q "\-\-yes"; then
    echo -ne "  ${B}Do you understand the risks and want to continue? [y/N] ${RS}"
    read -r CONFIRM
    case "$CONFIRM" in
        [yY]|[yY][eE][sS]) ;;
        *)
            echo ""
            info "Install cancelled. No changes were made."
            info "Read more: https://github.com/QuantumClaw/QClaw#readme"
            echo ""
            exit 0
            ;;
    esac
    echo ""
fi

# ═══════════════════════════════════════════════════════════════════
# [1/7] SYSTEM PACKAGES + DEPENDENCY AUTO-INSTALL
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[1/7] System${RS}"

# ── Auto-install Docker if not present (desktop only) ──
if ! $IS_TERMUX && ! command -v docker &>/dev/null; then
    echo ""
    info "Docker is required for the Cognee knowledge engine."
    info "Installing Docker..."
    echo ""

    if $IS_MAC; then
        if command -v brew &>/dev/null; then
            brew install --cask docker 2>&1 | tail -3
            info "Docker Desktop installed — please open it from Applications to start the daemon"
            info "Then re-run: bash scripts/install.sh"
        else
            warn "Install Docker Desktop from: https://docs.docker.com/desktop/install/mac-install/"
        fi
    elif $IS_LINUX; then
        if command -v apt-get &>/dev/null; then
            info "Installing Docker via apt..."
            sudo apt-get update -qq 2>/dev/null
            sudo apt-get install -y docker.io docker-compose-plugin 2>&1 | tail -3
            sudo systemctl start docker 2>/dev/null || true
            sudo usermod -aG docker "$USER" 2>/dev/null || true
            # Check if it worked
            if command -v docker &>/dev/null; then
                ok "Docker installed"
                # Need to use sudo for this session if user not in docker group yet
                if ! docker info &>/dev/null 2>&1; then
                    info "You may need to log out and back in for Docker group permissions"
                    info "Or use: sudo bash scripts/install.sh"
                fi
            else
                warn "Docker install may have failed — check above for errors"
            fi
        elif command -v dnf &>/dev/null; then
            info "Installing Docker via dnf..."
            sudo dnf install -y docker docker-compose-plugin 2>&1 | tail -3
            sudo systemctl start docker 2>/dev/null || true
            sudo usermod -aG docker "$USER" 2>/dev/null || true
            command -v docker &>/dev/null && ok "Docker installed"
        elif command -v pacman &>/dev/null; then
            info "Installing Docker via pacman..."
            sudo pacman -S --noconfirm docker docker-compose 2>&1 | tail -3
            sudo systemctl start docker 2>/dev/null || true
            sudo usermod -aG docker "$USER" 2>/dev/null || true
            command -v docker &>/dev/null && ok "Docker installed"
        else
            warn "Could not auto-install Docker on this system"
            info "Install manually: https://docs.docker.com/engine/install/"
        fi
    fi
fi

# ── Auto-install Python if not present ──
if ! $IS_TERMUX && ! command -v python3 &>/dev/null; then
    info "Installing Python 3..."
    if $IS_MAC; then
        command -v brew &>/dev/null && brew install python3 2>&1 | tail -3
    elif $IS_LINUX; then
        if command -v apt-get &>/dev/null; then
            sudo apt-get install -y python3 python3-pip 2>&1 | tail -3
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y python3 python3-pip 2>&1 | tail -3
        fi
    fi
    command -v python3 &>/dev/null && ok "Python $(python3 --version 2>&1 | cut -d' ' -f2)" || warn "Python 3 could not be installed automatically"
fi

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

    command -v termux-wake-lock &>/dev/null || pkg install -y termux-api 2>/dev/null || true
    [ -d "$HOME/storage" ] || termux-setup-storage 2>/dev/null || true
    command -v termux-wake-lock &>/dev/null && termux-wake-lock 2>/dev/null || true

    command -v pm2 &>/dev/null || { info "Installing pm2..."; npm install -g pm2 2>&1 | tail -1; }

    mkdir -p "$HOME/.termux/boot"
    cat > "$HOME/.termux/boot/start-quantumclaw.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
export DB_PATH=$HOME/.agex/agex.db
COGNEE_START="$QCLAW_DIR/scripts/cognee-start.sh"
[ -f "\$COGNEE_START" ] && [ -f "$CONFIG_DIR/cognee-proot-ready" ] && bash "\$COGNEE_START" &
pm2 resurrect 2>/dev/null || true
EOF
    chmod +x "$HOME/.termux/boot/start-quantumclaw.sh"
else
    if ! command -v node &>/dev/null; then
        fail "Node.js not found. Install from https://nodejs.org"
        exit 1
    fi
    # Install build tools for better-sqlite3 (if not present)
    if $IS_LINUX && ! command -v make &>/dev/null; then
        info "Installing build tools for native modules..."
        if command -v apt &>/dev/null; then
            sudo apt install -y build-essential python3 2>/dev/null || warn "Could not install build tools (try: sudo apt install build-essential)"
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y gcc gcc-c++ make python3 2>/dev/null || true
        fi
    fi
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[ "$NODE_VER" -lt 20 ] && { fail "Node.js $(node -v) too old (need 20+)"; exit 1; }
ok "Node $(node -v)"
command -v python3 &>/dev/null && ok "Python $(python3 --version 2>&1 | cut -d' ' -f2)"
$IS_TERMUX && command -v pm2 &>/dev/null && ok "pm2"
echo ""

# ═══════════════════════════════════════════════════════════════════
# [2/7] CLOUDFLARE TUNNEL (required for dashboard access)
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[2/7] Cloudflare Tunnel${RS}"

if command -v cloudflared &>/dev/null; then
    CF_VER=$(cloudflared --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
    ok "cloudflared $CF_VER (already installed)"
else
    info "Installing cloudflared..."
    CF_INSTALLED=false

    if $IS_TERMUX; then
        # Termux: try pkg first
        pkg install -y cloudflared 2>&1 | tail -2 && command -v cloudflared &>/dev/null && CF_INSTALLED=true

        # Fallback: download ARM binary
        if ! $CF_INSTALLED; then
            info "Trying direct binary download..."
            ARCH=$(uname -m)
            case "$ARCH" in
                aarch64|arm64) CF_ARCH="linux-arm64" ;;
                armv7l|armv8l) CF_ARCH="linux-arm" ;;
                x86_64)        CF_ARCH="linux-amd64" ;;
                *)             CF_ARCH="" ;;
            esac
            if [ -n "$CF_ARCH" ]; then
                CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${CF_ARCH}"
                CF_BIN="$PREFIX/bin/cloudflared"
                curl -sL "$CF_URL" -o "$CF_BIN" 2>/dev/null && chmod +x "$CF_BIN"
                command -v cloudflared &>/dev/null && CF_INSTALLED=true
            fi
        fi

    elif $IS_MAC; then
        if command -v brew &>/dev/null; then
            brew install cloudflared 2>&1 | tail -2
        else
            info "No Homebrew — downloading binary..."
            ARCH=$(uname -m)
            case "$ARCH" in
                arm64)  CF_ARCH="darwin-arm64" ;;
                x86_64) CF_ARCH="darwin-amd64" ;;
                *)      CF_ARCH="" ;;
            esac
            if [ -n "$CF_ARCH" ]; then
                CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${CF_ARCH}"
                sudo curl -sL "$CF_URL" -o /usr/local/bin/cloudflared 2>/dev/null && sudo chmod +x /usr/local/bin/cloudflared
            fi
        fi
        command -v cloudflared &>/dev/null && CF_INSTALLED=true

    elif $IS_LINUX; then
        ARCH=$(uname -m)
        case "$ARCH" in
            x86_64)        CF_ARCH="linux-amd64"; CF_DEB="amd64" ;;
            aarch64|arm64) CF_ARCH="linux-arm64"; CF_DEB="arm64" ;;
            armv7l)        CF_ARCH="linux-arm";   CF_DEB="armhf" ;;
            *)             CF_ARCH=""; CF_DEB="" ;;
        esac

        # Try .deb (Debian/Ubuntu/WSL)
        if command -v apt-get &>/dev/null && [ -n "$CF_DEB" ]; then
            CF_TMP="/tmp/cloudflared.deb"
            curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_DEB}.deb" -o "$CF_TMP" 2>/dev/null
            sudo dpkg -i "$CF_TMP" 2>&1 | tail -2
            rm -f "$CF_TMP"
        # Try .rpm (Fedora/RHEL)
        elif command -v dnf &>/dev/null && [ -n "$CF_ARCH" ]; then
            CF_TMP="/tmp/cloudflared.rpm"
            curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${CF_ARCH}.rpm" -o "$CF_TMP" 2>/dev/null
            sudo dnf install -y "$CF_TMP" 2>&1 | tail -2
            rm -f "$CF_TMP"
        fi

        # Fallback: direct binary
        if ! command -v cloudflared &>/dev/null && [ -n "$CF_ARCH" ]; then
            info "Downloading binary..."
            CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${CF_ARCH}"
            mkdir -p "$HOME/.local/bin"
            curl -sL "$CF_URL" -o "$HOME/.local/bin/cloudflared" 2>/dev/null && chmod +x "$HOME/.local/bin/cloudflared"
            export PATH="$HOME/.local/bin:$PATH"
            # Persist PATH
            for rc in "$HOME/.bashrc" "$HOME/.profile"; do
                [ -f "$rc" ] && ! grep -q '.local/bin' "$rc" 2>/dev/null && \
                    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
            done
        fi
        command -v cloudflared &>/dev/null && CF_INSTALLED=true
    fi

    if command -v cloudflared &>/dev/null; then
        CF_VER=$(cloudflared --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
        ok "cloudflared $CF_VER"
    else
        fail "cloudflared is required but could not be installed"
        echo ""
        echo -e "  ${R}┌─────────────────────────────────────────────────┐${RS}"
        echo -e "  ${R}│${RS} ${B}⚠  cloudflared is required for dashboard access${RS} ${R}│${RS}"
        echo -e "  ${R}│${RS}                                                 ${R}│${RS}"
        echo -e "  ${R}│${RS} Install manually:                               ${R}│${RS}"
        if $IS_TERMUX; then
        echo -e "  ${R}│${RS}   ${C}pkg install cloudflared${RS}                      ${R}│${RS}"
        elif $IS_MAC; then
        echo -e "  ${R}│${RS}   ${C}brew install cloudflared${RS}                     ${R}│${RS}"
        else
        echo -e "  ${R}│${RS}   ${C}sudo apt install cloudflared${RS}                 ${R}│${RS}"
        echo -e "  ${R}│${RS}   or: ${C}curl -sL https://pkg.cloudflare.com/install.sh | bash${RS} ${R}│${RS}"
        fi
        echo -e "  ${R}│${RS}                                                 ${R}│${RS}"
        echo -e "  ${R}│${RS} Then re-run: ${C}bash scripts/install.sh${RS}           ${R}│${RS}"
        echo -e "  ${R}└─────────────────────────────────────────────────┘${RS}"
        echo ""
        exit 1
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [3/7] NODE DEPENDENCIES
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[3/7] Dependencies${RS}"

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
# [4/7] CLI LINK
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[4/7] CLI${RS}"

BIN_TARGET="$QCLAW_DIR/src/cli/index.js"

# Ensure shebang is present
if [ -f "$BIN_TARGET" ]; then
    head -1 "$BIN_TARGET" | grep -q '^#!' || sed -i '1i#!/usr/bin/env node' "$BIN_TARGET"
    chmod +x "$BIN_TARGET"
fi

# Method 1: npm link (needs sudo on Linux when prefix is /usr)
if $IS_TERMUX; then
    npm link 2>/dev/null || npm link --force 2>/dev/null || true
elif [ "$(npm config get prefix 2>/dev/null)" = "/usr" ] || [ "$(npm config get prefix 2>/dev/null)" = "/usr/local" ]; then
    sudo npm link 2>/dev/null || npm link 2>/dev/null || true
else
    npm link 2>/dev/null || npm link --force 2>/dev/null || true
fi

# Method 2: Manual symlink if npm link failed
if ! command -v qclaw &>/dev/null; then
    # Find a bin directory that's in PATH
    LINK_DIR=""
    for d in /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
        if [ -d "$d" ] && echo "$PATH" | grep -q "$d"; then
            LINK_DIR="$d"; break
        fi
    done

    # Termux: use $PREFIX/bin
    $IS_TERMUX && LINK_DIR="$PREFIX/bin"

    # Fallback: create ~/.local/bin and add to PATH
    if [ -z "$LINK_DIR" ]; then
        LINK_DIR="$HOME/.local/bin"
        mkdir -p "$LINK_DIR"
        export PATH="$LINK_DIR:$PATH"
        for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
            if [ -f "$rc" ] && ! grep -q '.local/bin' "$rc" 2>/dev/null; then
                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
            fi
        done
    fi

    ln -sf "$BIN_TARGET" "$LINK_DIR/qclaw" 2>/dev/null
fi

# Method 3: Shell alias as absolute last resort
if ! command -v qclaw &>/dev/null; then
    ALIAS_CMD="alias qclaw='node $BIN_TARGET'"
    eval "$ALIAS_CMD"
    for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
        if [ -f "$rc" ] && ! grep -q "alias qclaw=" "$rc" 2>/dev/null; then
            echo "$ALIAS_CMD" >> "$rc"
        fi
    done
fi

if command -v qclaw &>/dev/null; then
    ok "qclaw command ready"
else
    # This should never happen after method 3, but just in case
    warn "qclaw not in PATH for this session"
    info "Close and reopen your terminal, then run: qclaw onboard"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [5/7] COGNEE (optional — local graph always available)
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${B}[5/7] Knowledge Engine${RS}"

mkdir -p "$CONFIG_DIR"
COGNEE_META="$CONFIG_DIR/cognee-install.json"
set +e

if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ok "Cognee running"
    echo '{"method":"cognee-api"}' > "$COGNEE_META"
elif [ -f "$CONFIG_DIR/config.json" ] && grep -q '"cognee"' "$CONFIG_DIR/config.json" 2>/dev/null && grep -q '"url"' "$CONFIG_DIR/config.json" 2>/dev/null; then
    COGNEE_URL=$(grep -oP '"url"\s*:\s*"\K[^"]+' "$CONFIG_DIR/config.json" 2>/dev/null | head -1)
    if [ -n "$COGNEE_URL" ] && curl -sf "$COGNEE_URL/health" >/dev/null 2>&1; then
        ok "Cognee connected: $COGNEE_URL"
        echo '{"method":"cognee-remote","url":"'$COGNEE_URL'"}' > "$COGNEE_META"
    else
        info "Remote Cognee configured but not reachable: $COGNEE_URL"
        info "Using local knowledge graph (will retry when agent starts)"
    fi
fi

ok "Local knowledge graph (Node.js — works on all devices)"
info "Entities, relationships, semantic/episodic/procedural memory"

if $IS_TERMUX; then
    echo ""
    echo -e "  ${D}┌──────────────────────────────────────────────────┐${RS}"
    echo -e "  ${D}│${RS} ${B}Want the full Cognee knowledge graph?${RS}            ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                  ${D}│${RS}"
    echo -e "  ${D}│${RS} Run on your PC/laptop/Pi:                        ${D}│${RS}"
    echo -e "  ${D}│${RS} ${C}curl -sL qclaw.dev/cognee | bash${RS}                ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                  ${D}│${RS}"
    echo -e "  ${D}│${RS} Then on your phone: ${C}qclaw setup-cognee${RS}          ${D}│${RS}"
    echo -e "  ${D}│${RS} ${D}Your data stays on YOUR machine. Free forever.${RS} ${D}│${RS}"
    echo -e "  ${D}└──────────────────────────────────────────────────┘${RS}"
else
    DONE=false
    # Method 1: Docker (best)
    if ! $DONE && command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
        info "Docker found — installing Cognee..."
        docker pull cognee/cognee:main 2>&1 | tail -2
        docker rm -f quantumclaw-cognee 2>/dev/null || true
        docker run -d --name quantumclaw-cognee --restart unless-stopped \
            -p 8000:8000 -e VECTOR_DB_PROVIDER=lancedb \
            -e ENABLE_BACKEND_ACCESS_CONTROL=false \
            -v quantumclaw-cognee-data:/app/cognee/.cognee_system \
            cognee/cognee:main >/dev/null 2>&1
        DONE=true; ok "Cognee (Docker)"
    fi
    # Method 2: pip (with --break-system-packages for modern Python)
    if ! $DONE; then
        PIP=""
        command -v pip3 &>/dev/null && PIP="pip3"
        [ -z "$PIP" ] && command -v pip &>/dev/null && PIP="pip"
        if [ -n "$PIP" ]; then
            info "Installing Cognee via pip..."
            if $PIP install cognee uvicorn --break-system-packages 2>&1 | tail -3; then
                PY="python3"; command -v python3 &>/dev/null || PY="python"
                nohup $PY -m uvicorn cognee.api.server:app --host 0.0.0.0 --port 8000 \
                    > "$CONFIG_DIR/cognee.log" 2>&1 &
                echo $! > "$CONFIG_DIR/cognee.pid"
                sleep 2
                if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
                    DONE=true; ok "Cognee (pip)"
                else
                    warn "Cognee installed but not responding — check $CONFIG_DIR/cognee.log"
                fi
            else
                warn "pip install failed"
            fi
        fi
    fi
    if ! $DONE; then
        info "Cognee not installed — local vector + SQLite memory active"
        info "To install later: docker run -d -p 8000:8000 cognee/cognee:main"
        info "Or: pip3 install cognee uvicorn --break-system-packages"
    fi
    if $DONE; then
        info "Waiting for Cognee..."
        for i in $(seq 1 20); do
            curl -sf http://localhost:8000/health >/dev/null 2>&1 && { ok "Cognee healthy"; echo '{"method":"auto"}' > "$COGNEE_META"; break; }
            sleep 1
        done
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# [6/7] AGEX
# ═══════════════════════════════════════════════════════════════════
set -e
echo -e "  ${B}[6/7] AGEX${RS}"

mkdir -p "$AGEX_DIR/aids" "$AGEX_DIR/creds"
export DB_PATH="$AGEX_DIR/agex.db"

curl -sf https://hub.agexhq.com/health >/dev/null 2>&1 && ok "Hub: hub.agexhq.com" || info "Hub offline (local secrets)"

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
# AUTO-CONFIGURE: tunnel only on Termux (desktop uses localhost)
# ═══════════════════════════════════════════════════════════════════
if $IS_TERMUX && command -v cloudflared &>/dev/null; then
    mkdir -p "$CONFIG_DIR"
    if [ -f "$CONFIG_DIR/config.json" ] && command -v node &>/dev/null; then
        node -e "
          const fs=require('fs'),f='$CONFIG_DIR/config.json';
          try{const c=JSON.parse(fs.readFileSync(f,'utf-8'));
          if(!c.dashboard)c.dashboard={};
          c.dashboard.tunnel='cloudflare';c.dashboard.host='0.0.0.0';
          fs.writeFileSync(f,JSON.stringify(c,null,2));
          }catch{}
        " 2>/dev/null || true
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# DONE
# ═══════════════════════════════════════════════════════════════════
echo -e "  ${G}════════════════════════════════════════${RS}"
echo ""
ok "Install complete"
echo ""

echo -e "  ${B}Summary:${RS}"
command -v node        &>/dev/null && echo -e "  ${G}✓${RS} Node $(node -v)"
command -v cloudflared &>/dev/null && echo -e "  ${G}✓${RS} Cloudflare Tunnel"
command -v qclaw       &>/dev/null && echo -e "  ${G}✓${RS} qclaw CLI" || echo -e "  ${Y}!${RS} qclaw CLI (use: node src/cli/index.js)"
$IS_TERMUX && command -v pm2 &>/dev/null && echo -e "  ${G}✓${RS} pm2 (process manager)"
curl -sf http://localhost:8000/health >/dev/null 2>&1 && echo -e "  ${G}✓${RS} Cognee (knowledge graph)" || echo -e "  ${D}·${RS} Cognee (optional — local graph active)"
echo ""

if [ ! -f "$CONFIG_DIR/config.json" ]; then
    echo -e "  ${G}┌─────────────────────────────────────────────────┐${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}│${RS}  ${B}Step 1:${RS} Set up your agent                      ${G}│${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}│${RS}    ${C}qclaw onboard${RS}                               ${G}│${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}│${RS}  ${B}Step 2:${RS} Launch your agent                      ${G}│${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}│${RS}    ${C}qclaw start${RS}                                  ${G}│${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}│${RS}  A public dashboard URL will appear.            ${G}│${RS}"
    echo -e "  ${G}│${RS}  Open it from any browser, any device.          ${G}│${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}└─────────────────────────────────────────────────┘${RS}"
else
    echo -e "  ${G}┌─────────────────────────────────────────────────┐${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}│${RS}    ${C}qclaw start${RS}      launch agent + dashboard    ${G}│${RS}"
    echo -e "  ${G}│${RS}    ${C}qclaw dashboard${RS}  re-show dashboard URL       ${G}│${RS}"
    echo -e "  ${G}│${RS}    ${C}qclaw tui${RS}        terminal chat               ${G}│${RS}"
    echo -e "  ${G}│${RS}    ${C}qclaw update${RS}     pull latest                  ${G}│${RS}"
    echo -e "  ${G}│${RS}                                                 ${G}│${RS}"
    echo -e "  ${G}└─────────────────────────────────────────────────┘${RS}"
fi
echo ""

# Tip: Remote Desktop for Android users
if $IS_TERMUX; then
    echo -e "  ${D}┌─────────────────────────────────────────────────┐${RS}"
    echo -e "  ${D}│${RS} ${Y}💡 TIP:${RS} Typing on a phone keyboard is slow.     ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                 ${D}│${RS}"
    echo -e "  ${D}│${RS} Use ${C}Chrome Remote Desktop${RS} to control your       ${D}│${RS}"
    echo -e "  ${D}│${RS} phone from a PC with a real keyboard:           ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                 ${D}│${RS}"
    echo -e "  ${D}│${RS} ${C}remotedesktop.google.com${RS}                        ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                 ${D}│${RS}"
    echo -e "  ${D}│${RS} 1. Install ${B}Chrome Remote Desktop${RS} on phone+PC    ${D}│${RS}"
    echo -e "  ${D}│${RS} 2. Sign in with same Google account              ${D}│${RS}"
    echo -e "  ${D}│${RS} 3. Control your phone's Termux from your PC    ${D}│${RS}"
    echo -e "  ${D}│${RS}                                                 ${D}│${RS}"
    echo -e "  ${D}│${RS} ${D}Much faster for setup. Once running, the${RS}       ${D}│${RS}"
    echo -e "  ${D}│${RS} ${D}agent works on its own — no PC needed.${RS}         ${D}│${RS}"
    echo -e "  ${D}└─────────────────────────────────────────────────┘${RS}"
    echo ""
fi
