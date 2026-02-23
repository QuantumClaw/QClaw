# Install on Linux

Works on Ubuntu, Debian, Fedora, Arch, Alpine, and anything else with Node.js 20+.

## Quick Start (Ubuntu/Debian)

```bash
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Verify
node -v  # should show v22.x.x

# Install QuantumClaw
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install

# Setup wizard
npx qclaw onboard

# Start
npx qclaw start
```

Dashboard: http://localhost:3000

## Other Distros

### Fedora / RHEL / CentOS Stream

```bash
# Node.js 22
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs git

git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install
npx qclaw onboard
```

### Arch Linux

```bash
sudo pacman -S nodejs npm git

git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install
npx qclaw onboard
```

### Alpine Linux

```bash
apk add nodejs npm git python3 make g++

git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install
npx qclaw onboard
```

Alpine needs `python3 make g++` for the native SQLite module. If you want to skip that:

```bash
apk add nodejs npm git
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install --ignore-scripts
npx qclaw onboard
```

QuantumClaw will use JSON file memory instead (works fine, just less efficient for large histories).

### Using nvm (any distro)

If you manage multiple Node.js versions:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install
npx qclaw onboard
```

## Adding the Knowledge Graph (Recommended)

The knowledge graph gives your agent relationship awareness. It needs Docker.

```bash
# Install Docker (if you don't have it)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Start Qdrant (vector database)
docker run -d \
  --name qdrant \
  --restart unless-stopped \
  -p 6333:6333 \
  -v qdrant_data:/qdrant/storage \
  qdrant/qdrant

# Start Cognee (knowledge graph engine)
docker run -d \
  --name cognee \
  --restart unless-stopped \
  -p 8000:8000 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  cognee/cognee

# Verify
curl http://localhost:6333/healthz   # Qdrant
curl http://localhost:8000/api/v1/health  # Cognee

# Start QuantumClaw (auto-detects Cognee)
npx qclaw start
```

Or use docker-compose for the full stack:

```bash
cd QClaw
docker compose up -d
```

## Running as a Service (Always-On)

### systemd (recommended)

Create `/etc/systemd/system/quantumclaw.service`:

```ini
[Unit]
Description=QuantumClaw Agent Runtime
After=network.target docker.service

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/QClaw
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable quantumclaw
sudo systemctl start quantumclaw

# Check status
sudo systemctl status quantumclaw

# View logs
journalctl -u quantumclaw -f
```

### pm2

```bash
npm install -g pm2
cd ~/QClaw
pm2 start src/index.js --name quantumclaw
pm2 save
pm2 startup  # follow the instructions it gives you
```

## Updating

```bash
cd ~/QClaw
git pull
npm install
npx qclaw start
```

Your config, secrets, and memory are stored in `~/.quantumclaw/` and are never touched by updates.

## Troubleshooting

**`npm install` fails on better-sqlite3:**

Install build tools:
```bash
sudo apt install -y python3 make g++
npm install
```

Or skip native SQLite entirely:
```bash
npm install --ignore-scripts
```

**Port 3000 already in use:**

```bash
npx qclaw config set dashboard.port 4000
npx qclaw start
```

**Permission denied on Docker:**

```bash
sudo usermod -aG docker $USER
newgrp docker
```

**Agent exits immediately:**

```bash
npx qclaw diagnose
```

This checks Node.js version, config, API keys, Cognee, and all other dependencies.
