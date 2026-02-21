# Install on Android (Termux)

QuantumClaw runs on your phone. No root needed.

## Install (3 commands)

```bash
pkg install nodejs-lts git -y
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && bash scripts/install.sh
```

That's it. The install script handles everything.

After install:

```bash
qclaw onboard
qclaw start
```

**If you're using proot-distro Ubuntu** instead of raw Termux:

```bash
apt install nodejs git -y
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && bash scripts/install.sh
```

## Full Guide

### Step 1: Install Termux

Download from **[F-Droid](https://f-droid.org/packages/com.termux/)** (not Google Play — that version is outdated and broken).

Direct APK: [F-Droid Termux page](https://f-droid.org/packages/com.termux/)

After installing, open Termux and let it set up (takes a minute on first launch).

### Step 2: Update and install dependencies

```bash
pkg update && pkg upgrade -y
pkg install nodejs-lts git -y
```

Verify:

```bash
node -v   # should show v20+ or v22+
git --version
```

### Step 3: Install QuantumClaw

```bash
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw

# Recommended: use yarn (npm has cache/rename issues in proot containers)
yarn install --ignore-scripts --no-optional

# Alternative: npm (if yarn isn't installed)
rm -f package-lock.json
npm install --ignore-scripts
```

`--ignore-scripts` skips compiling `better-sqlite3` (native C++ module that usually fails on Android). QuantumClaw automatically uses JSON file memory instead — works perfectly.

**If using a proot-distro Ubuntu container** (not raw Termux), use `yarn`. npm's cache often breaks because proot doesn't fully support the `rename()` syscall.

### Step 4: Run the setup wizard

```bash
npx qclaw onboard
```

If `npx` gives "Permission denied", use:

```bash
node src/cli/index.js onboard
```

This asks for:
1. Your name
2. AI provider + API key
3. Channels (Telegram works great on mobile)
4. Tool integrations

### Step 5: Start your agent

```bash
npx qclaw start
```

Dashboard: http://localhost:3000 (open in your phone's browser).

---

## Keeping it Running in the Background

Android aggressively kills background apps to save battery. Here's how to keep your agent alive.

### Wake lock (essential)

```bash
termux-wake-lock
```

This prevents Android from killing Termux. You'll see a notification in your notification bar. Run this every time you start Termux, or add it to your shell config:

```bash
echo 'termux-wake-lock' >> ~/.bashrc
```

### Running in background

```bash
# Start agent in background
npx qclaw start &

# Or use nohup to survive terminal close
nohup npx qclaw start > ~/qclaw.log 2>&1 &
```

### Auto-start on phone boot

Install [Termux:Boot from F-Droid](https://f-droid.org/packages/com.termux.boot/).

Create a boot script:

```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-qclaw.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/QClaw && npx qclaw start >> ~/qclaw.log 2>&1 &
EOF
chmod +x ~/.termux/boot/start-qclaw.sh
```

Now QuantumClaw starts automatically when your phone boots.

### Battery optimisation

Disable battery optimisation for Termux:

**Android 12+:** Settings → Apps → Termux → Battery → Unrestricted

**Samsung:** Settings → Apps → Termux → Battery → Allow background activity

**Xiaomi/MIUI:** Settings → Apps → Manage apps → Termux → No restrictions. Also: Settings → Battery & performance → App battery saver → Termux → No restrictions.

**OnePlus/OxygenOS:** Settings → Battery → Battery optimisation → Termux → Don't optimise.

---

## Knowledge Graph (Remote)

Docker doesn't run on Termux, so the knowledge graph (Cognee + Qdrant) needs to run elsewhere. Options:

### Option A: Your laptop or desktop

On your laptop (macOS/Linux/Windows with WSL):

```bash
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
docker run -d --name cognee -p 8000:8000 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  cognee/cognee
```

Find your laptop's local IP:

```bash
# macOS/Linux
hostname -I | awk '{print $1}'
# or
ifconfig | grep "inet " | grep -v 127.0.0.1
```

On your phone (Termux):

```bash
npx qclaw config set memory.cognee.url http://YOUR_LAPTOP_IP:8000
npx qclaw start
```

Both devices need to be on the same Wi-Fi network.

### Option B: A VPS

Run Cognee on a cheap VPS (Hetzner CAX11 at ~€4/month works well):

```bash
# On the VPS
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
docker run -d --name cognee -p 8000:8000 \
  -e QDRANT_URL=http://localhost:6333 \
  cognee/cognee
```

On your phone:

```bash
npx qclaw config set memory.cognee.url http://YOUR_VPS_IP:8000
```

### Option C: No knowledge graph

QuantumClaw works perfectly without Cognee. Conversation memory uses SQLite (or JSON files). You just won't get relationship mapping and entity extraction. Many users start without it and add it later.

---

## Useful Commands on Termux

```bash
# Check agent status
npx qclaw status

# Interactive chat
npx qclaw chat

# Send a quick message
npx qclaw chat "What's on my schedule today?"

# Full diagnostics
npx qclaw diagnose

# View recent audit log
npx qclaw logs

# Stop the agent
npx qclaw stop

# Check battery/memory impact
top -n 1 | grep node
```

---

## Updating

```bash
cd ~/QClaw
npx qclaw stop
git pull
npm install    # or npm install --ignore-scripts
npx qclaw start
```

---

## Termux Extras

### Termux:API (optional)

Install [Termux:API from F-Droid](https://f-droid.org/packages/com.termux.api/) for hardware access:

```bash
pkg install termux-api

# Now you can:
termux-battery-status    # check battery
termux-notification --title "QClaw" --content "Agent is running"
termux-vibrate           # buzz the phone
termux-tts-speak "Alert from your agent"  # text to speech
```

Future QuantumClaw skills may use these for mobile-native interactions.

### Storage access

To access phone storage (for reading documents, photos, etc.):

```bash
termux-setup-storage
```

This creates `~/storage/` with access to Downloads, DCIM, etc.

### SSH into your phone

Install an SSH server to manage your agent from your laptop:

```bash
pkg install openssh
sshd   # starts on port 8022

# From your laptop:
ssh -p 8022 user@PHONE_IP
```

---

## Troubleshooting

### "pkg: command not found"

You're not in Termux. Make sure you opened the Termux app (black icon with `$_`), not the regular Android terminal.

### "node: command not found" after restart

```bash
source ~/.bashrc
# or
pkg install nodejs-lts
```

### npm install keeps failing

```bash
# Nuclear option: clean everything and retry
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --ignore-scripts
```

### Agent crashes after phone locks

You need the wake lock:

```bash
termux-wake-lock
```

And disable battery optimisation for Termux (see above).

### Storage full

Termux has its own storage area. Check space:

```bash
df -h ~
```

If low, clear npm cache:

```bash
npm cache clean --force
```

### "EACCES: permission denied"

```bash
chmod -R 755 ~/QClaw
```
