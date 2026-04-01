# ═══════════════════════════════════════════════════════════════════
# QuantumClaw — Windows PowerShell Install
# ═══════════════════════════════════════════════════════════════════
# git clone https://github.com/QuantumClaw/QClaw.git
# cd QClaw; .\scripts\install.ps1
# npx qclaw onboard
# npx qclaw start
# ═══════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

function Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red }
function Info($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  ⚛ QuantumClaw Installer" -NoNewline
Write-Host ""
Write-Host "  Windows" -ForegroundColor DarkGray
Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# [1/4] Node.js 20+
# ═══════════════════════════════════════════════════════════════════
Write-Host "  [1/4] Node.js" -NoNewline -ForegroundColor White
Write-Host ""

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Fail "Node.js not found."
    Write-Host ""
    Write-Host "  Install Node.js 20+ from:" -ForegroundColor Yellow
    Write-Host "  https://nodejs.org" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Or via winget:" -ForegroundColor DarkGray
    Write-Host "  winget install OpenJS.NodeJS.LTS" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

$nodeVersion = (node -v) -replace 'v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 20) {
    Fail "Node.js v$nodeVersion is too old (need 20+)"
    Write-Host "  Update: https://nodejs.org" -ForegroundColor Cyan
    exit 1
}
Ok "Node.js v$nodeVersion"
Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# [2/4] Cloudflare Tunnel
# ═══════════════════════════════════════════════════════════════════
Write-Host "  [2/4] Cloudflare Tunnel" -NoNewline -ForegroundColor White
Write-Host ""

$cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cfCmd) {
    $cfVer = (cloudflared --version 2>&1) -match '\d+\.\d+\.\d+' | Out-Null
    $cfVerStr = if ($Matches) { $Matches[0] } else { "unknown" }
    Ok "cloudflared (already installed)"
} else {
    Info "Installing cloudflared via winget..."
    try {
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if ($wingetCmd) {
            winget install Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Null
            # Refresh PATH
            $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        }
    } catch {
        # Silently continue
    }

    $cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cfCmd) {
        Ok "cloudflared installed"
    } else {
        Warn "cloudflared could not be installed automatically"
        Write-Host ""
        Write-Host "  Install manually:" -ForegroundColor Yellow
        Write-Host "  winget install Cloudflare.cloudflared" -ForegroundColor Cyan
        Write-Host "  Or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Cyan
        Write-Host ""
    }
}
Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# [3/4] npm install
# ═══════════════════════════════════════════════════════════════════
Write-Host "  [3/4] Dependencies" -NoNewline -ForegroundColor White
Write-Host ""

$qclawDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $qclawDir

if (-not (Test-Path "node_modules") -or -not (Test-Path "node_modules\grammy")) {
    Info "npm install..."
    try {
        npm install --progress 2>&1 | Select-Object -Last 3
        Ok "Installed"
    } catch {
        Warn "Retrying without native modules..."
        npm install --ignore-scripts --progress 2>&1 | Select-Object -Last 3
    }
} else {
    Ok "Present"
}

Pop-Location
Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# [4/4] Summary
# ═══════════════════════════════════════════════════════════════════
Write-Host "  ════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Ok "Install complete"
Write-Host ""

Write-Host "  Summary:" -ForegroundColor White
Ok "Node.js v$nodeVersion"
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    Ok "Cloudflare Tunnel"
} else {
    Warn "Cloudflare Tunnel (install manually — see above)"
}
Write-Host ""

Write-Host "  ┌─────────────────────────────────────────────────┐" -ForegroundColor Green
Write-Host "  │                                                 │" -ForegroundColor Green
Write-Host "  │  Run:  " -ForegroundColor Green -NoNewline
Write-Host "npx qclaw onboard" -ForegroundColor Cyan -NoNewline
Write-Host "                        │" -ForegroundColor Green
Write-Host "  │                                                 │" -ForegroundColor Green
Write-Host "  └─────────────────────────────────────────────────┘" -ForegroundColor Green
Write-Host ""
