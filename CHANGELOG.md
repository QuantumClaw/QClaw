# Changelog

All notable changes to QuantumClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.5.2] - 2026-02-26

### Port Fix + Critical Gap Closure (OpenClaw Parity)

### Fixed
- **EADDRINUSE crash** — dashboard now auto-tries ports 3000-3020. If port 3000 is in use by another process (n8n, another project, etc), it automatically finds the next free port. No more crashes. Server/WS instances are properly recreated for each port attempt.

### Added — New Tools (13 built-in, was 10)
- **`web_search`** — Brave Search API integration. Returns top results with titles, URLs, descriptions. Requires `brave_api_key` secret. Closes parity gap with OpenClaw's web_search tool.
- **`manage_process`** — background process management. Start commands in background, then poll/log/kill them. Actions: start, list, poll, log, kill. Stores up to 512KB stdout per process. Closes parity gap with OpenClaw's process tool.
- **`send_message`** — cross-channel message sending. Send to specific channel/user or broadcast to all. Foundation for OpenClaw's message tool parity.

### Added — Slash Commands (Telegram)
- `/help` — list available commands
- `/status` — agent online status
- `/model` — current model routing info
- `/reset` — reset conversation context
- `/memory` — memory layer stats
- `/cost` — link to usage dashboard
- `/whoami` — pairing info + user ID

Previously all `/` commands were silently ignored. Now they're handled with useful responses.

### Added — Group Chat Support (Telegram)
- **Mention detection** — in groups/supergroups, bot only responds when:
  - @mentioned by username
  - Replied to directly
  - Message matches configurable `mentionPatterns` array
- **Silent ignore** — non-mentioned group messages are ignored (no error, no response)
- **Config:** `channels.telegram.mentionPatterns: ["@myclaw", "hey claw"]`

### Added — Credentials
- `brave_api_key` added to credential store + dashboard dropdown

### Changed
- Dashboard `_listen()` method completely rewritten with auto-port fallback
- Tool count: 10 → 13 built-in tools
- Channel manager: slash command router, group mention detection
- TelegramChannel gained `_handleSlashCommand()` method

## [1.5.1] - 2026-02-24

### Email + Slack Channels, Agent Routing, README Rewrite

### Added
- **Email channel** (`EmailChannel`, 180 lines) — IMAP polling + SMTP auto-reply:
  - Polls INBOX for unseen messages at configurable interval (default: 60s)
  - Processes through agent, sends reply via SMTP
  - Marks messages as seen after processing
  - `allowedSenders` filter — only process emails from approved addresses
  - Dashboard broadcast for email messages (📧 prefix)
  - Requires: `npm i nodemailer imapflow`
  - Config: `channels.email.imap`, `channels.email.smtp`, `channels.email.pollIntervalMs`
  - Secrets: `email_address`, `email_password` (app password for Gmail)

- **Slack channel** (`SlackChannel`, 120 lines) — Bolt SDK with Socket Mode:
  - Handles @mentions in channels and DMs
  - `allowedChannels` filter (empty = respond everywhere)
  - 4000-char message splitting for long responses
  - Filters out bot messages and subtypes (edits, joins)
  - Dashboard broadcast for Slack messages
  - Requires: `npm i @slack/bolt`
  - Secrets: `slack_bot_token`, `slack_app_token`

- **Agent routing** — assign different agents to different channels:
  - Set `"agent": "support"` in any channel config
  - `ChannelManager.getRouting()` returns channel→agent map
  - `ChannelManager._getAgent(channelConfig)` resolves agent with primary fallback

- **New credentials** — `slack_app_token`, `email_address`, `email_password` added to credential store + dashboard dropdown

- **README rewrite** — comprehensive showcase of all features for TubeFest presentation. Architecture diagram, feature matrix, CLI reference, quick start, Docker deploy.

### Changed
- Channel count: 3 → 5 (Telegram, Discord, WhatsApp, Email, Slack)
- Channels manager: 923 → 1225 lines
- Dashboard secrets dropdown expanded with Slack + Email options
- Credential definitions expanded

## [1.5.0] - 2026-02-24

### Dashboard v2 — Full-Featured UI

### Added — New Dashboard Pages
- **Tools page** (`⚡ Tools`) — lists all 10+ built-in tools, MCP tools, and API tools with descriptions and source badges. Shows voice STT/TTS provider status (Deepgram, Whisper, ElevenLabs, etc).
- **Scheduled Tasks page** (`⏰ Tasks`) — full CRUD for heartbeat scheduled tasks:
  - View all tasks with name, prompt, schedule, notify status
  - Add tasks via modal (name, prompt, schedule dropdown, notify toggle)
  - Delete tasks with confirmation
  - Schedules: every-minute, every-5-minutes, every-hour, every-day
  - Info banner explains restart requirement + channel push behaviour

### Added — Memory Enhancements
- **Remember/Forget** — "Teach something" input on Memory page. Type a fact → stored as semantic knowledge immediately. No LLM call needed.
- **Knowledge Graph Visualization** — 🕸️ Graph button renders all knowledge nodes on a Canvas element:
  - Nodes coloured by type: purple (semantic), blue (episodic), green (procedural)
  - Edges from co-reference analysis between entries
  - Circular force layout with labels
  - Close button to dismiss
- **Memory Export** — 📥 Export button downloads all semantic, episodic, and procedural knowledge as JSON with stats and timestamp.
- **3 new API endpoints:**
  - `POST /api/memory/remember { fact }` — add semantic knowledge from dashboard
  - `GET /api/memory/export` — export all knowledge as JSON
  - `GET /api/memory/graph` — nodes + edges for visualization

### Added — Hatching Animation
- **Full-screen hatching ceremony** — when agent names itself (first boot), the dashboard shows:
  - Shaking egg emoji (🥚) with CSS animation
  - Egg transforms to atom symbol (⚛) after 2 seconds
  - Agent name fades in large text
  - Purpose/description fades in below
  - "Let's go →" button dismisses overlay
- CSS animations: `hatchShake`, `hatchPop`, `fadeIn` with staggered delays

### Added — ToolRegistry.list()
- New `list()` method returns all registered tools (built-in + MCP + API) with name, description, and source. Used by `GET /api/tools` endpoint.

### Changed
- Dashboard now has 12 nav pages (was 10): +Tools, +Scheduled Tasks
- Memory page expanded with remember input, graph viz button, export button
- Page loader map (`pgL`) updated with tools and scheduled handlers
- Dashboard UI grew from 442 → 500+ lines

## [1.4.2] - 2026-02-24

### Phase 7 — Security, Scale & Delight

### Added — Security
- **AGEX scope enforcement** — Trust Kernel now checks every tool call before execution. If VALUES.md forbids an action (e.g. "Never delete data"), the tool call is blocked with `⛔ Blocked by Trust Kernel: <rule>`. Works for all tool types: built-in, MCP, and API.
- **Trust Kernel wired to ToolRegistry** — `setTrustKernel()` method + wired at startup after dashboard init.

### Added — Agent Management
- **Agent delete endpoint** — `DELETE /api/agents/:name` removes agent directory from disk and unregisters from running registry.
- **SOUL.md editor endpoints:**
  - `GET /api/agents/:name/soul` — read SOUL.md content
  - `PUT /api/agents/:name/soul { content }` — update SOUL.md (requires restart to apply)

### Added — Knowledge Graph Visualization
- **Graph endpoint** — `GET /api/memory/graph` returns `{ nodes, edges }` suitable for D3/force-graph rendering. Nodes have `id`, `label`, `type` (semantic/episodic/procedural). Edges created from co-reference analysis between knowledge entries.
- **`getGraph()` on MemoryManager** — builds node/edge graph from KnowledgeStore entries.

### Added — Delight
- **Weekly summary** — every Sunday at 9am, agent generates a brief weekly summary (messages processed, key topics, pending tasks) and pushes it to all channels. Controlled by `heartbeat.weeklySummary` config (default: on). Uses pushToUser() for delivery.
- **Summary dedup** — only sends once per day, tracks via memory context.

### Changed
- ToolRegistry constructor now accepts `_trustKernel` for scope enforcement
- `executeTool()` checks trust kernel before executing any tool
- Heartbeat start() now initializes weekly summary timer
- Memory manager grew with getGraph() method (~40 lines)
- Dashboard server grew with 5 new endpoints (agent delete, SOUL CRUD, graph viz)

## [1.4.1] - 2026-02-24

### Phase 5 — Live Canvas / A2UI + Phase 6 — Deep System Access

### Added — Live Canvas
- **Canvas pane** — toggleable split-pane on right side of chat (45% width). Supports:
  - **HTML** — full pages with inline CSS/JS rendered in sandboxed iframe
  - **SVG** — vector graphics rendered in centered iframe
  - **Markdown** — rendered with headers, bold, code blocks
  - **Mermaid** — diagrams rendered via mermaid.js (lazy-loaded from CDN)
  - **Image** — URLs displayed as responsive images
  - **Text** — plain text in preformatted block
- **Canvas tabs** — multiple artifacts persist as tabs. Click to switch between them.
- **Canvas toolbar** — download artifact as file, copy HTML to clipboard, close button
- **`render_canvas` built-in tool** — agent can create canvas artifacts during conversation. LLM sees it as a tool: `render_canvas({format: 'html', title: 'My Chart', content: '<html>...'})`
- **Canvas API endpoint** — `POST /api/canvas/render { format, title, content }` pushes content to all dashboard clients
- **Canvas WS event** — `canvas_render` event auto-opens canvas pane and adds artifact
- **Canvas toggle button** — 🖼️ button in chat input bar
- **Mermaid lazy loading** — mermaid.js v10.9.1 loaded from CDN only when first diagram is rendered

### Added — Deep System Access
- **`shell_exec` built-in tool** — execute shell commands with stdout/stderr capture. Features:
  - Configurable allowlist (`config.tools.shell.allowList`)
  - Timeout control (default 30s, max 120s)
  - Working directory support
  - 512KB output buffer
  - Returns exit code on failure
- **`read_file` built-in tool** — read file contents (UTF-8 or base64). 1MB size limit.
- **`write_file` built-in tool** — write/append to files. Auto-creates directories.
- **`list_directory` built-in tool** — list files with sizes and type icons
- **Tools API endpoints:**
  - `GET /api/tools` — list all registered tools (built-in + MCP + API)
  - `GET /api/tools/log` — recent tool execution log from audit

### Changed
- Built-in tool count: 5 → 10 (get_current_time, calculate, web_fetch, spawn_agent, search_knowledge, shell_exec, read_file, write_file, list_directory, render_canvas)
- ToolRegistry now has `_broadcastFn` for canvas rendering wired at startup
- Dashboard CSS grew with canvas pane styles (responsive, dark theme)
- Dashboard UI grew from 379 → 409 lines

## [1.4.0] - 2026-02-24

### Phase 4 — Voice & Media (STT + TTS)

### Added
- **VoiceEngine** (`src/core/voice.js`, 210 lines) — unified STT/TTS module:
  - **STT chain:** Deepgram Nova-2 → OpenAI Whisper → Groq Whisper (free tier). Auto-selects based on available API keys.
  - **TTS chain:** ElevenLabs Turbo v2.5 → OpenAI TTS. Auto-selects based on available API keys.
  - `transcribe(audioBuffer, mimeType)` → `{ text, provider, duration }`
  - `synthesize(text, options)` → `{ buffer, mimeType, provider }`
  - `status()` → `{ stt: [...providers], tts: [...providers], ready: bool }`
- **Telegram voice messages work** — send a voice note to your bot and it:
  1. Downloads the OGG file from Telegram servers
  2. Transcribes via Deepgram/Whisper/Groq (shows transcript: 🎙️ "what you said")
  3. Processes through agent like normal text
  4. Replies as voice note (TTS) if response < 3000 chars, falls back to text
  5. Full dashboard broadcast (shows 🎙️ prefix for voice messages)
- **Voice status endpoint** — `GET /api/voice/status` returns available STT/TTS providers
- **VoiceEngine in agent services** — all agents have `services.voice` for STT/TTS access
- **ElevenLabs voice settings** — stability 0.5, similarity 0.75, turbo v2.5 model
- **OpenAI TTS** — nova voice, opus format, 1.0x speed
- **Groq Whisper** — whisper-large-v3-turbo model (free tier)

### Changed
- Telegram voice handler replaced from "coming soon" stub to full transcription + TTS pipeline
- grammy `InputFile` imported for voice note replies

## [1.3.9] - 2026-02-24

### Phase 3 — Autonomous Agency (Proactive Push + Scheduled Tasks)

### Added
- **Proactive push system** — `Heartbeat.pushToUser(message)` sends messages to ALL active channels (Telegram, Discord, WhatsApp) AND the dashboard via WebSocket. This is the core "agent initiates contact" capability.
  - Telegram: sends DM to all paired users via `bot.api.sendMessage()`
  - Discord: sends DM to all paired users via `user.createDM()`
  - WhatsApp: sends message to all paired users via `client.sendMessage()`
  - Dashboard: broadcasts `proactive_message` event — appears as toast + chat message
- **Scheduled tasks push results** — heartbeat scheduled tasks now push their LLM output to the user via all channels when `notify: true` (default). Previously results were only logged.
- **Auto-learn pushes questions** — auto-learn questions are now sent to all channels instead of just written to a file queue. Users see "💡 Quick question: ..." in Telegram/Discord/WhatsApp/Dashboard.
- **Dashboard push endpoint** — `POST /api/push { message }` manually sends a proactive message to all channels from the dashboard.
- **Scheduled tasks API:**
  - `GET /api/scheduled` — list all scheduled tasks
  - `POST /api/scheduled { name, prompt, schedule, notify }` — create a new scheduled task (persisted to config)
  - `DELETE /api/scheduled/:index` — remove a scheduled task
  - Valid schedules: `every-minute`, `every-5-minutes`, `every-hour`, `every-day`
- **Dashboard proactive message handler** — `proactive_message` WS event shows toast notification and adds message to chat view with `[source]` prefix.
- **Heartbeat wiring** — `wireChannels()` and `wireBroadcast()` methods connect heartbeat to channel manager and dashboard at startup.

### Changed
- Heartbeat auto-learn no longer writes to filesystem delivery queue — sends directly via channels
- Scheduled tasks default to `notify: true` — results are pushed to user unless explicitly disabled
- index.js startup now wires heartbeat to channels and dashboard after both are initialized

### Notes
- Proactive push respects quiet hours (auto-learn only sends during configured hours)
- Daily cost cap still enforced across all heartbeat activities
- Scheduled tasks persist to config — survive restarts, but need restart to activate new tasks

## [1.3.8] - 2026-02-24

### Phase 2 — Multi-Channel Gateway (Discord + WhatsApp)

### Added
- **Discord channel** — Full implementation using discord.js v14. Features:
  - Same pairing flow as Telegram (8-char code, approve via dashboard or CLI)
  - Responds to @mentions in any server channel, or DMs directly
  - Optional `allowedChannels` config to restrict to specific channel IDs
  - 2000-char message splitting on paragraph/word boundaries
  - Typing indicator while processing
  - Message Content intent required (instructions in onboard)
  - Dashboard broadcast — Discord messages appear in real-time
- **WhatsApp channel** — Full implementation using whatsapp-web.js. Features:
  - QR code pairing via terminal (scan with WhatsApp mobile)
  - QR broadcast to dashboard via WebSocket (`whatsapp_qr` event)
  - Same pairing code flow for user authorization
  - LocalAuth session persistence (survives restarts)
  - Headless Chromium — no GUI needed
  - Group message filtering (`allowGroups` config option)
  - Status broadcast ignored
  - Typing indicator while processing
  - Dashboard broadcast — WhatsApp messages appear in real-time
- **Onboarding: Discord step** — `qclaw onboard` now asks "Connect a Discord bot?" with setup instructions (create app, enable MESSAGE CONTENT intent, invite to server). Validates token via Discord REST API before saving.
- **Discord config** — `config.channels.discord.enabled`, `allowedUsers`, `allowedChannels`
- **WhatsApp config** — `config.channels.whatsapp.enabled`, `allowedUsers`, `allowGroups`

### Changed
- Channel manager now routes `discord` and `whatsapp` to real implementations (were commented-out stubs)
- Onboarding flow now 6+ steps: LLM → Telegram → Discord → Embeddings → Name → Dashboard
- Channel manager file grew from 425 → 835+ lines with both new channels

### Notes
- Discord requires: `npm i discord.js` (prompted if missing)
- WhatsApp requires: `npm i whatsapp-web.js qrcode-terminal` (prompted if missing)
- WhatsApp uses Chromium headless — works on Linux/Mac/WSL, may need `--no-sandbox` on some systems
- WhatsApp session persists in `~/.quantumclaw/whatsapp-session/` — delete to re-pair

## [1.3.7] - 2026-02-24

### Phase 1 — ClawHub Integration

### Added
- **ClawHub CLI integration** — `qclaw skill install <slug>` tries `clawhub install` first (3,286+ skills available), falls back to direct SKILL.md fetch. Skills install to `workspace/shared/skills/` so all agents can use them.
- **ClawHub search from dashboard** — Install Skill modal now has live search. Type a query and results from ClawHub appear with stars/downloads. Click to select, then install. Falls back to "Browse clawhub.ai →" link if CLI not installed.
- **Dashboard search endpoint** — `GET /api/clawhub/search?q=...` runs `clawhub search` as subprocess with 15s timeout. Returns slug, description, stars, downloads.
- **Dashboard install uses CLI** — `POST /api/skills/install` tries ClawHub CLI first for named skills, falls back to direct fetch. Response includes `method: 'clawhub-cli'` or `method: 'direct'`.
- **ClawHub status endpoint** — `GET /api/clawhub/status` checks if `clawhub` CLI is installed, returns version.
- **CLI skill commands expanded:**
  - `qclaw skill search <query>` — search ClawHub (uses CLI or shows browse link)
  - `qclaw skill install <name-or-url>` — install via CLI or direct fetch
  - `qclaw skill reset <name>` — mark skill as unreviewed
  - `qclaw skill reset-all` — mark all skills as unreviewed
  - `qclaw skill remove <name>` — delete skill from disk
  - `qclaw skill list` — shows description, review status, enabled/disabled
- **Skill descriptions in list** — `qclaw skill list` now shows description, [unreviewed] and [disabled] badges.

### Changed
- Install modal widened to 600px, includes live search results panel with debounced input
- Skills page info box updated with ClawHub ecosystem context

## [1.3.6] - 2026-02-24

### Phase 0 — Fix What's Broken

### Added
- **SkillLoader: `reset(name)`** — marks a skill as unreviewed, persists to skills-meta.json
- **SkillLoader: `resetAll()`** — marks all skills as unreviewed
- **SkillLoader: `install(urlOrSlug)`** — fetches SKILL.md from ClawHub (clawhub.ai) or any URL, saves to shared/skills/, parses and registers. Handles multiple ClawHub URL patterns, HTML page fallback, and validation. All installed skills start as unreviewed.
- **SkillLoader: `setEnabled(name, bool)`** — enable/disable skills without deleting
- **SkillLoader: `remove(name)`** — delete skill file from disk
- **SkillLoader: skills-meta.json** — persistent metadata (reviewed, enabled, source, install date) survives restarts
- **SkillLoader: description parsing** — extracts description from YAML frontmatter or first paragraph, supports ClawHub `## Usage` section
- **Dashboard: hatching event** — when agent gets named during first conversation, broadcasts `hatched` WS event. Dashboard updates agent badge and shows toast "🎉 Agent named: X" without requiring manual reload.
- **Dashboard: restarting event** — on restart, broadcasts `restarting` WS event. Dashboard shows "Restarting" badge and toast before disconnecting, so users know it's intentional.
- **Cognee Docker restart fallback** — when `/api/v1/settings` POST fails, automatically restarts the `quantumclaw-cognee` Docker container with correct `-e` env vars for LLM and embedding configuration. Waits for health check after restart.

### Fixed
- **Dashboard skill buttons now work** — Reset, Reset All, and Install Skill were calling backend endpoints that returned "Skill manager not available". All three methods now exist on SkillLoader.
- **Restart is graceful** — broadcasts warning to all WS clients before exiting, giving 800ms for messages to send (was 500ms with no warning).
- **`forAgent()` respects enabled flag** — disabled skills are no longer returned to agents.

## [1.3.5] - 2026-02-24

### Added
- **Dashboard: Collapsible sidebar** — click the ⚛ logo or ◀/▶ arrow to toggle between expanded (labels) and compact (icons only) modes. State persists across sessions via localStorage.
- **Dashboard: Info boxes on every page** — contextual explainers on Overview (AGEX explained), Channels, Usage (tiered routing), Agents (SOUL.md, worker delegation), Skills (sandbox, reviewed/unreviewed, ClawHub link), Memory (3-layer architecture), Secrets (encryption details), Config (how to edit), and Logs (what's tracked).
- **Dashboard: Skill management** — "Install Skill" button opens modal accepting ClawHub skill names or direct URLs. "Reset" button per skill and "Reset All" button to re-review from scratch. Empty state links to clawhub.ai/skills.
- **Dashboard: ClawHub integration** — Install Skill modal fetches from `https://clawhub.ai/api/skills/{name}/download`. Browse link to clawhub.ai/skills throughout.
- **Dashboard: Tooltips** — title attributes on buttons, status indicators, and interactive elements throughout.
- **Backend: `POST /api/skills/reset`** — reset individual skill review status.
- **Backend: `POST /api/skills/reset-all`** — reset all skills.
- **Backend: `POST /api/skills/install`** — install skill from URL or ClawHub name.
- **AGEX explainer** — Overview page has detailed info box explaining AID, Trust Tiers (0-3), Hub, and child AID delegation in plain English.

### Fixed
- **Secrets page crash** — `set.map is not a function` error. Backend now validates `list()` returns array; frontend handles both `string[]` and `object[]` response formats defensively.
- **Skills endpoint crash** — wrapped in try/catch, returns empty array on error.
- Sidebar navigation now remembers collapsed/expanded state.

## [1.3.4] - 2026-02-24

### Added
- **Onboarding: Embedding model selection** — new step asks users to choose an embedding provider for the knowledge graph. Options: OpenAI (recommended, cheapest + best quality), same as LLM provider, Ollama (local/free), Fastembed (local/free), or skip (basic vector memory only). Handles Anthropic gracefully (no embeddings → auto-falls back to Fastembed). Reuses the LLM API key when possible.
- **Memory Manager: Cognee LLM/embedding auto-configuration** — on boot, bridges QClaw's config into Cognee's env vars (LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_API_KEY, EMBEDDING_DIMENSIONS, EMBEDDING_ENDPOINT).
- **Memory Manager: Settings API push** — after connecting to Cognee, pushes LLM/embedding settings via `POST /api/v1/settings` for Docker Cognee instances that can't inherit env vars. Falls back gracefully if the API isn't available.
- **Config: `memory.embedding`** — new config section stores embedding provider, model, dimensions, and endpoint.
- **Secrets: `embedding_api_key`** — separate encrypted key for embedding provider (reuses LLM key if same provider).

### Changed
- Onboarding now has 5 steps: LLM provider → Telegram → Embeddings → Name → Dashboard PIN/tunnel.
- By the time the dashboard opens after `qclaw start`, Cognee's knowledge graph is fully configured with both LLM and embedding models — no manual env var setup needed.

## [1.3.3] - 2026-02-24

### Fixed
- **AGEX SDK crash on Node 20** — `@agexhq/core` uses top-level `await` syntax that causes `SyntaxError: Unexpected reserved word` on Node 20.x. All AGEX imports are now dynamic with try/catch, so the agent starts cleanly and falls back to local secrets when AGEX SDK can't load.
- **AGEX packages moved back to optionalDependencies** — prevents `npm install` failures if the packages have native/syntax issues on the host platform.

## [1.3.2] - 2026-02-24

### Added
- **Dashboard: Secrets Manager** — new 🔑 API Keys page to add, view, and remove encrypted secrets directly from the dashboard. Supports all LLM providers (Anthropic, OpenAI, OpenRouter, Groq, Google, xAI, Mistral, Together), channel tokens (Telegram, Discord), and custom keys. No more CLI-only secret management.
- **Dashboard: Agent Spawning UI** — "Spawn Agent" button on the Agents page opens a modal to create sub-agents with name, role, model tier, and AGEX scopes. AID is auto-generated and displayed per agent.
- **Dashboard: AGEX Status Panel** — Overview page now shows full AGEX identity: AID (truncated), trust tier, hub URL, and per-agent AID count.
- **Dashboard: Restart Button** — sidebar and config page both have restart controls that hit `POST /api/restart`.
- **Dashboard: AGEX Badge** — topbar shows live AID status badge (green when connected, yellow for local mode).
- **Backend: `GET /api/secrets`** — lists all stored secret key names (not values).
- **Backend: `POST /api/secrets`** — stores a new encrypted secret.
- **Backend: `DELETE /api/secrets/:key`** — removes a secret.

### Changed
- **Dashboard: Full UI rebuild** — every page now calls its corresponding API endpoints. Previously unused endpoints (`/api/agex/status`, `/api/agents/spawn`, `/api/costs`, `/api/restart`) are now wired to the frontend.
- **Agents page** shows AID, trust tier badges, and provider/model per agent instead of just a name card.
- **Config editor** groups settings into collapsible sections and hides internal `_` prefixed keys.
- **Auth lockout** relaxed from 5 attempts / 15 min to 10 attempts / 2 min.

### Fixed
- Telegram pairing now inline during onboarding (no more "open a new terminal" flow).
- XSS protection: all user-facing strings escaped via `esc()` helper.

## [1.3.1] - 2026-02-24

### Fixed
- **Telegram pairing now inline during onboarding** — no more "open a new terminal" flow. Onboarding starts a temporary bot, user sends /start in Telegram, types the 8-letter code directly in the wizard, and pairing completes inline. Falls back gracefully if user skips or code doesn't match.
- **Dashboard auth lockout relaxed** — increased from 5 attempts / 15 min lockout to 10 attempts / 2 min lockout. The aggressive lockout was punishing legitimate users during setup.

## [1.3.0] - 2026-02-24

### Added
- **Full AGEX integration** — `@agexhq/sdk`, `@agexhq/core`, `@agexhq/store`, `@agexhq/hub-lite` now real dependencies (published to npm, no longer optional)
- **Auto-start hub-lite** — if no AGEX hub is running, QuantumClaw starts `@agexhq/hub-lite` in-process on port 4891 automatically. No separate process needed.
- **Auto-generate AID on first boot** — primary agent gets an Ed25519-signed Agent Identity Document stored in `~/.quantumclaw/agex/aid.json`
- **Agent spawning API** — `POST /api/agents/spawn` creates sub-agents with their own SOUL.md, child AID (delegated from parent), and scoped permissions
- **`spawn_agent` built-in tool** — the agent itself can spawn sub-agents via tool calling ("Create a research sub-agent")
- **`GET /api/agex/status`** — dashboard endpoint showing hub connection, AID info, and per-agent identity status
- **AID in agent identity** — each agent's `aid.json` is loaded at startup, AID injected into system prompt so the agent knows its own identity
- **Per-agent AID generation** — `credentials.generateChildAID()` method creates child AIDs for sub-agents with hub registration
- **Agent list enriched** — `GET /api/agents` now returns `aidId` and `trustTier` for each agent

### Changed
- `@agexhq/sdk` and `@agexhq/store` moved from `optionalDependencies` to `dependencies`
- `credentials.js` uses static `import { AgexClient }` instead of dynamic `import('@agexhq/sdk')` — no more silent failures
- Default AGEX hub URL set to `http://localhost:4891` — no config needed for local operation
- Agent class now exports (`export class Agent`) for use by dashboard spawn endpoint
- `CredentialManager.shutdown()` now also closes the in-process hub-lite server

## [1.2.1] - 2026-02-24

### Added
- **Safety warning during install** — users must acknowledge risks before installation proceeds, covering AI autonomy, tool access, API costs, and open-source software considerations. Includes `--yes` flag for CI/automation
- **Auto-install Docker** — installer detects missing Docker and installs it via apt (Debian/Ubuntu), dnf (Fedora/RHEL), pacman (Arch), or Homebrew (macOS). Handles daemon startup and docker group permissions
- **Auto-install Python 3** — installer detects missing Python and installs via system package manager

### Fixed
- Cognee Docker image tag corrected from `cognee/cognee:latest` to `cognee/cognee:main` in install.sh and install-cognee.js (matching docker-compose.yml fix from v1.2.0)
- Fixed broken `fi` nesting in install.sh Cognee health check block that caused bash parse error
- Install step numbering updated from [X/6] to [X/7] to reflect new dependency auto-install step

## [1.2.0] - 2026-02-24

### Fixed
- **Cognee integration rewritten** — proper authentication flow (API key, JWT login, no-auth modes), `POST /api/v1/auth/login` with token extraction and refresh, cognify pipeline trigger (`POST /api/v1/cognify` with `runInBackground: true`) that was previously missing entirely, structured search with configurable `search_type` (GRAPH_COMPLETION, CHUNKS, SUMMARIES, RAG_COMPLETION, FEELING_LUCKY), dataset-scoped operations, automatic re-authentication on 401 responses
- **Tool system wired in** — `ToolRegistry` and `ToolExecutor` (previously built but never instantiated) now initialise at startup in new Layer 4.5, `Agent.process()` uses `toolExecutor.run()` for full agentic tool-calling loop (LLM → tool call → execute → feed result → repeat), falls back to chat-only if tool system unavailable
- **Shared database connected** — `getDb()` from `database.js` now called at startup (Layer 1.7), `DeliveryQueue`, `CompletionCache`, and `ExecApprovals` wired via `.attach(db)` to use SQLite instead of silently falling back to JSON 100% of the time
- **`search_knowledge` built-in wired to live knowledge graph** — tool executor can search the agent's own memory via `memory.graphQuery()`
- Docker Compose Cognee image tag fixed from `cognee/cognee:latest` to `cognee/cognee:main`
- README version badge updated from 1.0.0 to 1.2.0

### Added
- Three Cognee authentication modes: API key (Cognee Cloud), JWT login (local with auth), no-auth (local dev)
- Tool audit logging — every tool call logged with name and truncated arguments
- Shared database shutdown cleanup (`closeDb()` on SIGINT/SIGTERM)
- Delivery queue retry timer cleanup on shutdown

## [1.0.0] - 2026-02-19

### Added
- Initial release
- 8-layer startup sequence with graceful degradation
- AES-256-GCM encrypted secret store with machine-specific derived keys
- Trust Kernel (VALUES.md) with immutable hard/soft/forbidden rules
- SQLite audit logging with cost tracking
- Three-layer memory: Cognee knowledge graph, SQLite conversations, workspace files
- Cognee auto-reconnect with token refresh 5 min before expiry
- 5-tier smart model routing (Reflex, Simple, Standard, Complex, Voice)
- 12 provider adapters (Anthropic, OpenAI, Groq, OpenRouter, Google, xAI, Mistral, Ollama, Together, Bedrock, Azure, custom)
- Agent registry with SOUL.md personality loading
- Drop-in markdown skills with permission detection
- Telegram channel via grammY with user allowlists
- Express + WebSocket dashboard with real-time chat
- 3-mode heartbeat (scheduled, event-driven, graph-driven)
- 5-step onboarding wizard with personality
- Delivery queue with exponential backoff retry
- Completion cache with TTL-based expiry
- Exec approval workflow with 10-min auto-deny
- AGEX credential management with local fallback
- Vendored AGEX SDK (AgexClient, AID generation, Ed25519 signing)
- Gateway scripts for Linux, macOS, Windows, and Android (Termux)
- Workspace templates: AGENTS.md, BOOT.md, BOOTSTRAP.md, HEARTBEAT.md, SOUL.md, USER.md, IDENTITY.md, MEMORY.md, TOOLS.md
- CLI commands: onboard, start, chat, status, diagnose, help
- Platform support: Linux, macOS, Windows (WSL2), Android (Termux), Raspberry Pi
