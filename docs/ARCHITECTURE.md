# QuantumClaw

**The agent runtime with a knowledge graph for a brain.**

Built by QuantumClaw | MIT License | Node.js | Open Source

The first agent framework where relationships between knowledge are
first-class citizens, not an afterthought bolted on via plugins.

---

## Why QuantumClaw Exists

OpenClaw proved the concept. ZeroClaw optimised the runtime.
Neither solved the real problem: **agents don't understand your business.**

They save text. They search text. They don't know that Sarah referred James,
that James works in the same vertical as your highest-paying client,
or that the contract renews next month.

QuantumClaw does. Because the knowledge graph IS the architecture.

---

## First Run Experience

```bash
git clone https://github.com/QuantumClaw/QClaw.git
cd QClaw
npm install
npx qclaw onboard
```

### The Onboarding Wizard

Runs ONCE after install. Guided terminal UI using @clack/prompts.
No editing JSON by hand. No nasty surprises.

**Works everywhere:** Linux, macOS, Windows (WSL2), and Android via
Termux (`pkg install nodejs` then clone and run). If it runs Node.js,
it runs QuantumClaw.

**Design principles:**
- 5 steps. That's it. Running in under 3 minutes.
- Has personality. Talks to you like a human, not a compiler.
- Animated loading states with spinners and progress bars
- Every question explains WHY
- Smart defaults so you can smash Enter through most of it
- Errors give fix instructions, not stack traces
- Purple colour theme throughout (#9333ea / ansi 135)

**Compare to OpenClaw's onboarding:** Security wall of text → QuickStart/Manual
→ config handling → provider list (25+ options) → model filter (25+ options)
→ model picker (hundreds of model strings, no descriptions) → channel list
→ skills status → dependency checkboxes → API key prompts → hooks checkboxes
→ gateway runtime. 12 screens of developer-speak.

QuantumClaw: 5 screens. Talks like a person. Done.

```
  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║     ⚛  Q U A N T U M C L A W  ⚛       ║
  ║                                               ║
  ║     The agent runtime that actually            ║
  ║     understands your business.                 ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝

  v1.0.0 | MIT License | github.com/QuantumClaw/QClaw

  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ Checking system...

  ✓ Node.js v22.1.0
  ✓ Platform: linux-x64 (also works on Android/Termux!)
  ✓ Memory: 487MB available (need 30MB, you're golden)
  ✓ Disk: 2.1GB free

  Right then. Let's build you an agent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◇ Step 1 of 5: Who are you?
│
│  No fluff - just need to know who I'm working for
│  and when to leave you alone.
│
│  Your name? › Hayley
│  Timezone? › Europe/London (auto-detected ✓)
│
│  Nice one. What should your agent actually DO?
│  Don't overthink it - one sentence.
│  › My chief of staff who knows my business inside out
│
│  Solid. Here's the deal:
│
│  ┌─────────────────────────────────────────────────┐
│  │  This runs on YOUR machine. Your data stays     │
│  │  here. No cloud. No tracking. No nonsense.      │
│  │                                                 │
│  │  Your agent CAN read files and take actions.    │
│  │  Everything is logged. Destructive ops need     │
│  │  your approval. Your Trust Kernel (VALUES.md)   │
│  │  sets hard limits it can never override.        │
│  │                                                 │
│  │  You're in control. Always.                     │
│  └─────────────────────────────────────────────────┘
│
│  We good? ● Yeah, let's go  ○ Nah, not for me
│

◇ Step 2 of 5: Give it a brain
│
│  Your agent needs an AI model to think with.
│  This is the only bit that costs money - everything
│  else in QuantumClaw is free.
│
│  Pick your provider:
│  ● Anthropic (Claude)  → Best reasoning. The one I'd pick.
│  ○ OpenAI (GPT)        → Solid all-rounder.
│  ○ Groq                → Stupid fast. Free tier.
│  ○ OpenRouter           → One key, loads of models.
│  ○ Google (Gemini)      → Decent free tier.
│  ○ xAI (Grok)          → Good for real-time stuff.
│  ○ Mistral             → Strong European option.
│  ○ Ollama (local)      → Runs on your machine. Totally free.
│  ○ Amazon Bedrock      → If you're already on AWS.
│  ○ Azure OpenAI        → If you're on Azure.
│  ○ Together AI         → Fast open-source models.
│  ○ Custom endpoint     → Any OpenAI-compatible URL.
│
│  Paste your Anthropic API key:
│  (grab one at console.anthropic.com - takes 30 seconds)
│  › sk-ant-••••••••••••
│
│  ◐ Verifying key...
│  ◓ Checking available models...
│  ✓ Key works! Claude Opus 4.5 available. Nice choice.
│
│  Right - quick money-saving tip. Most of your messages
│  are simple stuff like "thanks" or "what's next?" - those
│  don't need a genius model. Adding a fast model for the
│  easy stuff saves you 60-80% on costs.
│
│  Add a fast model for cheap messages?
│  ● Yes - Groq (free tier, 200ms responses) ← I'd do this
│  ○ No - use Claude for everything
│
│  Groq key: › gsk_••••••••••••
│  ◐ Verifying...
│  ✓ Llama 70B ready. Your "thanks" messages now cost £0.00.
│
│  🔐 Both keys encrypted to AES-256. They'll never appear
│     in any file on your system. Ever.
│

◇ Step 3 of 5: Where do you want to talk to it?
│
│  Your agent needs somewhere to listen. Dashboard is
│  always on - it's basically mission control. Add
│  whatever else you use.
│
│  ☑ Dashboard (always on - your agent's control centre)
│    Port: 3000  (change if something else uses it)
│
│    Want to access it from your phone or outside your network?
│    ○ Nah, this computer only (most secure)
│    ● localtunnel (free link you can open anywhere)
│    ○ Cloudflare Tunnel (free, needs CF account)
│    ○ ngrok (paid, rock solid)
│
│  Messaging:
│  ☐ Telegram        → Chat from your phone. 2 min setup.
│  ☐ WhatsApp        → Via WaOps bridge
│  ☐ Discord         → Bot API
│  ☐ Slack           → Socket mode
│  ☐ Signal          → Via signal-cli
│  ☐ iMessage        → macOS only (via imsg)
│  ☐ Microsoft Teams → Bot Framework
│  ☐ Google Chat     → Chat API
│  ☐ Matrix          → Self-hosted comms
│  ☐ LINE            → Messaging API
│  ☐ IRC             → Old school, still works
│  ☐ Email (SMTP)    → Send/receive emails
│  ☐ Skip - I'll add these later
│
│  [Telegram selected]
│
│  Sweet. Here's how to get a Telegram bot (2 minutes):
│  1. Open Telegram → search @BotFather
│  2. Send /newbot
│  3. Pick a name (e.g. "My QClaw Bot")
│  4. Copy the token it gives you
│
│  Paste your bot token:
│  › 8534••••••yqg0
│  ◐ Finding your bot...
│  ✓ Found @calwdiaai1bot!
│
│  Now lock it to your account (so nobody else can use it):
│  Send /start to @userinfobot and paste your user ID:
│  › 123456789
│  ✓ Locked. Only you can talk to this bot now.
│

◇ Step 4 of 5: What should it have access to?
│
│  Tick what you use. Skip what you don't.
│  Everything here can be added later in the dashboard.
│  Each one you tick will ask for an API key.
│
│  ── Business ───────────────────────────────────────
│  ☐ GoHighLevel       → CRM, calendar, contacts, pipelines
│  ☐ Notion            → Pages, databases, meeting notes
│  ☐ Google Calendar   → Schedule, events, reminders
│  ☐ Google Workspace  → Docs, Sheets, Drive
│  ☐ Stripe            → Customers, invoices, payments
│  ☐ HubSpot           → CRM, marketing, sales
│  ☐ Salesforce        → Enterprise CRM
│  ☐ Airtable          → Spreadsheet-database hybrid
│  ☐ Trello            → Boards, cards, task management
│  ☐ Asana             → Project management
│
│  ── Developer ──────────────────────────────────────
│  ☐ GitHub            → Repos, issues, PRs, actions
│  ☐ GitLab            → Repos, CI/CD, issues
│  ☐ 1Password         → Secure secret retrieval (CLI)
│  ☐ Oracle Cloud      → Infrastructure, databases
│  ☐ AWS               → EC2, S3, Lambda, CloudWatch
│  ☐ Linear            → Issues, sprints, roadmaps
│  ☐ Jira              → Issue tracking, agile boards
│  ☐ Docker            → Container management
│  ☐ Vercel            → Deployments, domains
│  ☐ Supabase          → Database, auth, storage
│
│  ── Voice & Audio ──────────────────────────────────
│  ☐ ElevenLabs        → Text-to-speech, voice cloning
│  ☐ OpenAI Whisper    → Speech-to-text transcription
│  ☐ Deepgram          → Real-time speech recognition
│  ☐ Cartesia          → Low-latency voice synthesis
│  ☐ PlayHT            → AI voice generation
│  ☐ AssemblyAI        → Audio intelligence, transcription
│
│  ── Media & Content ────────────────────────────────
│  ☐ OpenAI Image Gen  → DALL-E image generation
│  ☐ Midjourney        → AI art (via API)
│  ☐ Cloudinary        → Image/video management
│  ☐ YouTube Data API  → Channel stats, video metadata
│  ☐ Spotify           → Playlists, playback control
│  ☐ Obsidian          → Local knowledge base
│
│  ── Smart Home ─────────────────────────────────────
│  ☐ Philips Hue       → Lighting control
│  ☐ Home Assistant    → Full smart home control
│  ☐ Sonos             → Multi-room audio
│
│  ── Monitoring & Data ──────────────────────────────
│  ☐ Grafana           → Dashboards, alerting
│  ☐ Datadog           → APM, logging, metrics
│  ☐ PostHog           → Product analytics
│  ☐ Plausible         → Privacy-friendly analytics
│
│  ── Community Skills ───────────────────────────────
│  ☐ ClawHub           → Import 5,700+ OpenClaw community skills
│     (docs-only recommended - see dashboard Config for code import)
│
│  ☐ Custom API        → Drop in your own skill file later
│
│  Don't see what you need? Tell your agent
│  "connect to [whatever]" and it'll read the API
│  docs and build the skill for you. Seriously.
│
│  [GoHighLevel selected]
│
│  GHL Private Integration Token:
│  (GHL → Settings → Company → API Keys)
│  › eyJ••••••
│  ◐ Connecting to GoHighLevel...
│  ◓ Checking permissions...
│  ✓ Connected! Found 847 contacts, 12 pipelines.
│
│  GHL Location ID:
│  (GHL → Settings → Company → General)
│  › abc123
│  ✓ Location verified.
│

◇ Step 5 of 5: Locking it down
│
│  ◐ Encrypting API keys...
│  ✓ All keys encrypted (AES-256)
│
│  ◐ Setting up shell allowlist...
│  ✓ Only safe commands permitted
│
│  ◐ Scanning for plaintext secrets...
│  ✓ Clean. Nothing exposed.
│
│  ◐ Generating Trust Kernel...
│  ✓ VALUES.md created (your agent's constitution)
│
│  ◐ Creating agent identity...
│  ✓ AGEX identity generated (for secure credential sharing)
│
│  ◐ Initialising audit log...
│  ✓ Every action will be logged from here on
│
│  ◐ Auto-detecting Cognee knowledge graph...
│  ✓ Found at localhost:8000! 79 entities, 198 relationships.
│    (If Cognee isn't running, SQLite memory kicks in - still works.)
│
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ All checks passed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚛ Alright Hayley, you're live.

  Start your agent:   npx qclaw start
  Dashboard:          http://localhost:3000
  Tunnel:             https://qclaw-abc123.loca.lt
  Telegram:           @calwdiaai1bot

  Your dashboard is mission control - chat with your
  agent, manage skills, view the knowledge graph,
  track costs, everything. Go have a look.

  If you're on Android/Termux, same commands work.
  Just open Termux and run it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Platform Support

```
Linux       Full support. Recommended for always-on servers.
macOS       Full support. Native or via Homebrew Node.js.
Windows     WSL2 recommended. Native works but trickier.
Android     Termux. pkg install nodejs, clone, run.
             Dashboard accessible at localhost:3000.
             Tunnel gives you a URL for any browser.
Raspberry Pi  Full support. Runs comfortably on Pi 4+.
VPS          Any £4/month VPS (Hetzner, DigitalOcean, etc.)
```

### Terminal Branding

Purple colour theme throughout using chalk/picocolors:
- Primary: `#9333ea` (purple-600) / ANSI 135
- Accent: `#c084fc` (purple-400) / ANSI 177
- Success: `#22c55e` (green) for checkmarks
- Warning: `#f59e0b` (amber) for ⚠️ notices
- Error: `#ef4444` (red)
- Spinners: `◐ ◓ ◑ ◒` cycle (purple) for all async operations
- Progress bars: `▓▓▓▓▓▓▓░░░░░` (purple fill, grey empty)
- ASCII logo uses block characters for the quantum-claw symbol

Loading states use @clack/prompts spinners. Every async operation
(key verification, service connection, encryption, identity generation)
gets a visible spinner so the user never sees a frozen terminal.
Each spinner resolves to a ✓ with a human-readable result.

The onboarding wizard uses @clack/prompts for the interactive elements
(select, multiselect, text input, confirm) with the purple theme applied
to all chrome elements (borders, bullets, progress indicators).
```

---

## Local Dashboard

### Port Configuration

Default: `http://localhost:3000`. No cloud. No accounts.

But port 3000 might be in use. QuantumClaw handles this:

```json
{
  "dashboard": {
    "enabled": true,
    "port": 3000,
    "host": "127.0.0.1",
    "auto_port": true,
    "tunnel": "none"
  }
}
```

- `port`: Your preferred port. Set during onboarding or change any time.
- `host`: `127.0.0.1` (localhost only, most secure) or `0.0.0.0`
  (accessible from other devices on your network, e.g. phone)
- `auto_port`: If your port is taken, automatically finds the next
  available one (3001, 3002...) and tells you which it landed on.
- `tunnel`: Optional public URL access (see below).

### Tunnel Access (Optional)

Sometimes you need to access the dashboard from outside your network -
phone on mobile data, a client demo, or remote monitoring. QuantumClaw
supports three tunnel options:

```bash
# Option 1: localtunnel (built-in, free, no signup, npm package)
npx qclaw start --tunnel lt
# → Dashboard: https://qclaw-abc123.loca.lt

# Option 2: Cloudflare Tunnel (free, more reliable, needs CF account)
npx qclaw start --tunnel cloudflare
# → Dashboard: https://qclaw.your-domain.com

# Option 3: ngrok (paid, most features)
npx qclaw start --tunnel ngrok
# → Dashboard: https://abc123.ngrok.io
```

Or set it in config for persistent tunnel:
```json
{
  "dashboard": {
    "tunnel": "lt",
    "tunnel_subdomain": "my-agent"
  }
}
```

Security: Tunnels are protected by the same user allowlist that
protects all channels. Unknown visitors see nothing. Dashboard
authentication required when tunnel is active.

When no tunnel is configured, the dashboard stays fully local.
No external traffic. No DNS. No exposure.

### Tabs

**Chat** - Talk to any agent directly from browser. See model used, tokens, cost per message.

**Agents** - View all agents, their status, model, channel. Add/remove agents visually.

**Memory** - Interactive knowledge graph visualiser. See entities, relationships, search.

**Skills** - List all skills per agent. Add new skills via drag-and-drop or paste.

**Config** - Visual config editor. Change models, keys, channels. No JSON. Instant apply, no restart.

**Costs** - Real-time spending, model splits, projections, savings calculation.

**Evolution** - Self-improvement toggle. Review proposed changes. Approve or reject.

**Logs** - Live log tail. Filter by agent. See what the agent is doing in real time.

**Audit** - Every action the agent took, why, which tool, who authorised.

Built with Express + htmx. No React. No build step. Fast.

---

## Multi-Agent Architecture

### Agent Registry

```
workspace/agents/
├── echo/                    # Main agent (chief of staff)
│   ├── soul/
│   │   ├── IDENTITY.md      # "I am Echo"
│   │   ├── PERSONALITY.md   # Direct, British, no fluff
│   │   ├── VALUES.md        # Never expose secrets, always verify
│   │   └── MODES.md         # Client / Internal / Sales / Creative / Crisis
│   ├── skills/
│   │   ├── ghl.md
│   │   └── github.md
│   └── agent.json           # Model: Opus, Channels: Telegram + Dashboard
│
├── scout/                   # Research agent
│   ├── soul/
│   │   └── IDENTITY.md      # "I am Scout, Echo's research arm"
│   ├── skills/
│   │   └── web-research.md
│   └── agent.json           # Model: Groq (speed), No direct channels
│
└── piper/                   # Content agent
    ├── soul/
    │   └── IDENTITY.md      # "I am Piper, Echo's writer"
    ├── skills/
    │   └── content.md
    └── agent.json           # Model: Sonnet, No direct channels
```

### agent.json

```json
{
  "name": "Echo",
  "role": "main",
  "model": "claude-opus-4-5",
  "fast_model": "groq-llama-70b",
  "channels": ["telegram", "dashboard"],
  "can_delegate_to": ["scout", "piper"],
  "auto_start": true,
  "heartbeat": {
    "morning_brief": "0 8 * * *",
    "pipeline_check": "0 9 * * 1"
  }
}
```

### Delegation

```
User → Echo: "Research CRM alternatives and write a comparison post"

Echo → Scout: "Find top 5 GHL alternatives. Pricing, features, pros/cons."
Scout → Echo: [structured data]

Echo → Piper: "Write comparison post using this data. Brand voice."
Piper → Echo: [draft post]

Echo → User: "Done. Scout researched, Piper wrote it. Want changes?"
```

All agents share the knowledge graph. Scout's discoveries are instantly
available to Echo and Piper.

### Sub-Agent Spawning

Echo can spawn temporary agents for one-off complex tasks:

```javascript
await router.spawn({
  parent: 'echo',
  task: 'Analyse Q4 pipeline, identify at-risk deals',
  model: 'claude-opus-4-5',
  context: await graph.query('opportunities where status=active'),
  timeout: '5m',
  report_to: 'echo'
});
```

---

## Composable Soul

Not one monolith SOUL.md. Five layers:

| File | Changes? | Purpose |
|------|----------|---------|
| IDENTITY.md | Never | Who am I? Name, role, core purpose |
| PERSONALITY.md | Evolves | Communication style, tone, habits |
| VALUES.md | Never | Boundaries, ethics, hard rules |
| MODES.md | Rarely | Context-switching (client/internal/sales/creative/crisis) |
| EVOLUTION.md | Auto | Log of every personality adaptation and why |

---

## Smart Model Routing

```
TIER 1 REFLEX:   "ok" "thanks" "got it"      → No LLM. £0. 0ms.
TIER 2 SIMPLE:   "next meeting?" "send reminder" → Groq. ~200ms.
TIER 3 STANDARD: "draft follow-up to Sarah"   → Sonnet. ~1s.
TIER 4 COMPLEX:  "analyse my pipeline"        → Opus. ~3s.
TIER 5 VOICE:    Real-time conversation        → Groq. ~200ms.
```

---

## Three-Layer Memory

```
Layer 1: KNOWLEDGE GRAPH (Cognee)
  Entities, relationships, graph traversal
  "Who in Sarah's network works in fintech?"

Layer 2: CONVERSATION MEMORY (SQLite)
  Recent context, session history, fast local recall

Layer 3: WORKSPACE FILES
  Soul, skills, notes. Always loaded.
```

### Cognee Connection Resilience

QuantumClaw handles Cognee tokens and connection issues automatically.
No manual scripts. No boot loops. No "Waiting for Cognee..." forever.

```
STARTUP:
  1. Check if Cognee is reachable
  2. If token expired → auto-refresh (no human intervention)
  3. If Cognee is down → fall back to SQLite memory
  4. If Cognee comes back later → reconnect automatically
  5. Agent never stops working because of a token issue

TOKEN LIFECYCLE:
  - Tokens stored encrypted alongside API keys
  - Background refresh 5 minutes before expiry
  - If refresh fails → retry 3 times with backoff
  - If all retries fail → graceful degradation to SQLite
  - Log every refresh/failure to audit trail
  - Dashboard shows token status: ✓ valid / ⚠️ expiring / ✗ expired

RECONNECTION:
  - Health check every 60 seconds when disconnected
  - When Cognee comes back → verify token → reconnect → sync
  - Agent notifies user: "Knowledge graph back online. I can see
    relationships again."
  - No restart needed. Ever.
```

This exists because of a real problem: Echo's startup script on Windows
would loop `[Echo] Waiting for Cognee...` indefinitely when WSL timed
out or Cognee's token expired. That's not acceptable. An agent should
never be stuck because of an infrastructure hiccup. QuantumClaw detects
the problem, falls back gracefully, and reconnects when it can.

---

## Triple-Mode Heartbeat

```
SCHEDULED:    Cron jobs. Morning briefs, weekly reviews.
EVENT-DRIVEN: React to GHL webhooks, missed calls, new leads.
GRAPH-DRIVEN: Traverse knowledge graph for patterns, anomalies, opportunities.
```

---

## Drop-In Skills

Create `workspace/agents/echo/skills/anything.md`:

```markdown
# My API Skill

## Auth
Base URL: https://api.example.com
Header: Authorization: Bearer {{secrets.my_api_key}}

## Endpoints
GET /items - List items
POST /items - Create item (body: { name, description })
```

`{{secrets.my_api_key}}` auto-resolves from encrypted store. Done.

---

## Security

### Config Validation Philosophy

OpenClaw and ZeroClaw use strict config schemas because they run community
plugins as executable code. A malicious plugin could inject bad config keys
to alter agent behaviour. Strict validation is their defence. Fair enough.

But QuantumClaw skills are markdown documentation files, not executable code.
A skill file describes an API. The runtime reads the markdown and makes its
own HTTP calls through a controlled tool layer. No skill file can execute
arbitrary code or inject config keys.

That said, open-source software gets downloaded by everyone. We still
protect users. The approach:

```
VALIDATE what matters:
  ✓ API keys format-checked (right length, right prefix)
  ✓ URLs verified (valid format, reachable on first test)
  ✓ Model names checked against known providers
  ✓ Port numbers validated (valid range, not already in use)
  ✓ File paths sanitised (no path traversal attacks)

WARN on what's unknown:
  ⚠ "Unrecognised key 'waops' in config. Stored but not used by core."
  ⚠ Logged to dashboard. User can review.
  ⚠ Never crashes. Never blocks startup.

BLOCK what's dangerous:
  ✗ Secrets in plaintext (must use {{secrets.x}} syntax)
  ✗ Shell commands not on allowlist
  ✗ URLs pointing to known malicious domains
  ✗ Config values that look like injection attempts
```

`npx qclaw diagnose` runs a full health check on first boot and any
time the user asks: config validation, service connectivity, key verification,
security posture review.

### Encrypted Secrets
- AES-256 encrypted in `data/secrets.enc`
- Config contains `{{secrets.x}}` references only
- Machine-specific encryption key
- No plaintext secrets anywhere in repo or workspace

### Trust Kernel (VALUES.md)
- Immutable file only the human user can edit
- Agent cannot modify its own values
- Evolution Loop can update PERSONALITY.md but never VALUES.md
- Defines: what the agent must never do, what always requires approval,
  who the agent serves, what data never leaves the system

### Guardrail Layers

**Layer 1 - Input Protection:**
- Prompt injection detection on all inbound messages
- User allowlisting per channel (unknown users rejected silently)
- PII scanning on external source messages
- Rate limiting per channel

**Layer 2 - Action Protection:**
- Shell command allowlisting (only pre-approved commands execute)
- Destructive operation confirmation (delete, send, pay always need approval)
- API call validation (only endpoints in skill files are reachable)
- Budget limits per model, per day, per agent
- Tool timeout limits

**Layer 3 - Output Protection:**
- Secret redaction (keys, tokens, passwords never in responses)
- Audit logging of every action (immutable append-only log)
- Output validation against VALUES.md before delivery
- Sensitive data classification on outbound messages

### Audit Log
- Every action logged to `data/audit.jsonl`
- What, why, which tool, who authorised, timestamp
- Immutable append-only (agent cannot delete its own audit trail)
- Queryable via dashboard Audit tab or CLI

---

## AGEX Protocol Integration

QuantumClaw is the first open-source agent runtime to implement the AGEX
(Agent Gateway Exchange) protocol for autonomous credential management.

AGEX is an open protocol specification (developed separately at agex.api)
that solves the fundamental problem every multi-agent system faces: how do
agents securely share, delegate, and rotate credentials without human
intervention?

### Why AGEX Matters

Without AGEX, multi-agent credential sharing looks like this:
```
QClaw needs Scout to check GHL contacts.
Option A: Give Scout the full GHL API key. Over-permissioned. Dangerous.
Option B: Don't give Scout access. Useless. Human has to intervene.
```

Every other agent runtime is stuck choosing between A and B.

With AGEX:
```
QClaw delegates to Scout:
1. Issues scoped sub-credential: "Scout can READ GHL contacts for 5 minutes"
2. Scout receives a credential envelope (never sees the raw API key)
3. Scout's calls go through QuantumClaw's credential proxy
4. Proxy validates: within scope? within time? within rate limit?
5. If yes → proxy injects real key, forwards call
6. If no → blocked, logged, QClaw notified
7. On completion or expiry → envelope auto-revoked
```

### AGEX Primitives in QuantumClaw

**Agent Identity Documents (AIDs)**
Every named agent gets a cryptographic identity, not just a folder name.
Verifiable by any service or agent in the chain.

```javascript
// Generated during agent creation
{
  aid: "qc_echo_a1b2c3d4",
  name: "Echo",
  issuer: "quantumclaw://local",
  type: "primary",
  capabilities: ["ghl:full", "github:read", "stripe:read"],
  public_key: "ed25519:...",
  trust_tier: 3,            // Certified (owner-operated)
  created: "2026-02-18",
  expires: "2027-02-18"
}
```

**Intent Manifests**
Before an agent gets credentials, it declares what it intends to do and why.
Auditable. If actual behaviour doesn't match declared intent, the violation
is caught and the agent's trust tier can be demoted.

```javascript
// Scout requesting GHL access
{
  requesting_aid: "qc_scout_e5f6g7h8",
  target_service: "ghl",
  scopes_requested: ["contacts:read"],
  intent: "Research fintech contacts for lead qualification task",
  estimated_duration: "5m",
  max_api_calls: 50,
  data_handling: "read_only, no_export",
  delegated_by: "qc_echo_a1b2c3d4"
}
```

**Delegation Chains**
When QClaw delegates to Scout, scope can only decrease, never increase.
Each link in the chain is time-bounded and revocable.

```
QClaw (full GHL access)
  └→ Scout (contacts:read only, 5 min, 50 calls max)
       └→ Sub-scout (contacts:read, single contact ID, 1 min)
```

If Scout tries to write to GHL, the credential proxy blocks it.
If Scout tries to delegate more scope than it has, the chain rejects it.

**Credential Lifecycle Contracts (CLCs)**
Every credential relationship has a living contract:

```javascript
{
  agent: "qc_scout_e5f6g7h8",
  service: "ghl",
  granted_scopes: ["contacts:read"],
  rotation_schedule: "on_task_completion",
  escalation: "requires_echo_approval",
  termination: "auto_on_expiry_or_task_complete",
  audit: "all_calls_logged"
}
```

**Emergency Revocation System (ERS)**
One command kills an agent's credentials across ALL services and ALL
sub-agents instantly:

```bash
npx qclaw revoke --agent scout --cascade
# Revokes Scout's credentials
# + anything Scout delegated to sub-agents
# + logs the revocation reason
# + notifies QClaw
```

### AGEX for External Agents

When QClaw connects to an external platform (external platforms like OpenClaw, etc.),
AGEX handles the credential exchange:

```
QClaw → External Platform API:
1. Presents its AID
2. Submits Intent Manifest: "Update Atlas's prompt for Q2 targeting"
3. Platform validates AID, grants CLC:
   - Scope: agents:atlas:prompt:write
   - Duration: 10 minutes
   - Rate: 5 calls max
4. QClaw operates within CLC terms
5. Full audit trail on both sides
6. CLC auto-expires after 10 minutes
```

No hardcoded API keys shared between platforms.
No over-permissioned service accounts.
Every cross-platform action scoped, time-bounded, and auditable.

### Phase 1 Implementation (Local AGEX)

For Phase 1, QuantumClaw implements AGEX patterns locally without needing
the full AGEX Hub infrastructure:

- AIDs generated and verified locally
- Delegation chains enforced by the local credential proxy
- Intent manifests logged to the local audit trail
- CLCs managed by the runtime's secrets manager
- ERS operates on local agent registry

When the AGEX Hub reference implementation ships (Q2-Q3 2026),
QuantumClaw will be ready to connect to federated AGEX infrastructure
for cross-platform credential exchange with any AGEX-compatible service.

### Two Security Pillars

```
PILLAR 1: Trust Kernel (VALUES.md)
  → Protects WHAT the agent does
  → Immutable behaviour boundaries
  → Agent cannot modify its own values

PILLAR 2: AGEX Protocol
  → Protects HOW credentials flow
  → Scoped, time-bounded, auditable
  → Delegation chains with decreasing scope
  → Emergency revocation cascade
```

Together: the agent can only do what its values allow, using only the
credentials it's been delegated, for only the duration it's been granted,
with every action logged.

---

## ClawHub Skill Import

ClawHub (OpenClaw's skill marketplace) has 5,700+ community-built skills
with working integration code in JavaScript and Python. That code is
valuable - someone already built, tested, and debugged it.

QuantumClaw imports the FULL skill (code + docs), but sandboxes execution.

```bash
npx qclaw skill import --from-clawhub ghl-calendar
```

### What Happens

1. Pulls the ClawHub skill package (code, manifest, docs)
2. Extracts API documentation into markdown
3. Extracts implementation code into sandboxed code blocks
4. Generates a QuantumClaw skill file with both
5. Sets `reviewed: false` - agent can read the docs but CANNOT
   execute the code until the user approves it
6. User reviews code in the dashboard Skills tab
7. User approves → code executes inside QuantumClaw's sandbox

### Skill File Format (with code)

```markdown
# GoHighLevel Calendar

## Source
Imported from ClawHub: ghl-calendar v2.1.3
Author: community/ghl-tools
Reviewed: false ← BLOCKS EXECUTION until user approves

## Auth
Base URL: https://services.leadconnectorhq.com
Header: Authorization: Bearer {{secrets.ghl_api_key}}

## Endpoints
GET /calendars/events - List events
POST /calendars/events - Create event

## Implementation
\`\`\`javascript
async function listEvents(dateRange) {
  const response = await http.get('/calendars/events', {
    params: { startDate: dateRange.start, endDate: dateRange.end }
  });
  return response.data.events;
}

async function createEvent(event) {
  return await http.post('/calendars/events', {
    title: event.title,
    startTime: event.start,
    calendarId: event.calendarId
  });
}
\`\`\`

## Permissions
- http: [services.leadconnectorhq.com]
- shell: none
- file: none
```

### Code Isolation (Not In-Process Sandbox)

JavaScript sandboxes (Node.js `vm` module) have a long history of being
broken out of. We don't pretend ours would be different.

Instead: imported code runs in a **completely separate OS process**
with restricted permissions. Not a sandbox inside QuantumClaw's process.
A separate child process that QuantumClaw spawns, communicates with via
structured messages, and kills when done.

```
QuantumClaw main process (your agent, secrets, graph, dashboard)
    │
    │ spawns
    ▼
Isolated child process (the imported code)
    - Separate PID, separate memory space
    - No access to main process memory
    - No access to secrets store
    - No access to knowledge graph
    - No access to filesystem (except declared temp dir)
    - Network restricted to declared domains only (OS-level firewall rules)
    - Memory limited (e.g. 128MB max)
    - Time limited (killed after timeout)
    - AGEX credential envelope (never sees raw API key)
    │
    │ returns structured result via IPC
    ▼
QuantumClaw main process validates result, logs to audit
```

**Assume breach.** Even if the isolated process is fully compromised:
- It can't reach the main process or its memory
- It can't read the secrets store (different process, different permissions)
- It can't touch the knowledge graph
- The AGEX credential envelope it was given expires in minutes
  and only works for specific scoped API calls
- The credential proxy sits in the main process, not the child

The `## Permissions` block in the skill file declares what the child
process is allowed to do. Enforced at OS level where possible,
application level as backup:

- **http**: Only declared domains reachable. Everything else firewalled.
- **shell**: Must declare needed commands. Default: none.
- **file**: Must declare file paths. Default: temp dir only.
- **secrets**: AGEX credential envelope only. Never raw keys.

### Review Workflow (Dashboard)

The dashboard Skills tab is designed so anyone can understand it:

```
┌─────────────────────────────────────────────────────────────┐
│ Skills                                                [+ Add]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✅ GoHighLevel CRM         Approved    Used 142 times      │
│  ✅ GitHub Issues            Approved    Used 23 times       │
│  🟠 Stripe Payments         NEEDS YOUR REVIEW              │
│  ✅ Web Research             Built-in    Always available    │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Click "Stripe Payments" →

┌─────────────────────────────────────────────────────────────┐
│ 🟠 Stripe Payments - Imported from ClawHub                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 📋 What this skill does:                                    │
│    Connects to Stripe to manage customers and invoices.     │
│                                                             │
│ 🌐 What it can access:                                      │
│    • api.stripe.com (and nothing else)                      │
│    • No access to your files                                │
│    • No access to your terminal                             │
│                                                             │
│ 👤 Who wrote it:                                             │
│    community/stripe-tools v3.1.0 on ClawHub                 │
│                                                             │
│ 💻 The code (click to expand):                               │
│    ┌──────────────────────────────────────────────────────┐ │
│    │ async function listCustomers() {                     │ │
│    │   const response = await http.get('/v1/customers');  │ │
│    │   return response.data;                              │ │
│    │ }                                                    │ │
│    │ ...                                                  │ │
│    └──────────────────────────────────────────────────────┘ │
│                                                             │
│ ⚠️ This code was written by someone in the community.       │
│    It will run in a separate process that CANNOT access     │
│    your agent's memory, secrets, or files.                  │
│    It can only talk to api.stripe.com.                      │
│                                                             │
│  [ ✅ Approve ]  [ 📖 Docs Only ]  [ ✏️ Edit ]  [ ❌ Delete ]│
│                                                             │
│  💡 "Docs Only" means your agent reads the API instructions │
│     and makes the calls itself. No imported code runs.      │
│     This is the safest option.                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Dashboard: Idiot-Proof by Design

The dashboard is not just for viewing. Users can do everything from here
that they can do in the terminal. Every action has a plain-English
explanation.

**Chat tab:**
- Talk to your agent like texting a colleague
- Each message shows: which AI model was used, how many tokens,
  how much it cost
- Type naturally. No commands needed.

**Skills tab:**
- Click [+ Add] to add a skill
- Paste a URL → agent reads the API docs and creates the skill for you
- Or paste markdown directly
- Or drag-and-drop a .md file
- Every skill shows a plain-English summary of what it can access
- Imported skills require approval before they can do anything

**Memory tab:**
- Visual graph showing all the people, companies, and projects
  your agent knows about
- Click any node to see its connections
- Search bar: type a name and see everything connected to it
- "Your agent knows about 79 people, 12 companies, and 34 projects"

**Config tab:**
- Dropdowns, toggles, and sliders. No JSON.
- Change your AI model, add a channel, adjust settings
- Changes apply instantly. No restart needed.
- Every setting has a 💡 tooltip explaining what it does

**Costs tab:**
- "Today you've spent £0.34 on 23 messages"
- "Groq handled 65% of messages, saving you about £12"
- "At this rate, this month will cost about £8.50"
- Simple bar chart showing where money goes

**Evolution tab:**
- Big toggle: ON / OFF
- "Your agent reviewed its performance and wants to make these changes:"
- Each proposed change explained in plain English
- [Approve] [Reject] buttons per change
- History of all past changes with dates

### Skills Without Code

Skills don't NEED code. A pure markdown skill file (just Auth + Endpoints,
no Implementation block) works fine - the agent reads the API docs and
makes its own HTTP calls through the built-in tool layer. This is the
simplest and most secure approach. The recommended default.

Code blocks are optional. They're useful when:
- The integration is complex (OAuth flows, pagination, data transforms)
- Someone already solved it well (ClawHub imports)
- The agent auto-generated working code (skill auto-gen feature)

### Onboarding Warning

The ClawHub warning is now part of the onboarding wizard (Step 7).
See the onboarding wizard section above for the full flow.

The default recommendation is "Docs only" - safest option.
This setting can be changed later in the dashboard Config tab.

---

## Voice Pipeline (Future - Separate Project)

Designed to be compatible with QuantumClaw. Separate repo.

```
Simple: Mic → Deepgram (112ms) → Groq (200ms) → Cartesia (40ms) → Speaker
        Total: ~400ms

Complex: Mic → Deepgram → detect complexity →
         Cartesia: "Let me think..." (immediate) →
         Claude Opus (2-3s) →
         Cartesia: full answer
```

---

## CLI

```bash
# Lifecycle
npx qclaw onboard           # First-time setup
npx qclaw start             # Start everything
npx qclaw start --tunnel lt # Start with public URL (localtunnel)
npx qclaw start --tunnel cloudflare  # Cloudflare Tunnel
npx qclaw start --tunnel ngrok       # ngrok
npx qclaw stop              # Stop
npx qclaw status            # Health check
npx qclaw diagnose          # Full system diagnostics + security review

# Agents
npx qclaw agent add         # Add named agent interactively
npx qclaw agent list        # List agents
npx qclaw agent remove scout

# Chat
npx qclaw chat "Hello"      # Terminal chat
npx qclaw chat --agent scout "Research this"

# Skills
npx qclaw skill add         # Add skill interactively
npx qclaw skill list        # List skills
npx qclaw skill import --from-clawhub ghl-calendar  # Convert ClawHub skill

# Memory
npx qclaw memory status     # Graph stats
npx qclaw memory search "Sarah"
npx qclaw memory refresh    # Cognee token

# Evolution Loop
npx qclaw evolution status  # On/off? Last run? Next run?
npx qclaw evolution enable  # Turn on
npx qclaw evolution disable # Turn off
npx qclaw evolution history # View adaptation log

# External Agents
npx qclaw external add      # Connect external agent platform
npx qclaw external list     # List connected platforms
npx qclaw external test atlas  # Test connection

# AGEX Credentials
npx qclaw revoke --agent scout --cascade  # Emergency revocation

# Monitoring
npx qclaw costs             # Spending summary + projections
npx qclaw logs              # Tail logs
npx qclaw logs --agent echo # Filter by agent
npx qclaw audit             # Action history
npx qclaw config show       # Print config (secrets masked)
```

---

## Comparison

**Honest positioning:** OpenClaw has the largest community (145K+ stars,
50+ integrations). ZeroClaw has the smallest footprint. QuantumClaw has
the deepest memory and strongest security. Pick based on what matters to you.

| Feature | OpenClaw | ZeroClaw | QuantumClaw |
|---------|----------|----------|-------------|
| Language | Node.js | Rust | Node.js |
| Community | 145K+ stars, huge | Early | New |
| Integrations | 50+ built-in | 8+ channels, 22+ providers | Skill templates + ClawHub import |
| RAM | 300-500MB | 5MB | 30-50MB |
| Boot | 5-15s | <10ms | <1s |
| Memory | Flat markdown + hybrid search | SQLite + FTS5 + vector | **Knowledge graph (Cognee) + SQLite** |
| Relationships | Community plugin (Graphiti, requires Neo4j+Qdrant) | Text search only | **Native graph traversal (built-in)** |
| Model routing | Single model | Single model | **5-tier smart routing (60-80% savings)** |
| Security | Plaintext keys. Cisco: 26% of skills had vulns. | Rust memory safety | **AES-256 + Trust Kernel + 3 guardrail layers** |
| Credential delegation | Full keys shared between agents | N/A (single agent) | **AGEX: scoped, time-bounded, auditable** |
| Self-improvement | Can write skills (no performance analysis) | None | **Evolution Loop (systematic, auditable)** |
| Heartbeat | Timer-based | Cron | **Scheduled + event + graph-driven** |
| Skills | Executable code from community | Config-based | **Markdown docs + optional isolated code** |
| Skill ecosystem | ClawHub (5,700+ skills) | Early | **ClawHub importer + built-in templates** |
| Dashboard | Basic control UI | None | **Full: chat, graph, skills, config, costs, audit** |
| Onboarding | 12 screens, developer-focused | CLI | **5 steps, plain English, under 3 min** |
| Remote access | ngrok | None | **Configurable port + tunnel (lt/cloudflare/ngrok)** |
| Cost tracking | None | None | **Real-time per-message with projections** |
| Degradation | Service failures can crash gateway | Stable | **5-level graceful fallback** |
| Voice/TTS tools | Via skills (Whisper, etc.) | None | **ElevenLabs, Whisper, Deepgram, Cartesia** |
| Soul/personality | Customisable (monolith file) | Config-compatible | **Composable 5-layer (identity/personality/values/modes/evolution)** |

---

## The Killer Feature

Every runtime saves text and searches text.
QuantumClaw traverses a knowledge graph.

```
Message: "Got a lead from the Manchester fintech meetup"

OpenClaw: Saves note. Done.

QuantumClaw:
1. Creates entity: Lead (source: Manchester fintech meetup)
2. Graph: "Who else is in fintech?" → Sarah (£2,400/month, referred 2 others)
3. Graph: "Manchester connections?" → James (contacted 45 days ago, went cold)
4. Responds: "Lead logged. Same vertical as Sarah, your top fintech client.
   Her case study would land well. Also, James in Manchester went quiet
   45 days ago - worth re-engaging while you're thinking about that area?"
```

That's not a chatbot. That's a chief of staff.

---

## Self-Improving Agent (Evolution Loop)

User-controlled. Toggle on/off via dashboard or CLI.

```javascript
kai: {
  enabled: false,          // User activates when ready
  schedule: "0 0 * * 0",  // Default: Sunday midnight
  auto_apply: false,       // If false, suggests changes for approval
  
  // What the Evolution Loop reviews:
  review: {
    conversation_outcomes: true,   // What got positive reactions?
    task_failures: true,           // What broke? What needed retry?
    graph_patterns: true,          // What patterns emerged this week?
    cost_efficiency: true,         // Could cheaper models have handled tasks?
    tone_feedback: true            // Did the user seem frustrated?
  }
}
```

Output:
```markdown
# EVOLUTION.md - Auto-maintained

## Week of 2026-02-17

### Observations
- Fintech leads responded 3x better to ROI data vs feature lists
- Morning messages were shorter, agent matched but user wanted more detail
- 4 tasks routed to Opus could have used Sonnet (saving £0.12)

### Applied Changes
- Updated PERSONALITY.md: "Lead with ROI and specific numbers for fintech vertical"
- Adjusted tier router: lowered complexity threshold for financial analysis
- Morning mode now provides full detail regardless of message length

### Pending Review (auto_apply: false)
- Suggested: Add "invoice reminder" to Friday heartbeat
  → User: [Approve] [Reject] [Modify]
```

---

## Multi-Agent Architecture (Three Modes)

### Mode 1: Internal Named Agents

Every agent MUST have a user-defined name. No anonymous agents.
Always identifiable in logs, audit, and conversation.

```bash
npx qclaw agent add
# Name: Scout     ← user chooses, mandatory
# Role: Research
# Model: Groq
# Reports to: Echo
```

```
workspace/agents/
├── echo/       # "I am Echo, chief of staff"
├── scout/      # "I am Scout, Echo's research arm"
└── piper/      # "I am Piper, Echo's writer"
```

### Mode 2: External Agents via API

Connect to ANY agent platform. Edit its prompts. Read its data.
Trigger its actions. QuantumClaw becomes the orchestrator.

```json
{
  "external_agents": {
    "atlas": {
      "name": "Atlas",            // User-defined name, mandatory
      "platform": "external",
      "url": "https://example.com/api",
      "api_key": "{{secrets.atlas_key}}",
      "capabilities": {
        "edit_prompts": true,
        "read_data": true,
        "trigger_actions": true,
        "read_conversations": true
      }
    },
    "client_openclaw": {
      "name": "ClientBot",
      "platform": "openclaw",
      "url": "http://client-server:18789",
      "api_key": "{{secrets.client_openclaw_key}}",
      "capabilities": {
        "send_message": true,
        "read_memory": true
      }
    }
  }
}
```

Usage:
```
User → Echo: "Update Atlas's prompt to focus on Q2 targets"
Echo → External API: PATCH /agents/atlas/prompt { ... }
Echo → User: "Done. Atlas is now focused on Q2 targets."

User → Echo: "What did ClientBot handle today?"
Echo → OpenClaw API: GET /sessions?today=true
Echo → User: "ClientBot handled 12 conversations. 3 leads, 2 support tickets..."
```

### Mode 3: Self-Built Sub-Agents

Echo can create its own sub-agents when it needs them:

```
User → Echo: "I need an agent that monitors my competitors' pricing pages daily"

Echo:
1. Creates workspace/agents/sentinel/
2. Writes IDENTITY.md: "I am Sentinel, a pricing monitor"
3. Writes agent.json: { model: "groq", heartbeat: "0 8 * * *" }
4. Creates skills/competitor-watch.md with the URLs and what to track
5. Registers Sentinel in the agent registry
6. → User: "Created Sentinel. It'll check competitor pricing every morning
     at 8am and flag any changes. Want to review its config?"
```

The user always names the agent. Echo suggests a name, user approves.

---

## Graceful Degradation

The agent never stops working. It gets progressively simpler.

```
LEVEL 1 (Full power):
  Cognee ✓ + Claude ✓ + Groq ✓ + Internet ✓
  → Full graph traversal, smart routing, all tools

LEVEL 2 (Cognee down / token expired):
  SQLite ✓ + Claude ✓ + Groq ✓ + Internet ✓
  → Auto-refreshes token if expired. If Cognee itself is down,
    falls back to conversation memory. Reconnects automatically
    when Cognee comes back (health check every 60s). No restart.
  → Agent: "My knowledge graph is offline. I can still help
     but won't spot relationship patterns until it's back."

LEVEL 3 (Claude down):
  SQLite ✓ + Groq ✓ + Internet ✓
  → Fast model handles everything, less reasoning depth
  → Agent: "Running on my fast brain. Complex analysis
     might be less thorough until Claude is back."

LEVEL 4 (Internet down):
  SQLite ✓ + Ollama local ✓
  → Local model, local memory, no API calls
  → Agent: "I'm offline. I can chat and check local memory
     but can't reach external services."

LEVEL 5 (Everything down except SQLite):
  SQLite ✓
  → Read-only mode. Can retrieve past conversations.
  → "I'm in recovery mode. Services are restarting."
```

---

## Revenue Intelligence

Knowledge graph entities carry business metadata:

```javascript
// Entity: Sarah
{
  type: "client",
  name: "Sarah Chen",
  vertical: "fintech",
  monthly_revenue: 2400,
  lifetime_value: 28800,
  referrals_sent: 2,
  referral_revenue: 3600,
  satisfaction_score: 0.92,
  last_contact: "2026-02-15",
  contract_renewal: "2026-04-01"
}

// Relationship: Sarah → referred → James
{
  type: "referral",
  strength: 0.8,
  revenue_attributed: 1800,
  date: "2026-01-20"
}
```

Agent can answer:
- "What's my most profitable referral chain?"
- "Which clients are at risk of churning?" (decay + satisfaction)
- "What's my revenue per vertical?"
- "Who should I upsell this month?" (usage vs tier analysis)

All from graph traversal. No reports. No spreadsheets.

---

## Mood/Tone Adaptation

```javascript
// Sentiment detection on incoming messages
analyse_tone(message) → {
  length: "short",        // terse, normal, detailed
  sentiment: "neutral",   // positive, neutral, frustrated, stressed
  urgency: "low",         // low, medium, high, critical
  time_context: "morning" // morning, afternoon, evening, weekend
}

// Agent adapts:
// Short + frustrated → Direct, solution-focused, no fluff
// Detailed + positive → Match depth, explore ideas
// Morning + stressed → Lead with priorities, skip pleasantries
// Friday afternoon → Lighter touch, wrap-up summaries
```

---

## Cost Dashboard

Real-time in the dashboard Costs tab:

```
Today:  £0.34 │ 23 messages │ Avg £0.015/msg
Week:   £2.10 │ 142 messages
Month:  £6.80 │ est. £8.50 by month end

Model Split:
  Reflex (no LLM): 8 msgs  │ £0.00  │ 35%
  Groq:            10 msgs  │ £0.02  │ 43%
  Sonnet:          4 msgs   │ £0.18  │ 17%
  Opus:            1 msg    │ £0.14  │ 5%

Savings: £14.20 saved vs all-Opus routing

Per Agent:
  Echo:    £0.30 (22 msgs)
  Scout:   £0.04 (1 msg, delegated research)
```

---

## Skill Auto-Generation

```
User → Echo: "Connect to the Stripe API"

Echo:
1. Browser tool → navigates to stripe.com/docs/api
2. Reads authentication section
3. Reads key endpoints (customers, invoices, payments)
4. Generates workspace/agents/echo/skills/stripe.md
5. Asks user for API key → encrypts to secrets store
6. Tests: GET /v1/customers (limit 1)
7. → User: "Stripe skill created and tested. I can now
     manage customers, invoices, and payments."

// Auto-generated skill is reviewable in Skills tab
// User can edit, approve, or delete
```

---

## Built-In Skill Templates

QuantumClaw ships with ready-to-use skill templates. Users paste their
API key during onboarding or in the dashboard and they're connected.

### Communication
- **Telegram** - Send/receive messages, bot management
- **WhatsApp** (via WaOps) - Client messaging, auto-replies, lead capture
- **Email** (SMTP/IMAP) - Send follow-ups, read inbox, draft responses
- **Discord** - Channel messaging, notifications

### Business Tools
- **GoHighLevel** - Contacts, calendars, pipelines, invoices, automations
- **Notion** - Read/write pages, databases, meeting notes
- **Google Calendar** - Schedule, events, reminders
- **Stripe** - Customers, invoices, payment tracking

### Developer Tools
- **GitHub** - Issues, PRs, repo management
- **1Password** (CLI) - Secure secret retrieval for other integrations
- **Oracle Cloud** - Infrastructure, database queries
- **Linear** - Issue tracking, sprint management

### Voice & Audio
- **ElevenLabs** - Text-to-speech, voice cloning, audio generation
- **OpenAI Whisper** - Speech-to-text transcription
- **Deepgram** - Real-time speech recognition
- **Cartesia** - Low-latency voice synthesis

Voice tools are added during onboarding or in the dashboard Config tab.
Any TTS/STT provider with an API can be connected as a skill.

### Built-In Tools (no API key needed)
- **Web Search** - Research anything
- **Browser** - Navigate sites, extract data, fill forms
- **Shell** - Run allowlisted commands
- **File** - Read/write workspace files
- **Cron** - Scheduled tasks

### Custom Skills
- Drop in a markdown file for ANY REST API
- Or paste a URL and let the agent read the docs and build its own skill
- Or import from ClawHub (5,700+ community skills)

---

## What Ships

QuantumClaw is a complete, usable framework:

- Install, onboard, and have an agent running in under 5 minutes
- Knowledge graph memory with relationship understanding
- 5-tier smart model routing (60-80% cost savings)
- Composable soul (5 layers) with immutable Trust Kernel
- AGEX credential delegation between agents
- Dashboard: chat, skills, memory graph, config editor, costs, audit
- Telegram, WhatsApp, Discord, email channels
- Built-in skill templates for popular services
- ClawHub import with isolated process execution and review gate
- Evolution Loop (self-improvement, toggle on/off)
- Graceful degradation (5 levels, never fully stops)
- Mood/tone adaptation, time-aware context
- Revenue intelligence via graph traversal
- Relationship decay detection
- Full audit logging, encrypted secrets, three-layer guardrails
- Configurable port, optional tunnel access (localtunnel/cloudflare/ngrok)
- Purple-themed idiot-proof onboarding wizard
- CLI and dashboard for all operations

**Future projects** (separate repos, designed to be compatible):
- Voice pipeline (Deepgram + Cartesia)
- Multi-agent swarm with federated AGEX Hub
- Multi-tenant product layer
