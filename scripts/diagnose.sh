#!/data/data/com.termux/files/usr/bin/bash
# QuantumClaw — Quick Diagnostic
# Run: curl -sL https://raw.githubusercontent.com/QuantumClaw/QClaw/main/scripts/diagnose.sh | bash

echo "═══════════════════════════════════════"
echo "  QuantumClaw Diagnostic"
echo "═══════════════════════════════════════"
echo ""

echo "── Device ──"
echo "Arch: $(uname -m)"
echo "Android: $(getprop ro.build.version.release 2>/dev/null || echo 'N/A')"
echo "Storage free: $(df -h ~ 2>/dev/null | tail -1 | awk '{print $4}')"
echo "RAM free: $(free -h 2>/dev/null | grep Mem | awk '{print $4}' || echo 'N/A')"
echo ""

echo "── Termux packages ──"
for cmd in node npm git proot proot-distro pm2 curl; do
    if command -v $cmd &>/dev/null; then
        echo "  ✓ $cmd $(${cmd} --version 2>/dev/null | head -1)"
    else
        echo "  ✗ $cmd NOT FOUND"
    fi
done
echo ""

echo "── proot-distro ──"
proot-distro list 2>&1
echo ""

echo "── Ubuntu test ──"
if proot-distro list 2>/dev/null | grep -q "ubuntu.*installed"; then
    echo "  ✓ Ubuntu installed"
    echo "  Testing login..."
    proot-distro login ubuntu -- echo "  ✓ Login works" 2>&1 || echo "  ✗ Login FAILED"
    echo ""
    echo "  Python:"
    proot-distro login ubuntu -- bash -c 'python3 --version 2>&1; python3.11 --version 2>&1 || true' 2>&1
    echo ""
    echo "  Cognee venv:"
    proot-distro login ubuntu -- bash -c 'ls -la /opt/cognee-venv/bin/python 2>&1 || echo "  ✗ No venv"' 2>&1
    proot-distro login ubuntu -- bash -c '/opt/cognee-venv/bin/python -c "import cognee; print(\"  ✓ Cognee\", cognee.__version__)" 2>&1 || echo "  ✗ Cognee import FAILED"' 2>&1
else
    echo "  ✗ Ubuntu NOT installed"
    echo ""
    echo "  Attempting install (this shows the actual error)..."
    proot-distro install ubuntu 2>&1 | tail -20
fi
echo ""

echo "── Cognee API ──"
curl -sf http://localhost:8000/health 2>&1 && echo "  ✓ Running" || echo "  ✗ Not running"
echo ""

echo "── QClaw ──"
ls -la ~/QClaw/package.json 2>/dev/null && echo "  ✓ QClaw dir exists" || echo "  ✗ QClaw dir missing"
cat ~/QClaw/package.json 2>/dev/null | grep version | head -1
echo ""

echo "── Logs ──"
echo "Ubuntu log:"
cat ${TMPDIR:-/tmp}/qc-ubuntu.log 2>/dev/null | tail -15 || echo "  (no log)"
echo ""
echo "Cognee log:"
cat ${TMPDIR:-/tmp}/qc-cognee.log 2>/dev/null | tail -15 || echo "  (no log)"
echo ""

echo "── npm link ──"
which qclaw 2>&1 || echo "  ✗ qclaw not in PATH"
ls -la $(npm config get prefix 2>/dev/null)/bin/qclaw 2>/dev/null || echo "  ✗ no symlink"
echo ""

echo "═══════════════════════════════════════"
echo "  Copy everything above and paste it"
echo "═══════════════════════════════════════"
