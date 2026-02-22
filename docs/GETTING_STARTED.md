# Getting Started

Get QuantumClaw running in under 5 minutes.

## Prerequisites

- **Node.js 20+** (22 recommended)
- That's it. No Docker required. No cloud account. No credit card.

## Install

### Linux (Recommended)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && bash scripts/install.sh
```

### macOS

```bash
brew install node
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && bash scripts/install.sh
```

### Windows (WSL2)

QuantumClaw runs on Linux. On Windows, that means WSL2.

**If you don't have WSL2 yet:**

1. Open PowerShell as Administrator (right-click Start, "Terminal (Admin)")
2. Run:
```powershell
wsl --install -d Ubuntu
```
3. Restart your computer when prompted
4. After restart, Ubuntu opens automatically. Create a username and password (anything you like, it's just for the Linux environment)
5. Done. You now have Linux running inside Windows.

**Then install QuantumClaw:**

Open Ubuntu (search "Ubuntu" in Start menu) and run:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

cd ~
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && bash scripts/install.sh
```

**Important:** Always install in your Linux home folder (`~/QClaw`), never in `/mnt/c/Users/...`. The Windows filesystem through WSL is 5-10x slower.

### Android (Termux)

Install [Termux from F-Droid](https://f-droid.org/packages/com.termux/) (not Google Play, that version is outdated and broken).

```bash
# Update and install essentials
pkg update && pkg upgrade -y
pkg install nodejs-lts git -y

# Clone and install
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install

# If npm install fails on better-sqlite3 (native compilation error):
# That's fine! Run this instead:
npm install --ignore-scripts
# QuantumClaw will automatically use a JSON file fallback for memory.
# Everything works, just slightly less efficient for large histories.

# Optional: install build tools for native SQLite support
pkg install build-essential python3 -y
npm rebuild better-sqlite3

# Run the setup
npx qclaw onboard
npx qclaw start
```

**Keeping it alive in background:**

```bash
# Prevent Android from killing Termux
termux-wake-lock

# Start agent in background
npx qclaw start &

# Or use Termux:Boot (from F-Droid) for auto-start on phone boot
mkdir -p ~/.termux/boot
echo '#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/QClaw && npx qclaw start' > ~/.termux/boot/start-qclaw.sh
chmod +x ~/.termux/boot/start-qclaw.sh
```

**Remote knowledge graph:** Docker doesn't run on Termux, so run Cognee + Qdrant on a separate machine (laptop, VPS, Pi) and point your agent at it:

```bash
npx qclaw config set memory.cognee.url http://your-server:8000
```

### Raspberry Pi

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install
npx qclaw onboard
```

Runs comfortably on Pi 4 (2GB+). Good for an always-on agent.

### Docker

```bash
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw

# Full stack (QClaw + Cognee + Qdrant)
docker compose up -d

# First-time onboarding
docker compose run qclaw npx qclaw onboard
```

### VPS (Hetzner, DigitalOcean, etc.)

```bash
ssh root@your-server
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install
npx qclaw onboard
```

Any box with 512MB RAM and Node.js works.

## Onboarding

The wizard walks you through everything:

1. **Your name** — so the agent knows who it's talking to
2. **Agent purpose** — what you want it to do
3. **AI provider** — pick one, add the API key, it verifies instantly
4. **Channels** — connect Telegram, Discord, or just use the web dashboard
5. **Done** — keys encrypted, Trust Kernel created, audit trail running

## Starting Your Agent

```bash
npx qclaw start
```

Dashboard: http://localhost:3000

## What Happens Next

- Your agent responds on connected channels
- The heartbeat checks in periodically (scans inboxes, watches calendars)
- The knowledge graph builds up over time as the agent learns your business
- Every action is logged in the audit trail

## Commands

```bash
npx qclaw onboard   # first-time setup
npx qclaw start     # start the agent
npx qclaw status    # check agent health
npx qclaw diagnose  # full health check
npx qclaw chat      # chat directly in terminal
npx qclaw help      # all commands
```

## Connecting Cognee (Knowledge Graph)

Cognee gives your agent a proper knowledge graph. Without it, memory falls back to SQLite (still works, just less powerful).

### Option 1: Docker (Recommended)

```bash
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
docker run -d --name cognee -p 8000:8000 -e QDRANT_URL=http://host.docker.internal:6333 cognee/cognee
```

### Option 2: docker-compose (with QClaw)

```bash
docker compose up -d
```

This starts QClaw, Cognee, and Qdrant together.

QuantumClaw auto-detects Cognee and manages the authentication token automatically. If Cognee goes down, the agent continues with SQLite memory and reconnects when Cognee comes back.

## Connecting AGEX (Credential Management)

If you're running an AGEX Hub, QuantumClaw connects automatically:

```bash
AGEX_HUB_URL=http://localhost:4891 npx qclaw start
```

Without AGEX, credentials are stored locally with AES-256-GCM encryption. Everything works either way.

Learn more about AGEX: [agexhq.com](https://agexhq.com)

## Troubleshooting

**Agent won't start:**
```bash
npx qclaw diagnose
```
This checks Node.js version, config, secrets, Cognee connectivity, and channel status.

**Cognee won't connect:**
Check the containers are running:
```bash
docker ps | grep -E 'cognee|qdrant'
```

**API key rejected:**
Re-run onboarding to update:
```bash
npx qclaw onboard
```

**WSL is slow:**
Make sure QClaw is in `~/QClaw`, not `/mnt/c/...`.

## Next Steps

- Join the [Discord](https://discord.gg/37x3wRha) for help and to share your setup
- Read [CONTRIBUTING.md](CONTRIBUTING.md) if you want to help build
- Check the [ROADMAP.md](ROADMAP.md) for what's coming
- Join the discussions on [GitHub](https://github.com/QuantumClaw/QClaw/discussions)
