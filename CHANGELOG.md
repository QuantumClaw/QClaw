# Changelog

All notable changes to QuantumClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
