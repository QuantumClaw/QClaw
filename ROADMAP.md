# Roadmap

What's coming for QuantumClaw. This is a living document.

## v1.1 — Core Stability (NOW — Q1 2026)

- [x] `qclaw diagnose` health check with auto-restart
- [x] `qclaw update` self-updater
- [x] Cloudflare tunnel mandatory in install (all platforms)
- [x] Dashboard PIN protection + token expiry + auth lockout
- [x] Telegram message broadcast to dashboard (real-time)
- [x] WebSocket auto-reconnect
- [x] Mobile-friendly terminal onboarding (clear steps, boxed commands)
- [x] Chrome Remote Desktop tip for Android users
- [x] `sudo npm link` fix for Linux/WSL
- [ ] Full end-to-end onboard → start → pair → chat flow (zero errors)
- [ ] Dashboard shows "Connected" reliably (not intermittent offline)
- [ ] `qclaw onboard` re-run without breaking existing config
- [ ] Smoke tests passing on Termux, WSL, macOS, Linux
- [ ] Error recovery: agent auto-restarts on crash (pm2 on Termux, watchdog on desktop)
- [ ] SQLite WAL mode for better concurrent access
- [ ] Completion cache stats in dashboard
- [ ] Full test suite with CI (GitHub Actions)

## v1.2 — Desktop & Mobile Apps (Q2 2026)

- [ ] **QClaw-Desktop** (Electron) — one-click install for Windows/Mac/Linux
  - Bundles Node.js + QClaw + cloudflared
  - System tray icon, onboarding wizard, auto-start on boot
  - Build targets: `.exe` (Windows), `.dmg` (macOS), `.AppImage` + `.deb` (Linux)
- [ ] **QClaw-Android** (native APK) — no Termux dependency
  - Embeds Node.js runtime via nodejs-mobile
  - Bundles QClaw + cloudflared ARM64 binary
  - One APK install, native onboarding, background agent
- [ ] Landing page download buttons: Windows / macOS / Linux / Android / Source
- [ ] GitHub Releases CI for all platforms

## v1.3 — More Channels (Q2 2026)

- [ ] WhatsApp via WaOps bridge
- [ ] Discord channel (full gateway, not just bot)
- [ ] Slack channel (Bolt integration)
- [ ] Signal channel
- [ ] Matrix channel
- [ ] WebChat embeddable widget

## v1.4 — Agent Swarms (Q3 2026)

- [ ] Multi-agent orchestration (Atlas pattern)
- [ ] AGEX credential delegation between agents
- [ ] Agent-to-agent messaging via sessions
- [ ] Shared knowledge graph across agent swarm
- [ ] Per-agent cost tracking and budgets

## v1.5 — Voice (Q3 2026)

- [ ] ElevenLabs TTS integration
- [ ] Deepgram real-time STT
- [ ] Voice wake word detection
- [ ] Talk mode (continuous conversation)
- [ ] Voice routing in model router (Tier 4)

## v1.6 — Browser & Canvas (Q4 2026)

- [ ] Puppeteer browser control skill
- [ ] Screenshot and DOM snapshot tools
- [ ] DroidClaw integration (Android screen control via ADB)
- [ ] Live canvas (agent-driven visual workspace)
- [ ] Media pipeline (image/audio/video processing)

## v2.0 — Multi-Tenant SaaS (Q4 2026)

- [ ] ALLIN1.APP integration
- [ ] Tenant isolation and billing
- [ ] Managed AGEX Hub
- [ ] Skill marketplace
- [ ] White-label dashboard

## Community Wishlist

Got an idea? Open a [feature request](https://github.com/QuantumClaw/QClaw/issues/new?template=feature_request.md) or start a [discussion](https://github.com/QuantumClaw/QClaw/discussions).
