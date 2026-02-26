# OpenClaw vs QuantumClaw — Full Gap Analysis

Based on complete read of docs.openclaw.ai (tools, channels, security, config, architecture, features)

## CHANNELS — OpenClaw CRUSHES us here

| Channel | OpenClaw | QuantumClaw | Gap |
|---------|----------|-------------|-----|
| WhatsApp | ✅ Baileys, production-ready, QR pairing, groups, polls, reactions, ack reactions, multi-account, broadcast groups | ✅ whatsapp-web.js, basic pairing | OC has reactions, polls, multi-account, ack reactions |
| Telegram | ✅ grammY, long-poll + webhook, groups, mention patterns, forum topics, polls, draft streaming | ✅ grammY, polling, voice notes, pairing | OC has webhook mode, polls, forum topics, draft streaming |
| Discord | ✅ discord.js, guilds, channels, DMs, thread support, focus/unfocus, reactions, polls | ✅ discord.js, DMs, pairing, splitting | OC has guild management, thread support, polls, reactions |
| Slack | ✅ Bolt SDK, workspace apps, channels, DMs, thread support | ✅ Bolt SDK, socket mode, DMs, mentions | Roughly even |
| Email | ❌ No built-in (Gmail via webhooks/pubsub) | ✅ IMAP + SMTP built-in | **WE WIN** |
| Signal | ✅ signal-cli integration | ❌ None | **MISSING** |
| iMessage | ✅ BlueBubbles (recommended) + legacy imsg CLI | ❌ None | **MISSING** |
| Google Chat | ✅ HTTP webhook app | ❌ None | **MISSING** |
| MS Teams | ✅ Bot Framework (plugin) | ❌ None | **MISSING** |
| Matrix | ✅ Plugin | ❌ None | **MISSING** |
| IRC | ✅ Built-in | ❌ None | **MISSING** |
| Mattermost | ✅ Plugin | ❌ None | Lower priority |
| Zalo | ✅ Plugin (2 variants) | ❌ None | Niche |
| Feishu/Lark | ✅ Plugin | ❌ None | Niche |
| LINE | ✅ Listed | ❌ None | Niche |
| Synology Chat | ✅ Listed | ❌ None | Niche |
| Nextcloud Talk | ✅ Listed | ❌ None | Niche |
| Nostr | ✅ Listed | ❌ None | Niche |
| Twitch | ✅ Listed | ❌ None | Niche |
| WebChat | ✅ Built into Control UI | ✅ Dashboard chat | Even |

**Channel count: OpenClaw ~20+ vs QuantumClaw 5. This is the biggest gap.**

### Channel features OpenClaw has that we don't:
- **Group chat support** — mention patterns, per-group config, group allowlists
- **Channel routing rules** — `bindings` array maps channels/accounts/peers to agents
- **DM policies** — pairing | allowlist | open | disabled (per channel)
- **Reactions** — read/send/react across channels
- **Polls** — create polls in WhatsApp/Discord/Telegram/Teams
- **Message actions** — pin/unpin, edit, delete, search, thread management
- **Multi-account** — multiple WhatsApp numbers, multiple Telegram bots
- **Streaming/chunking** — responses stream back word-by-word in Telegram
- **Read receipts** — configurable per channel
- **Channel location parsing** — extract location from messages
- **Broadcast groups** — send to multiple groups at once

## TOOLS — They have more, but ours are different

| Tool | OpenClaw | QuantumClaw | Notes |
|------|----------|-------------|-------|
| exec/shell | ✅ exec with yieldMs, background, pty, elevated, sandbox/gateway/node targeting | ✅ shell_exec with allowlist, timeout, cwd | OC's is much richer |
| read/write/edit | ✅ read, write, edit, apply_patch (multi-hunk) | ✅ read_file, write_file, list_directory | OC has apply_patch |
| process management | ✅ list/poll/log/write/kill/clear background processes | ❌ None | **MISSING** |
| web_search | ✅ Brave Search API | ✅ web_fetch only | We need web_search |
| web_fetch | ✅ HTML→markdown/text extraction | ✅ Basic fetch | OC has markdown extraction |
| browser | ✅ Full Chrome/CDP: snapshot, act, screenshot, tabs, profiles, multi-instance | ❌ None (puppeteer preset only) | **MAJOR GAP** |
| canvas | ✅ A2UI: present, eval, snapshot, push/reset | ✅ render_canvas: HTML/SVG/Mermaid/MD | OC has eval + snapshot |
| nodes | ✅ camera snap/clip, screen record, location, notify, system.run | ❌ None | **MISSING** |
| cron | ✅ Full cron: add/update/remove/run/wake, concurrent limits, retention | ✅ Heartbeat scheduled tasks (basic) | OC's is much richer |
| sessions | ✅ list/history/send/spawn/status, per-session isolation | ✅ Per-agent conversation history | OC has inter-session messaging |
| message | ✅ Cross-channel send/react/pin/search/thread/poll/role/member | ❌ pushToUser is broadcast only | **MAJOR GAP** |
| gateway | ✅ restart, config.get/apply/patch, update.run | ✅ restart endpoint | OC has config management |
| image | ✅ Dedicated image analysis tool | ✅ Via multimodal LLM in chat | Similar |
| memory | ✅ memory_search, memory_get | ✅ search_knowledge + 3-layer store | **WE WIN** on depth |
| agents_list | ✅ List targetable agents | ✅ Agent registry | Similar |
| calculate | ❌ None | ✅ Built-in | **WE WIN** |
| spawn_agent | ❌ Via sessions_spawn | ✅ Built-in tool | **WE WIN** |
| render_canvas | ❌ Via canvas tool | ✅ Built-in with tabs | **WE WIN** on UX |
| get_current_time | ❌ None | ✅ Built-in | **WE WIN** |

### Tool features OpenClaw has that we don't:
- **Tool profiles** — minimal/coding/messaging/full base allowlists
- **Tool groups** — group:fs, group:runtime, group:sessions, etc.
- **Per-provider tool policy** — restrict tools for specific model providers
- **Loop detection** — blocks repetitive no-progress tool call loops
- **Elevated mode** — run on host even when sandboxed
- **Sandboxing** — per-session Docker sandboxes for non-main sessions

## BROWSER AUTOMATION — They have it, we don't

OpenClaw has full CDP browser control:
- OpenClaw-managed Chrome/Chromium instances
- Multiple browser profiles with auto-allocated ports
- AI snapshots (Playwright) and aria tree snapshots
- Click/type/press/hover/drag/select/fill actions
- Screenshot capture
- Tab management
- PDF generation
- File upload handling
- OAuth login flows
- Browser profiles (create/delete/reset)

**This is a significant feature we need to at least stub.**

## VOICE & MEDIA

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Voice transcription | ✅ Hook-based, provider flexible | ✅ Deepgram/Whisper/Groq chain |
| TTS | ✅ ElevenLabs | ✅ ElevenLabs/OpenAI chain |
| Voice Wake | ✅ "Hey OpenClaw" on macOS/iOS/Android | ❌ None |
| Talk Mode | ✅ Continuous conversation, interruption detection | ❌ None |
| Image input | ✅ All channels | ✅ Dashboard + Telegram |
| Camera capture | ✅ Via nodes | ❌ None |
| Screen record | ✅ Via nodes | ❌ None |
| Location | ✅ Via nodes | ❌ None |

**Voice Wake and Talk Mode are major experiential differentiators.**

## AGENT SYSTEM

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Multi-agent | ✅ agents.list[], per-agent workspace, sandbox, tools | ✅ AgentRegistry, per-agent SOUL.md, AID |
| Agent routing | ✅ bindings[] with channel/account/peer matching | ✅ Basic per-channel agent config |
| Sandbox | ✅ Per-session Docker sandboxes, scope (session/agent/shared) | ❌ None |
| Sub-agents | ✅ sessions_spawn with announce back | ✅ spawn_agent tool |
| Agent identity | ✅ name, theme, emoji, avatar | ✅ SOUL.md, AGEX AID (cryptographic) |
| Session scope | ✅ per-peer, per-channel-peer, main, per-account-channel-peer | ✅ Per-agent + per-channel + per-user |
| Workspace isolation | ✅ Per-agent workspace dirs | ✅ Per-agent dirs |

**WE WIN on AGEX cryptographic identity. They win on sandboxing.**

## SECURITY

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Trust rules | ✅ System prompt guidelines + tool allow/deny | ✅ VALUES.md Trust Kernel (immutable, checked per tool call) |
| Tool allow/deny | ✅ Global + per-agent + per-provider + sandboxed | ✅ Trust Kernel keyword matching |
| Sandboxing | ✅ Docker per-session with cap_drop, seccomp, apparmor | ❌ None |
| Credential encryption | ❌ Plain files in ~/.openclaw/credentials | ✅ AES-256-GCM encrypted secrets |
| DM pairing | ✅ Per-channel pairing with code expiry | ✅ Per-channel pairing with code expiry |
| Doctor tool | ✅ openclaw doctor diagnoses misconfig | ❌ None |
| Security audit | ✅ openclaw security audit --deep | ❌ None |
| Elevated mode | ✅ Per-sender, per-agent elevated permissions | ❌ None |

**WE WIN on credential encryption + immutable Trust Kernel. They win on sandboxing + audit tools.**

## AUTOMATION

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Cron jobs | ✅ Full CRUD, concurrent limits, session retention, run logs | ✅ Basic scheduled tasks in heartbeat |
| Heartbeat | ✅ Configurable interval, auto-learn | ✅ Configurable + auto-learn + weekly summary |
| Webhooks | ✅ Inbound webhooks with token auth + session routing | ❌ None |
| Gmail PubSub | ✅ Google Pub/Sub for real-time email triggers | ❌ None |
| Polls | ✅ Automation polls tool | ❌ None |
| Auth monitoring | ✅ Monitor auth expiry | ❌ None |

**They have proper webhook ingestion. We don't.**

## DASHBOARD / UI

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Control UI | ✅ Config tab, sessions, nodes, chat | ✅ 12-page dashboard |
| Canvas | ✅ A2UI host on separate port, eval, snapshot | ✅ Live Canvas pane with tabs |
| Config editor | ✅ Schema-driven form + raw JSON | ✅ Live JSON editor |
| Session management | ✅ List, inspect transcript, send | ✅ Thread listing |
| Node management | ✅ Pair, approve, describe | ❌ None |
| macOS menu bar | ✅ Native Swift app | ❌ None |
| iOS/Android app | ✅ Node apps with Canvas | ❌ None |
| WebChat | ✅ Built-in | ✅ Dashboard chat |

**We have a richer dashboard. They have companion apps we can't match without native dev.**

## MODELS & PROVIDERS

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Provider count | ✅ 20+ (Anthropic, OpenAI, Google, OpenRouter, local, etc) | ✅ 8 (Anthropic, OpenAI, Groq, Google, xAI, Mistral, Together, OpenRouter) |
| Model failover | ✅ primary + fallbacks array | ✅ 5-tier routing (reflex→expert) |
| Model switching | ✅ /model command in chat | ❌ No runtime model switching |
| Subscription auth | ✅ Anthropic Claude Pro/Max + OpenAI ChatGPT via OAuth | ❌ API keys only |
| Streaming | ✅ Block streaming + Telegram draft streaming | ✅ Dashboard WS streaming |
| Cost tracking | ❌ Usage tracking only | ✅ Per-message cost tracking, per-tier, per-channel |

**WE WIN on intelligent cost-optimised routing (5-tier). They win on model count + subscription auth.**

## SKILLS / PLUGINS

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Skills platform | ✅ Bundled + managed + workspace skills, install gating | ✅ ClawHub integration (3,286 skills) |
| Slash commands | ✅ /model, /reasoning, /verbose, /activation, /focus, /session | ❌ None |
| Plugin system | ✅ Extension packages (Mattermost, voice-call, Zalo, etc) | ❌ None |
| Skill config | ✅ Per-skill config in openclaw.json | ✅ SKILL.md parsed with endpoints |
| ClawHub | ✅ ClawHub marketplace | ✅ ClawHub search + install |

**Even on skills/plugins.**

## DEPLOYMENT

| Feature | OpenClaw | QuantumClaw |
|---------|----------|-------------|
| Install | ✅ curl one-liner + PowerShell, npm global | ✅ npm global |
| Service install | ✅ launchd/systemd via --install-daemon | ❌ Manual |
| Docker | ✅ Docker + sandbox images | ✅ Docker Compose |
| Nix | ✅ Declarative Nix config | ❌ None |
| VPS | ✅ DigitalOcean 1-Click, Coolify | ❌ None |
| Remote access | ✅ Tailscale Serve/Funnel, SSH tunnels | ✅ Cloudflare tunnels |
| Platforms | ✅ macOS, Linux, Windows (WSL2), iOS, Android, Raspberry Pi | ✅ Linux, macOS, Windows (WSL2), Termux, Raspberry Pi |

**They have 1-click VPS deploy and native mobile apps.**

---

## PRIORITY GAPS TO CLOSE (ranked by impact)

### CRITICAL (must have to compete)
1. **Signal channel** — privacy-focused users expect this
2. **Browser automation tool** — full CDP browser control 
3. **Group chat support** — mention patterns, per-group config, group allowlists across all channels
4. **Streaming responses** — word-by-word in Telegram/Discord, not just batch
5. **Message tool** — cross-channel send/react/pin/search (not just broadcast)
6. **Process management tool** — background exec with poll/log/kill
7. **Web search tool** — Brave Search API integration
8. **Webhook ingestion** — inbound webhooks with routing

### HIGH (differentiation)
9. **Slash commands** — /model, /verbose, /reset, /help in chat
10. **Cron v2** — proper add/update/remove/run with concurrent limits
11. **Channel reactions** — ack reactions, read receipts
12. **Streaming in channels** — draft streaming in Telegram
13. **Config hot reload** — file watcher + apply without restart
14. **Doctor command** — diagnose misconfiguration
15. **Service install** — launchd/systemd daemon

### NICE TO HAVE (polish)
16. **Google Chat channel**
17. **MS Teams channel** 
18. **Talk Mode** (continuous voice)
19. **Voice Wake** ("Hey Claw")
20. **Sandbox/Docker per-session**
21. **Plugin system** for community extensions
22. **1-Click VPS deploy** (DigitalOcean, Coolify)
