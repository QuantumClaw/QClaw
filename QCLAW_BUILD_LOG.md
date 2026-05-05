# QClaw Build Log & Technical Handoff

**Project:** QClaw — Self-hosted Claude agent runtime (Fork of QuantumClaw/QClaw)
**Owner:** Tyson Venables / Flow OS
**Last updated:** 21 April 2026
**Repo:** https://github.com/tysonven/QClaw

---

## Build Log Rules

- **NEVER commit literal tokens, API keys, passwords, or secrets to the build log.**
- Reference them as `<stored in ~/.quantumclaw/.env>` or `<rotated — see secrets store>`.
- If a token accidentally lands in a commit, rotate it immediately even if the repo is private — history is durable and hard to scrub.

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
- [ ] **n8n env consolidation (prerequisite for new client intakes)**: switch n8n docker-compose to load env_file from ~/.quantumclaw/.env on the n8n host, then refactor hardcoded IDs in workflows (intake-kylie-content-system, GHL Changelog Emails, others) to reference env vars. Single source of truth across qclaw and n8n containers.
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

---

## Session: 4 April 2026 — Security Hardening Sprint

### Audit Findings
Full security audit completed. 2 critical, 4 high, 3 medium issues identified and addressed.

### Completed
- Webhook auth: Trade Executor now requires x-trading-secret header (secret in .env)
- Telegram bot token: removed from all workflow JSON, stored in n8n docker .env as TELEGRAM_BOT_TOKEN
- Supabase anon key: migrated from hardcoded headers to Supabase FSC credential in all workflows (Competitor Research, Ad Creation, Copy Agent, Content Studio, Trading)
- Rate limiting: express-rate-limit on /api/trading/simulate (10/min), /api/trading/execute (5/min), /api/content-studio/upload (5/min), /api/content-studio/upload-image (10/min)
- Root SSH disabled on qclaw: flowos user created, SSH key copied, PermitRootLogin no, ssh service restarted
- .env permissions: chmod 600 ~/.quantumclaw/.env, chmod 700 ~/.quantumclaw/
- 7 Pillars architecture framework: written to src/agents/skills/architecture-pillars.md
- Security skill file: written to src/agents/skills/security.md

### SSH Config Change
- qclaw now connects as flowos (not root)
- Use sudo for PM2, nginx, and system commands
- Root login blocked: ssh root@138.68.138.214 returns Permission denied

### Pending Security Items
- Root SSH on n8n server (157.230.216.158) — same process, next session
- Dashboard static token — implement proper session auth
- Credentials rotation schedule — quarterly
- Older pre-March workflows not fully audited

### 7 Pillars Framework
Now enforced in:
- Claude project instructions (all future conversations)
- Memory (cross-chat enforcement)
- ~/QClaw/src/agents/skills/architecture-pillars.md (Charlie + Claude Code)

## Session: 6 April 2026 — Scanner Redesign + Charlie Tools

### Trading Room — Scanner Redesign
- Dynamic price-based targets replace static $5k gold / $150k BTC
- Gold short: current +1% / 14d, Gold medium: current +2.5% / 30d
- BTC short: current +5% / 14d, BTC medium: current +10% / 30d
- fetch() errors fixed — replaced with HTTP Request nodes
- Smart schedule: weekdays every 2h, weekends every 4h
- Silent notifications: Telegram only fires on edge >30% + $50k volume
- Weekend-aware: skips gold sims on Sat/Sun
- created_at column added to trading_positions (backfilled from opened_at)

### Charlie — Tools Now Working
- trading-api.md: 4 tools (get_simulations, get_positions, get_config, create_simulate)
- n8n-api.md: 2 tools (get_workflows, get_executions)
- All 6 tools registered and confirmed working via executeSkillTool
- charlie-cto.md updated with proactive tool usage rules
- Total: 11 skills loaded

### Security / Infrastructure
- TELEGRAM_BOT_TOKEN + SUPABASE_ANON_KEY added to n8n Docker .env
- Position Monitor: order=opened_at.desc fixed, Supabase FSC credential
- CI/CD deploy updated to use flowos user + sudo paths
- flowos user NOPASSWD sudo confirmed working

### Pending
- n8n server (157.230.216.158) root SSH still enabled — next session
- Dashboard static token — implement proper session auth
- Charlie content-studio.md skill file
- YouTube OAuth for Content Studio
- Instagram Reels workflow Google Sheets 403 — separate chat

---

## Session: Apr 6, 2026 — Content Studio Phase 2 Completion

### What Was Completed

**Content Studio Pipeline (Qf39NEOEgz2W0uls) — PRODUCTION READY**

Full end-to-end pipeline tested and confirmed working across all 30 nodes.

**Fixes applied this session:**
- Wait nodes: 5s before Substack, 3s before LinkedIn (rate limiting)
- Model: Substack + LinkedIn on Haiku, Blog stays on Sonnet
- Convert to HTML code node added between Blog Post and WordPress
- All three prompts: first person as Emma Maidment, no em dashes, no hashtags
- LinkedIn: Get LinkedIn Profile node removed; author hardcoded as urn:li:member:194094731
- LinkedIn posting via Blotato (avoids n8n JSON parser issues with dotted keys)
- YouTube Upload: inputDataFieldName fixed to data

**Verified pipeline outputs:**
- Buzzsprout upload, AssemblyAI transcription, Haiku clip selection
- WordPress HTML draft, Substack draft, LinkedIn post via Blotato
- YouTube unlisted upload, Supabase job record, Telegram start+complete notifications

### Pending Next Session
- Clean up test Buzzsprout episodes + WordPress drafts (post IDs 627-655)
- n8n server root SSH disable (157.230.216.158)
- Dashboard static token → session auth
- Charlie skill files: content-studio.md, trading.md
- YouTube auto-publish or Emma publishes manually

### Key Config
- Emma LinkedIn member ID: 194094731
- Emma YouTube channel: UCvUdyddTC_Njz52NNotKQWw
- Blotato API key: BLOTATO_API_KEY in ~/.quantumclaw/.env
- Content Studio workflow: Qf39NEOEgz2W0uls

---

## Session: Apr 7, 2026 — Weekly Analyst Fix + Oil Trading Room

### Weekly Analyst (vjj2uBIPc07FpIxx) — FIXED
- Supabase nodes: switched from hardcoded anon key to Supabase FSC
  credential (Nd2uuX5t9KEwbQPv) with apikey header
- Fetch Week Trades URL: fixed expression syntax (= prefix, single braces)
- Claude Analysis: switched to Anthropic API 2 credential (eXhIwRbh7FBgb6O3)
- Confirmed working: runs clean, handles empty trade set correctly

### Charlie Skill Files — ADDED
- src/agents/skills/content-studio.md: pipeline overview, webhook trigger,
  job status queries, content rules, safety rules
- src/agents/skills/trading.md: system architecture, config, API endpoints,
  wallet info, Supabase tables, safety rules, weekly analyst
- Committed a53f4e9, pushed to main

### Trading Room — Oil Futures Added
- Monte Carlo worker: added WTI (CL=F) and Brent (BZ=F) tickers
- Market Scanner (3YahxqOguET3pifj): 
  - Smart Schedule: hourly Mondays (weekend news volatility), 2h Tue-Fri, 4h weekends
  - Added Get WTI Price + Get Brent Price nodes
  - Chained merges: Gold+BTC → +WTI → +Brent (avoids n8n 4-input merge bug)
  - Calculate Targets: WTI/Brent short +3% / medium +8%
  - Analyse Edge: oil market matching, weekends skipped, Monday edge
    threshold lowered to 20% (vs 30% normal)
  - Notify Edge: all four asset prices in Telegram summary
- Test run confirmed: Gold 701, BTC 9134, WTI 11.66, Brent 08.11
  — 100 markets scanned, pipeline runs end-to-end

### Dashboard — Session Auth (ec3aad0)
- Login page at /login: minimal white form, matches flowos.tech aesthetic
- POST /api/auth/login: validates token, issues httpOnly JWT cookie (24h expiry,
  secure, sameSite=strict), redirects to /
- GET /api/auth/logout: clears cookie, redirects to /login
- Auth middleware priority: JWT cookie → Bearer header → ?token= query param
- Browser requests without auth → redirect to /login
- API requests without auth → 401 JSON
- Logout button added to dashboard topbar (ui.html)
- Bug fix: GET /api/config was mutating live config.dashboard.authToken to '***'
  via shallow spread — destroyed token in memory after first read. Fixed with
  deep copy of dashboard sub-object.
- New deps: jsonwebtoken, cookie-parser
- New env: DASHBOARD_SESSION_SECRET (32-byte hex, stored in ~/.quantumclaw/.env)
- PR to upstream: QuantumClaw/QClaw#6

### Pending
- n8n server root SSH disable (157.230.216.158)
- YouTube auto-publish option for Emma

---

## Session: Apr 7, 2026 — Clipper Microservice + Pipeline Completion

### Clipper Microservice — BUILT & PRODUCTION READY
- FastAPI service, port 4002, PM2: clipper-worker
- Source: /root/QClaw/src/clipper/main.py
- Supabase table: clip_jobs (id, status, video_url, transcript, clips, caption_style, etc.)
- Pipeline: Claude Haiku segment selection → FFmpeg cut → 9:16 vertical crop
  → SRT captions burned (word-by-word, Montserrat Bold, gold highlights, lower third)
  → R2 upload → Supabase job record
- Memory fix: -threads 1 -preset ultrafast, ffprobe duration guard (was OOM-killing at 681MB)
- Caption style: accepts dict or JSON string (fixed 422 error from n8n)
- Clip output: clips/{job_id}/clip_{n}.mp4 on R2
- Charlie skill file: src/agents/skills/clipper.md

### Content Studio Pipeline — FULLY PRODUCTION READY
- Clipper wired in parallel with blog post branch
- Merge Before Notify node: waits for both YouTube upload AND clips before firing Telegram
- Telegram notification now includes all 5 clip URLs
- AssemblyAI word_boost added: Maidment, Emma Maidment, Flowlane, Flow Lane
- Save Clip URLs: PATCHes clip_job_id + clip_selections into content_studio_jobs
- Supabase: clip_job_id column added to content_studio_jobs

### Dashboard Session Auth — SHIPPED
- /login page, JWT httpOnly cookie (24h), /logout endpoint
- Auth middleware: cookie → Bearer → ?token= priority chain
- Bug fix: /api/config shallow spread was destroying authToken in memory
- PR #6 opened upstream to QuantumClaw/QClaw

### Pending
- Blotato subscription renewal (LinkedIn posting disabled until paid)
- n8n server root SSH disable (157.230.216.158) — tonight
- YouTube auto-publish option for Emma
- Clipper Phase 2: face detection for rule-of-thirds reframing
- Clipper productisation: own domain, API key auth, Stripe

---

## Session: Apr 8, 2026 — Charlie Orchestration Loop

### Charlie Task Queue — BUILT & LIVE
- Supabase table: charlie_tasks (id, status, type, title, instructions,
  assigned_to, priority, result, error_message, parent_task_id, metadata)
- n8n workflow: Charlie - Task Handler (a88zSrQfEy79v3oc)
  - Webhook: POST /webhook/charlie-tasks
  - Commands: /task, /tasks, /done, /run
  - /done supports: exact UUID, ID prefix, partial title match
- Skill file: src/agents/skills/task-queue.md
- Skill file: src/agents/skills/build.md

### Claude Code CLI Integration — LIVE
- Claude Code CLI installed globally on qclaw (v2.1.96)
- run-task.sh: fetches task from Supabase, marks in_progress, 
  runs Claude Code, saves result, marks completed/failed
- charlie-watcher: PM2 process polling every 5s for queued tasks
- Architecture: Telegram → n8n → queued → charlie-watcher → 
  Claude Code → Supabase → Telegram

### First Real Task Completed by Charlie
- Task: Add swap space to qclaw droplet
- Result: 2GB swap added, persisted in /etc/fstab
- Before: 0 swap | After: 2GB swap active
- Clipper OOM risk eliminated

### Pending
- n8n server root SSH disable (needs DO console fix or password reset)
- YouTube auto-publish option for Emma
- Clipper Phase 2: face detection / rule of thirds
- Charlie sub-task spawning (parent_task_id support in run-task.sh)

---

## Session: Apr 8, 2026 (evening) — Telegram Token Rotation + n8n Recovery

### Security: Telegram Bot Token Rotated
- GitGuardian alert received — old token revoked in BotFather
- New token updated in /home/n8nadmin/n8n-project/.env on n8n server
- Confirmed: no token value was ever committed to git repo
- Added .env* to .gitignore to prevent future variants being committed

### n8n Recovery
- Charlie Task Handler lost during docker restart (NODE_FUNCTION_ALLOW_BUILTIN
  change required container recreate)
- Recreated: Charlie - Task Handler now at workflow ID dHoqL8Ph8kmFHwyx
- n8n owner account reset and reconfigured (password reset via n8n CLI)
- All workflows, credentials, and execution history preserved

### Workflow Backups Added
- All 6 QClaw workflows exported to /root/QClaw/n8n-workflows/
- Committed 3601424, pushed to main
- Update these exports after every workflow change

### Infrastructure Hardening
- Added postgres healthcheck to docker-compose.yml
- n8n now waits for postgres condition: service_healthy before starting
- Prevents workflow loss on future restarts

### Updated Workflow IDs
- Charlie - Task Handler: dHoqL8Ph8kmFHwyx (was a88zSrQfEy79v3oc)

## Session: Apr 9, 2026 — QA Agent Team + Stability Fixes

### Superpowers + claude-mem installed on qclaw
- Claude Code v2.1.96 now has Superpowers 5.0.7 and claude-mem 12.1.0
- Available for all tasks run via run-task.sh

### QA Agent System — LIVE
- qa-runner.sh: reviews completed tasks against 5-point checklist
- charlie-watcher updated to trigger QA async after task completion
- qa_status + qa_result + qa_completed_at columns added to charlie_tasks
- skill file: src/agents/skills/qa.md
- Tested end-to-end: task completed, QA passed, Telegram notified

### Task Watcher Resilience Fix
- Watcher now polls for status in (queued, pending) where assigned_to = claude-code
- Removes n8n as single point of failure for task execution
- Direct Supabase task inserts now flow through without n8n involvement

### PM2 Startup Persistence Fixed
- systemd service pm2-root.service created and enabled
- All 5 processes survive reboots: quantumclaw, trading-worker,
  clipper-worker, charlie-watcher, agex-hub

### Telegram Token Rotated + n8n Recovery (Apr 8 evening)
- See previous build log entry

---

## Session: Apr 9, 2026 (continued) — Clipper Phase 2

### Clipper Phase 2 — Face Detection + Platform-Safe Captions
- opencv-python-headless 4.13.0 installed
- OpenCV DNN face detector: deploy.prototxt (committed),
  caffemodel (gitignored, README install instructions added)
- detect_face_position(): samples 1fps max 10 frames, >50% confidence
- get_smart_crop_filter(): face-centered 9:16 crop, center fallback
- Platform-safe caption margins: MarginV=180, MarginL=40, MarginR=40
  (clears Instagram Reels + TikTok UI buttons)
- Montserrat Bold system font confirmed available
- Tested: fallback path confirmed on title card, face detection will
  activate on talking-head footage
- Committed f89cf1e, pushed to main

---

## Session: Apr 11, 2026 — Crete Marketing Dashboard Tab

### Crete Marketing — Content Review Queue
- New Supabase table `crete_content_queue` (schema in
  crete-qclaw-dashboard-spec.md): pending_review / approved /
  rejected / published / failed. RLS enabled, permissive policy
  matching existing QClaw tables (auth boundary is dashboard JWT).
- Six new Express routes under `/api/crete/content` added inline
  in src/dashboard/server.js `_setupAPI()`:
    GET    /api/crete/content           list with status filter + pagination
    GET    /api/crete/content/:id       single item
    POST   /api/crete/content           insert (fires Telegram notify)
    PUT    /api/crete/content/:id       edit title/body/cta/etc.
    PUT    /api/crete/content/:id/approve   → fires publish webhook
    PUT    /api/crete/content/:id/reject    → fires regenerate webhook
    POST   /api/crete/content/regenerate/:id
- Supabase URL + anon key read from /root/.quantumclaw/.env at
  server boot (no hardcoded creds). UUID regex validation on all
  :id params, status allowlist, limit/offset clamping, field
  allowlist on PATCH, notes truncated to 2000 chars.
- All routes inherit the existing global auth middleware (JWT
  cookie / Bearer / ?token=). Confirmed 401 on unauth request.
- New "Crete Marketing" tab in src/dashboard/ui.html (nav-item
  🌿, page id `page-crete`). Filter pills, card grid, inline
  edit, approve/reject/regenerate, prompt-based reject notes.
  Brand palette: olive #5B6F3C, sand #D4C5A9, cream #FAF8F4,
  charcoal #2D2D2D. All DB content HTML-escaped client-side.
- Telegram notification on new pending_review insert via
  qclaw.channels telegram channel (same pattern as
  webhook-manus.js). Non-blocking — failures logged, not raised.
- n8n webhooks `crete-content-publish` and `crete-content-regenerate`
  fired async fire-and-forget. Workflows do not exist yet — 404s
  on test runs are expected and only log.warn.
- Backups before edit: server.js.bak + ui.html.bak in
  /root/QClaw/src/dashboard/.
- pm2 restart quantumclaw — clean boot, Dashboard ready at
  http://localhost:4000.

### Smoke test (end-to-end, Apr 11 06:51 UTC)
- POST insert → UUID dbbb054d-... returned, Telegram fired
- GET ?status=pending_review → count 1
- GET /:id → row matches
- PUT /:id/approve → status=approved, reviewed_at set,
  publish webhook fired (404 expected)
- 2nd insert → PUT /:id/reject with notes → status=rejected,
  reviewer_notes saved, regenerate webhook fired (404 expected)
- Invalid UUID → 400
- No auth → 401
- Final counts: 0 pending, 1 approved, 1 rejected

### Outstanding (next session)
- [ ] n8n workflow: crete-content-publish (reads approved row,
      posts to platform API, updates status→published)
- [ ] n8n workflow: crete-content-regenerate (re-runs Claude
      with original prompt + reviewer notes, updates row,
      resets status→pending_review)
- [ ] n8n workflow: crete-content-generate cron (reads R2
      content-calendar.json, generates upcoming content,
      inserts to crete_content_queue)
- [ ] R2: upload initial crete-projects/content-calendar.json
- [ ] Manual cleanup of the 2 smoke-test rows when convenient
- [ ] (optional) Replace hardcoded anon keys in content-studio/
      trading routes with the same env-loading pattern used here

### Security gate (7 Pillars)
- Credentials: no hardcoded secrets; env-loaded at boot ✓
- Input validation: UUID regex, status allowlist, field
  allowlist, limit/offset clamping, notes truncation ✓
- Auth: global JWT middleware gates all new routes ✓
- XSS: creteEsc() on all DB fields rendered in HTML ✓
- Injection: PostgREST only, no SQL concat, UUIDs pre-validated ✓
- RLS: enabled on table, policy matches existing tables ✓
- Error handling: try/catch on every route, external-system
  failures swallowed with log.warn ✓


---

## 2026-04-13 — GHL Marketing Automation
- Added ghl-marketing.md skill file to /src/agents/skills/
- Created Supabase table: marketing_drafts (with RLS)
- Built 4 n8n workflows: Content Generator, Approval Handler, Publisher, Weekly Report
- Distribution: Telegram approval flow, copy-paste-ready posts per platform
- Cadence: Mon/Wed/Fri organic posts (pain-led/value-led/offer-led), weekly report Sunday 20:00 UTC
- Content Generator: Claude Sonnet, rotates hooks to avoid repetition
- Approval Handler: Telegram reply "go" approves, any other reply triggers regeneration with feedback
- Publisher: Webhook-triggered, updates Supabase status to published, sends formatted posts to Telegram
- Weekly Report: Claude Haiku summarises drafts generated/approved/rejected/published
- GHL Social Planner API: deferred (copy-paste via Telegram until OAuth confirmed)
- Security gate: PASSED (no hardcoded keys, RLS enabled, chat ID filter, credentials via n8n creds/env)
- All workflow JSONs backed up to /root/QClaw/n8n-workflows/
- No existing workflows, files, or processes were modified

### Trading Market Scanner Redesign (Apr 14)
- Flipped Polymarket matching logic: now fetches 600 markets from
  Gamma API (3 pages x 200), identifies asset type + target price
  from question text, runs Monte Carlo against each markets own
  resolution criteria
- Removed 7 nodes (price fetchers, old merges, old sims, old targets).
  Flow: Schedule > 3xFetch > Merge > Analyse Edge (parse markets) >
  Run Market Simulations (per-market) > Calculate Edge > Save/Notify
- Sports false-positive exclusion (Golden Knights, Warriors, Oilers etc.)
- Price regex handles 150k, 1m, 1b suffixes
- Horizon cap widened to 180 days (Polymarket crypto markets run 80+ days)
- Volume threshold lowered to 10k for calibration
- Edge threshold: 20% (15% on Mondays)
- First successful run found 1 BTC market: Will bitcoin hit 1m before
  GTA VI - sim 0.02% vs market 48.85%, edge -48.8% (market is massively
  overpriced for YES). Would signal a NO bet if that feature existed.
- Note: Only 3 crypto price markets exist across 1800 Polymarket markets
  currently. Zero gold/oil commodity price markets on the platform.
  Scanner will pick up new markets as they appear.

---

## Session: Apr 14, 2026 — Trading Room Fixes + Kalshi + Ops

### Monte Carlo dt Bug Fixed
- Changed dt = 1.0 / TRADING_DAYS_YEAR to dt = 1.0
- mu/sigma are daily parameters so dt must be 1.0 day per step
- Gold probability for realistic targets now 60-85% (was 5-12%)
- Committed 19a2791

### Polymarket Matching Logic Redesigned
- Flipped from "generate target, find market" to "find market, simulate against it"
- Fetches 600 Polymarket markets across 3 pages
- Parses each market's resolution criteria (price + end date)
- Runs Monte Carlo against those specific criteria
- Volume threshold lowered to $10k, edge threshold 20% (was 30%)
- Sports/entertainment exclusion regex added
- Committed bf96118

### Kalshi Integration Added
- Added Kalshi as second market source (api.elections.kalshi.com)
- Fetches 1,000 open markets, normalizes to Polymarket format
- Total markets scanned per run: ~1,600 across both platforms
- Source tracking added to edge notifications
- Finding: Kalshi currently has no commodity/crypto price markets
  (all sports + politics). Infrastructure ready for when they return.

### Instagram Reels — Fixed Schedule
- Changed from rolling every 5 hours to fixed times
- Now posts at 21:00, 02:00, 07:00, 11:00 UTC (7am/12pm/5pm/9pm AEST)
- Committed 9623509

### Charlie Fixes
- Fixed env path fallback in run-task.sh, qa-runner.sh, task-watcher.sh
- Fixed hardcoded dead Telegram token — all scripts now read from .env
- Fixed flowos user permissions via symlink to /root/.quantumclaw/.env
- Updated trading.md skill: n8n via MCP not localhost, all 10 workflow IDs
- Committed ff3da75, 9623509

### R2 Large File Upload
- Added upload-to-r2.sh and receive-and-upload.sh scripts
- Supports files over 300MB (Cloudflare browser UI limit) via S3 API
- First real episode (1.87GB) uploaded via SCP + script
- TODO: Fix dashboard R2 uploader to support multipart for large files
- Committed 0cc12c7

### Pending
- Dashboard R2 uploader multipart fix (files >100MB)
- receive-and-upload.sh r2FileKey variable bug (prints empty in curl command)
- Trading room: monitor for new gold/oil markets on Polymarket/Kalshi
- n8n root SSH disable (parked)

---

## Session: Apr 16, 2026 — Bug fixes + upstream sync

### spawn_agent fixed (commit 5b12cee)
- Root cause: handler registered as raw async function, not {fn, description, inputSchema}
- Fixed: both spawn_agent and search_knowledge wrapped correctly
- Charlie can now delegate to Claude Code directly

### Flow OS ad account added
- act_414785961683125 added to Meta Ads Optimisation Agent (lf955LDteJ512RQi)
- Copy Agent and Creative Brief Agent have no hardcoded accounts (dynamic from webhook)

### Playwright MCP installed
- claude mcp add playwright npx @playwright/mcp@latest
- Available for Claude Code browser automation and QA testing

### Upstream sync (cherry-pick from QuantumClaw/QClaw)
- c99dafb: CLEAN - fix: dashboard rate limiter lockout behind Nginx
- c5a29d7: SKIPPED (conflict) - web_search + process + message tools
- f4e3088: SKIPPED (conflict) - fix WSS EADDRINUSE crash
- 510c409: SKIPPED (conflict) - fix EADDRINUSE, MCP workspace placeholder
- 3be8d0b: SKIPPED (conflict) - fix security module imports
- eeb8d14: SKIPPED (conflict) - skill tool HTTP execution engine
- bb717d4: SKIPPED (conflict) - agent & team performance metrics
- bcdb1a5: SKIPPED (conflict) - native multi-agent spawning
- 7/8 conflicted due to diverged codebase. Only rate limiter fix applied.
  Full upstream merge requires dedicated session to resolve conflicts.

### Higgsfield skills noted in build.md roadmap
- 15 Seedance 2.0 video skills for future integration

### Content Studio fixes (Apr 14-15)
- Fixed custom_spelling error in AssemblyAI node (two-word "to" field)
- Fixed LinkedIn post: plain text only, no markdown, Buzzsprout URL appended
### Instagram Image Generation System (Apr 17)
- Installed node-canvas with Cairo dependencies for server-side image rendering
- Created src/crete-marketing/generate-text-card.js: branded 1080x1080 PNG generator
  - Two styles: quote (centred italic serif text, decorative quotation marks) and editorial (headline + body, structured layout)
  - Brand palette: cream background (#F5F0EB), olive green accents, Cormorant Garamond + DM Sans + Montserrat
  - Olive branch decorative elements, gold dividers, CRETE PROJECTS footer
- Added POST /api/crete/generate-image endpoint to dashboard server
  - Validates style + required fields, generates PNG in memory, uploads to R2
  - Returns public R2 URL at crete-projects/images/{uuid}.png
  - Rate-limited (10/min), protected by existing auth middleware
- Curated 22-photo stock library from Unsplash (all free for commercial use)
  - 8 agriculture/land, 6 village/stone buildings, 4 wellness, 4 Crete landscape
  - Centre-cropped to 1080x1080, uploaded to R2 at crete-projects/photos/{theme}/
  - Library index at crete-projects/photos/library.json
- Security: no hardcoded credentials, input sanitised, R2 creds from env, auth required

---

## Session: Apr 17, 2026 — Trading Scanner Fixes

### Kalshi Parse Fix
- Root cause: Kalshi v2 API returns yes_bid in cents not dollars
- Fix: changed yes_bid_dollars to yes_bid / 100
- Result: 1,000 Kalshi markets now output correctly (was 1)
- Total markets scanned per run: ~1,600 (600 Polymarket + 1,000 Kalshi)

### NO Edge / Market Intelligence Tracking
- Added noEdge detection: markets where yes_price > 20% but 
  our sim is <30% of market price (overpriced markets)
- Has Edge? now triggers on highEdge OR noEdge
- Notify Edge sends market intelligence message when no YES edge
  but overpriced markets detected
- First detection: BTC "Will bitcoin hit $1m before GTA VI?" 
  (market YES=49%, our sim=0%) — significant NO edge

### Current Market Status
- Zero tradeable YES edge opportunities on Polymarket or Kalshi
- Only 1 matched market total: BTC $1M (overpriced)
- Infrastructure ready — will auto-trigger when commodity/crypto 
  price markets appear


---

## Session: Apr 11-17, 2026 -- Crete Projects Marketing Automation

### Crete Marketing Dashboard Tab (Apr 11)
- New "Crete Marketing" tab added to QClaw dashboard (ui.html, server.js)
- 7 API routes under /api/crete/content (list, get, create, edit, approve, reject, regenerate)
- Supabase table: crete_content_queue (RLS enabled, 3 indexes)
- Filter pills (Pending Review, Approved, Published, Rejected, All)
- Inline edit, approve/reject with notes, card grid layout
- Telegram notification on new pending_review via qclaw.channels
- Brand palette: Olive #5B6F3C, Sand #D4C5A9, Charcoal #2D2D2D, Cream #FAF8F4
- Commits: 296b265, f9a05f8

### n8n Workflows -- Content Pipeline (Apr 11-13)
- Crete - Content Generator (tnvXFYvODL1PrhJa): daily 08:00 UTC cron, fetches R2 calendar, generates content via Claude API, inserts to Supabase
- Crete - Content Publish (zXKBjp3yjW2oR2Mj): webhook, routes by platform to Facebook Graph API, Instagram Graph API (two-step), LinkedIn via Blotato, updates status
- Crete - Content Regenerate (KKjw893zwzHwv1o6): webhook, appends reviewer notes to prompt, regenerates via Claude API, resets to pending_review
- Content calendar stored in R2 at crete-projects/content-calendar.json (v1.2)
- LinkedIn scheduled Tue/Thu only to avoid collision with Flow OS Mon/Wed/Fri posts

### Charlie Skill: crete-marketing (Apr 11)
- New skill file at src/agents/skills/crete-marketing.md
- Charlie can now check crete_content_queue for pending items and report status

### Brand Assets (Apr 16)
- CP monogram logo with olive branch (SVG + PNG on R2)
- Stacked wordmark "Crete / PROJECTS" (SVG + PNG on R2)
- Facebook banner "Land. Village. Wellness." (SVG + PNG on R2)
- Fonts: Cormorant Garamond + DM Sans installed on qclaw at /usr/share/fonts/truetype/custom/
- Assets on R2 at crete-projects/brand/

### Facebook & Instagram Pages (Apr 16)
- Facebook Page: Crete Projects (username: creteprojects.gr, Page ID: 1151574668028295)
- Instagram Business: @creteprojects (ID: 17841427777246522)
- Linked via Meta Business Suite
- Long-lived Page Access Token stored in n8n env (META_PAGE_ACCESS_TOKEN) and qclaw env

### Instagram Image Generation System (Apr 17)
- Text card generator: src/crete-marketing/generate-text-card.js (node-canvas, 1080x1080 branded PNGs)
- Two styles: quote (centred) and editorial (left-aligned headline + body)
- API endpoint: POST /api/crete/generate-image (auth-protected, rate-limited)
- Stock photo library: 22 Unsplash photos across 4 themes (agriculture, village, wellness, lifestyle)
- Photo library index: crete-projects/photos/library.json on R2
- Generated images stored at crete-projects/images/{uuid}.png on R2
- n8n Content Generator updated with Image Router, Generate Text Card, Merge Image URL nodes
- Dashboard updated to display images in content cards
- Commit: d31fc1a

### LinkedIn Auto-Publish via Blotato (Apr 17)
- Crete - Content Publish workflow updated with LinkedIn routing
- Uses Blotato account 11109 (Tyson Venables personal profile)
- Text-only LinkedIn posts, no image
- Tested end-to-end: Blotato submission confirmed

### GHL Email Sequences (Apr 11)
- 5-email EOI nurture sequence (Emails 3-7) built in GHL
- Trigger: tag eoi-pdf-sent, timing: Days 3, 7, 11, 16, 21
- From: hello@creteprojects.com
- Existing leads enrolled
- FB retarget audience workflow added by Tyson

### Supabase Schema Changes
- crete_content_queue table created (migration: create_crete_content_queue)
- Columns added: image_type, image_style, image_theme (migration: add_image_columns_to_crete_content_queue)

### Security Notes
- Meta Page Access Token stored in env only (n8n + qclaw), never hardcoded
- QCLAW_API_TOKEN for n8n to qclaw image API auth
- All new routes protected by existing dashboard JWT auth middleware
- XSS: creteEsc() applied to all user-controlled content in dashboard
- GitHub PAT in git remote URL flagged for rotation (not changed)

### Bug Fixes (Apr 22)
- Content Generator: stock photo selection now implemented (was previously stubbed as "future feature")
- Content Generator: Select Random Photo node reads row from Image Router, not Fetch Photo Library response
- Dashboard: approve handler checks scheduled_for date — future-dated approvals sit at "approved" without triggering publish
- New workflow: Crete - Scheduled Publisher (9kTWhh9PlxMpyMlp) — hourly cron picks up approved content when scheduled_for <= now
- Photo library themes aligned: agriculture/village/wellness/lifestyle (was Land Sourcing/Village Restoration/Health & Wellness/Crete General)

## Session: Apr 17, 2026 — Final cleanup

### Dashboard R2 Multipart Upload (commits 9b1e80f, 047f559)
- Files >50MB use chunked multipart upload via S3 API
- Files <=50MB use existing FormData upload
- Progress bar with percentage + part counter
- Chunks sent as raw binary (no base64 overhead)
- Endpoints: /api/upload/initiate, /api/upload/part, /api/upload/complete
- All auth-protected with rate limiting

### Dashboard Session Secret Fixed (047f559)
- Added dotenv loader at DashboardServer.start()
- DASHBOARD_SESSION_SECRET now persists across PM2 restarts
- tunnelUrl set to https://agentboardroom.flowos.tech in config.json

### All active backlog items cleared
- spawn_agent fixed (5b12cee)
- Flow OS ad account added (d490788)
- Playwright MCP installed (d490788)
- Kalshi parse fix — yes_bid/100 (cents not dollars)
- NO edge market intelligence tracking added
- receive-and-upload.sh r2FileKey quoting bug fixed (83b92a4)
- Morning Light WL checked — healthy, token fresh

### Pending
- Upstream full merge: bcdb1a5 (delegate_to), bb717d4 (metrics/leaderboard)
- n8n root SSH disable (parked — DO console broken)
- YouTube auto-publish (carparked — wait for Emma)

## Session: Apr 20, 2026 — Security Audit + Charlie Recovery

### Charlie Recovery
- Root cause: Anthropic credits exhausted Apr 18 — all LLM calls failing
- Added credits exhaustion handler in executor.js — 6h cooldown 
  Telegram notification instead of silent crash (cc7f37e)
- Added heartbeat.js graceful degradation for credits errors
- Fixed Charlie 401 on trading API — dashboard token updated in config
- GitHub PAT rotated and updated in git remote

### Vercel Security Audit (Vercel breach response)
- Reviewed all 12 Vercel projects
- gohighlevel_mcp: token rotated
- fit-quiz-results: new scoped GHL JWT created
- n8n-dashboard: n8n API key rotated to v2
- flowos-ai-va, venables-finances, codesprout, triple-a-tracker: no keys
- wellness-oauth: dormant, kept for reuse
- wellness-oauth-fresh: kept as reusable WL OAuth connector for future clients

### GHL Token Refresh Security Fix
- Found hardcoded client_id, client_secret in HighLevel OAuth 
  Token Refresh workflows
- Moved credentials to n8n env vars (HL_LOCATION1_CLIENT_ID/SECRET)
- Primary workflow (N3VF1VKlekDdhxGU): cleaned + left inactive (deprecated)
- Sister workflow (02Dob9FCEkXZFDAs): fixed + stays active
- Verified live execution — tokens refreshing correctly in Supabase

### Pending
- wellness-oauth-fresh: consider rebuilding as proper 
  Flow OS GHL OAuth connector (documented, multi-tenant)
- Upstream full merge: bcdb1a5 (delegate_to), bb717d4 (metrics)
- Social media automation for SproutCode, Flow OS, FSC (parked)

---

## Session: Apr 20, 2026 — Full Day Build

### Charlie Recovery (Anthropic credits exhaustion)
- Root cause: Anthropic credits exhausted Apr 18–20 — all LLM calls failing
- Added credits exhaustion handler in executor.js (commit cc7f37e)
  - 6-hour cooldown Telegram notification instead of silent crash
  - Tagged error code `ANTHROPIC_CREDITS_EXHAUSTED` for downstream handling
- Added heartbeat.js graceful degradation for credits errors
- Charlie restored after credits top-up

### Dashboard Trading API 401 Fix
- Dashboard auth token updated in Charlie config
- New token: `<rotated — stored in ~/.quantumclaw/.env>`

### GitHub PAT Rotated
- Previous PAT expired, blocking git push from qclaw
- New PAT rotated and updated in git remote URL
- Flagged for future: move from plaintext URL to SSH auth or credential helper

### Vercel Security Audit (Vercel breach response)
Reviewed all 12 Vercel projects after Vercel security incident notification:
- gohighlevel_mcp: token rotated
- fit-quiz-results: new scoped GHL JWT created (fit-quiz labeled)
- n8n-dashboard: n8n API key rotated to v2 query key
- flowos-ai-va, venables-finances, codesprout, triple-a-tracker: no API keys
- wellness-oauth: dormant, kept for reuse
- wellness-oauth-fresh: kept as reusable WL OAuth connector for future clients
- portfolio, crete-eoi, 1-ceo-dashboard: static/low risk

### GHL Token Refresh Credentials Hardened
- Found hardcoded client_id + client_secret in 2 n8n workflows
- Moved credentials to n8n env vars (HL_LOCATION1_CLIENT_ID/SECRET)
- Primary workflow (N3VF1VKlekDdhxGU): cleaned + left inactive (deprecated duplicate)
- Sister workflow (02Dob9FCEkXZFDAs): fixed + remains active
- Verified live execution — tokens refreshing correctly in Supabase

### Charlie n8n Diagnosis — Permanent Fix (commit db6bc9c)
Permanently solved Charlie's recurring "I don't have access to that workflow" issue:
- Replaced static hardcoded workflow registry with dynamic n8n API queries
- charlie-cto.md skill: added n8n Diagnostics section with live-query recipes
- trading.md: removed static workflow ID list
- New `/diagnose <workflow_id_or_name>` Telegram command
  - Charlie auto-queries n8n for any workflow, live
  - Claude Code executes the diagnosis and reports findings to Telegram
  - E2E verified with `44g7cbGz5osQ1pcBVhIoz` — found Instagram media_publish 500 issue
- Self-serve: new workflows automatically discoverable, no manual updates needed

### Instagram Reels Workflow Status
- Charlie's diagnosis flagged Instagram media_publish 500 on Apr 16 (transient)
- Real current issue: post 271 missing from R2 (now uploaded by Tyson)
- Workflow should resume on next scheduled cron run
- Retry/wait fix parked until next failure confirms it's needed

### Pending
- wellness-oauth-fresh: consider rebuilding as proper Flow OS GHL OAuth connector
  (documented, multi-tenant, safe for future clients)
- Upstream full merge: bcdb1a5 (delegate_to), bb717d4 (metrics/leaderboard)
- Social media automation for SproutCode, Flow OS, FSC
  (awaiting brand kits + content topics from Tyson)
- Enhance `/diagnose` to also check Slack #n8n-error for recent messages
  (would have caught R2 404 pattern faster)
- Move GitHub PAT from plaintext git remote URL to SSH auth

### Parked
- n8n root SSH disable (DO console broken, too risky)
- YouTube auto-publish (carparked — wait for Emma to test pipeline)

---

## Session: Apr 21, 2026 — Charlie Architecture Fix

### Split-Brain Skill Loading — RESOLVED (commit e47767d)
Diagnosed via /diagnose task path still working while interactive Charlie
path kept claiming "tools hardcoded to Market Scanner". Root cause was a
fundamental architecture split:
- Task queue path loads skills from git repo via symlinked charlie-cto.md
- Interactive path loads skills from /root/.quantumclaw/workspace/agents/charlie/skills/
  which had its own stale copies

### Skills Dir Fully Symlinked
- All 11 skill files now symlinked from workspace → /root/QClaw/src/agents/skills/
- Moved to repo + symlinked: ads-agency.md, agent-coordination.md,
  business-intelligence.md, ghl.md, n8n-router.md, qclaw-dev.md,
  stripe.md, trading-api.md
- content-studio.md existed in both, workspace version won (overwrote repo)
- n8n-api.md rewritten from scratch
- charlie-cto.md was already symlinked from yesterday
- Backup: /root/.quantumclaw/workspace/agents/charlie/skills.backup-1776770419
- End state: any git repo skill edit is instantly live in runtime

### n8n Tools Fully Parameterised
New tool surface (no workflow IDs baked into names):
- get_workflows (list all)
- get_workflows_id (get details by id)
- get_executions_id
- get_executions_workflowid_id
- get_executions_workflowid_id_status_id
Base URL: https://webhook.flowos.tech/api/v1 (was localhost:5678 — wrong host)

### Generic Skill Executor Bug Fixed
Found during restart testing — registry.js:1127 only substituted
{{secrets.*}} placeholders, appending all other args as query string.
Result: get_workflows_id with {id: "X"} hit /workflows/{{id}}?id=X (400 error).
Fix: added pass to substitute {{k}} → args[k] and track consumed args
to prevent double-append.

### spawn_agent Approval Gate Auto-approved (commit b537573)
Diagnosed: spawn_agent was dying after 10-minute silent timeouts.
Root cause was NOT the gated-tool list — it was the approval-gate
keyword scan tripping on role descriptions containing words like
'send', 'publish', 'post'. Every sub-agent spawn needing these
words expired without approval.

Fix: added autoApproveTools list in src/security/approval-gate.js,
seeded with spawn_agent. Short-circuits check() before the keyword
scan. Debug logging via log.debug for traceability.

Guardrails retained:
- Credential scoping (AGEX envelopes with 1h TTL)
- Audit log on every spawn
- Rate limits (api_calls 200/hour)
- Trust tier inheritance (sub-agents can't elevate past Tier 0)

### Interactive Test Confirmed
Telegram query: "What's the status of workflow 44g7cbGz5osQ1pcBVhIoz"
Charlie now uses dynamic tools, returns full node-by-node breakdown,
no more "I don't have access" responses. ~17s end-to-end for
sub-agent spawning tasks.

### Pending
- wellness-oauth-fresh: rebuild as proper Flow OS GHL OAuth connector
- Upstream full merge: bcdb1a5 (delegate_to), bb717d4 (metrics/leaderboard)
- Social media automation for SproutCode, Flow OS, FSC
- Enhance /diagnose to also check Slack #n8n-error channel
- Move GitHub PAT from plaintext git remote URL to SSH auth

## 2026-04-21 — GHL Marketing Automation System

### What was built
- Full marketing automation for GHL Support Specialist (support.flowos.tech/ghl/landing)
- Skill file: `ghl-marketing.md` deployed to `/root/QClaw/src/agents/skills/`
- Supabase table: `marketing_drafts` with RLS, publish tracking columns, partial index
- 4 n8n workflows:
  - Content Generator (Awo65rdSe5BvDHtC) — Mon/Wed/Fri 07:00 UTC, Claude Sonnet, auto-assigns branded template images
  - Approval Handler (ptHK2TZq5XppKOOg) — Telegram fallback + dashboard regenerate webhook
  - Publisher (fonuRTyqepxdyIdf) — Posts to Facebook (Flow OS page), Instagram (Flow OS IG), LinkedIn (Blotato/Tyson) with branded images
  - Scheduled Publisher (dHceOMijUOcnEowO) — 15-min cron, picks up approved drafts when scheduled_for <= now
  - Weekly Report (jRiiOsWneQAtfVPD) — Sunday 20:00 UTC performance summary
- Dashboard: GHL Marketing tab with Content Review Queue (Pending/Approved/Published/Rejected), Schedule/Post Now/Custom Time actions, template thumbnails
- 4 branded post templates uploaded to R2 (pain-led, value-led, offer-led, story) with auto-rotation by post type
- Calendar guardrails: max 1 post/day, LinkedIn 4-hour spacing, MWF auto-scheduling

### Landing page conversion fixes
- Hero headline/CTA updated (removed Flow OS branding for /ghl/landing route)
- Server-side meta tag rewrite for social crawlers (og:title, og:image, og:url, twitter tags)
- Added: trust bar, "How it works" section, FAQ accordion (6 questions), value comparison, Founders Offer pill in hero
- Cache-busting headers for /ghl/landing (Cloudflare-CDN-Cache-Control: no-store)

### Paid ads
- Meta Pixel verified (927054375981982): PageView, Lead, InitiateCheckout, Purchase
- 3 Canva ad creatives (primary feed, vertical story, retargeting)
- Campaign structure: Conversion + Retargeting + Awareness
- Custom audiences and automated rules created in Meta Ads Manager
- Facebook Sharing Debugger verified with correct OG tags

### Cleanup
- Removed all Manus references from codebase (-1263 LOC, 9 files deleted, 7 edited)
- Tightened CSP headers (removed manus.im, manus.computer from connect-src)
- Weekly admin digest notification migrated from Manus to Telegram

### Commits (ghl-support-bot repo, Railway auto-deploy)
- b9ece5c — GHL landing SEO copy + CTA
- 92fb14a — SSR meta rewrite (initial)
- 8c5225c — Conversion polish (trust bar, FAQ, how-it-works, value line)
- 4875606 — Manus cleanup
- 05ab3ef — SSR root cause fix (req.originalUrl) + cache headers
- 8889596 — GHL default image URL fix
- b747c36 — Publisher + scheduled posting + dashboard actions
- c6d56bf — Template images to R2 + image rotation in Content Generator

### Commits (QClaw repo)
- ghl-marketing.md skill file
- n8n workflow backups (4 files)
- Dashboard GHL Marketing tab (server.js + ui.html)

### Security gate: PASSED
- No hardcoded credentials
- Supabase RLS enabled
- Telegram handler restricted to Tyson's chat ID
- All API keys via n8n credentials or env files
- Webhook endpoints authenticated
- All workflow JSONs backed up

---

## Session: Apr 22, 2026 — Charlie Phase 1 Session 1 (execution tools)

### Problem solved
Charlie's interactive path had no execution tools — every "do X" request
ended with Charlie dumping shell commands for Tyson to paste. Pure
diagnostic agent, no action capability.

### shell_exec tool (src/tools/shell-exec.js)
- qclaw-local command execution (quantumclaw PM2 runs as root)
- Three safety tiers:
  1. DENY_PATTERNS — hard-block, no approval path. Covers cat of .env /
     .secrets / .ssh, pipe-to-shell (curl | sh), base64 exfil, source
     .env, eval, echo .env, any write into .quantumclaw secrets files.
  2. DESTRUCTIVE_PATTERNS — inline Telegram approval. Covers rm -rf,
     sudo, kill, pm2 stop/delete/kill, systemctl stop/disable/mask,
     chmod/chown on root paths, git force-push / hard-reset, docker
     compose down, dd if=, redirects and tee writing outside /tmp
     (both > and >>, including relative-path file creation).
  3. /root/.quantumclaw touches — require approval even for reads, so
     secrets-directory activity is surfaced.
- pm2 restart / reload are NOT gated (recovery ops).
- 60s default timeout, max 300s, SIGKILL on timeout.
- Audit log per call: command, exit code, duration_ms, approved_inline
  flag, stdout/stderr truncated to 500 chars.

### n8n_workflow_update tool (src/tools/n8n-workflow-update.js)
- Full GET → modify → PUT → re-activate cycle for
  webhook.flowos.tech/api/v1 workflows.
- Always requires inline approval (writes are high-risk).
- Strips n8n read-only fields before PUT (updatedAt, createdAt, id,
  shared, tags, versionId family, isArchived, meta, pinData,
  staticData, description, active).
- Preserves settings.availableInMCP so the MCP surface stays enabled.
- Re-activates the workflow if it was active before the edit.
- Accepts either `{ patch: {...} }` for shallow root merges or
  `{ node_updates: [{node_name, parameter_path, new_value}] }` for
  targeted edits. parameter_path supports dot + [N] notation.

### Inline Telegram approval (no poller conflict)
Telegram's single-consumer getUpdates rule meant the original spec
(parallel poller) would have collided with the existing grammy bot.
Redesign:
- ApprovalGate.requestInlineApproval() reuses the existing
  ExecApprovals promise system. ExecApprovals gained createPending()
  which returns {id, promise} synchronously so the id can be embedded
  in the Telegram prompt.
- index.js wires a notifier that DMs the owner chat at boot — the
  bot reference is resolved at call time via
  channels._channelsByName.get('telegram').bot so the notifier
  survives ChannelManager reinit.
- channels/manager.js got:
  - a new /deny command
  - an inline reply handler that recognises "✅ {id}", "❌ {id}",
    "approve {id}", "deny {id}", "yes {id}", "no {id}" from the
    owner chat
- ExecApprovals.approve()/deny() resolve the pending promise →
  shell_exec / n8n_workflow_update continue.
- 10-minute auto-deny still provided by ExecApprovals.
- Executor got a longRunning tool flag — tools with longRunning:true
  use an 11-minute ceiling instead of the default 30s TOOL_TIMEOUT so
  approval waits don't trip the tool-level timeout.

### Threat model note
shell_exec exposes root code execution to Charlie's LLM. Mitigations:
DENY_PATTERNS hard-block exfiltration vectors; DESTRUCTIVE_PATTERNS
require Telegram approval; /root/.quantumclaw touches require
approval; every call audit-logged with stdout/stderr truncation.
Blast radius is still larger than pre-Phase-1; accepted trade-off for
operational velocity.

### Anti-pattern documentation
charlie-cto.md gained an Execution Tools section with explicit
"NEVER tell Tyson to paste commands" guidance. SSH to the n8n server
is still unavailable — Phase 1 Session 2 will add ssh_exec; until
then any task needing n8n-server shell access is routed via the task
queue (`/diagnose`-style) rather than dumping SSH commands on Tyson.

### Verified this session
- Safe-path shell_exec: "pm2 status" — executes without approval,
  returns parsed table.
- DENY hard-block: "cat /root/.quantumclaw/.env | head -3" — refused
  outright with pattern_matched reason.
- Approval path: "ls /root/.quantumclaw/workspace/agents/charlie/skills/"
  — creates pending approval, Telegram notifier sends the prompt
  cleanly to the owner chat, Charlie waits for ✅ / ❌ reply. Final
  owner-tap still required to verify resolve-on-reply path end-to-end.

### Known follow-ups
- SSH ops (ssh_exec) — Phase 1 Session 2
- file_edit_remote — Phase 1 Session 2
- Consider surfacing pending approvals on the dashboard as well as
  Telegram (currently only CLI + Telegram).

---

## 2026-04-22 — Skill file path corrections + approval gate fix

Charlie flagged that skill files carried Mac-local paths (`~/QClaw`)
and BSD sed syntax (`sed -i ''`) that doesn't work on Linux. Also
identified that edit attempts were timing out at the approval gate.

### Diagnosis (approval gate)
Charlie's symlink-vs-realpath hypothesis was wrong — `approval-gate.js`
had no `/root/.quantumclaw` path check at all, so no path-normalization
fix applied. The actual block came from two places:
- **Generic keyword scan** in `ApprovalGate.check()` that ran
  `JSON.stringify(args).includes(keyword)` against the blob, so any
  sed script or file content containing "truncate", "delete", "remove"
  etc. falsely triggered approval (e.g. approvals 18/19/20 on
  knowledge.js edits where "truncate" appeared inside a comment).
- **Gated fs tools** covering all `filesystem__*` operations
  unconditionally, so skill-file edits under
  `/root/QClaw/src/agents/skills/` required Telegram approval even
  though that directory exists for agent self-service.

10-minute timeout in `approvals.js:66` is intentional; not changed.
`tools/shell-exec.js` was already fine (regex-anchored DESTRUCTIVE
patterns, properly verb-scoped) and was not modified.

### Fixed
- All `~/QClaw` references in skill files → `/root/QClaw` absolute
  (14 hits in `qclaw-dev.md`, 1 in `build.md`).
- `sed -i ''` (BSD) → `sed -i` (GNU) in `qclaw-dev.md`.
- Added environment-clarifying header comment to `qclaw-dev.md`
  (target ssh qclaw, user root, absolute paths, GNU tools).
- Rewrote `ApprovalGate.check()`:
  - Removed the `gatedKeywords` JSON.stringify scan entirely.
  - Added `SKILL_EDIT_ALLOWLIST = '/root/QClaw/src/agents/skills/'`
    with `path.resolve()` + `startsWith()` — narrow prefix match that
    rejects `skills-evil/` lookalikes and `../` traversal attempts.
    Checks structured fields (`path`, `destination`, `cwd`) only;
    does not scan free-text command bodies.
  - Added verb-scoped `DESTRUCTIVE_PATTERNS` (rm, kill, killall,
    shutdown, reboot, dd, pm2 stop, pm2 delete, pm2 restart) matched
    against the first token (or first two for two-word patterns) of
    shell commands only. Leading `sudo ` is stripped before matching
    so `sudo rm -rf` still parses as `rm`.
  - Decision order puts destructive check BEFORE allowlist, so a
    destructive verb targeting a skill file still requires approval.
  - Stripe special-case tightened to inspect `args.action/operation/
    type === 'charge'` instead of `JSON.stringify(args).includes('charge')`.

### Test matrix (11/11 pass)
1. Sed edit in skill dir (via cwd) → no prompt (allowlist hit)
1b. Fs edit via `path` field under skill dir → no prompt
2. Sed with "truncate" in script body on non-skill file → no prompt
3. `rm -rf /something` → prompt fires
3b. `sudo rm -rf /something` → prompt fires (sudo prefix stripped)
4. `pm2 stop charlie-watcher` → prompt fires
4b. `pm2 status` → no prompt (not destructive)
5. Write to `/root/QClaw/src/someotherdir/` → prompt fires (gated)
5b. `rm` on a skill file STILL fires (destructive beats allowlist)
5c. `/root/QClaw/src/agents/skills-evil/` lookalike → prompt fires
5d. `../skills-evil/` traversal normalized → prompt fires

### Impact
Charlie can now update his own skill files directly, and make legitimate
code edits containing incidentally-destructive words without Tyson
needing to tap through Telegram approvals. Genuine destructive ops
(rm, kill, pm2 stop, etc.) and writes outside the skill directory are
still gated.

### Open follow-ups
- `tools/shell-exec.js` still gates on sudo-prefix (`\bsudo\b` in
  DESTRUCTIVE_PATTERNS), which fires correctly but could be noisy.
  Deferred.
- GitHub PAT embedded in `/root/QClaw` origin URL — visible in
  `git remote -v`. Separate rotation task if not already tracked.

---

## 2026-04-27 — Approval gate: orphan-callback safety

Small defensive change to `ExecApprovals.approve/deny`. On process restart
the in-memory `pendingCallbacks` Map empties; previously the SQL row update
ran but the resolution call site silently no-op'd. Now:
- Read the row first; throw `Error('not found')` for nonexistent ids.
- Return `{alreadyResolved:true,status}` for rows already approved/denied
  (instead of running a second UPDATE that does nothing because of the
  `WHERE status='pending'` clause — same outcome, but the call site now
  knows what happened).
- When `pendingCallbacks.get(id)` is empty, log a warning instead of
  silently dropping the resolution. Row still updates correctly.

The original requester's Promise stays unresolved on the orphan path
— a full DB-backed callback queue is a larger architectural change,
out of scope for this PR.

### Origin of this PR — and what it isn't

Started as a fix for "approval gate timing out every approval since
2026-04-22" after I diagnosed the bug as a missing emoji parser. That
diagnosis was wrong — `b08d64b` (2026-04-21) already added the
`/^([✅❌]|approve|deny|yes|no)\s*#?(\d+)\s*(.*)$/i` parser inside
`bot.on('message:text')`, line 263 of channels/manager.js. The parser
works correctly (verified against the diagnostic input matrix).

The actual headline bug is **handler concurrency**: `bot.on('message:text')`
runs `await agent.process(text)` synchronously, which blocks grammY's
update loop. When Charlie's chat handler stalls (Cognee reconnect storms,
slow tool calls, etc.) the user's emoji-reply sits undelivered until the
previous chat completes — by which time the 10-minute timeout has already
denied the row. Production logs for [37] show a 13-minute silence between
the previous chat completion (09:41:16) and the next (09:54:17), with the
[37] timeout firing at 09:54:13 inside that gap.

`pm2 logs quantumclaw --lines 5000` confirms exactly **1 successful
approval** (`[7] granted by telegram:tysonven via inline reply` at
21:23:34) against ~49 timeouts — consistent with messages occasionally
arriving while the chat handler is between calls.

Headline-bug fix (extract `approvalReply` to a `bot.hears()` registered
before `bot.on('message:text')`, or fire-and-forget the agent call) is
tracked separately. This PR only ships the small defensive change; the
gate will still time out approvals until the concurrency fix lands.

### Changes
- `src/security/approvals.js` — orphan-callback safety + return shape.
- `tests/approvals.test.js` — 13 cases (happy path, already-resolved,
  not-found, orphan-callback for both approve and deny). JSON fallback
  path so no SQLite dep.

### Test results
- `node tests/approvals.test.js` → 13/13 pass
- `node tests/smoke.test.js` → 21/22 (pre-existing local `jsonwebtoken`
  module-not-found, unrelated)

### Deferred to other sessions
- Real headline fix: handler concurrency / approval reply pre-empting
  long chat handler.
- Cognee reconnect storms (probable amplifier of the concurrency bug).
- QClaw on `qclaw` is under root's PM2 (not raw node — diagnostic
  correction). `flowos` user has its own empty PM2 instance, which is
  what threw me earlier.
- `charlie-watcher` PM2 entry exists (id 4, runs
  `bash src/agents/task-watcher.sh`) — name is real, role is task-queue
  watching, not Telegram listening.
- `/root/QClaw` has 1 unpushed commit (`26fe992`) and 3 WIP files
  (`monte_carlo.py`, `n8n-api.md`, `yarn.lock`) — Pillar 7 drift, parked.
- Local Mac PM2 zombie entry `quantumclaw` (PID 1381) — `pm2 delete`
  on the Mac.
- Plaintext credentials in local `~/.quantumclaw/config.json`
  (`dashboard.authToken`, `dashboard.pin`, `dashboard.tunnelToken`).

---

## 2026-04-27 — Flow OS Intake System: Kylie content build

First module of a reusable Flow States Collective (FSC) client intake
system. Static intake form on Vercel POSTs to a public n8n webhook, which
emails Tyson via GHL, syncs the submitter to GHL as a contact with a
note, and falls back to Telegram if GHL sync fails.

### Architecture
- Webhook: `POST https://webhook.flowos.tech/webhook/intake-kylie`,
  CORS restricted to `https://intake.flowstatescollective.com`
- Honeypot: `body.rawData.website` non-empty short-circuits to silent 200
  before any GHL call (no contact, no email, no log noise)
- Rate limit: per-IP 3 hits / 60s window via `getWorkflowStaticData`,
  4th and beyond return 429 (no body) without any GHL or email work
- Format: builds markdown note body and HTML email body from
  `responses[]`; HTML escape everywhere
- GHL email: POST `/conversations/messages` (type=Email) to a fixed
  internal notify contact, same pattern as `GHL Changelog Emails`
- GHL sync: `/contacts/search/duplicate` then either add note to existing
  or create contact (tags `intake-completed`, `kylie-content-build`,
  `fsc-client`, source `intake.flowstatescollective.com`) and add note
- Error fallback: any non-2xx from a GHL node fires a Telegram alert to
  chat `1375806243` so we know GHL sync broke even though the form still
  got a 200

### What got created
- n8n workflow `intake-kylie-content-system` (id `qOwJhClx5BnOeycf`,
  active, `availableInMCP: false`, 17 nodes)
- JSON backup committed at
  `n8n-workflows/intake-kylie-content-system.json`
- New `.env` keys in `~/.quantumclaw/.env` (perms tightened from 644 to
  600 in this session): `GHL_FSC_LOCATION_ID`, `GHL_FSC_USER_ID`,
  `GHL_FSC_NOTIFY_CONTACT_ID`, `NOTIFY_EMAIL`. The qclaw `.env` is the
  source of truth; the values are also referenced in the workflow.

### Credential decisions
- Reused existing n8n credential `FSC GHL pit` (id `TK2wBgy9ZtKLf8UG`,
  httpHeaderAuth) for all GHL HTTP nodes. The brief had asked for a new
  `GHL Flow States Collective PIT`; on inspection the live credential
  was already named `FSC GHL pit` and scoped to the FSC location,
  so creating a duplicate would have been churn.
- The four FSC `.env` values above (locationId, userId, notify
  contactId, notify email) are NOT secrets, just public IDs and an
  email. n8n on its host (157.230.216.158) does not currently load
  the qclaw `.env`, and adding them to the n8n container env would
  require a Docker restart that would interrupt active production
  workflows. Compromise: hardcode the four IDs in the workflow JSON
  and document in this entry. The PIT (the only real secret) stays in
  the n8n credential vault. Future improvement: migrate n8n to an
  `env_file` and consolidate.
- Also bootstrapped `tyson@flowstatescollective.com` as an FSC GHL
  contact for the operator-notify path (already existed: id
  `SbPJpeihuGK3RT6bspyq`). GHL conversations API requires a contactId
  to send email; that contact is the recipient.

### Tests run
1. Happy path: `{success:true}` 200, contact created, note added,
   email queued via GHL conversations
2. Honeypot: filled `rawData.website` returns 200 silent, only
   3 nodes execute (no GHL, no email)
3. CORS: server returns fixed
   `Access-Control-Allow-Origin: https://intake.flowstatescollective.com`
   regardless of request origin, so non-allowed origins are rejected
   client-side
4. Rate limit: submissions 1-3 within 60s succeed with full GHL flow,
   4th+ returns HTTP 429 with no body and skips GHL entirely

7 test contacts deleted from FSC GHL after testing.

### Security gate
- [x] No hardcoded secrets in the workflow JSON. The PIT lives only in
      the n8n credential vault. The four FSC IDs are public, not secret.
- [x] `~/.quantumclaw/.env` permissions are 600 (was 644 before this
      session, fixed)
- [x] Webhook CORS restricted to `https://intake.flowstatescollective.com`
- [x] Honeypot routes filled-honeypot submissions to silent 200 with no
      GHL/email side effects
- [x] Rate limit caps at 3/60s per IP, returns 429 silently
- [x] Workflow `availableInMCP: false` (public webhook, not for agent use)
- [x] Activated only after all 4 tests passed

### 7 Pillars
1. Frontend — form is on Vercel; handled in form-build session, not here
2. Backend — n8n workflow validates honeypot first, rate-limits, then
   processes. All HTTP nodes have `neverError: True`/
   `onError: continueRegularOutput` so a single GHL failure cannot crash
   the request path
3. Databases — n/a (no DB writes; static data is workflow-scoped)
4. Authentication — webhook is intentionally public (form endpoint);
   protection is honeypot + rate limit + CORS at the n8n layer; GHL PIT
   in n8n credential vault
5. Payments — n/a
6. Security — no hardcoded credentials, CORS restricted, rate limit in
   place, `.env` perms 600
7. Infrastructure — n8n workflow is JSON-backed in the repo; can be
   re-imported via the public API if the n8n host is reset

### Known limitations / deferred
- The four FSC `.env` keys live on qclaw but are not yet consumed by
  the n8n host; they're mirrored in `.env` for docs/source-of-truth and
  the actual values are inlined in the workflow JSON. The right long-
  term fix is to switch n8n's docker-compose to load an env_file and
  drop the inline values.
- The notify email path uses GHL's conversations endpoint and so the
  email comes from `tyson@flowstatescollective.com` to itself via the
  internal notify contact. Functional; if the brand voice eventually
  matters for these internal alerts we can switch to a dedicated
  transactional sender.
- Reusable intake module: this is workflow #1. The next intake (e.g.
  for a non-Kylie client) should clone this workflow, change the path
  (`/intake-<client>`), the tag set (drop `kylie-content-build`, add
  client-specific), and CORS origin if hosting at a different subdomain.

---

## 2026-04-27 — Session close: intake shipped, security pass, drift triage

End-of-session summary. The intake-kylie build entry above covers the
feature work. This entry covers the post-build hardening pass and a drift
triage list for next session.

### Recap
- **Kylie intake form**, FSC client #1 of the reusable intake module:
  built, deployed, tested (4/4 tests pass), JSON backup committed at
  `n8n-workflows/intake-kylie-content-system.json`. Live workflow id
  `qOwJhClx5BnOeycf`, webhook
  `https://webhook.flowos.tech/webhook/intake-kylie`. See the previous
  entry for architecture and decisions.
- **Security pass**: `~/.quantumclaw/.env` perms tightened from 644 to
  600. New FSC keys added (`GHL_FSC_LOCATION_ID`, `GHL_FSC_USER_ID`,
  `GHL_FSC_NOTIFY_CONTACT_ID`, `NOTIFY_EMAIL`). FSC PIT remains in the
  n8n credential vault only (`FSC GHL pit`, id `TK2wBgy9ZtKLf8UG`). Test
  contacts created during testing were deleted from FSC GHL.
- **charlie_n8n_key incident remediated**:
  - `git log --all --full-history -- charlie_n8n_key` confirmed the key
    was never committed (untracked only)
  - Moved from `/root/QClaw/charlie_n8n_key` to
    `/root/.ssh/charlie/charlie_n8n_key`, perms 600, owner root:root
  - Duplicate copy at `/home/flowos/charlie_n8n_key` shredded with
    `shred -u` after grep across `/root/QClaw/`, `/etc/`, `/home/flowos/`
    confirmed zero references
  - SSH from qclaw to n8n host (`n8nadmin@157.230.216.158`) verified
    working from the new path
  - `.gitignore` hardened with private-key patterns: `*.pem`, `*.key`,
    `*_key`, `*_rsa`, `*_ed25519`, `id_*`, `**/charlie_n8n_key`
- **Skill doc**: `src/agents/skills/ghl.md` gained a
  "Notification email pattern (out of GHL)" section so future-Charlie
  doesn't re-derive the contactId-required workaround.
- **Roadmap**: added `n8n env consolidation` as the first priority,
  flagged as a prerequisite for new client intakes (so we don't keep
  hardcoding location/user/contact IDs into each cloned workflow).

### Security gate (final)
- [x] No hardcoded secrets in workflow JSON or repo
- [x] No private keys in the repo or in git history
- [x] `.env` perms 600
- [x] Webhook CORS restricted, honeypot active, rate limit active
- [x] Workflow `availableInMCP: false` for the public intake webhook
- [x] All 4 functional tests pass; test data cleaned up

### Pre-existing drift (not touched this session, for separate triage)
Listed so next session can decide what to do with each:

- `src/agents/skills/n8n-api.md` — 1+/1- line. Trivial doc tweak adding
  `?limit=200` to a GET endpoint example. File last touched 2026-04-23,
  so this drifted somewhere in the last 4 days.
- `src/trading/monte_carlo.py` — 2+/0- lines. Last touched 2026-04-25.
  Has a sibling `.backup.1777144066` file from the same modtime,
  suggesting an automated edit pass.
- `yarn.lock` — 14+/1- lines, modtime 2026-04-27 12:42 UTC (today).
  Indicates a `yarn install` ran during this session window without a
  paired `package.json` change being staged. Worth confirming nothing
  got orphaned.
- Untracked: `scripts/migrate-r2.mjs`, `scripts/update-library.mjs`,
  `src/crete-marketing/curate-photos.mjs` — all from Apr 17–23,
  pre-session WIP.
- Untracked backups: `src/agents/skills/n8n-api.md.backup.1776933191`,
  `src/trading/monte_carlo.py.backup.1777144066` — these will be
  swallowed by the existing `*.backup` gitignore pattern only if the
  automated tooling renames them; current names don't match the
  pattern. Either delete them or add `*.backup.[0-9]*` to gitignore.

### Commits this session (origin/main)
- `88aa45d docs: update build log [2026-04-27]` — Kylie intake build
- `7dc1820 security: gitignore private keys, move charlie_n8n_key out of repo`
- (this commit) — session close summary

origin/main HEAD before this commit: `7dc182051551b0e54c8b2f6c00c761ae3b6c77f2`.

## 2026-04-27 — GHL Marketing R2 migration + IG path hardening

Completed:
- Migrated marketing templates from emma-content-studio (PNG) to
  flowos-content (JPEG) for proper bucket separation
- Updated Publisher (fonuRTyqepxdyIdf): Patches A/B/C — image format
  guard in Prepare, IG Eligible IF gate, error precedence flip in
  Compute Final
- Updated Content Generator (Awo65rdSe5BvDHtC): literal swap to new
  R2 prefix + .jpg extension
- Set GHL_DEFAULT_IMAGE_URL env var on n8n droplet
- Re-enabled availableInMCP=true on both workflows post-PUT (verified
  by re-GET)
- Refreshed JSON dumps in n8n-workflows/
- Supabase migration: zero rows in active statuses (no-op as expected)

Verified working:
- Publisher smoke test surfaced TRUE upstream Meta error
  (9004/2207052) instead of misleading "creation_id required" —
  error precedence flip working as designed
- Content Generator dry-run produced draft with new R2 prefix + .jpg
- FB and LinkedIn publish paths functioning end-to-end

Pending (next session priorities):
1. IG fetch failure (Meta 9004/2207052) — likely IG-FB account
   linkage, IG-specific token scope decay, or IG fetcher edge issue
   with *.r2.dev. Quick diagnostics: /debug_token,
   /me/accounts?fields=instagram_business_account, swap to non-R2
   control image. Test draft 82294451 reserved for this.
2. LinkedIn 4h guard didn't fire despite 11:00 UTC LI post — verify
   published_platforms and published_at stamping on draft a78794b6.
3. Bind media.flowos.tech to flowos-content R2 — something else is
   currently on that hostname.
4. Audit src/dashboard/server.js upload destination — likely should
   move to flowos-content/ for same architectural reason
   marketing-templates moved.

Architecture decision: emma-content-studio holds Emma's
personal-brand and content-pipeline assets only. flowos-content holds
Flow OS marketing/brand/agent assets. Future Flow OS infra defaults
to flowos-content unless there's a specific reason otherwise.

### Security gate (this session)
- [x] No hardcoded credentials added (R2 dev URL is a public-read
      hostname; no keys in repo or workflow JSON)
- [x] `/root/.quantumclaw/.env` perms remain 600;
      `/home/n8nadmin/n8n-project/.env` perms remain 600
- [x] No new webhooks introduced — existing
      `webhook/ghl-marketing-publish` path unchanged
- [x] Supabase RLS unchanged — only data UPDATE/INSERT on existing
      `marketing_drafts` table; no schema changes
- [x] `availableInMCP: true` confirmed via re-GET on both Publisher
      (fonuRTyqepxdyIdf) and Content Generator (Awo65rdSe5BvDHtC)
- [x] No financial features touched
- [x] No stack traces or secrets in error messages exposed to
      Telegram (Compute Final emits `errors.{platform} = msg`,
      msg sourced from API `error.message` strings only)

### Reserved test artifacts
- Supabase `marketing_drafts` row `82294451-3adc-4852-8ab0-3cd285664b91`
  (status=partially_published, feedback tagged) — reserved for
  next-session IG fetch failure diagnosis. Do not delete.


## 2026-04-27 (afternoon) — IG path: pivot to Blotato

**Issue:** After morning's R2 migration, IG still failed with Meta 9004.

**Diagnosis:** Cloudflare-fronted URLs (both `pub-*.r2.dev` and
`media.flowos.tech`) are blocked by IG's fetcher. Confirmed via
controls — Wikipedia and GitHub raw both work, both Cloudflare URLs
fail. Bot Fight Mode off, no Workers Routes, no UA-based blocking.
Cause is in Cloudflare's edge security vs IG's fetcher specifically.

**Resolution:** Route IG via Blotato (account 27064, `flow_os_`).
Blotato uploads bytes to Meta directly, bypassing the Cloudflare
block. Already a dependency in this workflow for LinkedIn; Crete
workflow proves the IG path.

- **Removed**: `IG Eligible?`, `IG Create Container`, `IG Wait For Ready`,
  `IG Publish` (all 4 IG-direct nodes from morning's hardening)
- **Added**: `IG Post (Blotato)` — single node
- **Updated**: Compute Final IG block, Prepare (dropped
  `ig_eligible` flag)

**Net:** workflow simpler (4 IG nodes → 1), bypasses
Cloudflare-vs-Meta entirely.

**Deferred investigation:** Cloudflare-vs-Meta-fetcher block on
`media.flowos.tech`. Worth fixing eventually if we ever want direct
Graph API for IG, but Blotato is fine for now.

### Patch: Compute Final IG block (Blotato success detection)

**Bug:** Architect's spec checked `igB.id || igB.submissionId ||
igB.success || igB.status`, but Blotato actually returns
`postSubmissionId`. None matched, fell to error else-branch despite
IG having posted successfully. Row `c21b3192` was labeled
`partially_published` incorrectly.

**Fix:** Mirrored the LinkedIn pattern (`if (li && !li.error)`) which
was proven correct by the same execution. One-line semantics:
truthy node response without an error field = success.

**Lesson logged:** when adapting a known-working pattern, mirror it
rather than re-speccing from scratch.

**Manually corrected:** row `c21b3192-8fb9-4d34-a79d-155f7c5055a9`
`status → published`, `published_platforms → all three`,
`publish_errors → null`.

### Pending (next session priorities, updated)

1. ~~IG fetch failure~~ — **RESOLVED** via Blotato pivot
2. LinkedIn 4h guard didn't fire on draft `a78794b6` — verify
   `published_platforms` and `published_at` stamping logic
3. ~~Bind media.flowos.tech to flowos-content R2~~ — **DONE today**
4. Cloudflare-vs-Meta-fetcher diagnosis (deferred from above)
5. Audit `src/dashboard/server.js` upload destination — likely
   should move to `flowos-content/`
6. Clean up duplicate `FLOWOS_META_PAGE_ACCESS_TOKEN` line in
   `/home/n8nadmin/n8n-project/.env` (one empty, one populated —
   docker-compose takes the last but it's a latent bug)

### Reserved test artifacts

- Supabase `marketing_drafts` row
  `82294451-3adc-4852-8ab0-3cd285664b91` (morning smoke test, kept
  for Cloudflare-vs-Meta-fetcher diagnosis next session — see #4)
- Supabase `marketing_drafts` row
  `c21b3192-8fb9-4d34-a79d-155f7c5055a9` (afternoon Blotato smoke
  test, manually corrected to `published`)

### Security gate (this session)
- [x] No new credentials, webhooks, or financial features
- [x] availableInMCP === true verified post-PUT
- [x] Supabase update scoped to single row by primary key
- [x] No stack traces exposed via Telegram errors
---

## 2026-04-27 — Approval gate concurrency fix

Fixes the deterministic deadlock-by-origin documented in the prior audit:
when an approval was requested from inside a tool call inside
`bot.on('message:text')`'s `await agent.process(...)` chain, the user's
`✅ <id>` reply could not be processed because the same handler instance
that owns the reply parser was the one awaiting the approval Promise.
Production data: ~25 timeouts vs 1 success (`[7]`) over 5 days, with the
single success originating from a heartbeat task — i.e., outside the
chat handler's await chain.

### Changes

`src/channels/manager.js`
- New dependency `@grammyjs/runner@2.0.3`.
- Inline approval-reply branch removed from `bot.on('message:text')` and
  re-registered as a top-level `bot.hears(APPROVAL_REPLY_RE, …)` placed
  before `message:text`. Under the runner's concurrent middleware, emoji
  replies dispatch in parallel with any in-flight `agent.process()`.
- `bot.start({drop_pending_updates:true})` replaced with
  `run(bot, { runner: { fetch: { allowed_updates: ['message','callback_query'] } } })`.
  `drop_pending_updates` is still applied via the existing
  `deleteWebhook({drop_pending_updates:true})`.
- `stop()` now calls `_runner.stop()`.
- `handleApprovalReply` extracted as an exported function so it can be
  unit-tested without spinning up a real Bot. The `bot.hears` callback
  is a one-line wrapper.

`src/agents/registry.js`
- Concurrent dispatch would let two `agent.process()` calls for the
  same agent run in parallel — both reading the same history snapshot,
  running separate LLM calls, then writing interleaved turns. (Audit §3
  conversation-history hazard.)
- Added a module-level mutex (Map<agentName, Promise>) and a
  `_withAgentLock(name, fn)` helper. Reflex-tier responses skip the lock
  (no history I/O). Everything from `graphQuery` through the second
  `addMessage` is held under the lock, restoring the same serialization
  grammY's default sequential middleware used to provide.
- Body extracted to `_processNonReflex(message, context, route, textMessage)`
  so the lock wrap doesn't reindent ~165 lines. No logic change.
- Mutex exported as `__agentLockForTests` for the concurrency test only.

The existing `/approve <id>` and `/deny <id>` slash commands are
untouched. All other handlers (audited as concurrency-safe) are now
running through the runner.

### Tests

- `node tests/smoke.test.js` → 22/22
- `node tests/approvals.test.js` → 13/13 (added `process.exit(failed?1:0)`
  so it doesn't hang on armed 10-min timeouts)
- `node tests/approval-parser-handler.test.js` → **29/29** new — full
  regex input matrix plus handler behaviour (authorized success,
  already-resolved, unauthorized silent ignore, nonexistent id, deny
  aliases, deny-with-tail-as-reason)
- `node tests/agent-mutex.test.js` → **7/7** new — same-key
  serialization, history consistency under concurrency, different-key
  parallel execution, lock release on throw, post-throw reacquire

### Deploy

PM2 still owns the process (root's PM2, id 2 `quantumclaw`):
```
ssh qclaw
sudo git -C /root/QClaw fetch origin
sudo git -C /root/QClaw merge --no-ff origin/fix/approval-gate-concurrency
sudo pm2 restart quantumclaw
sudo pm2 logs quantumclaw --lines 30
```

Tyson runs the manual smoke from Telegram once deployed. The headline
`[37]`-class failure should disappear: emoji replies resolve approvals
even while a chat handler is mid-`agent.process()`.
---

## 2026-04-28 — Approval notifier: bypass `bot.api.sendMessage` (raw fetch workaround)

Workaround for a silent-drop on the outbound approval notifier path:
`bot.api.sendMessage` from inside the `@grammyjs/runner`-managed process
returned without error and without delivery. No "Telegram send failed"
log line ever fired (catch never hit). Independent verification:
- `curl https://api.telegram.org/bot$TOKEN/sendMessage` → delivered.
- `new Bot(token).api.sendMessage(...)` from a one-shot script under
  `/root/QClaw` (same node_modules, same `.env`) → delivered (msg id
  `2843`).
- The same call from inside the long-running QClaw process → no error,
  no delivery.

Root cause is suspected to be an interaction between the runner's
update-fetch loop and the bot's outbound API client (possibly an
internal queue / abort signal / connection-pool state). **Tracked as
a separate investigation; not addressed in this PR.**

### Change

`src/index.js` notifier callback:
- Replace `await bot.api.sendMessage(ownerChatId, text)` with a raw
  `fetch('https://api.telegram.org/bot${token}/sendMessage', …)` POST.
- Cache the bot token at notifier-wire time (one `secrets.get` call at
  boot, not per-notification).
- On HTTP 401, refresh the token from `secrets.get` once and retry —
  so a BotFather rotation while the process is running doesn't
  permanently wedge the notifier.
- 10 s `AbortSignal.timeout` so a network stall can't hold up the
  approval flow indefinitely.
- Keep the `tgChannel` availability check as a fast-fail (channel never
  came up → don't try to send), but the actual send no longer depends
  on the bot reference.
- Surface non-OK responses via `log.warn` with status + first 200 chars
  of the body, so future failures are visible (this was the missing
  signal that made the silent-drop hard to diagnose).

The bot's own API client is still used for everything else (chat
replies via `bot.on('message:text')`, `bot.command(...)` responses,
the inline `bot.hears` approval-reply parser added in PR #2). The
workaround is scoped to the single notifier callback.

### Tests

- `node tests/smoke.test.js` → 22/22
- `node tests/approvals.test.js` → 13/13
- Manual smoke (post-deploy, run by Tyson):
  - [ ] Trigger an approval from Telegram (or via Charlie tool call).
        Confirm `⚠️ Approval needed [N] …` arrives at chat
        `1375806243` within 5 s.
  - [ ] Reply `✅ <id>`. Confirm row resolves to `approved` and the
        original tool action proceeds.
  - [ ] Trigger another, wait 10 min without replying — confirm the
        timeout still fires.

### Branch / PR

- `fix/notifier-raw-fetch`, off `origin/main` (`5a5b546`).
- Single-file change to `src/index.js`. No new dependencies.
- Deploy via `git merge --no-ff origin/fix/notifier-raw-fetch` onto
  `/root/QClaw`'s local `main` (which already carries the concurrency
  fix from PR #2). No conflicts expected — PR #2's changes are in
  `src/channels/manager.js` + `src/agents/registry.js`, this PR only
  touches `src/index.js`. After merge, `pm2 restart quantumclaw`.

### Out of scope (deferred)

- Root-cause analysis of why `bot.api.sendMessage` silently drops in
  runner context. Separate investigation; not blocking the gate fix.
- The previous Telegram-side 429/502 storm on the prior process
  (PID 2230128) — already cleared by the post-rotation restart;
  unrelated to this PR.
---

## 2026-04-28 — Approval gate: unify request paths so notifier always fires

The actual root cause of the production approval-gate failures.

`src/tools/executor.js` calls `approvalGate.requestApproval(...)` for
every tier-classified tool call inside `agent.process()`.
`requestApproval` delegated straight to `approvals.request()` and
**bypassed the notifier entirely**. Only `requestInlineApproval` (used by
`shell_exec` and `n8n_workflow_update` directly) ever fired the
notifier.

Result: every executor-driven approval created a row, logged
`⏸️  Approval required: …`, then sat invisible until the 10-min timeout
denied it. No Telegram prompt was ever sent for those — which is why
the logs showed `Approval needed: [N]` but no `Telegram send failed`,
no `Telegram bot unavailable`, no `No notifier wired` warnings: the
notifier code was never reached on that path. The PR #3 raw-fetch
workaround for `bot.api.sendMessage` was real but addressed a
*separate* silent-drop in the notifier transport, not the missing
notifier dispatch on the executor path.

### Change — single file

`src/security/approval-gate.js` `requestApproval`:
- Replace its body (which did `approvals.request(...)` directly) with
  a delegation to `requestInlineApproval`. Same payload shape — `agent`,
  `tool`, `action`, `detail`, `riskLevel`. Single approval-creation
  code path. Single notifier dispatch.
- Existing `log.warn('⏸️  Approval required: …')` line kept so log
  format stays consistent with previous output.

### Tests

- `node tests/smoke.test.js` → 22/22
- `node tests/approvals.test.js` → 13/13
- `node tests/approval-gate-notifier.test.js` → **13/13** new
  - notifier fires exactly once on `requestApproval`
  - payload contains agent / tool / numeric id / riskLevel / action /
    detail with the right shape
  - works without a notifier (warns, still resolves)
  - notifier-throws path is non-fatal (approval resolves regardless)
  - `requestInlineApproval` (existing callers: `shell_exec`,
    `n8n_workflow_update`) still fires the notifier — sanity check on
    the shared code path

### Deploy

Branch off `origin/main` (`5a5b546`). Single-file change to
`src/security/approval-gate.js` plus one new test file. No new deps.

```
ssh qclaw
sudo git -C /root/QClaw fetch origin
sudo git -C /root/QClaw merge --no-ff origin/fix/approval-gate-unify
sudo pm2 restart quantumclaw
sudo pm2 logs quantumclaw --lines 30
```

PR #2 (concurrency) and PR #3 (raw-fetch) are already on prod's local
`main`. This PR layers on top — no conflicts expected on
`approval-gate.js` (PR #2 didn't touch it; PR #3 didn't touch it).

### Why earlier PRs missed this

Both #2 and #3 were correct as far as they went, but neither path was
the failing one in production:
- #2 fixed the `bot.hears` reply parser and the agent concurrency
  hazard. Needed for once approvals start arriving via Telegram.
- #3 worked around the `bot.api.sendMessage` silent drop in runner
  context. Needed for the notifier transport to actually reach
  Telegram.
- This PR fixes the *missing* notifier dispatch on the executor path.

The three are independent and stack: the executor's approval row now
fires the notifier (this PR) → the notifier sends via raw fetch (#3) →
the user's `✅ <id>` reply arrives via concurrent middleware (#2) →
the row resolves.

### Out of scope (unchanged)

- Root-cause investigation of why `bot.api.sendMessage` silently drops
  in runner context. Tracked separately; PR #3's workaround stays.

---

## 2026-04-28 — Approval gate fix journey: closeout

End-of-day summary. Approval `[50]` resolved successfully end-to-end via
Telegram smoke test, confirming the gate is working. Three PRs were
needed because the failure had three independent contributing causes —
each PR addressed one, and only the combination unblocks the path.

### Root cause

`requestApproval` and `requestInlineApproval` were two parallel
approval-creation code paths in `src/security/approval-gate.js`, and
**only the inline one had the notifier wired**. The executor
(`src/tools/executor.js`) — which gates every tier-classified tool call
inside `agent.process()` — used `requestApproval`, the no-notifier
path. Direct callers (`shell_exec`, `n8n_workflow_update`) used
`requestInlineApproval`, which did fire the notifier. So most of
production's "Approval needed: [N]" log lines were created on a path
that never sent a Telegram prompt at all.

### Three PRs, three fixes (all merged into `origin/main`)

| PR | Branch | Fix | Why needed |
|---|---|---|---|
| **#2** `732876b` | `fix/approval-gate-concurrency` | `bot.hears(APPROVAL_REPLY_RE)` registered before `bot.on('message:text')` via `@grammyjs/runner`'s concurrent middleware; per-agent async mutex around `agent.process()`'s history read-modify-write. | Once approvals start arriving via Telegram, the inbound `✅ <id>` reply needs to be parseable while a prior chat handler is mid-`agent.process()`. Without this, replies queue behind a slow chat. Concurrent dispatch added a separate hazard (concurrent history reads → interleaved DB writes), which the mutex fixes. |
| **#3** `ede5dec` | `fix/notifier-raw-fetch` | Replace `bot.api.sendMessage(ownerChatId, text)` in the notifier callback with raw `fetch()` to `https://api.telegram.org/bot${token}/sendMessage`. Token cached at wire time; refresh on 401; 10 s `AbortSignal.timeout`. | `bot.api.sendMessage` from inside the runner-managed process was returning without error and without delivery — silent drop. Independent verification (curl, one-shot `new Bot(token).api.sendMessage`) confirmed the env, token, network path, chat id, and grammy library all worked outside the running process. Workaround scope is the single notifier callback; bot's API client unchanged for chat replies. Runner-context root cause still under investigation. |
| **#4** `7d471c6` | `fix/approval-gate-unify` | `requestApproval` delegates to `requestInlineApproval` instead of calling `approvals.request` directly. Single approval-creation path; single notifier dispatch. | The actual root cause. Without this, executor-driven approvals (the production majority) created rows that timed out silently — the notifier was never invoked for them at all. PRs #2 and #3 only had effect once this PR routed those approvals through the notifier in the first place. |

### How the three stack at runtime

For an approval-gated tool call inside Charlie's chat reply:

1. Tier-classified tool call hits `executor.runTool` → `approvalGate.requestApproval(...)`
2. **(PR #4)** `requestApproval` delegates to `requestInlineApproval`, creating the row AND firing the notifier.
3. **(PR #3)** Notifier sends via raw `fetch` to Telegram's HTTP API → Tyson sees `⚠️ Approval needed [N] …` within seconds.
4. Tyson replies `✅ N`.
5. **(PR #2)** `bot.hears(APPROVAL_REPLY_RE)` matches the reply concurrently with the still-running `agent.process()` (no head-of-line blocking under runner middleware) → calls `approvals.approve(N)`.
6. The original `agent.process` await resolves with `{approved:true}` → tool executes → Charlie's reply continues → done.

### Confirmed working today

- Approval `[50]` resolved successfully end-to-end via Telegram smoke
  test.
- Boot logs on prod show all three changes loaded:
  `Telegram: ready (2 users)` and
  `Approval gate Telegram notifier wired (raw fetch)`.

### Open follow-ups (deferred to future sessions)

- **Root-cause: `bot.api.sendMessage` silent-drop in `@grammyjs/runner`
  context.** PR #3's raw-fetch workaround sticks until this is
  understood. Suspected interaction between the runner's update-fetch
  loop and the bot's outbound API client (connection-pool state,
  transformer chain, AbortSignal handling).
- **`/root/QClaw` ↔ `origin/main` graph divergence.** Functionally in
  sync: the only file-content diff is 3 cosmetic lines in
  `QCLAW_BUILD_LOG.md` (extra `---` separator from how an earlier
  merge resolved). Different commit graphs (prod has local merge
  commits; origin has GitHub PR merge commits). Not blocking;
  reconciles next time the build log is touched.
- **Pre-existing WIP on prod** (parked, untouched in this session):
  `M yarn.lock` (drift) and `?? scripts/upload-ep66.mjs` (new
  one-shot). Neither affects the approval-gate path.

---

## 2026-04-28 — Content Studio EP66 first live run; n8n Telegram token fix

First end-to-end attempt at shipping a podcast episode through the
`Qf39NEOEgz2W0uls` "Content Studio Pipeline" workflow. The dashboard
`/api/content-studio/upload` route had failed earlier in the day
(~17:00 UTC, suspected dashboard restart mid-stream — separate issue,
not investigated this session). EP66 was bypassed via CLI: file
uploaded directly to R2, webhook fired manually with the same payload
shape the dashboard would build.

### Recon (Phase 1)

- R2 multipart-uploads listing on `emma-content-studio` returned `[]`
  — no orphan from the 17:00 failure (the dashboard busboy path
  doesn't use multipart for the single-shot upload, so a mid-stream
  restart leaves no R2-side trace).
- `scripts/upload-to-r2.sh` and `scripts/receive-and-upload.sh` both
  depend on `/home/flowos/.local/bin/aws`, which is broken on qclaw —
  `ModuleNotFoundError: No module named 'awscli'`. Documented but
  not fixed this session.
- Commit `83b92a4` (r2FileKey-interpolation fix in
  `receive-and-upload.sh` curl example) confirmed on `main`.
- EP05 in the bucket: `theflowlane-ep05-Brand_Positioning.mp4`. EP66
  key conventionalised to
  `theflowlane-ep66-Mothering_In_Business.mp4` to match — kebab +
  lowercase prefix, underscored title segment.
- n8n workflow `Qf39NEOEgz2W0uls` payload shape verified via MCP:
  webhook expects camelCase `r2FileKey`, `episodeTitle`,
  `episodeDescription`, optional `chatId`, `r2Url`. No
  episode-number field — episode 66 lives only in the title prefix.

### Upload — `scripts/upload-to-r2-multipart.mjs`

50-line node multipart uploader as fallback when the awscli shim is
broken. Uses the `@aws-sdk/client-s3` already in `node_modules`
(no new deps). Reads R2 creds from `/root/.quantumclaw/.env`. 16 MB
parts, 4 concurrent workers. Aborts the multipart upload on any
error to avoid orphans.

The 2.42 GB EP66 file was scp'd from laptop to qclaw `/tmp`, then
uploaded:

```
ssh qclaw 'sudo node /root/QClaw/scripts/upload-to-r2-multipart.mjs \
  /tmp/theflowlane-ep66-Mothering_In_Business.mp4 \
  episodes/theflowlane-ep66-Mothering_In_Business.mp4'
```

R2 ETag `8af99de9e6e11428778216dee9c25a14-145` (145 parts). Public
URL `https://pub-70c436931e9e4611a135e7405c596611.r2.dev/episodes/theflowlane-ep66-Mothering_In_Business.mp4`.

Promoted to canonical large-file uploader for future episodes — the
script is generic, not EP66-specific.

### First webhook fire — failed at Notify Start (T+1.2s)

curl to `https://webhook.flowos.tech/webhook/content-studio-pipeline`
returned HTTP 200 / 0 bytes in 1.6s (Cloudflare tunnel buffer
artefact). n8n executions API revealed the real cause:

```
n8n execution 718765:
  Webhook Trigger:    OK    (1ms)
  Create Job Record:  OK    (908ms)
  Notify Start:       error (318ms)
    NodeApiError 401 — Authorization failed - please check your credentials
```

Notify Start calls
`https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage`.
Telegram replied 401 → token unset, empty, or wrong on the n8n
container.

### Token diagnosis

- qclaw `/root/.quantumclaw/.env` `TELEGRAM_BOT_TOKEN`: `getMe`
  returns `{ok:true, @tyson_quantumbot, id 8588434821}`. Working.
- n8n `/home/n8nadmin/n8n-project/.env` line 15: set, length 46.
  Same length as qclaw's.
- sha256 first-8-char comparison:
  - qclaw: `5520af11…`
  - n8n .env (current + 3 historical backups going back to Apr 21):
    `acfc03ae…`
  - n8n container env: `acfc03ae…`
- `getMe` against the n8n token directly: 401 Unauthorized.

Two completely different bot tokens, both 46 chars (the format is
`<10-12 digit bot id>:<33-35 char auth>`, always 46). n8n had been
holding a dead token since at least Apr 21 — all 4 .env backups
have the same `acfc03ae…` hash. The workflow `updatedAt` is
`2026-04-14T21:13Z`; EP05 ran Apr 14 20:39, before that change —
likely the change introduced the `$env.TELEGRAM_BOT_TOKEN`
reference and EP66 is the first time anyone tried to fire the
workflow since.

### Fix — replace n8n token, recreate container

Token pulled from qclaw via stdin pipeline directly into a sed -i
replacement on n8n's .env (never echoed in either direction):

```
ssh qclaw 'sudo grep "^TELEGRAM_BOT_TOKEN=" /root/.quantumclaw/.env | cut -d= -f2-' | \
ssh n8n 'NEW=$(cat); sed -i.bak.20260428-pretoken \
  "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${NEW}|" \
  /home/n8nadmin/n8n-project/.env'
```

Pre-edit backup written to `.env.bak.20260428-pretoken`. Perms
preserved 600 / `n8nadmin:n8nadmin`. Then on n8n:

```
cd /home/n8nadmin/n8n-project && docker compose up -d
```

(`up -d` rather than `restart` is required — restart re-signals the
existing container and does not pick up env_file changes.)
Recreated only the n8n service; postgres + flowos-overlay untouched.
Container `starting → healthy` in ~20s. Container env sha256 now
`5520af11…`. n8n editor reachable. `getMe` from n8n side now
returns `tyson_quantumbot`.

### Re-fire — Phase 3

Orphan `content_studio_jobs` row from the failed first run deleted
via PostgREST DELETE (anon role has DELETE permission on the table —
`SUPABASE_SERVICE_KEY` is not present in qclaw .env, but anon
worked). Webhook re-fired from qclaw using the same
`/tmp/ep66-payload.json` from the first attempt.

New job `219ad102-6767-40ab-ba39-1e71aa9debce`, fired
`2026-04-28T17:05:22Z`.

Stages cleared (verified via Supabase row updates and clipper-worker
logs):

```
T+0s     Webhook Trigger
T+1s     Create Job Record
T<100s   Notify Start (Telegram)            — Phase 2 fix confirmed
T<100s   Generate R2 Presigned URL
T<100s   Upload to Buzzsprout                — episode id 19091555
T<100s   Save Buzzsprout ID
T~100s   Send to AssemblyAI / Wait / Poll    — transcribed cleanly,
                                              5,681 words captured
T<166s   Extract Highlights / Select Clip Segments / Parse
T+166s   Generate Blog Post / Convert to HTML / Post to WordPress
                                              — post id 675, draft
T+166s   Save WordPress URL
T+288s   Generate Clips                      — clipper job
                                              aa9be7f0-a424-42d9-9338-
                                              f56b67416602
```

Then deadlock at clipper.

### Clipper deadlock — out-of-scope to fix tonight

Clipper job `aa9be7f0` errored on the first vertical-crop step.
ffmpeg invocation:

```
ffmpeg -y -threads 1 -i /tmp/aa9be7f0…_clip_0.mp4 \
  -vf 'crop=ih*9/16:ih:max(0, min(iw-ih*9/16, 0.3919*iw - ih*9/16/2)):0' \
  -preset ultrafast -c:a copy /tmp/aa9be7f0…_vertical_0.mp4
```

Returned exit status 8 (ffmpeg "Conversion failed"). Likely
audio-codec compatibility with `-c:a copy` for this source's
encoding; would resolve with re-encoding (`-c:a aac -b:a 128k`) or
by skipping vertical processing. AssemblyAI transcript completed
cleanly, so video download + transcription are not implicated.

Workflow "Clip Done?" IF only branches on `status == "complete"`
(true → Save Clip URLs, false → Wait 10s Retry). No error branch.
Clipper returns `status: "error"` indefinitely → infinite poll.
Pipeline cannot finalise — Update Job Record, Notify Complete,
Respond to Webhook all unreached.

### Persisted vs lost

Persisted (survives the deadlock, written before the clipper
branch):

- Buzzsprout EP66 draft (id 19091555, unpublished)
- WordPress draft (post id 675)
- LinkedIn post via Blotato — likely published; the parallel branch
  reaches Blotato before YouTube and before the deadlock point.
  Not confirmed in Supabase (`linkedin_post_url` writes only at the
  final Update Job Record).
- YouTube unlisted upload — likely complete; same parallel branch.
  Not confirmed in Supabase (same writeback constraint).

Lost if the runaway execution is stopped without harvest:

- Substack draft text (held in n8n runtime memory only)
- LinkedIn post URL (returned by Blotato but only persisted at the
  final node)
- YouTube video ID (returned by upload but only persisted at the
  final node)

### Phase 1 finding correction

Phase 1 recon claimed PM2 was empty on qclaw. That was `pm2 list`
run as user `flowos`, which has its own empty PM2 daemon.
Production processes are managed by root's PM2: `sudo pm2 list`
shows `agex-hub`, `charlie-watcher`, `clipper-worker`,
`quantumclaw`, `trading-worker` all online. The dashboard
"not under PM2" framing earlier today was based on the same
wrong-user query. Documented as a session-incident gotcha.

### Backlog from this session

P0 (next session, EP66 unblock):

- Stop the runaway n8n execution still polling clipper. Currently
  spinning at ~6 req/min against `clipper-worker:4002/clip/aa9be7f0`
  and won't self-resolve.
- Investigate clipper-worker ffmpeg vertical-crop+`-c:a copy`
  failure on EP66's source. Reproduce manually if `_clip_0.mp4`
  still in `/tmp`; otherwise re-trigger with debug logging.
- Patch workflow `Qf39NEOEgz2W0uls`: add error branch on
  "Clip Done?" → Update Job Record (with empty clips +
  error_message). Stops infinite polls on all future clipper
  failures, generic to the workflow not specific to EP66.

P1 (workflow / config hygiene):

- Refactor `$env.TELEGRAM_BOT_TOKEN` references in
  `Qf39NEOEgz2W0uls` to n8n credential store (Telegram credential
  type). Removes the env-var-on-host-not-on-container failure mode
  entirely.
- Diff the Apr 14 21:13 workflow update against its prior version
  to confirm it's the change that introduced
  `$env.TELEGRAM_BOT_TOKEN`, and audit other workflows for the
  same pattern.
- Move `N8N_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` out of the
  tracked `docker-compose.yml` into the env_file. Both are in git
  history; rotate after move. The git-history exposure is the
  larger concern.

P2 (config cleanup):

- Dedupe `FLOWOS_META_PAGE_ACCESS_TOKEN` (appears twice) in
  `/home/n8nadmin/n8n-project/.env`.
- Delete `/home/n8nadmin/n8n-project/.docker-compose.yml.swp`
  vim-swap leftover from Sep 2025.
- Confirm via BotFather (using the working `5520af11…` token's
  bot) that no zombie bot remains for the `acfc03ae…` token.
- Add `SUPABASE_SERVICE_KEY` to qclaw `/root/.quantumclaw/.env`
  for proper service-role DELETEs. Anon role currently has DELETE
  on `content_studio_jobs` — broader than typical, worth auditing
  RLS on that table.
- Fix awscli on qclaw (`pip install --user awscli` for flowos), or
  formally retire `scripts/upload-to-r2.sh` /
  `scripts/receive-and-upload.sh` in favour of
  `upload-to-r2-multipart.mjs`.

### Out of scope (deferred)

- Dashboard PM2 enrolment / 17:00 UTC dashboard upload root cause:
  the dashboard is in fact PM2-managed (id 2 under root's PM2,
  restart count visible in the `↺` column). Whether the 17:00
  failure was a restart mid-stream or a different cause was not
  investigated this session.
- Ship-completion harvest: deciding whether to manually patch
  `clip_jobs.aa9be7f0` to `status='complete'` to let the workflow
  finalise and write Substack/LinkedIn/YouTube URLs. Risk:
  clipper-worker may serve in-memory state over DB on its
  `/clip/<id>` GET; needs verification before any patch.

---

## Session — 28 April 2026

### Completed

#### Trading Room — yarn.lock & dependency cleanup
- Resolved yarn.lock conflicts that were blocking clean installs
- Trading worker dependencies reconciled; `agex-hub`, `trading-worker`, and `charlie-watcher` all confirmed stable in PM2
- Market scanner (`3YahxqOguET3pifj`) extended from ~50 to ~400 Polymarket markets
- Added Silver and ETH to market scanner asset coverage
- Scanner confirmed live and running every 30 mins; Telegram alerts firing correctly
- Note: Polymarket currently has limited gold/silver/oil price-target markets — scanner will catch them when they open

#### Meta Ads Report — Split by Account (workflow `lf955LDteJ512RQi`)
- **Problem:** Emma Maidment and Flow OS ad account data was being merged into a single combined report, producing incorrect aggregated figures
- **Root cause:** `Process & Score Insights` node dropped account identity when merging insights; single Telegram message sent for all accounts combined
- **Fix:** Rewrote `Process & Score Insights` to preserve `account_id` and `account_name` on every row, group by account, and sort each account's ad sets independently
- Rewrote `Format Report` to produce **one Telegram message per account** (3 messages total: Flow States Retreats, Emma Maidment Business, Flow OS)
- Each message includes: spend, leads, avg CPL, top performers, needs-attention ad sets — all scoped to that account only
- Workflow re-activated; `availableInMCP` preserved
- Tomorrow's 9am report will deliver three separate Telegram messages

### Pending (carried forward)
- All P0/P1/P2 items from previous session remain open (see above)
- Flow States Collective ad account (`act_464237024205104`) label in workflow still reads "Flow States Retreats" — sticky note also needs updating. Low priority cosmetic fix.
- Confirm tomorrow's report fires correctly and figures match individual account dashboards


---

## Session — 29 April 2026

### Completed

#### Content Studio — Force JPEG output from FAL Gemini (workflow `kJ2EdkOeEAwVbMwU`)
- **Workflow:** Infographic Social Media Machine V2 - Flow Os
- **Problem:** Instagram Graph API was rejecting generated images. FAL Gemini was returning PNG by default; Meta's Graph API for IG/TikTok image upload is JPEG-only per Meta docs.
- **Fix:** Added `output_format: 'jpeg'` to the FAL Gemini request body on node `a4db370c-7eb7-4977-8082-4b863cdc9ee6` ("Generate Image - Variation 1"), field `parameters.jsonBody`.
- **Before:** `={{ JSON.stringify({ prompt: $json.variation1Prompt, aspect_ratio: '4:5' }) }}`
- **After:**  `={{ JSON.stringify({ prompt: $json.variation1Prompt, aspect_ratio: '4:5', output_format: 'jpeg' }) }}`
- `settings.availableInMCP` re-asserted to `true` on PUT (n8n public API resets it otherwise — known issue).
- PUT returned HTTP 200; `updatedAt` advanced from `2026-04-29T12:21:03.986Z` to `2026-04-29T14:13:42.202Z`.
- **Rollback artefact:** `/root/QClaw/n8n-workflows/kJ2EdkOeEAwVbMwU.before-jpeg-fix.json` (pre-patch GET response, 107024 bytes).
- **Post-patch artefact:** `/root/QClaw/n8n-workflows/kJ2EdkOeEAwVbMwU.json` (full patched workflow).
- Semantic diff between pre/post is exactly the two expected lines (one jsonBody removed, one added). No other nodes, settings, or connections changed.
- Workflow execution NOT triggered — manual test in n8n UI pending.

### Pending (carried forward)
- All P0/P1/P2 items from previous sessions remain open.

### Infrastructure note
- Added `N8N_BASE_URL` to `/root/.quantumclaw/.env` (was missing; only `N8N_API_KEY` and `N8N_SSH_KEY` present prior). Perms confirmed `600`. Value not logged.
- `.env` line 11 emits a `command not found` warning when sourced via `set -a; source ...; set +a` — a value contains an unquoted shell metacharacter. Worked around by extracting needed vars via `grep`/`cut` instead of sourcing. Worth fixing properly in a future hygiene pass.

---

## Session — 29 April 2026 — Meta Ads Optimisation Agent (workflow lf955LDteJ512RQi)

**Completed:**
- Rotated to long-lived Graph API token; stored as Header Auth credential
  (id: bJDoAH6FBEUyRbJK), removed from query params on Fetch nodes
- Fixed Fetch Ad Insights auth (genericCredentialType + httpHeaderAuth,
  credential attached); confirmed Bearer header injection working
- Removed Fetch Campaigns node entirely — was dead weight causing dual-fire
  of Process & Score (resulted in 2 Telegram messages + 2 Opus calls per run)
- Rewrote Process & Score Insights to correlate adsets back to source
  account via pairedItem + $('Split Accounts'); added belt-and-braces block
  ensuring all 3 accounts appear even when one has 0 active adsets
- Rewrote Build Opt Analysis Request prompt to mandate per-account sections
  and Telegram-safe Markdown (no ## headers, no pipe tables); bumped
  max_tokens 1500 → 2000
- Rewrote Format Report to consume AI markdown from upstream Anthropic node
  (was previously ignoring the AI output entirely)
- Verified end-to-end: single Telegram message, 3 account sections
  (Emma Maidment Business 4 adsets, Flow OS 2 adsets, Flow States Retreats
  0 adsets), cross-account priorities footer

**Pending (carparked for next session):**
- Sticky note on workflow still references "60-day expiry" — update to
  reflect long-lived token
- Log Report (Optional) Airtable node still points at literal
  "AIRTABLE_BASE_ID" placeholder — disabled but should be wired to Supabase
  or removed

**7 Pillars gate:**
- ✅ P4 Auth — token in n8n credential store, Bearer header injection,
  no credentials in workflow JSON
- ✅ P6 Security — token out of query string + workflow JSON, no
  hardcoded secrets, credential file permissions verified 600
- ✅ P7 Infra — workflow JSON backed up to n8n-workflows/ in this commit
- N/A P1 Frontend, P2 Backend, P3 Database, P5 Payments — no changes in
  these areas this session

#### Content Studio — Cap Hashtags Code node (workflow `kJ2EdkOeEAwVbMwU`)
- **Workflow:** Infographic Social Media Machine V2 - Flow Os
- **Problem:** Instagram's December 2025 hard 5-hashtag limit on Graph API publishing. AI Writer system prompt was updated by Tyson to instruct the LLM, but a code-level safety net is needed to defend against AI prompt drift.
- **Change:** Added a new `Cap Hashtags` Code node (id `0b0ab9e2-3a2c-494f-a4cb-352f5c890b5a`, position `[-7080, 1728]`) between `Cost Per Run` and the Blotato fan-out. Node trims any hashtag past the 5th from `captions.{facebook,instagram,twitter,youtube,linkedin,tiktok}` and tidies whitespace.
- **Connections rewired:**
  - `Cost Per Run` → previously `[Instagram [BLOTATO], Tiktok [BLOTATO]]`. Now: `[Cap Hashtags]`.
  - `Cap Hashtags` → `Instagram [BLOTATO]` (new).
  - `Tiktok [BLOTATO]` input edge **removed entirely** — Tyson is locked out of TikTok in Blotato; not re-routing through Cap Hashtags.
  - Twitter / Facebook / YouTube / LinkedIn Blotato nodes remain disconnected (Tyson's debug state); they will need to be re-wired manually from `Cap Hashtags` when ready.
- **Blotato `postContentText` updated** on all 6 platform nodes (Twitter, Instagram, Facebook, YouTube, LinkedIn, TikTok) from `={{ $('AI Writer - Content Generator').item.json.choices[0].message.content.captions.<X> }}` → `={{ $json.captions.<X> }}`. So when Tyson reconnects them, they read the capped output. YouTube's `postCreateYoutubeOptionTitle` was not touched (no hashtags in titles).
- `settings.availableInMCP` re-asserted to `true` on PUT.
- PUT returned HTTP 200; `updatedAt` advanced to `2026-04-29T18:51:33.781Z`. Node count 24 → 25.
- Verified all 6 platforms' new `$json.captions.<X>` literal landed cleanly via grep round-trip on the saved JSON.
- **Rollback artefact:** `/root/QClaw/n8n-workflows/kJ2EdkOeEAwVbMwU.before-hashtag-cap.json` (73701 bytes, pre-patch GET).
- **Post-patch artefact:** `/root/QClaw/n8n-workflows/kJ2EdkOeEAwVbMwU.json` (94335 bytes).
- Workflow execution NOT triggered — manual UI test pending with Tyson.

#### Trading Market Scanner — Restored after 2-day silent failure (workflow `3YahxqOguET3pifj`)
- **Workflow:** Trading - Market Scanner. Cron: hourly Mon, every 2h Tue–Fri, every 4h weekend.
- **Symptom:** No Telegram updates since Tue 28 Apr 2026 18:00 UTC. 22 consecutive failed runs (status=error, ~1s each) before detection on Wed 29 Apr 2026 ~19:30 UTC. Detection lag: ~25h. Heartbeat now in place — would have been ~2h instead.
- **Root cause:** Workflow edit on **2026-04-28T18:30:52Z** introduced a templated `Notify Edge` body referencing `$json.highEdge.length` and `$json.noEdge.length` — but no upstream node produced a `{ highEdge, noEdge }` object. The pipeline reached `Notify Edge` (Analyse Edge → Run Market Sims → Has Edge?), then n8n's HttpRequestV3 pre-flight JSON validation rejected the evaluated body. Has Edge? IF was also broken (same bad refs) but routed items through anyway because both `main[0]` and `main[1]` pointed at Notify Edge — the IF was a no-op pass-through.
- **Raw exception text** (execution 723655, last in series):
  ```
  NodeOperationError: JSON parameter needs to be valid JSON
      at ExecuteContext.execute (HttpRequestV3.node.ts:442:15)
      at WorkflowExecute.executeNode (workflow-execute.ts:1045:31)
      at WorkflowExecute.runNode (workflow-execute.ts:1226:22)
  lastNodeExecuted: "Notify Edge"
  ```
- **Triage findings** (none of the brief's three hypotheses were the cause):
  - Sim worker on `:4001`: healthy (HTTP 200 in 230ms; pid 2276594, plain python3 — no pm2 entry).
  - Cron firing: yes, on schedule. n8n in Docker (`n8n-project-n8n-1`) on a separate host (157.230.216.158), not on the qclaw box.
  - Markets passing filter: yes — `Build Run Summary` `stats.passed_filter` is consistently 2–3 BTC markets per run.
  - Polymarket commodity coverage: thin. Across 3500 open markets, 11 hits for `gold|silver|wti|brent|crude|oil price|barrel`; most "gold" hits are Trump "Gold Cards" merch, not commodity. Regex broadening landed but real bottleneck is payload availability, not the keyword list.
- **Fixes applied** (priority order swapped from original brief — restore Telegram first, regex broadening last):
  1. **New `Build Run Summary` Code node** between `Run Market Simulations` and `Has Edge?`. Aggregates sim outputs back with original Analyse Edge fields via `$('Analyse Edge').itemMatching(i)`. Partitions into `highEdge` / `noEdge` / `neutral` by asymmetric thresholds: `+0.07` for high, `-0.10` for no, gated on `volume ≥ 5000`. Emits `stats {fetched, passed_filter, markets_simulated, sim_errors, high_edge_count, no_edge_count, neutral_count}` and a Supabase-shaped `sims` array.
  2. **`Has Edge?` IF rewired**: TRUE → `Notify Edge`, FALSE → new `NoOp End` terminator (was previously both → Notify Edge).
  3. **`Save Simulations` reconnected** off `Build Run Summary`. Was orphaned (`"Save Simulations":{"main":[[]]}`). Credential unchanged — uses stored `Supabase FSC` httpHeaderAuth (id `Nd2uuX5t9KEwbQPv`); no raw service-role key in workflow JSON.
  4. **`Notify Heartbeat` HTTP node** off `Build Run Summary` — fires every successful run with `🔁 Scanner run | <ts> | Fetched: N | Passed filter: N | Sims: ok/total | Edges: H high / N no`. `continueOnFail: true`, `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 2000`.
  5. **`Merge Pages` node** before `Analyse Edge` — combines the four `Fetch Page*` HTTP outputs into a single execution stream, fixing per-execution `seen` Set dedup that previously failed across the 4 parallel Analyse Edge runs.
  6. **`Analyse Edge` regex broadened** — adds bare-number `(?:above|over|reach|hit|cross|exceed|surpass|past|to|at)\s+\$?<num>` fallback alongside the original `\$<num>` matcher, with per-asset `minPrice` floor (`btc:10000, eth:500, gold:1000, silver:10, wti:30, brent:30`) so years/IDs cannot be misread as targets. False-positive `gold cards / olympic gold / gold medal / golden bachelor / golden globe` exclusions added to the sports/non-commodity filter.
  7. **`Notify Edge` resilience** — `continueOnFail: true`, retry 3× / 2s backoff, 15s timeout, hardcoded chat_id replaced with `$env.TELEGRAM_TRADING_CHAT_ID`.
  8. **Env hardening**: `SIM_HOST=http://138.68.138.214:4001` and `TELEGRAM_TRADING_CHAT_ID=1375806243` appended to `/home/n8nadmin/n8n-project/.env` on the n8n host (NOT `/root/.quantumclaw/.env` on qclaw — n8n loads via `env_file:` in compose; brief had this conflated). Container recreated via `docker compose up -d n8n` (NOT `restart` — restart keeps old env). Backup: `.env.before-trading-fix-2026-04-29`. Permissions still `-rw------- n8nadmin:n8nadmin`.
  9. **`Run Market Simulations` URL** → `={{ $env.SIM_HOST }}/simulate` (was hardcoded IP).
  10. **New companion workflow `Trading - Error Handler`** (id `7kpNnMtnuDWXgWcX`). Single ErrorTrigger → Telegram HTTP node sending `🚨 Workflow error\nWorkflow: <name>\nExecution: <id>\nNode: <node>\nMessage: <msg>\nLast node: <last>`. Wired as `settings.errorWorkflow` on the scanner. Two-day silent failures are now structurally impossible — any run that errors before reaching `Notify Heartbeat` triggers a Telegram alert via the error workflow.
- **Secondary follow-up bug discovered during verification:** First post-patch run (723715) succeeded but `Save Simulations` returned `400 - {"code":"22P02","message":"invalid input syntax for type uuid: \"540844\""}`. The `trading_simulations.market_id` column is `uuid`, but Polymarket emits integer-string IDs. Historical successful rows have `market_id: NULL`. Fix: dropped `market_id` from the `sims` payload, moved Polymarket's id into `raw_output.polymarket_market_id` so the linkage isn't lost. Verified row 2 of execution 723751 contains `raw_output.polymarket_market_id: "540844"`, `raw_output.question: "Will bitcoin hit $1m before GTA VI?"`, `probability: 0.0002`, `current_price: 75515.19`, `edge: -0.4903`, full `macro_factors {dxy, tnx}`.
- **Verification (live, not theoretical):**
  - Execution 723715 (20:05 UTC): finished=t, status=success, 6.1s, lastNodeExecuted=`Notify Heartbeat` — all 13 nodes ran.
  - Execution 723751 (20:14 UTC, after market_id fix): finished=t, status=success, 4.6s — **2 rows landed in `trading_simulations`** with `created_at >= 2026-04-29T20:13:09Z`.
  - Tested via temporary `* * * * *` cron expression added to `Smart Schedule`, removed immediately after each verification (3 extra rows in execution log, no production impact).
- **Topology after fix** (14 nodes):
  - `Smart Schedule` → fan-out to `Fetch Polymarket / Fetch Page 2/3/4`
  - 4× Fetch → `Merge Pages` (append, 4 inputs) → `Analyse Edge` (runs once now, dedup intact)
  - `Analyse Edge` → `Run Market Simulations` (env URL) → `Build Run Summary`
  - `Build Run Summary` → fan-out: `Has Edge?` + `Save Simulations` + `Notify Heartbeat`
  - `Has Edge?` TRUE → `Notify Edge` ; FALSE → `NoOp End`
- **Repo artefacts:**
  - Pre-patch backup: `/root/QClaw/n8n-workflows/trading-market-scanner.before-2026-04-29-fix.json` (33908 bytes, broken state)
  - Post-patch live: `/root/QClaw/n8n-workflows/trading-market-scanner.json` (43907 bytes, 14 nodes)
  - New: `/root/QClaw/n8n-workflows/trading-error-handler.json` (4449 bytes)
- **Settings re-asserted on PUT:** `availableInMCP: true ✓`, `errorWorkflow: 7kpNnMtnuDWXgWcX ✓`, `executionOrder: v1`, `callerPolicy: workflowsFromSameOwner`. Cron expressions back to original 3 (`0 */1 * * 1`, `0 */2 * * 2-5`, `0 */4 * * 0,6`).

**Pending (carparked for next session):**
- Polymarket commodity coverage is thin even with broadened regex. If commodity edge is the goal, supplement with Kalshi/PredictIt sources rather than expanding keyword lists.
- The Apr 28 broken edit pattern would benefit from a pre-deploy lint of n8n expressions (catch references to fields no upstream node produces) — could be a Code-node-only smoke test that walks the graph and grep-checks `$json.<key>` against upstream emitters.
- Clipper Phase 2 (face detection) still next.

**7 Pillars gate:**
- ✅ P3 Database — `trading_simulations` table mapping verified (uuid mismatch caught and routed via `raw_output`)
- ✅ P4 Auth — Supabase FSC credential unchanged (stored, not raw); n8n public API key used for orchestration only
- ✅ P6 Security — no hardcoded chat_id / sim host / service role key in workflow JSON; `/root/.quantumclaw/.env` permissions `600` unchanged; `/home/n8nadmin/n8n-project/.env` permissions `600` unchanged; backups created before each in-place edit
- ✅ P7 Infra — workflow + error handler + .env backups committed to repo; live state matches repo state
- N/A P1 Frontend, P2 Backend, P5 Payments — no changes in these areas this session

## 2026-04-30 — Crete Publishing Pipeline Hardening

**Goal:** Stop the silent-fail cascade where Instagram rows with `media_url=NULL` would be picked up by `Crete - Scheduled Publisher`, posted to Blotato (which rejected them), and never advance past `status=approved` — re-failing every hour. Three rows had been stuck for up to 96h before detection.

**Workflows touched:** `Crete - Scheduled Publisher` (`9kTWhh9PlxMpyMlp`), `Crete - Content Publish` (`zXKBjp3yjW2oR2Mj`), `Crete - Content Generator` (`tnvXFYvODL1PrhJa`). Reference error workflow: `Trading - Error Handler` (`7kpNnMtnuDWXgWcX`).

### Diagnosis (deferred from build brief §2.5)

Read of `src/dashboard/server.js:1926` shows the route is sound:
- **Auth:** Bearer header `Authorization: Bearer <token>` OR `?token=<value>` query param, validated by the global auth middleware (lines 380–410). Localhost is NOT auto-trusted (verified: `curl http://localhost:4000/...` still returns 401).
- **Token env var:** `process.env.DASHBOARD_AUTH_TOKEN` (or `config.dashboard.authToken` from `~/.quantumclaw/config.json`).
- **Success response:** `{ success: true, url: "https://media.creteprojects.com/images/<uuid>.png", style, key }`. URL prefix from `CRETE_R2_PUBLIC_URL` env var (default `https://media.creteprojects.com`). All required env vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CRETE_R2_BUCKET_NAME`, `CRETE_R2_PUBLIC_URL`) ARE present in `/root/.quantumclaw/.env`.

`git log src/dashboard/server.js --since=2026-04-21 --until=2026-04-23`:
- `26fe992 2026-04-23 feat: migrate Crete R2 to dedicated bucket with custom domain`
- `07ce57a 2026-04-22 fix: scheduled publishing + stock photo selection for Crete content`
- `0597cbc 2026-04-21 feat: GHL Marketing dashboard tab + fix n8n workflow auth + regenerate webhook`

The Apr 21 commit (`fix n8n workflow auth`) and Apr 23 R2 migration line up with the date the brief identifies as the start of `text_card` failures (last successful gen Apr 21). Most plausible failure mode: n8n's HTTP node `Generate Text Card` was sending an outdated auth token after Apr 21, OR the Apr 23 R2 migration changed the response URL host in a way `Merge Image URL` couldn't parse — combined with the existing silent-null pattern, every text_card slot since produced `media_url=NULL` and the failure went undetected. **Definitive root cause requires a request-log trace from the n8n side; deferred.** This session removes the silent-null behaviour and adds a stock-photo fallback so the failure mode is loud + non-blocking from now on.

### Schema migration — `crete_publish_retry_tracking`

Applied via Supabase MCP on project `fdabygmromuqtysitodp` (n8n database):

```sql
ALTER TABLE public.crete_content_queue
  ADD COLUMN IF NOT EXISTS publish_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crete_content_queue_publishable
  ON public.crete_content_queue (status, scheduled_for, publish_attempts)
  WHERE status = 'approved';
```

Verified: 3 columns added, partial index created, RLS still enabled (`relrowsecurity=t`, 1 policy). The `status` column has **no CHECK constraint** — free-text — so `failed` and `archived` are usable without DDL.

Migration SQL file committed at `n8n-workflows/migrations/2026_04_30_crete_publish_retry_tracking.sql`.

### `Crete - Scheduled Publisher` (`9kTWhh9PlxMpyMlp`)

3 → 5 nodes. Settings: `errorWorkflow=7kpNnMtnuDWXgWcX`, `availableInMCP=true` re-asserted on PUT.

- **`Query Approved Due` HTTP node**: added `publish_attempts=lt.3` query param (so permanently-failed rows stop being retried), bumped `limit` from `5` to `10` for headroom. Attached `Supabase FSC` credential (id `Nd2uuX5t9KEwbQPv`); inline `apikey` / `Authorization: Bearer {{$env.SUPABASE_ANON_KEY}}` headers retained per the GHL Marketing pattern (see "Tech debt" below).
- **`Trigger Publish` HTTP node**: added `onError: continueRegularOutput`. Reason: when `Crete - Content Publish` returns 502 on permanent failure (3 attempts exhausted), the per-item iteration must keep running for rows 2-N rather than halting the whole hourly run.
- **New `Build Summary` Code node** as a parallel branch off `Hourly Schedule` (sibling of `Query Approved Due`). `alwaysOutputData: true`, "Run Once for All Items" mode, body emits `[{json: {count: $('Query Approved Due').all().length, ids: [...], timestamp}}]`.
- **New `Heartbeat` Telegram node** downstream of `Build Summary`. Posts `💛 Scheduled Publisher tick: triggered N item(s)` to chat `1375806243`.

**Topology gotcha (caught + fixed live):** First PUT placed `Heartbeat` after `Trigger Publish`. The 14:00 UTC tick ran `success` in n8n executions but **no Telegram message arrived**. Diagnosis via `GET /api/v1/executions/<id>?includeData=true`:
```
runData keys: ["Hourly Schedule", "Query Approved Due"]
Hourly Schedule: 1 item
Query Approved Due: 0 items
```
n8n skips downstream nodes when input has 0 items. With an empty queue (the most common case for this hourly publisher), neither `Trigger Publish` nor `Heartbeat` executed — defeating the heartbeat's whole purpose (silent-skip detection on cron jobs). Fix: re-route `Heartbeat` as a **parallel branch off `Hourly Schedule`** (which always emits 1 item), with `Build Summary` between Schedule and Heartbeat. `Build Summary` reads `$('Query Approved Due').all()` for the count, relying on n8n's fan-out connection-list ordering: `Hourly Schedule` lists `Query Approved Due` FIRST, `Build Summary` SECOND, so QAD's subtree completes before Build Summary executes. **Lesson for future heartbeat builds**: never route a heartbeat downstream of a node that may emit 0 items. Always source it from an always-emits parent (Schedule, Webhook, Manual trigger) or use `alwaysOutputData: true` on a node whose input is guaranteed non-empty.

**Verification (live, post-fix):**
- Fixed Scheduled Publisher PUT returned HTTP 200; topology confirmed via GET — `Hourly Schedule.main[0]` = `[Query Approved Due, Build Summary]` in that order, `Build Summary.alwaysOutputData=true`.
- Triggered via temporary fast cron: PUT with `Hourly Schedule.parameters.rule.interval[0].expression = "0 * * * * *"` (every minute on :00) at 14:58:14 UTC → execution `724304` fired at 14:59:00 UTC, status=success, finished=true. Reverted to `0 0 * * * *` immediately after (PUT HTTP 200).
- Execution `724304` `runData` keys: `["Hourly Schedule", "Query Approved Due", "Build Summary", "Heartbeat"]` — all 4 nodes ran (was 2 nodes pre-fix).
- Heartbeat HTTP node return body: `{"ok":true, "result":{"message_id":3108, "chat":{"id":1375806243, "username":"tysonven"}, "text":"💛 Scheduled Publisher tick: triggered 0 item(s)"}}`. Telegram delivery **confirmed end-to-end** via the API response (no longer awaiting visual confirmation).

### `Crete - Content Publish` (`zXKBjp3yjW2oR2Mj`)

14 → 24 nodes. Settings: `errorWorkflow=7kpNnMtnuDWXgWcX`, `availableInMCP=true` re-asserted on PUT.

**New validation path (between `Extract Item` and `Platform Switch`):**
- `Validate Media` Code node — flags `_validation_failed=true, _failure_reason='missing_media_for_instagram'` for Instagram rows missing `media_url`.
- `Validation Failed?` IF node — `main[0]` (true) → Mark Failed branch; `main[1]` (false) → `Platform Switch` (existing path).
- `Mark Failed (Validation)` HTTP PATCH → sets `status='failed', publish_attempts=current+1, last_error='missing_media_for_instagram', last_attempt_at=now()`. Supabase FSC credential attached.
- `Telegram Validation Failed` → posts `🛑 Crete publish blocked — <title> | reason: <_failure_reason> | id: <id>` to chat `1375806243`. Pulls `_failure_reason` from `$('Validate Media').item.json` (NOT `$('Extract Item')` — the field is set by Validate Media's output, an earlier draft used the wrong reference and was caught and re-PUT during validation).
- `Respond Validation Failed` → `responseCode: 422`, body `{success: false, reason: <_failure_reason>, content_id}`.

**New publish-failure path (off Blotato/FB error outputs):**
- `LinkedIn Post (Blotato)`, `Instagram Post (Blotato)`, `Facebook Post` all set to `onError: continueErrorOutput`. Their `main[1]` (error) outputs route to `Increment Attempts`.
- `Increment Attempts` Code → builds PATCH body `{publish_attempts: prev+1, last_error: <err.message ∥ JSON.stringify(err)>.slice(0,1000), last_attempt_at, status: attempts >= 3 ? 'failed' : 'approved', _will_retry}`.
- `Patch Attempts` HTTP PATCH → applies it. Supabase FSC credential attached.
- `Telegram Publish Failed` → `⚠️ Crete publish failed (will retry): ...` for attempts 1-2, `🛑 Crete publish PERMANENTLY failed (3 attempts): ...` for attempt 3.
- `Respond Publish Failed` → `responseCode: 502`, body `{success: false, attempt, will_retry, content_id, error}`.

**Success path:**
- `Update Status` HTTP PATCH body now includes `publish_attempts: ($('Extract Item').item.json.publish_attempts || 0) + 1, last_attempt_at: now()` alongside the existing `status='published', published_at=now()`. Supabase FSC credential attached.
- `Telegram Notify` → `Heartbeat` (new) → `Respond` (success path tail). Heartbeat fires per successful publish: `💛 Crete publish OK — <title> | platform=<...> | id=<...>`.

**Validation test (live):**
- Inserted synthetic test row id `d4fec160-0657-4167-b9b0-1325ffd0c601`: `platform='instagram'`, `media_url=NULL`, `status='approved'`, `scheduled_for=now()`, `title='[TEST-VALIDATION-2026-04-30] synthetic missing-media probe'`.
- POSTed to `https://webhook.flowos.tech/webhook/crete-content-publish` with `{content_id: ...}`.
- First run (after initial PUT): HTTP 422 in 2.04s, body `{"success":false,"reason":"validation_failed","content_id":"..."}`. Row state confirmed: `status='failed'`, `publish_attempts=1`, `last_error='missing_media_for_instagram'`, `last_attempt_at=2026-04-30T13:46:03Z`. **Pass**, but `reason` field returned the fallback string `validation_failed` instead of `missing_media_for_instagram` because `Respond Validation Failed`'s expression read `$('Extract Item').item.json._failure_reason` — Extract Item runs before Validate Media so the field is undefined there.
- Fix: changed all references from `$('Extract Item').item.json._failure_reason` to `$('Validate Media').item.json._failure_reason` (also affected `Telegram Validation Failed`). Re-built, re-PUT (HTTP 200).
- Second run: HTTP 422, body `{"success":false,"reason":"missing_media_for_instagram","content_id":"d4fec160..."}` — precise reason now flows through. Row state: `publish_attempts=2`, `last_error='missing_media_for_instagram'`, `last_attempt_at=2026-04-30T14:00:40Z`. **Pass.**
- No Blotato call attempted in either run (validation short-circuited before `Platform Switch`).
- Test row archived: `UPDATE crete_content_queue SET status='archived', last_error='archived after synthetic validation test passed (build brief 2026-04-30)' WHERE id='d4fec160-0657-4167-b9b0-1325ffd0c601'`.

### `Crete - Content Generator` (`tnvXFYvODL1PrhJa`)

15 → 18 nodes. Settings: `errorWorkflow=7kpNnMtnuDWXgWcX`, `availableInMCP=true` re-asserted on PUT.

- **`Merge Image URL` Code node rewritten** — happy path unchanged (assigns `cleanRow.media_url = apiResp.url, metadata.image_source='generator'`). Failure path now `throw new Error('generate-image API returned no url for slot <slot|title>. Response: <stringified apiResp>.slice(0,500)')` instead of silently null'ing. The Error Workflow (`7kpNnMtnuDWXgWcX`) catches this and posts a Telegram alert.
- **`Select Random Photo` Code node rewritten** — preserves existing theme-filter semantics, but now `throw new Error('Photo library returned 0 photos. Theme=<...>')` if the library is empty, and `throw new Error('Photo library returned no usable photo for theme: <...>. Library size: N')` if filtering yields nothing usable. Output also tags `metadata.image_source='library_fallback'` (vs `'library'`) when the row arrived via the new fallback path.
- **`Generate Text Card`** set to `onError: continueErrorOutput`.
- **New `Photo Fallback` Code node** on the `Generate Text Card` error output → builds a row with `_needsPhoto=true, _photoTheme=<image_theme∥theme>, _fallback_from_generator=true`.
- **New `Telegram Fallback Alert`** → `⚠️ Image generator unavailable, fell back to stock photo for <title>`. Loud but non-blocking.
- **Wiring:** `Generate Text Card` `main[0]` → `Merge Image URL` (existing); `Generate Text Card` `main[1]` (error) → `Photo Fallback` → `Telegram Fallback Alert` → `Fetch Photo Library` → `Select Random Photo` → `Insert to Supabase` (existing path resumes).
- **`Insert to Supabase`** — Supabase FSC credential attached.
- **`Telegram Notify` → `Heartbeat` (new)** at tail. Heartbeat: `💛 Content Generator tick OK — generated N row(s)`.

**Regression discovered + fixed (2026-05-02):** First natural tick after PUT was 2026-05-01 12:00 UTC (n8n's effective hour for cron `0 0 8 * * *` — timezone-shifted from 08:00 UTC). Execution `724874` errored at `Insert to Supabase` with HTTP 400:
```
NodeApiError: 400 — {"code":"PGRST204","details":null,"hint":null,
  "message":"Could not find the 'photos' column of 'crete_content_queue' in the schema cache"}
lastNodeExecuted: "Insert to Supabase"
```
Root cause: my rewritten `Select Random Photo` set `const row = $input.item.json` — but `$input.item.json` IS the photo-library response (contains `photos[]`), not the Crete row. The original (working) code used `$('Image Router').item.json` for row context. After my edit, the row sent to Supabase had `{photos: [...22 photos...], media_url, metadata}` and was missing all the actual content fields (title, body, platform, content_type, etc.). PGRST rejected the unknown `photos` column. Hard regression — the n8n Code-node row-context source is non-obvious and I substituted incorrectly. **Fix (PUT'd 2026-05-02 ~08:30 UTC):** restore `$('Image Router').item.json` as the primary row source, plus add a try/catch fallback to `$('Photo Fallback').item.json` for the text-card-failed path (which the original code didn't cover because Photo Fallback didn't exist). Also strip `_needsImage`/`_apiBody` in the destructure so they don't leak into the Insert payload via the fallback path. **n8n's `.item` accessor is paired-item-aware**, so multi-item executions correctly resolve each Select Random Photo iteration to its corresponding Image Router output.

**Pending validation (carparked):** next natural Content Generator tick at **2026-05-02 12:00 UTC**. Watch for: (a) Insert to Supabase succeeds (HTTP 200/201) for any photo-path slots; (b) `metadata.image_source='library'` for normal photo path or `'library_fallback'` for text-card-failed path; (c) no `'photos'` field in the inserted row. Rollback plan if it fails: revert Content Generator from `n8n-workflows/crete-content-generator.before-2026-04-30-fix.json` via `curl -X PUT $N8N_BASE/api/v1/workflows/tnvXFYvODL1PrhJa -d @<that-file>` (filtering to {name,nodes,connections,settings}); the original silent-null behaviour returns but the queue stops failing loudly. Any future content generated with `media_url=NULL` would then be caught by the new `Crete - Content Publish` validation path (which IS verified as working) — it would mark `status=failed, last_error='missing_media_for_instagram'` instead of silently retrying.

### Recovery (already complete pre-session)

The 3 stuck rows from the build brief were resolved before this session by Tyson:
- `c9e4332b-baa8-4b10-898a-6e847fb9e764` (2026-04-25): archived (5 days stale)
- `a19cdd5b-f64c-453a-95db-e02e65cadf8c` (2026-04-25): archived (5 days stale)
- `5f560a1f-6dbe-4338-9a42-c8dae4982eb0` (2026-04-30): media_url switched to a stock photo, published manually via Blotato submission `0cab6040-5fd1-4314-8cf0-4642bdeadc82` (Path A in the brief).

Pre-session DB state confirmed: 24 published, 2 archived, 0 approved+due+attempts<3.

### Repo artefacts

```
n8n-workflows/
  crete-scheduled-publisher.json                       # 6906 bytes — post-PUT live state
  crete-scheduled-publisher.before-2026-04-30-fix.json # 5409 bytes — original
  crete-content-publish.json                           # 36146 bytes — post-PUT live state
  crete-content-publish.before-2026-04-30-fix.json     # 20785 bytes — original
  crete-content-generator.json                         # 30705 bytes — post-PUT live state
  crete-content-generator.before-2026-04-30-fix.json   # 24974 bytes — original
  migrations/
    2026_04_30_crete_publish_retry_tracking.sql        # 978 bytes — applied via Supabase MCP
```

### Tech debt — pending next session (n8n-host access required)

Two items deferred because they require shell on the n8n host (`n8nadmin@<n8n-server-ip>`). The `N8N_SSH_KEY=/root/QClaw/charlie_n8n_key` env var on qclaw points at a path that doesn't exist on this box, so SSH to the n8n host wasn't possible this session.

1. **Webhook auth + Nginx rate limit** (build brief step 6). `Crete - Content Publish`'s webhook is currently open to the public internet — only Scheduled Publisher legitimately calls it, but anyone with the URL can trigger publishes. Plan: generate `CRETE_WEBHOOK_TOKEN` via `openssl rand -hex 32`, add to `/root/.quantumclaw/.env` AND `/home/n8nadmin/n8n-project/.env` on the n8n host, recreate the n8n container via `docker compose up -d` (NOT restart — env_file change), add `Verify Token` Code node in Content Publish, add `X-Webhook-Token` header to Trigger Publish in Scheduled Publisher, add Nginx `limit_req zone=publish burst=10 nodelay` on `/webhook/crete-content-publish` in `webhook.flowos.tech` vhost.
2. **Full Supabase FSC credential migration** (build brief step 7 caveat). Current state: the `Supabase FSC` credential (id `Nd2uuX5t9KEwbQPv`) is now attached to every Crete HTTP node that hits Supabase, AND the inline `apikey` / `Authorization: Bearer {{$env.SUPABASE_ANON_KEY}}` headers are retained — same pattern as `ghl-marketing-content-generator.json`. The brief's intent ("removes hardcoded reliance on `$env.SUPABASE_ANON_KEY` for Crete") would mean removing the inline headers. The n8n public API doesn't expose credential values so the FSC credential's actual header contribution can't be inspected; risk-averse path was to preserve current functionality and defer the strip-out until the credential's role can be verified.

### 7 Pillars gate

- ✅ **P3 Database** — migration applied, RLS preserved, partial index created, schema verified post-migration.
- ✅ **P4 Auth** — Supabase FSC credential attached (stored, not raw); inline anon-key headers retained as transitional state per existing GHL pattern.
- ❌ **P4 Auth (deferred)** — Content Publish webhook still unauthenticated. Blocked on n8n-host access. Risk window is unchanged from pre-session state (already open).
- ✅ **P6 Security** — no hardcoded credentials in any modified workflow JSON; service tokens stay in `/root/.quantumclaw/.env` (perms `600`); test row id `d4fec160-...` archived (audit trail preserved, not deleted).
- ❌ **P6 Security (deferred)** — Nginx rate limit on `/webhook/crete-content-publish` not added. Same blocker as P4 webhook auth.
- ✅ **P7 Infra** — workflow + migration + backup JSONs all committed; live state matches repo state; `availableInMCP: true` re-asserted on every PUT (per memory note: PUT body is `{name, nodes, connections, settings}` and resets unspecified flags).
- N/A **P1 Frontend, P2 Backend, P5 Payments** — no changes in these areas this session.

### Pending validation (carparked)

- ~~**Heartbeat in Telegram**~~ — **VERIFIED** via fast-cron probe at 2026-04-30 14:59:00 UTC. Telegram API returned `{"ok":true, "result":{"message_id":3108, "text":"💛 Scheduled Publisher tick: triggered 0 item(s)"}}`. All 36+ subsequent natural ticks (15:00 UTC 2026-04-30 → 08:00 UTC 2026-05-02) have run `status=success`. Pattern is solid.
- ~~**Content Generator (post-fix)**~~ — **VERIFIED** at 2026-05-02 12:00 UTC natural tick (execution `725593`, status=success, all 13 expected nodes ran). Two rows inserted cleanly: `fc2e6f2f-8241-4e9f-bbc3-c6260df4f02e` (Instagram, image_type=photo, metadata.image_source='library', metadata.photo_id='photo-007', has_media=true) and `146db1fa-ee3b-40fb-8ec5-4e04007e6279` (Facebook, image_type=null, no photo needed, flowed through Image Router unchanged). Both rows already `status=published` — entire pipeline healthy end-to-end post-fix. The 2026-05-01 12:00 UTC tick was the only casualty of the regression (status=error, no row inserted that day).
- **Image generator root cause** — code review didn't find a smoking gun; needs a request-log trace from the n8n side comparing pre/post Apr 21 to determine whether auth token, body shape, or response URL parsing was the failure. Deferred until n8n-host shell access lands.


## [2026-05-03] Charlie Overhaul — Phase 3 Design Complete

All six components of Charlie 2.0 designed and locked:
1. Bootstrap mechanism — five-layer load, session-cached, observable
2. Canonical doc loading — identity/state/operational/capability layers, single source of location pattern
3. Skill loading strategy — pragmatic always-on/on-demand split, upgradeable to intent classification
4. Tool surface overhaul — lane discipline at tool level, dead stubs removed, scoped narrow tools added
5. Verification gates — soft (prompt) + hard (runtime) enforcement on completion, delegation, state, tool existence, lane
6. Claude Code delegation bridge — audit-first dispatch, Supabase-tracked, scope-gated authorisation

See CHARLIE_OVERHAUL.md for full design. Phase 4 implementation prerequisites and slicing defined.

## 2026-05-03 — FSC credential header contribution: confirmed (resolves step 7 ambiguity)

**Trigger:** during the 2026-04-30 Crete pipeline hardening (commit `91746aa`), step 7 ("strip inline `apikey`/`Authorization: Bearer` headers in favour of the `Supabase FSC` credential") was deferred because the n8n public API doesn't expose credential values, so the FSC credential's actual header contribution couldn't be inspected. Without that, removing inline headers risked breaking auth.

**Probe procedure:** created a one-shot temporary workflow `Crete - FSC Credential Probe (TEMP 2026-05-03)` (id `hAOfnl9ifMBzM9FF`) with three nodes — Webhook → HTTP Request → Respond. The HTTP Request node hit `https://httpbin.org/headers` (which echoes received headers back), with the `Supabase FSC` credential (id `Nd2uuX5t9KEwbQPv`, type `httpHeaderAuth`) attached and **no inline auth headers**. Triggered via `curl -X POST https://webhook.flowos.tech/webhook/crete-fsc-probe-2026-05-03` then deactivated + deleted (404 confirmed).

**Result:** httpbin echoed only generic transport headers — `Accept`, `Accept-Encoding`, `Host`, `User-Agent: axios/1.12.0`, `X-Amzn-Trace-Id`. **No `apikey`, no `Authorization`, no Supabase token.** The FSC credential adds NOTHING to outgoing requests.

```json
{
  "headers": {
    "Accept": "application/json,text/html,application/xhtml+xml,application/xml,text/*;q=0.9, image/*;q=0.8, */*;q=0.7",
    "Accept-Encoding": "gzip, compress, deflate, br",
    "Host": "httpbin.org",
    "User-Agent": "axios/1.12.0",
    "X-Amzn-Trace-Id": "Root=1-69f73eb5-7624fb7e3977c8823f62c0d0"
  }
}
```

**Implication:** the `Supabase FSC` credential is a misconfigured / empty `httpHeaderAuth` (the Name/Value pair is unset, or the credential exists in name only). Every Crete and GHL workflow that references it has been authenticating **purely via the inline `apikey` / `Authorization: Bearer {{$env.SUPABASE_ANON_KEY}}` headers**. The credential attachment is cosmetic.

**Step 7 verdict — false premise:** the brief's plan to "strip inline headers in favour of the FSC credential" cannot proceed as written. Stripping inline headers would leave the workflows with no auth → 401 from Supabase on every call. **Do NOT strip inline headers.** Two valid forward paths:
1. **Populate the FSC credential properly via the n8n UI** (set its Name/Value to e.g. `apikey: <service-role-key>` plus a second credential for `Authorization`), THEN strip inline headers. Net win: secrets stop flowing through `$env.SUPABASE_ANON_KEY` references in workflow JSON. Requires n8n UI session.
2. **Accept the FSC credential is a no-op and detach it** from the Crete + GHL HTTP nodes (keep inline headers as the actual auth source). Cleanup, no auth change. Lower-value but removes a misleading attribution.

The 2026-04-30 commit's "Tech debt — pending next session" entry is therefore **partially obsolete**: the n8n-host SSH access is still required for step 6 (webhook auth + nginx rate limit), but step 7 needs a different action (n8n UI session OR detach-as-cleanup), not the strip-inline-headers action originally specified.

**Repo artefacts:** none — temp workflow created and deleted in this probe; no permanent changes to live workflows. Workflow JSON for the probe (5 nodes incl. trigger/respond) lived only at `/tmp/crete-build/fsc-probe-workflow.json` on Tyson's laptop and qclaw `/tmp`.

**Pillars gate:** N/A — pure inspection, no production state changed.

## [2026-05-03] Charlie Overhaul — Pre-Slice Foundation Docs Committed

Four foundation docs created in repo root:
- LOCATIONS.md — single source of location for all state, logs, configs, docs
- KEYWORD_REFERENCE.md — skill loading keyword cheat sheet (for Tyson reference)
- CLAUDE_CODE_OPERATING_RULES.md — discipline rules for Claude Code sessions
- CLAUDE_CODE_INVENTORY.md — Claude Code's tool surface and access scope

Phase 4 implementation begins after remaining pre-slice docs (FLOW_OS_STATE.md, FLOW_OS_SPECIALISTS.md, N8N_WORKFLOW_INDEX.md, CHARLIE_ROLE.md) are populated in subsequent sessions.

## [2026-05-03] Charlie Overhaul — CHARLIE_ROLE.md Committed

Canonical role spec for Charlie committed to repo root. This file is loaded into Charlie's context on every session as part of the identity layer (per Phase 3 Component 1 bootstrap order). It defines: identity, in-lane vs out-of-lane behaviour, non-negotiable verification reflexes, communication discipline, escalation paths, multi-business-unit awareness, session-start read order, write authority by target, and active guards against the five failure patterns.

Pre-slice progress: 1 of 4 remaining canonical docs complete (CHARLIE_ROLE.md). Still pending: FLOW_OS_SPECIALISTS.md, FLOW_OS_STATE.md, N8N_WORKFLOW_INDEX.md.

## [2026-05-03] Charlie Overhaul — CC Docs Touch-up

Fixed markdown code-fence artefacts in CLAUDE_CODE_OPERATING_RULES.md and CLAUDE_CODE_INVENTORY.md from prior paste operation. Content unchanged, formatting restored so both docs render correctly when Claude Code reads them at session start.

## [2026-05-03] Charlie Overhaul — FLOW_OS_SPECIALISTS.md Committed

Canonical specialist registry committed to repo root. 15 specialists across 6 business contexts (Flow OS: 7, FSC: 3, SproutCode: 1, Crete: 2, Personal: 1, Shared: 1) plus 3 deferred specialists with trigger conditions.

Notable: Ad Agency Operator consolidates the two Ads Operator entries originally split in Phase 3 design (Flow OS + Emma Maidment Business) into a single shared specialist matching actual running architecture (account-routing handled server-side via creator field and chatId; ad creation FSC-only; reporting all three accounts). CHARLIE_OVERHAUL.md updated with footnote pointing to FLOW_OS_SPECIALISTS.md as canonical current registry.

Phase 4 Slice 2 reconciliation tasks captured in FLOW_OS_SPECIALISTS.md "Phase 4 reconciliation tasks" section. Ready for next pre-slice doc: FLOW_OS_STATE.md.

Pre-slice progress: 2 of 4 remaining canonical docs complete (CHARLIE_ROLE.md, FLOW_OS_SPECIALISTS.md). Still pending: FLOW_OS_STATE.md, N8N_WORKFLOW_INDEX.md.

## [2026-05-03] Charlie Overhaul — FLOW_OS_STATE.md Committed

Canonical state doc committed to repo root. Initial v1 population covers all 5 business contexts plus cross-dimensional clients section. Captures: 9 paid Flow OS subs (~$1,541 MRR), 4 internal users, 1 paid + 1 free + 4 trial GHL Support Bot users, 10 active FSC engagements (~$4,502/mth recurring + one-offs), 3 cross-dimensional clients (Lucy H. VIP across 3 engagements, Eliza J. + Gutful linkage, Kylie F. multi-engagement growing relationship), SproutCode pre-revenue beta + seed-stage, Crete EOI-phase / pre-entity / land-sourcing, Trading Operator only on Personal.

Architectural principles locked in this doc: GHL is canonical contact store per business unit, Stripe is canonical payer record, this doc bridges them with structural context. Pseudonymisation rule: first name + last initial in committed doc; full mappings in private file at ~/.quantumclaw/flow_os_state_private.md (gitignored, qclaw-server-only).

Pre-slice progress: 3 of 4 remaining canonical docs complete (CHARLIE_ROLE.md, FLOW_OS_SPECIALISTS.md, FLOW_OS_STATE.md). Final pre-slice doc pending: N8N_WORKFLOW_INDEX.md (focused Tyson + Claude Code session, scheduled next session).

## [2026-05-03] Charlie Overhaul — Session Summary and End-of-Day State

Substantial day on the Charlie 2.0 overhaul. Capturing the full arc here so future sessions (and Charlie himself, post-Phase-4 bootstrap) have the consolidated picture.

### What was completed today

**Design phases:**
- Phase 1 — Charlie role spec + failure catalogue (5 patterns: hallucinated context, stale memory, false completion reports, phantom tool use, lane violations)
- Phase 2 — Code-grounded audit of current Charlie via Claude Code; headline finding: doc-runtime gap (Charlie has been built as if he reads canonical docs at session start, but the runtime opens almost none of them)
- Phase 2.5 — CEO Operating Model spec locked (north star: Tyson as CEO, Charlie as orchestration, specialists as operators, Claude Code as implementor; daily rhythm with morning + evening digests; trust gradient with 5 levels; non-negotiable rules; success criteria with 50/30/20 → 30/60/10 trajectory)
- Phase 3 — Six-component Charlie 2.0 design locked: bootstrap mechanism, canonical doc loading, skill loading strategy (pragmatic split), tool surface overhaul, verification gates (soft + hard), Claude Code delegation bridge

**Foundation docs committed:**
- `CEO_OPERATING_MODEL.md` — north star
- `CHARLIE_OVERHAUL.md` — running architecture doc with full Phase 3 design + footnote pointing to FLOW_OS_SPECIALISTS.md as canonical registry
- `LOCATIONS.md` — single source of location for state, logs, configs, docs
- `KEYWORD_REFERENCE.md` — keyword cheat sheet for skill loading routing
- `CLAUDE_CODE_OPERATING_RULES.md` — Claude Code session discipline (working tree, lock file, branch hygiene, scope, verification, handoff, read-before-write, secrets, escalation, reading order)
- `CLAUDE_CODE_INVENTORY.md` — Claude Code tool surface and access scope
- `CHARLIE_ROLE.md` — Charlie's canonical role spec with warm but precise tone
- `FLOW_OS_SPECIALISTS.md` — 15 specialists across 6 sections + 3 deferred
- `FLOW_OS_STATE.md` — initial v1 population across all 5 business contexts + cross-dimensional clients

**Process learnings captured:**
- Code-fence artefacts from large markdown pastes — caught and fixed via diagnose-pause-fix Claude Code pattern
- Person↔business mapping is load-bearing context Charlie needs (Stripe customer name ≠ business operating name in many cases)
- Cross-dimensional clients are a structural pattern: 3 clients (Lucy H., Eliza J. + Gutful, Kylie F.) span multiple business units
- GHL is canonical contact store per business unit; Stripe is canonical payer record; state doc bridges with structural context

### Pre-slice progress

- Foundation docs: COMPLETE
- `CHARLIE_ROLE.md`: COMPLETE
- `FLOW_OS_SPECIALISTS.md`: COMPLETE
- `FLOW_OS_STATE.md`: COMPLETE
- `N8N_WORKFLOW_INDEX.md`: PENDING — focused Tyson + Claude Code session scheduled for next session

### Blockers for Phase 4 implementation

One: `N8N_WORKFLOW_INDEX.md` must be populated before Phase 4 Slice 1 (Bootstrap and canonical doc loading) ships, because the bootstrap reads it as part of canonical doc loading.

### Next session

1. Populate `N8N_WORKFLOW_INDEX.md` via focused Tyson + Claude Code session walking through every active n8n workflow on `webhook.flowos.tech` (~2-3 hours estimated)
2. Once committed, Phase 4 Slice 1 (Bootstrap and canonical doc loading) can begin

### Today's commit chain

In order:
- `eb6de4d` — Charlie overhaul foundation (CEO_OPERATING_MODEL.md + CHARLIE_OVERHAUL.md initial)
- `e18f75a` — Phase 3 design complete (CHARLIE_OVERHAUL.md updated with full Phase 3 block + Phase 4 slicing + Phase 5+ roadmap)
- `17499ea` — Pre-slice foundation 1 (LOCATIONS.md + KEYWORD_REFERENCE.md + CLAUDE_CODE_OPERATING_RULES.md + CLAUDE_CODE_INVENTORY.md)
- `b7fad6c` — Canonical role spec (CHARLIE_ROLE.md)
- `3313b02` — Code-fence touch-up on CLAUDE_CODE_OPERATING_RULES.md
- `0c415aa` — FLOW_OS_SPECIALISTS.md committed with CHARLIE_OVERHAUL.md footnote
- `8a2fdf3` — Canonical state doc v1 (FLOW_OS_STATE.md)
- (this commit) — End-of-session summary

End of day. Next session: N8N_WORKFLOW_INDEX.md focused session, then Phase 4 Slice 1 begins.

## [2026-05-04] Trading - Market Scanner JSON fix + Charlie Overhaul process tidy

Trading worker /simulate endpoint hardened: outer try/except wrap returns valid JSON for any failure mode (was returning Flask's HTML 500 page, breaking the n8n Trading - Market Scanner "Run Market Simulations" node). request.get_json now silent=True. Already live in PM2 since ~08:02 UTC; this commit lands the running code in main.

Process tidy: CLAUDE_CODE_TASKS.md added to .gitignore (transient session brief docs from Charlie dispatches — pattern expected to recur, narrow ignore preserves the tracked CC_OPERATING_RULES + CC_INVENTORY docs). Backup glob in .gitignore expanded to `*.bak.*` and `*.backup.*` to match the qclaw-dev skill's timestamped backup convention. Pre-existing `monte_carlo.py.bak.20260504-080207` removed (byte-identical to HEAD, content preserved in git history).

## [2026-05-04] Charlie Overhaul — N8N_WORKFLOW_INDEX.md created, Trading cluster documented

First cluster of the workflow index documented. Trading cluster (5 workflows: Market Scanner, Position Monitor, Trade Executor, Weekly Analyst, Error Handler) used as template-establishing pass. Format conventions locked.

Notable findings during cluster review:
- Trading - Weekly Analyst silently dormant since 2026-04-04 — cron registration likely cleared by an n8n restart event. Mechanical fix (deactivate/reactivate) deferred to combined dispatch with the broader heartbeat + errorWorkflow backlog.
- Trading - Market Scanner has ongoing post-fix error mode beyond what today's monte_carlo.py JSON fix addressed. Errors confirmed at 09:00 UTC and ~12:00 Athens time on 2026-05-04. Separate diagnostic dispatch needed.
- Trading - Error Handler rename decision: rename to neutral identity (proposed "Shared Error Handler") with per-domain handlers deferred to Phase 5+ if needed. Mechanical rename dispatch to follow.

Pre-slice progress: 4 of 4 remaining canonical docs in progress (CHARLIE_ROLE.md, FLOW_OS_SPECIALISTS.md, FLOW_OS_STATE.md complete; N8N_WORKFLOW_INDEX.md cluster 1 of 11 complete). 10 clusters remain to document.

Concurrent backlog item: 13 mission-critical workflows lack heartbeat + errorWorkflow pattern. Discovery audit identified them. To be addressed in a single sweep dispatch as Phase 4+ work.

## [2026-05-04] Charlie Overhaul — N8N_WORKFLOW_INDEX.md Crete cluster documented

Cluster 2 of 11. Crete cluster (4 workflows). 3 of 4 had the heartbeat + errorWorkflow pattern wired (pointing to 7kpNnMtnuDWXgWcX — the workflow pending rename per Trading cluster decision). Format conventions from Trading cluster applied cleanly.

Notable findings:
- Content Generator: image generator root cause from the Apr 30 session is still unresolved; Photo Fallback work is the runtime workaround keeping the pipeline alive. Now infrastructure-unblocked given today's n8n SSH probe outcome.
- Content Publish: 86% failure rate over 7d, last successful publish 2026-05-02. Reframed in the entry: this is the Apr 30 visibility layer working as designed, not a regression. The hardening was a resilience layer (silent-fail prevention, retry-loop suppression, error capture, heartbeat coverage), not a root-cause fix on underlying APIs or upstream content quality.
- Content Regenerate is the heartbeat gap in the cluster — only Crete workflow without errorWorkflow set. Lower priority (human-initiated, low volume) but worth adding for consistency in the sweep dispatch.
- Scheduled Publisher: structural reporting note recorded for Phase 4 Slice 1 design — orchestrator workflows need composite heartbeat + downstream-success reporting in the digest, not just their own heartbeats. General principle, not Crete-specific.

**Diagnostic dispatch tracked:** Content Publish 86% failure rate (over 7d, last successful publish 2026-05-02) is the Apr 30 hardening working as designed — visibility, not suppression. Underlying failure rate was always there; pre-Apr-30 it was silent. Diagnostic SQL prepared (group by last_error in crete_content_queue) for follow-up dispatch. Tyson explicitly: silent failures unacceptable; need dashboard surfacing of which channels are failing.

**Infrastructure note:** Today's qclaw → n8n SSH probe outcome (separate session work) confirmed n8n SSH operational. The image generator root cause investigation deferred Apr 30 due to dashboard auth blockers is now infrastructure-unblocked. Pull-forward window for the May 17 deferred items (webhook auth, nginx rate limit, FSC populate-vs-detach) opens whenever a 30-min quiet slot appears post-index session.

Pre-slice progress: N8N_WORKFLOW_INDEX.md cluster 2 of 11 complete. 9 clusters remain.

## [2026-05-04] Charlie Overhaul — N8N_WORKFLOW_INDEX.md Flow OS GHL Marketing cluster documented

Cluster 3 of 11. Flow OS GHL Marketing cluster (5 workflows: Approval Handler, Content Generator, Publisher, Scheduled Publisher, Weekly Report). Format conventions from Trading + Crete clusters applied cleanly.

Notable findings during cluster review:
- 0/5 of cluster has heartbeat + errorWorkflow pattern. Largest single contributor to the 13-workflow heartbeat-pattern backlog.
- Same orchestrator/downstream reporting trap as Crete: Scheduled Publisher 100% green while Publisher status invisible. Locks the general principle that Charlie's digest needs composite reporting for orchestrators.
- `ghl-marketing.md` skill file describes a GHL Social Planner intermediate; actual Publisher workflow goes direct-to-platform via Facebook Graph API + Blotato. Skill file stale on architecture — Phase 4 Slice 2 reconciliation list.
- `LI Guard Check` + `LI Guard Apply` pattern in Publisher is a workflow-internal LinkedIn rate-limiter. Reusable precedent for cross-cluster.

**System-level finding — schedule timezone drift:** n8n is evaluating cron in America/New_York (UTC-4 EDT) not UTC. Node names declaring UTC are misleading; actual fire times are 4 hours later. Discovered during Flow OS GHL Marketing cluster doc pass. Affects at minimum 4 already-documented workflows; likely affects more in remaining 7 clusters. Cluster-sweep correction pass scheduled post-cluster-11. Three potential fixes: rename nodes for accuracy, compensate cron expressions, change n8n timezone config (cleanest). Decision pending sweep.

**Confirmed root cause via direct Tyson verification:** Approval Handler suspect-dormant verdict from Telegram trigger probe was wrong-shaped. Real cause: Content Generator delivers approval messages to `flowstatesads_bot` (different bot than ops monitoring), which Approval Handler's trigger likely doesn't listen on. End-to-end Telegram approval loop broken at bot-identity boundary. Dashboard reject/regenerate path is functional. Plus secondary draft-ID template bug confirmed — empty in delivered messages. Both bugs added to work list as bot-consolidation dispatch.

Work list additions (cumulative tracking):

7. **Schedule timezone cluster-sweep correction (post-cluster-12) — 14+ workflows confirmed affected, with per-workflow override option observed.** n8n evaluates cron in America/New_York not UTC despite node names declaring UTC; affects at least 14 workflows across 5 clusters (Crete + Flow OS GHL Marketing + Tyson personal brand LinkedIn + Tyson personal brand Instagram + Flow OS Infographics). **Per-workflow timezone override observed 2026-05-05** — `Flow Os Blog Post` workflow (`TOvwXSwlXasDgsXL`) has `settings.timezone: "Europe/Athens"` which overrides n8n's global default. Cluster-sweep correction pass must consider per-workflow `settings.timezone` overrides as a fourth option alongside (a) rename nodes for accuracy, (b) compensate cron expressions, (c) change n8n global timezone config (cleanest); (d) standardise on per-workflow `settings.timezone` overrides where a workflow needs non-default scheduling. Decision pending sweep.

- Process rule for skill file maintenance — proposed addition to CLAUDE_CODE_OPERATING_RULES.md: any system change touching functionality documented in a skill file must update the skill file in the same commit

8. Bot consolidation across QClaw — `flowstatesads_bot` vs `@tyson_quantumbot`. Currently Content Generator + Approval Handler are split across bots, breaking the approval loop. Consolidate to single bot OR formally document the multi-bot split as intentional. Confirmed by direct verification 2026-05-04.

9. Bot inventory in LOCATIONS.md — multi-bot infrastructure exists with no canonical mapping of "which bot serves which workflow/dashboard/specialist." Same Single Source of Location pattern. Add a "Bots" section to LOCATIONS.md listing every bot, its credential location, and the workflows/dashboards using it.

10. Trivial fix: Content Generator Send-to-Telegram template `{{ $json[0].id }}` → `{{ $json.id }}` so Draft ID renders. Bundle with bot consolidation dispatch.

Pre-slice progress: N8N_WORKFLOW_INDEX.md cluster 3 of 11 complete. 8 clusters remain.

## [2026-05-04] Charlie Overhaul — N8N_WORKFLOW_INDEX.md Ad Agency cluster documented

Cluster 4 of 11. Ad Agency cluster (6 workflows: Scout, Ledger, Penny, Frame, Optimisation, Bot Router). Rex confirmed UI-only — no backing workflow exists. Format conventions from Trading + Crete + Flow OS GHL Marketing applied cleanly.

Notable findings during cluster review:
- 0/6 of cluster has heartbeat + errorWorkflow pattern. Joins the heartbeat backlog alongside Flow OS GHL Marketing's 0/5.
- Bot identity confirmed cross-cluster: Bot Router self-identifies as "Flow States Ads Agent" in Help Reply text — same `flowstatesads_bot` as Flow OS GHL Marketing Content Generator. **11 workflows now confirmed on `flowstatesads_bot`** (6 Ad Agency + 5 Flow OS GHL Marketing). Work list item 8 (bot consolidation) spans both clusters.
- Optimisation Agent has elevated 7d error rate (~45% of 33 executions). Diagnostic same flavour as Trading Market Scanner and Crete Content Publish — bundle for batch.
- Flow States Retreats account hardcoded in Ledger workflow remains pending cleanup per `FLOW_OS_SPECIALISTS.md`.
- Frame `chatId` hardcoded to Tyson is intentional design per Tyson 2026-05-04 (ads sign-off authority lives with Tyson) — operational decision, not a bug. Logged in entry.

**Architectural finding from cluster review:** Bot Router (Ad Agency conversational orchestrator) was built but never adopted operationally — Tyson reports copy-pasting between Ad Agency sub-role workflows because agents don't chain. Same shape as Apr 30 visibility findings (system built piece-by-piece without integration enforced) but at the orchestration layer rather than the observability layer. Added as work-list item 12. Charlie 2.0's design must include defined inter-specialist invocation routes via Charlie-as-router; without this, humans-as-integrator failure mode will reappear with new specialists. Probe outcome 2026-05-04: Bot Router `telegramTrigger` confirmed dormant via direct test (Tyson sent "show me the latest ad performance" to `flowstatesads_bot`, no reply received), joins Trading Weekly Analyst pattern. Approval Handler cross-referenced as likely-same-cause given shared bot.

**Approval Handler entry updated:** Cross-reference paragraph appended to N8N_WORKFLOW_INDEX.md Approval Handler Known issues (cluster 3) — now reflects confirmed-dormant Bot Router as cross-cluster evidence that Approval Handler likely shares the same trigger-registration failure mode. Both `telegramTrigger`s on `flowstatesads_bot`; bundle verification + recovery into the same dispatch as Bot Router.

Work list addition:

12. **Specialist-to-specialist communication contract — Phase 4+ load-bearing.** Three patterns observed across documented clusters: (a) Ad Agency Bot Router built as orchestrator but never adopted, (b) Crete pipeline orchestrator working at heartbeat layer but not at downstream-success-reporting layer, (c) LinkedIn cluster has no orchestrator at all — workflows coordinate via shared database. All three end with humans-as-integrator. Charlie 2.0 must define how specialists invoke each other AND how Charlie reads composite state from shared databases when no orchestrator exists. The pattern is now too consistent to defer to Phase 5+.

Pre-slice progress: N8N_WORKFLOW_INDEX.md cluster 4 of 11 complete. 7 clusters remain.

## [2026-05-04] Charlie Overhaul — N8N_WORKFLOW_INDEX.md LinkedIn cluster documented + LOCATIONS.md secondary Supabase

Cluster 5 of 11. Tyson Personal Brand — LinkedIn cluster (5 workflows: Analytics + monitoring, Content Generation, Engagement Automation, Lead Generation, Master avatar machine V1). No specialist owner — Tyson directly. Format conventions from prior 4 clusters applied cleanly.

Notable findings during cluster review:
- 0/5 of cluster has heartbeat + errorWorkflow pattern. Joins the heartbeat backlog.
- Lead Gen has elevated 7d error rate (~67% of 6 executions; last successful 2026-04-30). Bundle into the same diagnostic batch as Trading Market Scanner / Crete Content Publish / GHL Marketing Optimisation Agent.
- Master avatar V1 multi-platform fit anomaly: Tyson decision 2026-05-04 to keep in LinkedIn cluster (single-workflow categories overkill). Reconsider if more multi-platform workflows surface in remaining clusters.
- Schedule timezone NY pattern confirmed for 5 more cron expressions in this cluster. Cluster-sweep work-list item 7 now covers 8 workflows total.
- PhantomBuster discovery-audit reference confirmed as operational history, not current state — Lead Gen workflow uses Apify + Browserflow exclusively. PhantomBuster transition started, never fully completed; sweep of stale references added as work-list item 15.

**Cluster fork from ecosystem default:** LinkedIn cluster runs on a different stack than the rest of the ecosystem — separate Supabase project (`zshmlgtvhdneekbfcyjc`), OpenAI not Anthropic, Slack + email not Telegram for alerting. Documented as cluster-level findings; `LOCATIONS.md` updated to include the secondary Supabase project under a new "Secondary Supabase projects" line.

**Architectural finding update:** Three patterns of specialist-coordination-failure now observed across 3 documented clusters (Ad Agency Bot Router unused, Crete orchestrator partially-blind, LinkedIn no-orchestrator-at-all). Updated work-list item 12 from Phase 5+ tidy to Phase 4+ load-bearing — Charlie 2.0's design must define how specialists invoke each other AND how composite state is read when no orchestrator exists. Updated text replaces the original item 12 in the Ad Agency cluster build log entry.

**Operational reality (Master avatar workflow):** Tyson lost access to the Flow OS LinkedIn company page; the disabled "Flow Os LinkedIn" branch in `NhTdMXeqliW6dPDr` reflects this real-world access loss, not a workflow bug. Worth marking because it's the kind of operational reality detail that without explicit capture would result in Charlie hallucinating "Flow OS LinkedIn distribution is wired but disabled" without knowing the access-recovery dependency.

Work list additions:

13. LinkedIn Engagement rate limit verification — confirm current daily limit value in Supabase, verify it's conservative relative to LinkedIn's anti-abuse heuristics. Small verification task.

14. LinkedIn Analytics weekly report routing + dormancy — Tyson decision 2026-05-04: reports should go to tyson@flowos.tech. Verify whether Email Report Sender is currently configured to that destination, and disambiguate between two possible states: (a) wrong destination configured (needs update), (b) workflow silently broken (needs trigger recovery). Probe Mon executions and email destination config. Bundle with the heartbeat + errorWorkflow sweep dispatch.

15. PhantomBuster sweep — workflow was originally built with PhantomBuster, transitioned to Apify but never fully completed. Sweep skill files, old briefs, and any other docs for residual PhantomBuster references that are stale. Discovery audit referenced PhantomBuster — confirm whether discovery audit's source data has stale references too.

16. Optional: LinkedIn lead gen specialist in FLOW_OS_SPECIALISTS.md. Currently no specialist exists for Tyson personal brand LinkedIn — explicitly Tyson-direct work. If LinkedIn lead gen becomes more autonomous (per the trust gradient model), a specialist can be added. For now, document explicitly as Tyson-direct.

17. Optional: FLOW_OS_STATE.md add Tyson personal brand LinkedIn lead gen subsection. Parallel to the Instagram reel engine entry; document cadence, current performance, known constraints (PhantomBuster→Apify migration in progress, separate Supabase project, OpenAI stack vs ecosystem-default Anthropic).

18. **Alerting platform consolidation decision — Phase 4 Slice 1 dependency.** Tyson currently doesn't reliably check Slack (LinkedIn cluster's Slack alerts mostly unread; same dormancy pattern as the Analytics weekly report email). Three paths under consideration: (A) consolidate everything to Telegram including LinkedIn cluster's Slack + email alerts — multiple bots is fine if it streamlines monitoring to one app, (B) keep multi-platform with Charlie as synthesiser via morning + evening digests, (C) hybrid — Telegram for urgent alerts and approvals, email for long-form reference reports, retire Slack. Tyson's lean 2026-05-04: Path A. Charlie 2.0 implication: Path A simplifies bootstrap (single read protocol, one bot inventory), Path B adds meaningful integration complexity (three protocols + dedup logic). Decision needed before Phase 4 Slice 1 finalises because bootstrap architecture depends on it. Likely bundle execution with bot consolidation dispatch (work-list item 8). Estimated 1-2 hours of Claude Code work to rewire LinkedIn cluster Slack + email nodes to Telegram if Path A is chosen.

Pre-slice progress: N8N_WORKFLOW_INDEX.md cluster 5 of 11 complete. 6 clusters remain.

## [2026-05-04] Charlie Overhaul — N8N_WORKFLOW_INDEX.md Instagram cluster documented

Cluster 6 of 11. Tyson Personal Brand — Instagram cluster (3 workflows: Token Expiry Monitor, Trial Reels Auto-Publisher, Sync Performance Data). No specialist owner — Tyson directly. Format conventions from prior 5 clusters applied cleanly.

Notable findings during cluster review:
- 0/3 of cluster has standard heartbeat + errorWorkflow pattern; 1/3 (Reels Auto-Publisher) has workflow-internal `errorTrigger` + Slack catch-all (rare partial-coverage variant — useful precedent).
- Token Expiry Monitor confirmed silent dormant — third confirmed dormant trigger after Trading Weekly Analyst and Bot Router. Pattern is now established as common.
- All 3 cluster workflows alert via Slack only — reinforces work-list item 18 (alerting platform consolidation).
- No orchestrator workflow exists; coordination via shared Google Sheet — third "no orchestrator at all" cluster (LinkedIn first), supporting work-list item 12 reframe.
- LLM stack: Anthropic (Claude Haiku for caption generation in Reels Auto-Publisher) — back to ecosystem default after LinkedIn cluster's OpenAI fork. Memory's Haiku-replaces-Code-node note confirmed.
- Reels Auto-Publisher fires 27 times in 7d (matches state doc's "4-5 reels per day" cadence); Performance Sync fires daily; Token Monitor fires 0 times in 30d.

**Cluster data layer:** Instagram cluster is the only documented cluster using Google Sheets as primary data layer (other clusters: main Supabase or LinkedIn's secondary Supabase). The shared Google Sheet connects all 3 cluster workflows — reel queue + post URLs + posted timestamps + per-post performance metrics all in per-row columns. Worth tracking as architectural diversity in `LOCATIONS.md` if it grows; v1 captures the pattern in this entry.

**Third confirmed dormant trigger:** Token Expiry Monitor (`cP5TjJ3DFle6r6FC`) joins Trading Weekly Analyst and Bot Router as confirmed silently dormant. Pattern is now established as common across the index — at least 3 of 46 workflows have triggers registered `active=true` in the n8n DB but not actually firing. Heartbeat + errorWorkflow sweep dispatch is now the most operationally urgent post-doc-pass work item.

**Internal errorTrigger pattern:** Reels Auto-Publisher demonstrates a workflow-internal `errorTrigger` + Slack catch-all pattern as alternative to standard `settings.errorWorkflow`. Built deliberately by Tyson. Worth surfacing as design choice precedent for the heartbeat sweep dispatch — in-workflow `errorTrigger` may be cleaner for self-contained workflows than external errorWorkflow references.

**Compound silent-failure pattern:** Token Monitor dormancy + Slack-only alerting (Tyson rarely checks) = compounding silent-failure path for IG production pipeline. Documented in Reels Auto-Publisher entry. Mitigation via Path A from work-list item 18 (consolidate alerting to Telegram).

**Cluster-sweep timezone tally update:** 6 more cron expressions confirmed in NY-timezone naming mismatch pattern (Token Monitor + 4 in Reels Auto-Publisher trigger + Performance Sync). Running tally: 14 workflows with timezone naming drift across documented clusters.

Pre-slice progress: N8N_WORKFLOW_INDEX.md cluster 6 of 11 complete. 5 clusters remain.

## [2026-05-04] Charlie Overhaul — N8N_WORKFLOW_INDEX.md Flow OS Client integrations cluster documented + LOCATIONS.md n8n internal Postgres + critical executions-history API finding

Cluster 7 of 11. Flow OS Client integrations cluster (2 active workflows after recategorisation: Morning Light WL→HL, Gutful Shopify→FOS V3). A third workflow originally categorised here (`intake-kylie-content-system`, `qOwJhClx5BnOeycf`) was reclassified to "Various utilities and standalone" cluster after Tyson confirmed 2026-05-04 that the form's GHL destination is the FSC GHL sub-account, not Flow OS GHL. Categories table updated: Client integrations 3→2 documented; Various utilities 9→10 pending. Format conventions from prior 6 clusters applied cleanly.

Notable findings during cluster review:
- 0/2 of cluster has heartbeat + errorWorkflow pattern. Both webhook-triggered, no schedule timezone contributions.
- Both workflows write to Flow OS GHL sub-account via `services.leadconnectorhq.com`.
- Activity divergence: Morning Light 100+/7d (Kayla N. high-volume class booking sync); Gutful 0 in 30d.
- Inactive predecessor sweep surfaced 3 candidates: `E4PDhQyrGbd8lAQi` "Master MLM avatar V1", `9mgN68ib4BLn8W5w` "MASTER WL to HL", `gCG5uP4sggi8MFob` "Production - Wellness Living to FlowOS [Morning Light]" — joins work-list item 9.

**Gutful 30-day silent period reframed:** Initially flagged as "needs disambiguation" between business-quiet vs webhook-broken. Tyson cross-referenced 2026-05-04 — Flow OS downstream automations catching Gutful customer-purchase data show last execution 2026-04-17. Since downstream activity requires upstream webhook delivery, downstream silence corroborates business-side dormancy on Gutful Shopify rather than a webhook-broken state. Verdict: workflow healthy, business genuinely quiet. Tyson plans a check-in email to Mikey or Eliza for confirmation, but no urgent fix required. Operational caveat surfaced: Tyson is not contracted to manage Gutful's n8n workflow operationally — Gutful pays $297/mth for the Flow OS subscription which includes the integration but ongoing workflow health is not part of the deliverable. Pattern likely applies to other paid client integrations.

**LOCATIONS.md updated** to surface n8n internal Postgres database as a previously-undocumented data layer. Morning Light's conflict-resolution Postgres node uses n8n's own internal database, not external Supabase. Distinct from the main QClaw Supabase (`fdabygmromuqtysitodp`) + LinkedIn secondary Supabase (`zshmlgtvhdneekbfcyjc`) + Instagram cluster's Google Sheets. Surfaced because hidden architectural dependencies don't survive Charlie's bootstrap-time reasoning.

**Critical architectural finding (2026-05-04):** Tyson reports n8n executions-history API may be unreliable — some workflows showing 0 executions in API have actually had executions in reality. This breaks the core diagnostic assumption used in the discovery audit and all prior cluster probes. Affected verdicts on previously-committed entries: Trading Weekly Analyst (confirmed dormant), Bot Router (confirmed dormant), Token Expiry Monitor (confirmed dormant), Approval Handler (suspect dormant), and possibly others — all assumed API truthfulness. Charlie 2.0's bootstrap probe (Phase 3 Component 1 Layer 5) must use second-source verification, not API-only. Pre-Phase-4-Slice-1 work item 19 added; cluster-sweep correction pass post-doc-pass needs to revisit dormancy verdicts using a verified-truthful method.

Work list additions:

19. **n8n executions-history API reliability investigation — Phase 4 Slice 1 dependency.** Tyson reports 2026-05-04 that some workflows show 0 executions in n8n's API but have actually had executions in reality. This breaks the core diagnostic assumption used throughout the doc pass and the discovery audit. Affected verdicts on previously-committed entries: Trading Weekly Analyst (confirmed dormant), Bot Router (confirmed dormant), Token Expiry Monitor (confirmed dormant), Approval Handler (suspect dormant), and possibly others. Investigation needed: (a) what API query was used in the discovery audit and probes — paginated correctly?, (b) is there a date range or filter issue?, (c) does n8n's execution history have a hidden retention period or row limit?, (d) cross-reference n8n's UI execution view directly to confirm or deny the "0 executions" claim per workflow. Charlie 2.0's bootstrap probe (Phase 3 Component 1 Layer 5) must not rely on execution-history API alone — needs a second-source verification method (e.g. workflow's own logs, downstream-data verification, direct UI inspection). Pre-Phase-4-Slice-1 priority. Cluster-sweep correction pass post-doc-pass also needs to revisit dormancy verdicts using a verified-truthful method.

20. **Gutful workflow contract scoping conversation.** Per Tyson 2026-05-04: Gutful pays $297/mth for the Flow OS subscription which includes the integration, but ongoing n8n workflow health is not contractually part of the deliverable. If the Gutful integration breaks in the future, scoping conversation with Mikey or Eliza precedes any work. Worth surfacing as an explicit operational reality in `FLOW_OS_STATE.md` Section 1 Gutful entry: paid Flow OS subscription does not include workflow management. Pattern likely applies to other paid client integrations too.

Pre-slice progress: N8N_WORKFLOW_INDEX.md cluster 7 of 11 complete. 4 clusters remain.

## [2026-05-04] Charlie Overhaul — Session Close-Out

Long deep work session today on N8N_WORKFLOW_INDEX.md plus emergent architectural findings. Capturing where we left off and what's queued for next session.

### Today's commits (Charlie overhaul work, in order)

1. `deb6970` — fix(trading): wrap /simulate in try/except + .gitignore tidy (working tree triage)
2. `f563883` — N8N_WORKFLOW_INDEX.md created with Trading cluster (cluster 1 of 11)
3. `1bdadc4` — N8N_WORKFLOW_INDEX.md add Crete cluster (cluster 2 of 11)
4. `bfe9fa1` — N8N_WORKFLOW_INDEX.md add Flow OS GHL Marketing cluster (cluster 3 of 11)
5. `5d66bbd` — N8N_WORKFLOW_INDEX.md add Ad Agency cluster (cluster 4 of 11)
6. `b28ec42` — N8N_WORKFLOW_INDEX.md add LinkedIn cluster (cluster 5 of 11) + LOCATIONS.md secondary Supabase
7. `717ac51` — append work-list item 18 alerting platform consolidation
8. `462b1a2` — N8N_WORKFLOW_INDEX.md add Instagram cluster (cluster 6 of 11)
9. `f9f53e9` — N8N_WORKFLOW_INDEX.md add Flow OS Client integrations cluster (cluster 7 of 11) + LOCATIONS.md n8n internal Postgres + critical executions-history API finding

### Pre-slice progress

- 7 of 11 clusters documented (30 workflow entries)
- 4 clusters remaining: Cross-cutting + token refresh (3), Flow OS Blog (1), Flow OS Infographics (1), FSC Content Studio (1), Various utilities and standalone (10 — including the reclassified intake-kylie-content-system from cluster 7)

### Architectural findings surfaced today (significant)

1. **Schedule timezone drift system-wide** — n8n evaluating cron in America/New_York not UTC despite node names declaring UTC. 14 workflows across 5 clusters confirmed affected. Cluster-sweep correction pass scheduled post-cluster-11. Three potential fixes: rename nodes, compensate cron expressions, change n8n timezone config (cleanest).

2. **Bot identity split** — Two Telegram bots in QClaw stack (`flowstatesads_bot` and `@tyson_quantumbot`/QuantumClaw). 11 workflows on flowstatesads_bot (Ad Agency + GHL Marketing). Approval flows broken at the bot-identity boundary. Bot consolidation dispatch tracked as work-list item 8.

3. **Three confirmed dormant triggers** — Trading Weekly Analyst, Bot Router, Token Expiry Monitor. All show active=true in n8n DB but never fire. Pattern is structural n8n behaviour, not isolated bad luck. Recovery is mechanical (deactivate/reactivate).

4. **Three patterns of specialist-coordination-failure** — Bot Router unused (Ad Agency), Crete partial-blind (orchestrator green while downstream red), LinkedIn no-orchestrator-at-all. Pattern reframed work-list item 12 from Phase 5+ tidy to Phase 4+ load-bearing.

5. **Skill file staleness pattern** — trading.md, ghl-marketing.md, crete-marketing.md all confirmed stale on operational reality. Process rule needed: any system change touching skill-file-documented functionality must update skill file in same commit. Phase 4 Slice 2 reconciliation work + ongoing process rule.

6. **Operational reality vs structural intent gap** — bot identity split, schedule timezone drift, skill file staleness, Bot Router never adopted, Apr 30 Crete hardening visibility-not-suppression — all examples of system-as-built drifting from system-as-documented. Charlie 2.0 must be designed assuming this gap exists.

7. **Critical: n8n executions-history API may be unreliable** — Tyson reports some workflows show 0 executions in API but have actually had executions in reality. Breaks the core diagnostic assumption used throughout the doc pass. Affected dormancy verdicts on Trading Weekly Analyst, Bot Router, Token Expiry Monitor, Approval Handler all flagged for re-verification. Charlie 2.0's bootstrap probe (Phase 3 Component 1 Layer 5) cannot rely on execution-history API alone — needs second-source verification. Pre-Phase-4-Slice-1 dependency.

### Work list current state (20 items)

1. Market Scanner post-fix diagnostic — ongoing failure mode beyond JSON fix (confirmed by Tyson's Telegram observation 2026-05-04 09:00 UTC + 12:00 Athens errors)
2. Crete Content Publish failure-mode diagnostic — group last_error in crete_content_queue, dispatch fixes per error class
3. Heartbeat + errorWorkflow sweep — 13+ mission-critical workflows lacking the pattern
4. Trading Error Handler rename to neutral identity ("Shared Error Handler") + update 4 dependent workflows
5. Trading Weekly Analyst recovery (deactivate/reactivate to force schedule re-registration)
6. Skill file reconciliation (Phase 4 Slice 2) — multiple skill files stale
7. Schedule timezone cluster-sweep correction (post-cluster-11) — 14 workflows confirmed affected
8. Bot consolidation across QClaw — 11 workflows on flowstatesads_bot vs @tyson_quantumbot
9. V1/V2/V3 cleanup sweep + bot inventory in LOCATIONS.md (3 inactive predecessor candidates surfaced for Tyson decision: Master MLM avatar V1, MASTER WL to HL, Production WL to FlowOS [Morning Light])
10. Trivial fix: Content Generator Send-to-Telegram template `{{ $json[0].id }}` → `{{ $json.id }}`
11. Cross-cluster Blotato Instagram failure investigation (GHL Marketing Publisher + Crete Content Publish + Optimisation Agent same pattern)
12. Specialist-to-specialist communication contract — Phase 4+ load-bearing
13. LinkedIn Engagement rate limit verification in Supabase
14. LinkedIn Analytics weekly report routing + dormancy (Tyson decision: route to tyson@flowos.tech)
15. PhantomBuster sweep — stale references in skill files / old briefs
16. Optional: LinkedIn lead gen specialist in FLOW_OS_SPECIALISTS.md
17. Optional: FLOW_OS_STATE.md add Tyson personal brand LinkedIn lead gen subsection
18. Pull-forward May 17 deferred items (webhook auth, nginx rate limit, FSC populate-vs-detach) — n8n SSH now operational
19. Process rule for skill file maintenance — proposed addition to CLAUDE_CODE_OPERATING_RULES.md
20. Gutful workflow contract scoping conversation — paid Flow OS subscription does not include workflow management; pattern likely applies to other paid client integrations

(Note: items 18 alerting platform consolidation + 19 executions-history API investigation are pre-Phase-4-Slice-1 dependencies)

### Next session

1. Resume cluster 8: Cross-cutting + token refresh (3 workflows — includes the two genuine token refreshers + the third zero-execution candidate flagged for archive)
2. Then clusters 9-11: Flow OS Blog + Infographics + FSC Content Studio + Various utilities (and intake-kylie-content-system in Various utilities per cluster 7 reclassification)
3. After all 11 clusters committed: cluster-sweep correction pass (timezone drift across 14 workflows, dormancy re-verification post-API-investigation, Crete Content Generator UTC retro-correction)
4. Then Phase 4 Slice 1: Bootstrap + canonical doc loading begins

intake-kylie-content-system entry preserved at `/tmp/intake_kylie_for_cluster_11.md` on qclaw for cluster 11 application.

End of day. Path forward clear.

## [2026-05-05] Charlie Overhaul — N8N_WORKFLOW_INDEX.md Cross-cutting + Token Refresh cluster documented

Cluster 8 of 11. Cross-cutting + Token Refresh cluster (3 workflows: Gutful GHL refresher, Morning Light GHL refresher, abandoned-scaffold archive candidate). Format conventions from prior 7 clusters applied cleanly.

Notable findings during cluster review:
- 0/3 of cluster has heartbeat + errorWorkflow pattern. All 3 use legacy n8n `cron` node with interval-based scheduling (every 12h), so no contribution to schedule-timezone cluster-sweep work-list item 7.
- Both functional refreshers share a single Postgres credential (`qGUxEHfEZkZGdAcZ` "Supabase Postgres DB") writing to a shared `highlevel_tokens` table. Confirmed intentional by Tyson 2026-05-05 — same purpose (GHL OAuth refresh), one shared table, different keys per domain (Gutful keyed by `location_id`, Morning Light keyed by `id`).
- Workflow age timeline supports the archive recommendation for `N3VF1VKlekDdhxGU`: created 2025-10-04 (oldest, abandoned with empty cron params), Morning Light refresher 2025-10-05 (one day later — successful second attempt), Gutful refresher 2025-10-14 (10 days later — copy-and-modify of Morning Light).
- Cross-workflow Execute reference search came up empty for `N3VF1VKlekDdhxGU` across all 75 active+inactive workflows — strong archive signal. Tyson approved archive 2026-05-05.

**Naming convention renames confirmed by Tyson 2026-05-05:**
- `b36b4MKe1p6wQbTQ` → **`Flow OS Client — Gutful — GHL OAuth Refresh`**
- `02Dob9FCEkXZFDAs` → **`Flow OS Client — Morning Light — GHL OAuth Refresh`**

Don't rename in n8n now — bundle with V1/V2/V3 cleanup dispatch (work-list item 9). Convention pattern locked: `<business unit> — <client> — <purpose>`.

**Item 19 escalated from "investigate" to "blocker on Phase 4 Slice 1":** discovery audit yesterday (2026-05-04) reported 13 execs/7d for both functional refreshers. Today's probe (2026-05-05) reports 0 in 7d AND 0 in entire 100-row API window. Same workflows, same API endpoint, 24h gap, no workflow update in between. This is the executions-history API unreliability hitting actively-running infrastructure in real time — not just retrospective stale data on dormant workflows. Charlie 2.0's bootstrap probe (Phase 3 Component 1 Layer 5) cannot launch on top of an unreliable execution-data primitive. Item 19 must resolve before Phase 4 Slice 1 begins.

Work list addition:

22. **Postgres credential audit — `qGUxEHfEZkZGdAcZ` "Supabase Postgres DB" target verification.** Both Cross-cutting cluster refreshers use this credential. Cluster 7's Morning Light entry described its main-workflow Postgres node as "n8n internal" per Tyson 2026-05-04, but the refresher workflows use a credential named "Supabase Postgres DB". Need to confirm whether this credential ID resolves to external Supabase (matching the credential name) or n8n's internal Postgres (matching cluster 7's note). `LOCATIONS.md` clarification dependent on this audit — current entry says "n8n internal Postgres database" is a hidden architectural dependency, but if `qGUxEHfEZkZGdAcZ` is also used by the refreshers and points to external Supabase, the LOCATIONS entry needs nuance. Small probe: open the credential in n8n UI, confirm the connection string host. Bundle with the V1/V2/V3 cleanup dispatch.

Pre-slice progress: N8N_WORKFLOW_INDEX.md cluster 8 of 11 complete. 3 clusters remain.

## [2026-05-05] Charlie Overhaul — N8N_WORKFLOW_INDEX.md add Blog + Infographics + Content Studio clusters (clusters 9-11 of 12)

Three single-workflow clusters in one commit, each with its own `##` cluster section. Total cluster count clarified: **12, not 11** — the original prose "11 categories identified in the discovery audit" in the Categories index has been off-by-one since cluster 1; fixed in this commit to "12 categories". The categories table itself has had 12 rows from the start. Cluster numbering recalibration: Various utilities and standalone is now cluster 12 of 12 (was tracked as "of 11" in prior commits' messages — historical record preserved).

Format conventions from prior 8 clusters applied cleanly. Categories table updated for all 3 rows (Flow OS Blog, Flow OS Infographics, FSC Content Studio: pending → documented).

Notable findings during cluster review:

- **Per-workflow timezone setting observed for the first time** in `Flow Os Blog Post` (`TOvwXSwlXasDgsXL`). `settings.timezone: "Europe/Athens"` overrides n8n's global NY default. First counter-example to the cluster-wide NY-timezone observation. Work-list item 7 updated in same commit to reflect the new fourth correction option.

- **API unreliability hits all 3** — discovery audit reported 2/16/2 execs/7d for Blog/Infographics/Content Studio respectively. Today's probe reports 0/0/0. Continues the work-list item 19 pattern across all 8 commits' worth of probes. Item 19 Phase-4-Slice-1 blocker status remains.

- **Misleading commit-message history surfaced.** Commits `e4ad82c` "feat(content-studio): add Cap Hashtags node…" and `bdc0e6f` "fix(content-studio): force JPEG output…" (both 2026-04-29) used `content-studio` prefix but the actual modified workflow was the **Flow OS Infographics V2** (`kJ2EdkOeEAwVbMwU`), NOT Content Studio Pipeline. Worth flagging as historical record — when the build log or skill files are reconciled, treat those two commits as touching Infographics, not Content Studio.

- **Content Studio is the only cluster with a named specialist owner** (Content Studio Operator per `FLOW_OS_SPECIALISTS.md`). 8 of 12 clusters have None — Tyson directly. As Charlie 2.0 specialist scaffolding ships in Phase 4 Slice 6, more clusters will get specialist owners.

- **LLM stack diversity continues** — Blog + Infographics use OpenAI; Content Studio uses Anthropic. Pattern matches LinkedIn cluster's OpenAI usage and the Flow OS marketing/Trading/Crete/GHL Marketing Anthropic ecosystem.

- **Naming inconsistency** "Flow Os" (lowercase 'o') in two workflow names — joins V1/V2/V3 cleanup sweep (work-list item 9).

- **Content Studio's Clipper integration** confirmed at workflow level — `Generate Clips` httpRequest targets `138.68.138.214:4002` (the qclaw clipper-worker PM2 process). Confirms the architecture documented in `FLOW_OS_SPECIALISTS.md` Content Studio Operator entry that Clipper is an internal sub-component.

**Work-list item 7 updated in same commit** — folded the per-workflow `settings.timezone` observation into item 7's canonical text. Affected workflow count remains 14+; correction option set expands from 3 to 4. Original creation-point line in QCLAW_BUILD_LOG.md updated; prior eod-summary references in this file remain as historical snapshots.

Pre-slice progress: N8N_WORKFLOW_INDEX.md clusters 9 + 10 + 11 of 12 complete. **1 cluster remains: Various utilities and standalone (10 workflows including reclassified intake-kylie-content-system).**

## [2026-05-05] Charlie Overhaul — N8N_WORKFLOW_INDEX.md add Various utilities cluster (cluster 12 of 12) — doc pass complete

**Doc pass complete: 46 workflows across 12 clusters.** The Various utilities and standalone cluster (10 workflows) closes out N8N_WORKFLOW_INDEX.md's per-cluster documentation phase. Format conventions from the prior 11 clusters applied cleanly. Categories table flipped (`Various utilities and standalone | 10 | pending → documented`).

**Final bucket distribution for cluster 12:** 7 × M, 3 × S, **0 × A** (zero archive candidates after Tyson review). Initial draft proposed FFC webhook as Bucket A (abandoned scaffold); Tyson clarified 2026-05-05 that FFC = Freedom and Flow Challenge — active production cross-account contact bridge from Emma's FSC sub-account to Flow OS — and recategorised to M.

**Three corrections applied during Tyson Mode 2 review (2026-05-05):**

1. **AIA002 - Emma AI Advisor Token Generator: S → M.** Direct revenue path. Per Tyson 2026-05-05: Emma AI Advisor product is still on sale and active; 1 lifetime purchase to date per memory. 0 executions in API window consistent with low organic volume + work-list item 19 unreliability. Even one failed purchase = customer-trust + refund event.

2. **FFC webhook from Emma to FOS: A → M.** Reframed from "abandoned scaffold archive candidate" to active production infrastructure. FFC = Freedom and Flow Challenge (free challenge for setting up automated business). The webhook bridges contacts from Emma's FSC GHL sub-account to Flow OS GHL sub-account so Flow OS marketing/onboarding funnel can pick them up. Only workflow in the index that explicitly bridges FSC GHL → Flow OS GHL boundary. Rename queued for V1/V2/V3 cleanup sweep (work-list item 9): "FSC Freedom and Flow Challenge — Emma to Flow OS Contact Bridge".

3. **GHL Changelog Emails: S → M.** Operationally desired client/lead newsletter feature for Flow OS — value-add informing them of GHL changelog updates. Currently dormant (0 executions despite expected 1-2 fires given bi-weekly cadence). **4th confirmed dormant trigger** joining Trading Weekly Analyst, Bot Router, Token Expiry Monitor. Bundles with heartbeat sweep dispatch recovery action (work-list item 3).

**Notable cluster-12 findings:**

- **Universal API unreliability** — all 10/10 workflows in cluster 12 report 0 executions in the 100-row API window. Even Charlie - Task Handler and Qclaw router (which we know have been triggered manually) show 0. Strongest single-cluster confirmation of work-list item 19 (n8n executions-history API unreliability) across the doc pass. **Item 19 Phase-4-Slice-1 blocker status reaffirmed.** UI cross-check or alternative observability source mandatory before Slice 1 launch.

- **0/10 cross-workflow Execute references** — none of the cluster-12 workflows are called via `executeWorkflow` from elsewhere in the index. Full cross-workflow scan ran across all 75 active+inactive workflows. Confirms each cluster-12 workflow's failure blast radius is limited to its own webhook/trigger surface.

- **Charlie infrastructure findings (Phase 4 Slice 4+5 input)** — Charlie - Task Handler webhook + Qclaw router webhook are both built but functionally unused since adoption (no executions, no cross-references, no documented call path). Feed Phase 4 Slice 4 (tool surface) + Slice 5 (Claude Code dispatcher) design decisions — target architecture decides whether to repurpose or deactivate.

- **2 LinkedIn-adjacent workflows surfaced** — Engagement Weighting Re-calibration + Lead Score Re-calibration both write to the LinkedIn secondary Supabase (`zshmlgtvhdneekbfcyjc.supabase.co`) and serve LinkedIn engagement scoring. Belong functionally in the LinkedIn cluster but live here per discovery audit grouping. Joins cluster-sweep recategorisation (work-list item 9).

- **3 NY-timezone schedules** added to the cluster-wide tally (Engagement Weighting Monday 08:00 NY; Lead Score Re-calibration 1st-of-month 07:00 NY; GHL Changelog Emails Monday 09:00 NY every 2 weeks). **Total under work-list item 7 now 16 workflows.**

- **Cluster-internal duplication noted** — Flow OS + FSC Payment Update Link Generators are 95% identical 5-node webhooks differing only by GHL destination + path. Refactor candidate (consolidate into single workflow with brand-routing switch node) tracked as future-sweep build-log note (no work-list item — minor maintenance debt, not blocking).

- **OpenAI LLM stack continues to diverge from Anthropic ecosystem default** — GHL Changelog Emails + Lead Score Re-calibration both use OpenAI, matching Flow OS Blog Post + LinkedIn cluster pattern.

**Work list addition:**

23. **Webhook signed-request validation hardening — AIA002 + FFC webhook.** Both webhooks accept untrusted unauthenticated POST traffic. AIA002 (`/webhook/emma-ai-purchase`) is revenue-path: forged events provision unauthorised credits to attackers. FFC webhook (`/webhook/bf033d33-…`) is data-integrity path: forged events inject arbitrary contacts into Flow OS GHL. UUID-pathed obscurity is not authentication. Hardening options: HMAC signature header verification (preferred — symmetric secret shared with caller), IP allowlist (operationally fragile), or upstream API gateway with auth. Bundle with work-list item 18 (May 17 deferred items: webhook auth, nginx rate limit, FSC populate-vs-detach) — same security-pass scope.

---

**Doc pass closeout summary:**

- **46 active workflows documented** across 12 clusters (Trading 5, Crete 4, Flow OS GHL Marketing 4, Ad Agency 4, LinkedIn 7, Instagram 2, Flow OS Client integrations 2, Cross-cutting + Token Refresh 3, Flow OS Blog 1, Flow OS Infographics 1, FSC Content Studio 1, Various utilities 10) + 1 reclassified (intake-kylie from cluster 7 → cluster 12) + 1 archived (`N3VF1VKlekDdhxGU` abandoned scaffold from Cross-cutting cluster).

- **0 archive candidates from cluster 12** — all 10 workflows retained as active production infrastructure or pending Phase 4 Slice 4+5 design decision (Charlie - Task Handler, Qclaw router).

- **Phase 4 Slice 1 dependencies remaining:** work-list item 18 (alerting platform consolidation Path A) + work-list item 19 (executions-history API reliability investigation) must both resolve before Slice 1 Bootstrap + canonical doc loading begins.

- **Post-doc-pass cluster-sweep work queued** (separate dispatches from doc pass): timezone correction across 16 workflows (item 7); dormancy re-verification post-API-investigation (4 confirmed dormant: Trading Weekly Analyst, Bot Router, Token Expiry Monitor, GHL Changelog Emails); Crete Content Generator UTC retro-correction; LinkedIn-adjacent recategorisation (Engagement Weighting + Lead Score Re-calibration); V1/V2/V3 cleanup + workflow renames (item 9); webhook signed-request hardening (item 23, new); heartbeat + errorWorkflow sweep (item 3).

Pre-slice progress: **N8N_WORKFLOW_INDEX.md doc pass complete. 12 of 12 clusters documented.** Next: cluster-sweep correction passes + Phase 4 Slice 1 dependency resolution (items 18, 19).
