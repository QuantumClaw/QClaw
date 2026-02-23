# Changelog

All notable changes to QuantumClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
