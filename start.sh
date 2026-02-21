#!/usr/bin/env bash

# QuantumClaw Start Script (Linux / macOS / WSL / Termux)
#
# Just run: bash start.sh
# Or: chmod +x start.sh && ./start.sh

set -e

PURPLE='\033[0;35m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${PURPLE}⚛ QuantumClaw${NC}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    echo ""
    echo "Install Node.js first:"
    echo "  macOS:   brew install node"
    echo "  Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
    echo "  Termux:  pkg install nodejs"
    echo "  Windows: https://nodejs.org"
    exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 20 ]; then
    echo -e "${RED}✗ Node.js v$(node -v) is too old. Need v20+${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Check if npm install has been run
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Check if onboarding has been done
CONFIG_DIR="$HOME/.quantumclaw"
if [ ! -f "$CONFIG_DIR/config.json" ]; then
    echo ""
    echo "First time? Running onboard wizard..."
    echo ""
    node src/cli/onboard.js
else
    node src/index.js
fi
