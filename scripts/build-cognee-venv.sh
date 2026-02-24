#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# QuantumClaw — Build Cognee Venv for ARM64
#
# Run this on a REAL arm64 Linux machine (not proot, not Termux):
#   - Oracle Cloud free tier (aarch64 Ubuntu)
#   - GitHub Actions arm64 runner
#   - Raspberry Pi 4/5
#   - Any arm64 VPS
#
# It creates a portable tarball of a complete Python 3.11 + Cognee
# virtual environment that can be extracted on any arm64 Ubuntu/Debian.
#
# Output: cognee-venv-arm64.tar.xz (~80-150MB compressed)
#
# Usage:
#   bash build-cognee-venv.sh
#   # Upload cognee-venv-arm64.tar.xz to GitHub Releases
# ═══════════════════════════════════════════════════════════════════
set -e

echo "╔══════════════════════════════════════════╗"
echo "║  QuantumClaw — Cognee Venv Builder       ║"
echo "║  Target: arm64 / aarch64                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Verify we're on arm64
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ]; then
    echo "ERROR: This must run on aarch64. Detected: $ARCH"
    echo "Use an ARM64 VPS, Raspberry Pi, or GitHub Actions arm64 runner."
    exit 1
fi

echo "✓ Architecture: $ARCH"
echo "✓ OS: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2)"
echo ""

# ── 1. Install Python 3.11 ──────────────────────────────────────
echo "═══ [1/4] Installing Python 3.11 ═══"
export DEBIAN_FRONTEND=noninteractive

sudo apt-get update -qq
sudo apt-get install -y -qq software-properties-common curl
sudo add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || true
sudo apt-get update -qq
sudo apt-get install -y -qq python3.11 python3.11-venv python3.11-dev

PY=$(command -v python3.11)
echo "✓ Python: $($PY --version)"

# ── 2. Create venv + install Cognee ──────────────────────────────
echo ""
echo "═══ [2/4] Creating venv + installing Cognee ═══"

VENV=/tmp/cognee-venv
rm -rf "$VENV"
$PY -m venv "$VENV"

# Upgrade pip, install uv
"$VENV/bin/pip" install --upgrade pip wheel setuptools 2>&1 | tail -1
"$VENV/bin/pip" install uv 2>&1 | tail -1

echo "Installing cognee + uvicorn via uv..."
"$VENV/bin/uv" pip install --python "$VENV/bin/python" cognee uvicorn 2>&1 | tail -10

# Verify it imports
echo ""
echo "Verifying import..."
"$VENV/bin/python" -c "import cognee; print(f'✓ Cognee {cognee.__version__} imported successfully')"
"$VENV/bin/python" -c "import uvicorn; print('✓ uvicorn imported')"

# ── 3. Make it relocatable ───────────────────────────────────────
echo ""
echo "═══ [3/4] Making venv relocatable ═══"

# Fix the shebang in all scripts to use /opt/cognee-venv/bin/python
# (the standard install location on Termux proot Ubuntu)
find "$VENV/bin" -type f -exec grep -l "^#!$VENV" {} \; | while read f; do
    sed -i "s|$VENV|/opt/cognee-venv|g" "$f"
done

# Fix pyvenv.cfg
sed -i "s|$VENV|/opt/cognee-venv|g" "$VENV/pyvenv.cfg" 2>/dev/null || true

# Strip __pycache__ and .pyc to save space
find "$VENV" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find "$VENV" -name "*.pyc" -delete 2>/dev/null || true

# Remove test directories to save space
find "$VENV" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "$VENV" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true

echo "✓ Venv prepared for /opt/cognee-venv"

# ── 4. Package it ────────────────────────────────────────────────
echo ""
echo "═══ [4/4] Packaging tarball ═══"

OUTFILE="cognee-venv-arm64.tar.xz"
cd /tmp
tar -cJf "$OUTFILE" -C /tmp cognee-venv

SIZE=$(du -sh "$OUTFILE" | cut -f1)
SHA=$(sha256sum "$OUTFILE" | cut -d' ' -f1)

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  BUILD COMPLETE                                         ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  File: /tmp/$OUTFILE"
echo "║  Size: $SIZE"
echo "║  SHA256: $SHA"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                            ║"
echo "║  1. Upload to GitHub Releases:                          ║"
echo "║     gh release create cognee-v1 /tmp/$OUTFILE ║"
echo "║                                                         ║"
echo "║  2. Or upload to any HTTP server and update:            ║"
echo "║     COGNEE_VENV_URL in scripts/install.sh               ║"
echo "╚══════════════════════════════════════════════════════════╝"
