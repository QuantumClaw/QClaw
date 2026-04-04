# QClaw Build Log & Technical Handoff

**Project:** QClaw — Self-hosted Claude agent runtime (Fork of QuantumClaw/QClaw)
**Owner:** Tyson Venables / Flow OS
**Last updated:** 26 March 2026
**Repo:** https://github.com/tysonven/QClaw

---

## Infrastructure

| Component | Location | Details |
|-----------|----------|---------|
| QClaw Agent (Charlie) | DigitalOcean Droplet | IP: [QCLAW_SERVER_IP], LON1, 2GB |
| n8n Server | DigitalOcean Droplet | IP: [N8N_SERVER_IP] |
| Dashboard | https://agentboardroom.flowos.tech | Nginx + SSL + PM2 |
| n8n Webhooks | https://webhook.flowos.tech | |
| Supabase | [SUPABASE_PROJECT_ID] | Ads agency data |

### SSH Aliases
```bash
ssh qclaw        # root@[QCLAW_SERVER_IP] — QClaw agent server
ssh n8n          # n8nadmin@[N8N_SERVER_IP] — n8n server
```

### Dashboard Access
URL: https://agentboardroom.flowos.tech/?token=[DASHBOARD_AUTH_TOKEN] Auth token: [DASHBOARD_AUTH_TOKEN] PIN: [DASHBOARD_PIN]

---

## PM2 Processes (on ssh qclaw)

| ID | Name | Port | Description |
|----|------|------|-------------|
| 0 | quantumclaw | 4000 | Main agent runtime (Charlie) |
| 1 | agex-hub | 4891 | AGEX identity/security hub |

Also running via Docker:
- cognee — Knowledge graph on port 8000 (docker ps to check)

---

## Agent: Charlie

- **Model:** claude-sonnet-4-6 (chat), claude-haiku-4-5-20251001 (fast tasks)
- **AID:** 7bdb59a3-2dfd-44fe-8c0b-f6e47e075061
- **Trust tier:** 0 (dev mode — self-signed, expected for hub-lite)
- **Telegram bot:** @tyson_quantumbot
- **Config:** ~/.quantumclaw/config.json
- **Skills dir:** ~/.quantumclaw/workspace/agents/charlie/skills/
- **6 skills loaded:** GHL, Stripe, n8n, QClaw repo, n8n-router, others

---

## Key Files
~/QClaw/ ├── src/ │ ├── index.js # Main entry point │ ├── credentials.js # AGEX credential manager │ ├── dashboard/ │ │ ├── server.js # API server (45 endpoints) │ │ ├── ui.html # Dashboard frontend (12 pabhook-manus.js # Manus job webhook handler │ ├── security/ # Trust kernel, audit, approvals │ ├── memory/ # Cognee + local graph │ └── agents/ # Agent registry ├── packages/ │ └── agex-core/ # PATCHED local copy of @agexhq/core │ └── src/crypto/ # Fixed Ed25519 crypto bugs ├── .github/workflows/ │ ├── deploy.yml # CI/CD — push to main auto-deploys │ ├── ci.yml # Tests + lint on every push │ └── build-cognee-venv.yml # ARM64 only — not used on x86_64 └── ~/.quantumclaw/ ├── config.json # Agent configuration ├── .env # Secrets (N8N_API_KEY etc) └── secrets.enc # Encrypted secrets store


---

## CI/CD

- **Trigger:** Push to main branch
- **Process:** SSH to server → git stash → git pull → npm install → pm2 restart
- **GitHub Secrets needed:** SERVER_IP, SERVER_USER, SERVER_SSH_KEY
- **Tests:** 22/22 passing (npm test)

---

## AGEX Security Layer

AGEX provides cryptographic identity for agents.

* packages/agex-core/. package.json references file:packages/agex-core so fixes survive npm install.

**Bugs fixed (commit db8bb70):**
1. keys.js — wrong import: @noble/ed25519 → @noble/curves/ed25519
2. keys.js — ed.getPublicKeySync() → ed.getPublicKey()
3. keys.js — ed.signAsync/verifyAsync → ed.sign/verify (sync)
4. ecdh.js — await in non-async function
5. ecdh.js — wrong SHA-256 scalar clamping → edwardsToMontgomeryPriv()

Bug report sent to QClaw/AGEX devs (same team).

---

## Dashboard Pages

| Page | Description | Key API |
|------|-------------|---------|
| Chat | Live Canvas chat with Charlie | POST /api/chat |
| Overview | Stats, costs, alerts | GET /api/stats |
| Channels | Telegram, dashboard config | GET /api/channels |
| Usage | Cost breakdown by channel | GET /api/costs |
| Agents | Spawn/manage agents | GET /api/agents |
| Skills | Charlie's loaded skills | GET /api/skills |
| Tools | MCP tools viewer | GET /api/tools |
| Scheduled | Heartbeat tasks | GET /api/scheduled |
|earch/remember | POST /api/memory/search |
| API Keys | Secrets management | GET /api/secrets |
| Config | Agent configuration | GET /api/config |
| Logs | Audit trail | GET /api/audit |

---

## n8n Workflows — Ads Agency

All workflows on: https://webhook.flowos.tech

| Workflow | ID | Webhook | Status |
|----------|----|---------|--------|
| Meta Ads Copy Agent | 0sIugM5o5wTwpflq | /webhook/meta-ads-copy-agent | Working |
| Meta Ads Creative Brief Agent | TtSUyKpvE5f9iQZg | /webhook/meta-ads-creative-brief | Working |
| Meta Ads Ad Creation Agent | lrGcirtmOHb1xTq8 | /webhook/ad-creation-agent | Fixed |
| Meta Ads Optimisation Agent | lf955LDteJ512RQi | Daily 9am + webhook | Working |
| Flow States Competitor Ad Research | QnCEES9T7WxW5vVR | /webhook/... | Untested |
| QClaw Router | n8n manual | /webhook/qclaw-router | Working |

### Ad Agency Supabase Tables ([SUPABASE_PROJECT_ID])
- copy_agent_output — stores copy variants with UTM URLs
- ad_creation_sessions — conversational ad creation state

# Structure
utm_source=meta&utm_medium=paid_social&utm_campaign=[offer-slug]&utm_content=[angle-slug]&utm_term=[creator]

### Offer Slugs
- free-community, claude-onboarding, manus-onboarding
- sustainable-blueprint, strategy-session, automate-to-elevate

---

## Ad Accounts

| Account | ID |
|---------|----|
| Flow States Retreats (all FSC ads) | act_464237024205104 |
| Emma Maidment Business | act_1426936257455201 |

### Facebook Pages
| Account | Page ID |
|---------|---------|
| Flow States Retreats | 2118187938198257 |
| Emma Maidment Business | 273319159777759 |

---

## Q2 2026 Strategy Context

**Primary CTA:** Join free community
https://fsc.app.clientclub.net/communities/groups/flow-states-collective/home?invite=69c559912f745e42c74153d6

**Lead Magnets:**
- Claude: https://claude.flowstatescollective.com
- Manus: https://manus.flowstatescollective.com
- Blueprint: https://go.flowstatescollective.com/the-sustainable-scaling-blueprint
- Strategy: https://go.flowstatescollective.com/strategy-sessions

**ICA:** Coaches and health professionals, solo operators, time-poor, non-technical
**Tone:** Calm, warm, authoritative — never urgent or pressure-based

---

## Roadmap

- [x] n8n router webhook
- [x] AGEX hub — crypto fixed, running under PM2
- [x] Dashboard sync with upstream (12 pages, 45 endpoints)
- [x] Manus webhook handler
- [x] Copy Agent — brand-aware + UTMs + Telegram working
- [x] Creative Brief Agent — brand-aware prompts
- [x] Ad Creation Agent — copy library + audience/targeting fixed
- [ ] Verify morning brief fires at 8am Athens time
- [ ] Test Ad Creation Agent end-to-end via Telegram
- [ ] Test Competitor Research Agent
- [ ] Connect Charlie skills to Ad Agency workflows
- [ ] Trading Room + Gym (Monte Carlo, Polymarket)
- [ ] Ads Agency dashboard room with agent characters
- [ ] Content Studio — Emma podcast "The Flow Lane with Emma Maidment"
- [ ] SproutCode continued development
- [ ] Wire Charlie memory to Cognee graph

---

## Common Commands
```bash
# Restart Charlie
ss restart quantumclaw"

# Restart AGEX hub
ssh qclaw "pm2 restart agex-hub"

# Check all processes
ssh qclaw "pm2 list"

# Check Cognee health
ssh qclaw "curl -s http://localhost:8000/health"

# Check Charlie health
ssh qclaw "curl -s http://localhost:4000/api/health --header 'Authorization: Bearer [DASHBOARD_AUTH_TOKEN]'"

# Deploy latest code
cd ~/QClaw && git push origin main

# View logs
ssh qclaw "pm2 logs quantumclaw --lines 50"
ssh qclaw "pm2 logs agex-hub --lines 20"

# Run tests
ssh qclaw "cd ~/QClaw && npm test"
```

---

## Key Contacts

- QClaw/AGEX devs — same team, in contact via Telegram. Bug report sent 26 Mar 2026.
- n8n API key — stored in ~/.quantumclaw/.env as N8N_API_KEY

---

## Session: 27 March 2026

### Completed This Session

**Morning Brief:**
- [x] Delivery queue consumer wired to Telegram channel (channels/manager.js)
- [x] Morning brief confirmed delivering to Telegram
- [x] Schedule corrected to 05:00 UTC = 08:00 Athens

**Ad Creation Agent (lrGcirtmOHb1xTq8):**
- [x] Full end-to-end test passed
- [x] Bug fix: campaign name "undefined" — added campaignName to Step: Objective Selected return object
- [x] Bug fix: no-adset-node fallback for undefined campaign name
- [x] Bug fix: copy agent pull uses parseInt(ctx.chatId)

**Competitor Research Agent (QnCEES9T7WxW5vVR):**
- [x] Model updated to claude-haiku-4-5-20251001, max_tokens 800
- [x] Truncation added at 3500 chars to fit Telegram limit
- [x] Tested via dashboard Scout button — working

**Charlie Routing:**
- [x] ads-agency.md skill updated with CRITICAL ROUTING RULES
- [x] Charlie calls ad-creation-agent webhook on "create ad"

**Ad Agency Dashboard Room:**
- [x] Agency page added (🎬 nav item)
- [x] 5 Pixar/DreamWorks 3D characters generated via Gemini:
  Rex (Strategist), Ledger (Media Buyer), Frame (Creative Dir),
  Penny (Copywriter), Scout (Researcher)
- [x] Characters at ~/QClaw/src/dashboard/agency-assets/
- [x] Dark cinematic office floor, colour-coded desk cards, trigger buttons
- [x] Modals for Scout, Penny, Frame — all calling correct webhooks
- [x] Ledger routes to Telegram, Rex shows Coming Soon

**Dashboard Fixes:**
- [x] Token persistence — saved to sessionStorage, no more Unauthorised errors
- [x] WebSocket timeout — Nginx proxy timeouts set to 3600s, fixes Offline badge

### Pending / Next Session

- [ ] Content Studio — Emma podcast "The Flow Lane with Emma Maidment"
  video → YouTube/Buzzsprout → social clips → email → blog
- [ ] Rex (Strategist) agent — not yet built
- [ ] Trading Room + Gym (Monte Carlo, Polymarket)
- [ ] Wire Charlie memory to Cognee graph
- [ ] SproutCode continued development

---

## Session: 1 April 2026 — Content Studio Phase 1

### Infrastructure
- Cloudflare R2 bucket: emma-content-studio
- R2 public URL: https://pub-70c436931e9e4611a135e7405c596611.r2.dev
- Supabase table: content_studio_jobs
- n8n credentials created: AssemblyAI, WordPress FSC, Buzzsprout, Supabase FSC, Anthropic

### n8n Workflow: Content Studio Pipeline (ID: Qf39NEOEgz2W0uls)
- 20 nodes, active at /webhook/content-studio-pipeline
- Webhook → Supabase job → Telegram notify → R2 URL → Buzzsprout → AssemblyAI → Extract highlights → Blog post → WordPress → Substack → LinkedIn → Update job → Telegram complete

### Dashboard — Content Studio Page
- New tab: microphone icon
- Drag-and-drop upload zone (MP4, MP3, WAV, M4A)
- server.js: POST /api/content-studio/upload (500MB limit)
- server.js: GET /api/content-studio/jobs
- Results Panel with 4 cards: Blog Post, Substack, LinkedIn, OpusClip Timestamps
- Job History table with View Results
- Nginx client_max_body_size 500M

### Services Integrated
- Cloudflare R2 (storage), Buzzsprout (podcast), AssemblyAI (transcription)
- Claude Sonnet (blog + substack + linkedin generation)
- WordPress REST API (draft posts), Telegram (notifications)

### Tested End-to-End
- Pipeline completed with real video upload (39.6MB MP4)
- Blog post draft created in WordPress
- All content cards loading in dashboard

### Pending — Phase 2
- YouTube OAuth (Emma Google account needed)
- LinkedIn direct posting via API
- Delete test Buzzsprout episodes and WordPress drafts
- Charlie skill: content-studio.md routing

### Key Technical Notes
- AssemblyAI: use speech_models (array) not speech_model
- Buzzsprout: audio_url must be publicly accessible
- n8n runs in Docker: use n8n credentials not host .env
- R2 upload must be server-side (credentials not exposed to browser)

---

## Session: 3 April 2026 — Content Studio Phase 2

### n8n Workflow Updates (Qf39NEOEgz2W0uls) — now 22 nodes
- Select Clip Segments node added (claude-haiku-4-5-20251001, analyses transcript, returns 5-8 clip segments as JSON)
- Parse Clip Selections node added (extracts JSON array, merges with highlight timestamps)
- Backlinks added to Blog Post prompt (Buzzsprout, LinkedIn, Substack)
- Backlinks added to Substack prompt (Buzzsprout, WordPress, LinkedIn)
- Backlinks added to LinkedIn prompt (Buzzsprout)
- clip_selections saved to Supabase job record

### Dashboard Updates
- Episode Images section: Hero image (1200x628) + YouTube Thumbnail (1280x720) upload zones
- Image resize via sharp, uploads to R2 at episodes/[jobId]/[imageType].jpg
- Social Clips section: drop zone for MP4 clips, caption editor, platform selector, schedule picker, Schedule via GHL button
- server.js: POST /api/content-studio/upload-image
- server.js: POST /api/content-studio/schedule-clip

### Supabase
- social_clip_schedules table created
- Columns added: clip_selections (jsonb), hero_image_url, thumbnail_url

### Pending — Phase 3
- YouTube OAuth (Emma Google account)
- LinkedIn direct posting via API
- GHL Social Planner integration for scheduled clips
- Auto-clipper: FFmpeg worker for automated clip generation from transcript timestamps
- Delete test Buzzsprout episodes before Emma uses it

---

## Session: 4 April 2026 — Trading Room

### Infrastructure
- Monte Carlo worker: PM2 trading-worker, port 4001
- Python Flask: ~/QClaw/src/trading/monte_carlo.py
- yfinance for gold (GC=F) and BTC (BTC-USD) price data
- Macro factors: DXY (DX-Y.NYB) and 10Y treasury yield (^TNX)
- 10,000 GBM simulations, 95% confidence interval
- Polymarket CLOB client: ~/QClaw/src/trading/execute_trade.py

### n8n Workflows (all active)
- Trading - Market Scanner (3YahxqOguET3pifj) — every 30 mins
  - Simulates gold (k target) + BTC (k target, 90 days)
  - Fetches Polymarket markets (100 markets, offset 500)
  - Compares sim probability vs market odds, flags edge >25%
  - Saves to trading_simulations, Telegram scan summary
- Trading - Trade Executor (fq7spfyiNcpt8Mf7) — webhook /webhook/trading-execute
  - Validates trading_config (trading_enabled, daily loss limit)
  - Executes via port 4000 API, saves to trading_positions
- Trading - Position Monitor (UYA0JppH7eqyI7fQ) — every 15 mins
- Trading - Weekly Analyst (vjj2uBIPc07FpIxx) — Monday 9am

### Dashboard — Trading Room Page (🎰)
- Live simulations table (auto-refresh 60s)
- Live positions table 
- Config panel: trading toggle, max position, min edge, daily loss limit
- Run Simulation panel: asset selector, target price, horizon input

### Supabase Tables
- trading_simulations, trading_positions, trading_config, 
  trading_analyst_reports, trading_markets

### Key Settings (trading_config)
- trading_enabled: false (manual activation required)
- max_position_usdc: 25
- min_edge_threshold: 25
- daily_loss_limit: 50

### Polymarket Setup
- Account: .94 USDC deposited
- Private key and funder address stored in ~/.quantumclaw/.env on ssh qclaw
- py-clob-client installed

### Key Technical Notes
- Polymarket Gamma API requires User-Agent header or returns 403
- BTC k markets live at offset 500 in Gamma API
- No gold/XAU price markets currently on Polymarket
- n8n merge node v2.1 with append mode works; waitForAll with 3 inputs does not
- All Supabase nodes use Supabase FSC credential (never hardcode keys)
- Analyse Edge output[0] fans out to both Save Simulations and Notify Edge

### Pending
- Charlie trading.md skill file for conversational trading control
- News sentiment overlay for macro adjustment
- Oil as third asset when Polymarket markets appear
- First live trade once edge >25% is detected

## Session: 4 April 2026 — Trading Room (continued)

### Dashboard additions
- USDC Balance widget (shows Polymarket position value via data-api.polymarket.com/value)
- Realised PnL widget (from trading_positions table)
- Open Positions count widget
- All auto-refresh every 60 seconds
- Config values updated: max_position=, min_edge=30%, daily_loss=

### Technical notes
- Polymarket .94 balance sits in CTF exchange proxy contract, not funder wallet
- py-clob-client get_balance() returns CLOB collateral balance (0 until trade placed)
- data-api.polymarket.com/value returns position value only, not uninvested cash
- Balance widget will populate once first position is opened

### Status
- Trading system fully operational, trading_enabled=false
- Scanner running every 30 mins, Telegram scan summaries active
- No edge detected yet — BTC k markets exist, gold markets absent from Polymarket
- Ready for first trade when edge >30% is detected
