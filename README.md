<div align="center">
  <h1>⚛ QuantumClaw</h1>
  <p><strong>Self-hosted AI agent runtime — your personal assistant that lives on your hardware.</strong></p>
  <p>
  <a href="package.json"><img src="https://img.shields.io/badge/version-1.5.1-purple.svg" alt="Version 1.5.1"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://clawhub.ai"><img src="https://img.shields.io/badge/skills-3,286+-green.svg" alt="ClawHub Skills"></a>
  <a href="#-5-messaging-channels"><img src="https://img.shields.io/badge/channels-5-orange.svg" alt="5 Channels"></a>
  </p>
  <p><em>The reference implementation of the <a href="https://github.com/agexhq/agex-spec">AGEX protocol</a> for agent identity and trust.</em></p>
</div>

---

## What is QuantumClaw?

QuantumClaw is an AI agent that runs on your machine — laptop, VPS, Raspberry Pi, or Android phone. It connects to your messaging apps, learns about you over time, and takes actions on your behalf.

- **Runs where your data lives** — no cloud, no tracking, your conversations never leave your hardware
- **Talks to you everywhere** — Telegram, Discord, WhatsApp, Slack, Email, and a web dashboard
- **Gets smarter over time** — extracts facts, preferences, and events from every conversation
- **Acts autonomously** — runs commands, reads/writes files, searches the web, sends emails, all governed by your safety rules
- **Speaks and listens** — send a voice note on Telegram, get a voice reply back

---

## Quick Start

```bash
npm i -g quantumclaw
qclaw onboard      # interactive setup
qclaw start        # agent + dashboard at localhost:3000
```

**Requirements:** Node.js 20+ and one LLM API key (Anthropic, OpenAI, Groq free tier, OpenRouter, Google, xAI, Mistral, or Together).

---

## Features

### 🔐 Self-Hosted & Private

Everything local. SQLite database, AES-256-GCM encrypted secrets, direct LLM API calls — no middleware.

### 📡 5 Messaging Channels

| Channel | Features |
|---------|----------|
| **Telegram** | DMs, voice transcription + TTS replies, image support |
| **Discord** | @mentions in servers, DMs, 2000-char splitting |
| **WhatsApp** | QR code pairing, session persistence, group filtering |
| **Slack** | Socket Mode, @mentions + DMs, 4000-char splitting |
| **Email** | IMAP polling + SMTP auto-reply |

All channels use a **pairing flow** — your agent only talks to people you approve. Assign different agents to different channels via config.

### 🧠 Persistent Memory

Three-layer memory that survives restarts: vector search (TF-IDF), structured knowledge store (facts, events, preferences), and optional Cognee-powered knowledge graph. Per-agent isolation. Dashboard has search, remember/forget, graph visualization, and JSON export.

### 🤖 Multi-Agent System

Spawn specialist agents from CLI, dashboard, or conversation. Each agent has its own SOUL.md personality, AGEX cryptographic identity, scoped tool access, and conversation history.

### ⚡ 10+ Built-in Tools

`shell_exec`, `read_file`, `write_file`, `list_directory`, `web_fetch`, `render_canvas`, `search_knowledge`, `spawn_agent`, `get_current_time`, `calculate` — plus 12 pre-configured MCP servers and 3,286 community skills from [ClawHub](https://clawhub.ai).

### 🎙️ Voice & Media

Telegram voice notes are transcribed (Deepgram → Whisper → Groq) and replies come back as voice (ElevenLabs → OpenAI TTS). Images work via paste/drag-drop in dashboard.

### 🖼️ Live Canvas

Agent renders HTML, SVG, Mermaid diagrams, and Markdown directly in a split-pane dashboard view. Multiple artifacts persist as tabs.

### 📋 Proactive Push & Scheduled Tasks

Agent sends messages to all your channels unprompted — morning briefs, price alerts, weekly summaries. Configure via dashboard or config.

### 🔐 Trust Kernel

Immutable safety rules in VALUES.md. Every tool call is checked before execution. The agent cannot modify its own rules.

### 💰 5-Tier Cost Routing

Automatic model selection: reflex (free) → simple → standard → complex → expert. Average daily cost: £0.01–0.05.

---

## Dashboard

12-page web UI at `http://localhost:3000`:

💬 Chat (with Live Canvas) · 📊 Overview · 📡 Channels · 📈 Usage · 🤖 Agents · 🔧 Skills · ⚡ Tools · ⏰ Tasks · 🧠 Memory · 🔑 API Keys · ⚙️ Config · 📋 Logs

---

## CLI

```bash
qclaw start / stop / restart / status
qclaw chat                              # terminal chat
qclaw dashboard                         # show URL
qclaw agent list / spawn / delete
qclaw skill list / search / install / remove
qclaw tool list / enable / disable
qclaw secret set / list
qclaw pairing list / approve
qclaw config get / set
qclaw update
```

---

## Docker

```bash
cp .env.example .env && docker compose up -d
```

---

## Architecture

```
Channels (5)  →  5-Tier Router  →  Agent Registry  →  Tools (10+ built-in, MCP, ClawHub)
                      ↓                    ↓
                 Trust Kernel        Memory (3 layers)
                 (VALUES.md)         Vector · Knowledge · Graph
```

AGEX protocol gives every agent a cryptographic identity for authentication, scoped permissions, and credential sharing.

---

## License

MIT © 2025–2026 ALLIN1.APP LTD — Built by [Hayley](https://allin1.app)
