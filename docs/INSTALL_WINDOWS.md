# Install on Windows

QuantumClaw runs inside WSL2 (Windows Subsystem for Linux). This gives you a real Linux environment inside Windows — it's fast, lightweight, and how most developers run Linux tools on Windows.

**Time required:** ~10 minutes for a fresh install.

## Quick Start

If you already have WSL2 and Node.js:

```bash
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw && npm install
npx qclaw onboard
npx qclaw start
```

If not, follow the full guide below.

---

## Full Guide: From Scratch

### Step 1: Install WSL2

Open **PowerShell as Administrator** (right-click Start button → "Terminal (Admin)"):

```powershell
wsl --install -d Ubuntu
```

This installs WSL2 and Ubuntu in one command. **Restart your computer when prompted.**

After restart, Ubuntu opens automatically. It asks you to create a username and password. This is just for the Linux environment — pick anything you'll remember.

**Verify WSL2 is working:**

```powershell
# In PowerShell
wsl --list --verbose
```

You should see Ubuntu with VERSION 2.

> **Already have WSL1?** Upgrade it:
> ```powershell
> wsl --set-version Ubuntu 2
> ```

### Step 2: Install Node.js inside Ubuntu

Open Ubuntu (search "Ubuntu" in Start menu, or type `wsl` in any terminal):

```bash
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Verify
node -v   # should show v22.x.x
npm -v    # should show 10.x.x
```

### Step 3: Install QuantumClaw

**Critical:** Always install in your Linux home folder, not in `/mnt/c/Users/...`. The Windows filesystem through WSL is 5-10x slower and causes real problems.

```bash
cd ~
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw
npm install
```

### Step 4: Run the Setup Wizard

```bash
npx qclaw onboard
```

This walks you through:
1. Your name and timezone
2. AI provider and API key (verified in real-time)
3. Channel connections (Telegram, Discord, etc.)
4. Tool integrations

### Step 5: Start Your Agent

```bash
npx qclaw start
```

Dashboard: http://localhost:3000 (open in your normal Windows browser — WSL2 shares localhost with Windows).

---

## Adding the Knowledge Graph

### Option A: Docker Desktop (easiest)

1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
2. Install it. During setup, make sure **"Use WSL 2 based engine"** is checked
3. Open Docker Desktop → Settings → Resources → WSL Integration → Enable for Ubuntu
4. Restart Docker Desktop

Then in your Ubuntu terminal:

```bash
# Start Qdrant
docker run -d \
  --name qdrant \
  --restart unless-stopped \
  -p 6333:6333 \
  -v qdrant_data:/qdrant/storage \
  qdrant/qdrant

# Start Cognee
docker run -d \
  --name cognee \
  --restart unless-stopped \
  -p 8000:8000 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  cognee/cognee

# Verify
curl http://localhost:6333/healthz
curl http://localhost:8000/api/v1/health

# Start QuantumClaw (auto-detects Cognee)
cd ~/QClaw
npx qclaw start
```

### Option B: Docker inside WSL only (no Docker Desktop)

If you don't want Docker Desktop:

```bash
# Inside Ubuntu (WSL2)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Start Docker daemon
sudo service docker start

# Now run the same docker commands as Option A
```

To auto-start Docker when WSL opens, add to `~/.bashrc`:

```bash
if ! pgrep -x "dockerd" > /dev/null; then
  sudo service docker start > /dev/null 2>&1
fi
```

And allow passwordless docker start — run `sudo visudo` and add:

```
YOUR_USERNAME ALL=(ALL) NOPASSWD: /usr/sbin/service docker *
```

---

## Running QuantumClaw from Windows

### Opening your agent

You have several options:

**Option 1: Ubuntu terminal** (search "Ubuntu" in Start menu)

```bash
cd ~/QClaw && npx qclaw start
```

**Option 2: Windows Terminal** (search "Terminal" in Start menu)

Click the dropdown arrow next to the + tab → Ubuntu. This is the nicest terminal experience.

**Option 3: From PowerShell/CMD**

```powershell
wsl -d Ubuntu -e bash -c "cd ~/QClaw && npx qclaw start"
```

**Option 4: VSCode** (for development)

```powershell
# Open QClaw in VSCode with WSL support
code --remote wsl+Ubuntu ~/QClaw
```

### Accessing the dashboard

Open any Windows browser and go to:

```
http://localhost:3000
```

WSL2 automatically forwards ports to Windows. No extra config needed.

### Chatting from PowerShell

```powershell
wsl -d Ubuntu -e bash -c "cd ~/QClaw && npx qclaw chat 'What is my schedule today?'"
```

### Interactive chat from PowerShell

```powershell
wsl -d Ubuntu -e bash -c "cd ~/QClaw && npx qclaw chat"
```

---

## Auto-Start on Windows Boot

### Option 1: Windows Task Scheduler

1. Open Task Scheduler (search in Start menu)
2. Click "Create Basic Task"
3. Name: "QuantumClaw"
4. Trigger: "When the computer starts"
5. Action: "Start a program"
6. Program: `wsl`
7. Arguments: `-d Ubuntu -e bash -c "cd ~/QClaw && npx qclaw start"`
8. Finish

### Option 2: Startup script

Create a file `start-qclaw.bat` in your `shell:startup` folder:

```
Press Win+R, type: shell:startup, press Enter
```

Create `start-qclaw.bat`:

```batch
@echo off
wsl -d Ubuntu -e bash -c "cd ~/QClaw && npx qclaw start"
```

### Option 3: pm2 inside WSL

```bash
# In Ubuntu
npm install -g pm2
cd ~/QClaw
pm2 start src/index.js --name quantumclaw
pm2 save
```

Then add a startup script to keep WSL running (WSL shuts down when all terminals close).

---

## Updating

```bash
# In Ubuntu terminal
cd ~/QClaw
git pull
npm install
npx qclaw start
```

Your config and secrets are in `~/.quantumclaw/` inside WSL — updates never touch them.

---

## Common Issues

### "WSL is not installed"

Make sure you're running PowerShell as Administrator. If `wsl --install` fails:

1. Open "Turn Windows features on or off"
2. Enable "Windows Subsystem for Linux"
3. Enable "Virtual Machine Platform"
4. Restart
5. Run `wsl --install -d Ubuntu` again

### WSL2 requires Hyper-V / virtualisation

Enable virtualisation in your BIOS/UEFI settings. The setting is usually called "Intel VT-x" or "AMD-V" and is under CPU settings.

### npm install fails on better-sqlite3

Install build tools inside Ubuntu:

```bash
sudo apt install -y python3 make g++
npm install
```

Or skip it entirely:

```bash
npm install --ignore-scripts
```

### "Localhost not working in browser"

WSL2 should auto-forward ports. If it doesn't:

```powershell
# In PowerShell — find WSL IP
wsl hostname -I
```

Then open `http://THAT_IP:3000` in your browser.

### Everything is slow

Make sure your project is in `~/QClaw` (Linux filesystem), **not** in `/mnt/c/Users/...` (Windows filesystem through WSL). The Windows filesystem is 5-10x slower through WSL.

Check:

```bash
pwd
# Should show: /home/your-username/QClaw
# NOT: /mnt/c/Users/...
```

If it's in the wrong place:

```bash
mv /mnt/c/Users/you/QClaw ~/QClaw
cd ~/QClaw
```

### Docker permission denied

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### WSL runs out of memory

WSL2 defaults to using half your system RAM. To limit it, create/edit `C:\Users\YOUR_NAME\.wslconfig`:

```ini
[wsl2]
memory=4GB
swap=2GB
```

Then restart WSL:

```powershell
wsl --shutdown
wsl
```

### Multiple WSL distros

If you have multiple Linux distros installed:

```powershell
# See all distros
wsl --list --verbose

# Set Ubuntu as default
wsl --set-default Ubuntu
```
