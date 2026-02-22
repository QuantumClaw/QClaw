# AGENTS.md — For AI Coding Agents

This file tells AI coding agents (Claude Code, Copilot, Cursor, etc.) how to work on the QuantumClaw codebase.

## Project Overview

QuantumClaw (QClaw) is a Node.js AI agent runtime. ESM modules throughout. No TypeScript.

## Architecture

```
src/
├── index.js          # Bootstrap (8-layer startup sequence)
├── credentials.js    # AGEX credential manager (wraps secrets + AGEX SDK)
├── agex-sdk/         # Vendored AGEX SDK (AgexClient, crypto)
├── core/             # Config, logger, heartbeat, delivery queue, completion cache
├── security/         # SecretStore (AES-256-GCM), TrustKernel, AuditLog, approvals
├── memory/           # Cognee knowledge graph + SQLite conversation memory
├── models/           # 5-tier smart router, provider adapters
├── agents/           # Agent registry, personality loading from workspace
├── skills/           # Drop-in markdown skill loader
├── channels/         # Telegram, Discord, Slack, WhatsApp, WebSocket
├── dashboard/        # Express + WS dashboard server
└── cli/              # Onboarding wizard, commands, branding
```

## Conventions

- ESM imports (`import`/`export`, not `require`)
- British English in docs and comments
- No TypeScript
- No em dashes in comments or docs
- Minimal dependencies (justify any new npm package)
- `log.info/warn/error/debug/success` for logging (not console.log)

## Running

```bash
npm install
npx qclaw onboard   # first time
npx qclaw start     # run the agent
npx qclaw diagnose  # health check
```

## Testing

```bash
npm test                   # runs test suite
npx qclaw diagnose   # runtime health check
```

## Key Patterns

- **Graceful degradation**: If Cognee is down, memory falls back to SQLite. If AGEX Hub is down, credentials fall back to local encrypted secrets. Nothing crashes.
- **8-layer startup**: Security → Memory → Models → Skills → Agents → Channels → Dashboard → Heartbeat. Each layer can fail without killing the rest.
- **Credential resolution**: `credentials.get('key')` checks AGEX first, then local secrets. Drop-in compatible with SecretStore.
- **Trust Kernel**: VALUES.md defines hard limits. The agent cannot override these. Code that enforces VALUES.md rules should never have a bypass.

## What NOT to Do

- Don't add `require()` calls
- Don't store secrets in plaintext anywhere
- Don't bypass the TrustKernel or approval system
- Don't add dependencies without good reason
- Don't use American English in docs
