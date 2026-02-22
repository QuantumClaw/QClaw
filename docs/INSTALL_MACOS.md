# Install on macOS

Works on macOS 12+ (Monterey and newer), both Intel and Apple Silicon.

## Quick Start

```bash
# Install Node.js (pick one method)
brew install node          # Homebrew (recommended if you have it)
# OR download from https://nodejs.org (LTS version)

# Verify
node -v  # should show v20+ (v22 ideal)

# Install QuantumClaw
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install

# Setup wizard
npx qclaw onboard

# Start
npx qclaw start
```

Dashboard: http://localhost:3000

## Detailed Install

### Node.js

**Option A: Homebrew** (if you already use Homebrew)

```bash
brew install node
```

**Option B: Official installer** (no Homebrew needed)

1. Go to [nodejs.org](https://nodejs.org)
2. Download the macOS installer (LTS version)
3. Double-click the `.pkg` file and follow the steps
4. Open Terminal and verify: `node -v`

**Option C: nvm** (if you manage multiple Node versions)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.zshrc  # or ~/.bashrc
nvm install 22
nvm use 22
```

### Git

macOS ships with Git via Xcode Command Line Tools. If `git --version` shows "command not found":

```bash
xcode-select --install
```

Click Install when prompted. Takes a few minutes.

### QuantumClaw

```bash
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw
npm install
npx qclaw onboard
```

The onboard wizard walks you through:
1. Your name and timezone (auto-detected)
2. AI provider + API key (verified in real-time)
3. Channel connections (Telegram, Discord, etc.)
4. Tool integrations (GHL, Notion, Stripe, etc.)

Everything is encrypted and stored in `~/.quantumclaw/`.

## Adding the Knowledge Graph

Docker Desktop makes this easy on macOS.

### Step 1: Install Docker Desktop

Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/). Open the `.dmg`, drag to Applications, launch it once. Docker runs in the menu bar.

### Step 2: Start the containers

```bash
# Qdrant (vector database)
docker run -d \
  --name qdrant \
  --restart unless-stopped \
  -p 6333:6333 \
  -v qdrant_data:/qdrant/storage \
  qdrant/qdrant

# Cognee (knowledge graph)
docker run -d \
  --name cognee \
  --restart unless-stopped \
  -p 8000:8000 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  cognee/cognee
```

### Step 3: Verify

```bash
curl http://localhost:6333/healthz        # should return "ok" or similar
curl http://localhost:8000/api/v1/health  # should return JSON
```

### Step 4: Start QuantumClaw

```bash
npx qclaw start
```

It auto-detects Cognee and authenticates automatically. You'll see:

```
✓ Knowledge graph connected (X entities)
```

Or use docker-compose for everything in one command:

```bash
cd QClaw
docker compose up -d
```

## Running in the Background

### Using launchd (macOS native)

Create `~/Library/LaunchAgents/com.quantumclaw.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.quantumclaw.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>src/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USERNAME/QClaw</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/quantumclaw.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/quantumclaw-error.log</string>
</dict>
</plist>
```

Replace `YOUR_USERNAME` and adjust the node path (run `which node` to find it — on Apple Silicon with Homebrew it's `/opt/homebrew/bin/node`).

```bash
launchctl load ~/Library/LaunchAgents/com.quantumclaw.agent.plist

# Check it's running
launchctl list | grep quantumclaw

# Stop
launchctl unload ~/Library/LaunchAgents/com.quantumclaw.agent.plist

# View logs
tail -f /tmp/quantumclaw.log
```

### Using pm2

```bash
npm install -g pm2
cd ~/QClaw
pm2 start src/index.js --name quantumclaw
pm2 save
pm2 startup  # follow the instructions it prints
```

## Updating

```bash
cd ~/QClaw
git pull
npm install
npx qclaw start
```

Config and secrets live in `~/.quantumclaw/` — updates never touch them.

## Troubleshooting

**`npm install` hangs or fails:**

```bash
# Clear npm cache and retry
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

**Port 3000 in use (common if you run React dev servers):**

```bash
npx qclaw config set dashboard.port 4000
```

**Docker containers keep stopping:**

Check Docker Desktop is running (look for the whale icon in the menu bar). If containers crash:

```bash
docker logs cognee
docker logs qdrant
```

**Apple Silicon: native module issues:**

Rarely, `better-sqlite3` might need Rosetta. If `npm install` fails:

```bash
# Try installing with architecture flag
arch -arm64 npm install

# Or skip native module entirely
npm install --ignore-scripts
```

**Firewall blocking connections:**

macOS may ask to allow incoming connections for Node.js. Click Allow. If you missed it:

System Settings → Privacy & Security → Firewall → allow Node.js
