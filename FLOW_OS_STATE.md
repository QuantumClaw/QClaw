# Flow OS State

This is the canonical state doc. Charlie reads it at session start to know what's currently true across all business units. The doc is updated continuously — routine state changes by Charlie autonomously, significant changes after Tyson approval.

This file is the fourth canonical doc Charlie reads at session start, after `CEO_OPERATING_MODEL.md`, `CHARLIE_ROLE.md`, and `LOCATIONS.md`.

**Last updated:** 2026-05-03

## Maintenance rules

- **Charlie writes autonomously to:** routine state changes (lead status updates, content pipeline status, infrastructure snapshot, recent significant changes log, churn events)
- **Charlie surfaces for Tyson approval before writing:** new client onboarding, retainer scope changes, trust gradient promotions, new specialist additions, new business unit activity, cross-dimensional client identification
- **Tyson edits directly (with Claude (chat) help):** strategic direction, offer ladder changes, business unit additions or removals
- **Sensitive context** (full names, emails, business mappings, contract values where identifying) lives in `~/.quantumclaw/flow_os_state_private.md` on the qclaw server, never in the repo
- **Maintenance log** at the bottom of this doc captures all significant changes with dates

## Architectural principles for this doc

- **GHL is the canonical contact store** for every business unit. This doc references GHL pipelines rather than duplicating contact lists.
- **Stripe is the canonical payer record** for every business unit. This doc references Stripe rather than duplicating payment data.
- **This doc bridges them** with structural context: customer↔business mapping, cross-dimensional flagging, ownership routing.
- **Pseudonymisation:** first name + last initial only in this committed doc. Full mapping in private file.

---

## Section 1 — Active engagements

### Flow OS

**9 paid subscribers** (~$1,541/mth MRR):

| Person | Plan | Started | Notes |
|---|---|---|---|
| Suze H. | $97 starter | Jul 2025 | |
| Rachael B. | $97 starter | Apr 2025 | |
| Lucy H. (acct 1) | $97 starter | Apr 2025 | Cross-dimensional VIP — see Cross-dimensional clients section |
| Lucy H. (acct 2) | $97 starter | Jan 2026 | Cross-dimensional VIP — Lucy's personal brand account |
| Michael Y. | $297 unlimited | Sep 2025 | Co-runs business with Eliza J. (cross-dimensional). Has Shopify n8n workflow integration. |
| Georgia F. | $97 starter | Feb 2026 | Bundled with free GHL Support Bot |
| Kayla N. | $297 unlimited | Dec 2025 | Has Morning Light WL→HL n8n workflow integration |
| Wallis M.-M. | $297 unlimited | Nov 2025 | No workflow integrations yet |
| Angela S. | $97 starter | Apr 2025 | |

**4 internal/non-charged users:** Emma Maidment, Crete Projects, SproutCode, Flow States Collective.

**Owner:** Tyson for all Flow OS engagements.

### GHL Support Bot (Flow OS product, separate pricing tier)

**1 paid + 1 free + 4 trial:**

| Person | Status | Started | Notes |
|---|---|---|---|
| Bruce S. | $29 paid | Apr 2026 | Converted from trial 26 Apr |
| Georgia F. | Free | bundled | Free with Flow OS sub |
| Helena K. | Trial | — | Completed payment details, hasn't used the platform yet |
| Joemarie O. | Trial | — | Completed payment details, hasn't used the platform yet |
| Murray M. | Trial | — | Completed payment details, hasn't used the platform yet |
| Nexus Admin | Trial | — | Completed payment details, hasn't used the platform yet |

**Owner:** Tyson.

### Flow States Collective

**10 active engagements** (~$4,502/mth recurring + one-offs):

| Client | Engagement | Started | Payment | Owner |
|---|---|---|---|---|
| Tracy R. | 1% Club payment plan | — | $350/mth (cancels 21 Jul) | Emma |
| Sarah H. | As Seen In (2-pay) | 1 May | 2 × $149 (1st paid) | Emma |
| Kylie F. | DFY content setup | 28 Apr | $1,400 AUD one-off | Tyson |
| Kylie F. | As Seen In | 22 Apr | $297 one-off | Emma |
| Elise C. | As Seen In | 22 Apr | $297 one-off | Emma |
| Katlen Q. | 1:1 mentoring | 18 Apr | $1,050.12/mth × 6 | Emma |
| Sinead Q. | 1:1 mentoring | 18 Apr | $1,058/mth × 6 | Emma |
| Eliza J. | 1:1 mentoring | 9 Apr | $919.07/mth × 6 | Emma |
| Natalie C. | 1:1 mentoring | 9 Apr | $1,125/mth × 5 | Emma |
| Lucy H. | 1:1 mentoring | 12 Apr | $5,850 PIF (next 6mo) | Emma |

**Offer ladder context:** FSC funnel works toward 1% Club as the volume layer, with 1:1 mentoring as the apex tier. Below 1% Club: lower-ticket entry products (As Seen In, AI PT Sessions, A2E sessions, soulful strategy sessions). Tyson does occasional 1:1 and contract builds.

**Strategic note:** all 4 active 1:1 monthly clients started 9-18 Apr 2026. Next 5-6 months are loaded with delivery work for Emma. Watch for capacity strain.

### SproutCode

**Pre-revenue / beta + seed-stage.**

- Beta + trial users; contact list growing in SproutCode GHL sub-account
- In active development
- Actively seeking seed funding
- No paid customers yet

**Owner:** Tyson.

### Crete

**EOI-phase / pre-entity / land-sourcing.**

- Building interest from investors and members
- Actively sourcing land and buildings to renovate
- Business entity not yet officially set up — waiting on concrete EOIs first
- Crete GHL sub-account is the canonical contact store for leads and contractors
- QClaw runs content automation for Crete

**Owner:** Tyson.

### Personal

**Trading scanner monitoring only.** No other personal-business engagements.

---

## Section 2 — Cross-dimensional clients

These are clients engaged across multiple business units. They are highest-value and highest-touch relationships. Charlie reads this section before any action involving these names so cross-engagement context is always considered.

### Lucy H. — VIP

- Flow OS sub × 2 (chiro practice + personal brand business)
- FSC 1:1 mentoring with Emma ($5,850 PIF, started 12 Apr 2026)
- **3 concurrent engagements with one person.** Highest-touch relationship in the portfolio.
- Charlie's rule: any Lucy H. interaction across any business unit factors in all three engagements.

### Eliza J. + Gutful

- Eliza on FSC 1:1 with Emma ($919/mth from 9 Apr 2026)
- Co-runs Gutful (Flow OS $297 sub) with Mikey
- Stripe payer for Gutful is Michael Y.; Eliza is operationally part of Gutful's reality
- Charlie's rule: Gutful conversations factor in Eliza's parallel 1:1 relationship.

### Kylie F.

- FSC As Seen In ($297 one-off, 22 Apr 2026)
- Tyson DFY content setup ($1,400 AUD, 28 Apr 2026)
- Potential Crete projects investor (warm conversation, no commitment yet)
- **Multi-engagement, growing relationship.** Charlie's rule: any Kylie F. action considers all three engagement contexts and her potential investor status.

---

## Section 3 — Active leads

Per the architectural principle, leads live in GHL sub-accounts. Charlie pulls current pipeline state via GHL operator tools rather than duplicating here. This section captures only:

- The location of each business unit's lead pipeline
- Named leads worth Charlie tracking by name beyond the GHL list
- Non-GHL lead sources

### Lead pipelines by business unit

- **Flow OS leads:** Flow OS GHL sub-account (read via Flow OS GHL Operator)
- **FSC leads:** FSC GHL sub-account (read via FSC GHL Operator)
- **SproutCode leads:** SproutCode GHL sub-account (read via SproutCode Operator)
- **Crete leads:** Crete GHL sub-account (read via Crete Operations Specialist)
- **GHL Support Bot leads:** Flow OS GHL sub-account, tagged for support bot product
- **Instagram DMs:** Direct to Tyson, not yet auto-routed to GHL — Charlie reads via Instagram tools

### Named leads (worth tracking by name beyond GHL pipeline)

- **Nate Puffalt / Prairie Rising** — Flow OS lead. Paid discovery proposal sent at $3,000 CAD. Status: parked but warm. Last contact: emailed week ending 2026-05-03 saying they're trying internally first; will reach back out if they want to go deeper. Charlie's rule: do not actively chase. If Nate or Prairie Rising contacts arrive, surface immediately to Tyson with full historical context.

### Dormant interest (low-priority watch list)

- **Sally and Dani** — both expressed interest in Automate to Elevate (FSC offering). Given the link, parked while they think. Not active leads. Charlie's rule: don't chase. If either re-engages, surface to Emma.

---

## Section 4 — Content pipeline state

### FSC — Emma's podcast pipeline (Content Studio)

- **Status:** Active
- **Last episode:** Shipped via Claude Code direct upload (bypassed dashboard due to file size)
- **Known issue:** Large file upload fails through Content Studio dashboard. Workaround: Claude Code direct upload. Resolution pending in Phase 5+.
- **Test episodes:** Deleted from Buzzsprout (per session 2026-04 work). Pipeline is clean for Emma's use.

### Flow OS GHL Marketing — Support Bot content

- **Status:** Live, automated
- **Cadence:** ~3× per week

### Flow OS — Infographics

- **Status:** Live (separate automation from Support Bot)
- **Scope:** Flow OS marketing only

### Flow OS — Blog posting

- **Status:** Live (separate workflow from Support Bot and Infographics)
- **Scope:** Flow OS marketing only

### Crete Marketing

- **Status:** Live, dashboard-driven workflow
- **Distribution:** IG, Facebook, LinkedIn
- **Cadence:** 3-4× per week

### Instagram reel engine — Tyson personal brand

- **Status:** Active
- **Current batch:** Batch 2 (posts 251-500) underway. Performance and analytics improved versus Batch 1.
- **Cadence:** 4-5 reels per day (reduced from earlier higher volume)
- **ICA archetypes:** "Sophie" (overwhelmed wellness entrepreneur) and "Tom" (ex-corporate performance-focused founder)
- **Themes for Batch 2:** Revenue Leakage, Offer Clarity, AI + Automation for Operators, Founder Operating Rhythm, Scaling Without Breaking

### SproutCode content

- **Status:** Manual
- **Process:** Tyson creates and schedules content via GHL social planner
- **Automation:** Not yet built (potential Phase 5+ work)

---

## Section 5 — Infrastructure snapshot

This is a point-in-time snapshot. Charlie probes at session bootstrap (Layer 5 of bootstrap mechanism) and either confirms freshness or flags drift.

**Last verified:** 2026-05-06

| Component | Status | Location | Notes |
|---|---|---|---|
| QClaw server | Live | `138.68.138.214`, port 4000 | PM2 manages: quantumclaw, trading-worker, clipper-worker, charlie-watcher |
| n8n server | Live | `157.230.216.158` | Docker Compose |
| Dashboard | Live | `agentboardroom.flowos.tech` | Per Phase 2 audit, API layer healthy on localhost |
| Supabase | Live | project `fdabygmromuqtysitodp` | "Supabase FSC" credential in n8n |
| Cloudflare R2 | Live | per-bucket scope | Used by Clipper, Content Studio, Crete Marketing, Flow OS GHL Marketing |
| Cognee + Qdrant | Live | localhost:8000 | Memory layer probe green; `recentEntries` returning 12-14 conversation entries per bootstrap fire (verified 2026-05-06). Entities/relationships table fullness not re-verified since Phase 2 audit. |
| Heartbeats | Live | 08:00 Athens daily morning brief; trading scanner heartbeat with error workflow `7kpNnMtnuDWXgWcX` | |

---

## Section 6 — Trust gradient registry

Per the operating model, every task type sits at one of five trust levels. Tasks move up only with track record; demoted on any failure.

### Level 4 — autonomous, logged, surfaced only on anomaly

- Pre-approved Instagram reel publishing (where content was approved in batch)
- Workflow heartbeat monitoring + recovery for documented failure modes
- Log rotation, disk hygiene, routine PM2 process health
- Memory writes, build log updates, audit log entries
- Trading scanner monitoring (read-only)

### Level 3 — specialist acts, Charlie reviews, Tyson sees in digest

- Buzzsprout episode upload (Content Studio Operator) — candidate for Level 4 after 2-3 successful runs; currently held at Level 3 due to large-file upload issue

### Level 2 — specialist drafts, Charlie reviews, Tyson approves

- Most Content Studio distribution steps (LinkedIn drafts, Substack drafts, WordPress drafts)
- GHL Operator pipeline moves outside pre-authorised rules
- Email drafts for client comms

### Level 1 — Charlie drafts, Tyson approves and dispatches

- Bug fixing of any kind (always via Claude Code dispatch with audit-first)
- n8n workflow modifications (always via Claude Code dispatch with audit-first)
- Code commits (always via Claude Code dispatch with audit-first)
- New task types not yet categorised

### Level 0 — Tyson does it; never autonomous

- Trade execution
- Position changes
- Capital allocation decisions
- Financial actions of any kind (charges, refunds, payouts, ad spend changes, subscription changes)
- External comms send (drafts only by agents, sent by humans or pre-authorised schedules)
- Content editorial decisions on first-pass content (Tyson + Emma only)
- Strategic decisions (offer ladder, business unit changes)
- Identity-layer doc edits (`CEO_OPERATING_MODEL.md`, `CHARLIE_ROLE.md`)

### Promotion candidates (next review)

- **Buzzsprout episode upload** Level 3 → Level 4 after 2-3 successful runs and large-file upload fix
- Any task type that demonstrates clean execution at current level for 2-4 weeks without failure

---

## Section 7 — Known issues

Stuff currently broken, suboptimal, or pending. Charlie reads this section to know what to surface in digests and what not to retry blindly.

### Memory layer

- Cognee entities/relationships tables empty (Phase 2 audit). Degradation level 1 of 5. Functional but not at full capacity. Resolution: pending.

### Tool surface

- (Resolved 2026-05-14, Slice 3a) Filesystem MCP preset removed from `PRESET_SERVERS`; the dashboard `POST /api/agents/spawn` endpoint and the `spawn_agent` built-in are both gone; the `Supabase:execute_sql` reference in `archive/charlie-cto.md` corrected to `supabase_select`. The `supabase_select` tool itself is still not registered (no Supabase preset in `PRESET_SERVERS`) — Slice 3b decides whether to add the preset or drop the always-on prose reference in `delegation.md`.

### Skill files

- 6 load-bearing skill files not symlinked into Charlie's workspace (trading, build, architecture-pillars, qa, task-queue, security). Pending Phase 4 Slice 2 reconciliation.
- `trading.md` config values may drift from live `trading_config` table after Apr 29 trading-fix commit. Reconcile in Phase 4 Slice 2.
- `content-studio.md` is a 440-byte stub. Rebuild from `FLOW_OS_SPECIALISTS.md` in Phase 4 Slice 2.
- `community-manager.md` (both Flow OS and FSC) does not exist. Create in Phase 4 Slice 2.
- Files to archive: `charlie-cto.md` (superseded by `CHARLIE_ROLE.md`), `agent-coordination.md` (frozen Echo agent), `n8n-api.md.backup.*` (stale backup).
- **HIGH (2026-05-14, Slice 3b.1 verification) — `ghl.md` keyword coverage gap.**
  - Symptom: "what leads do we have right now" did not route `ghl.md` (tool-call.log entry 19:08:45Z showed `routed_on_demand_skills:[]` and `active_set_size:6`).
  - Root cause: `ghl.md` frontmatter keywords don't include "leads", "contacts", or "pipeline" — the most natural words a user would use to ask about GHL data.
  - Fix shape: add keywords to `ghl.md` frontmatter. Likely a 5-minute dispatch.
  - Priority HIGH — Charlie can't reach GHL tools through natural phrasing, will keep falling back to `shell_exec` which 3c will block.
- **LOW (2026-05-14, Slice 3b.1 verification) — Trading API 401 even when tools activated.**
  - Symptom: "status of trading" routed `trading-api` correctly (tool-call.log entry 19:09:13Z showed 4 `trading-api` tools activated), but Charlie reported all three trading endpoints returning 401 Unauthorised.
  - Root cause: pre-existing auth wiring bug in the `trading-api` skill — either `secrets.dashboard_auth_token` is missing/expired or the trading-worker is genuinely down. Separate from 3b.
  - Fix shape: separate diagnostic dispatch on `trading-api` auth wiring + trading-worker process state.
  - Priority LOW — trading cluster is deactivated per 2026-05-13; auth fix only useful after Polymarket funds and worker diagnostic resolve.
- **LOW (2026-05-14, Slice 3b.1 verification) — Trading skill self-awareness gap.**
  - Symptom: Charlie correctly recalled from bootstrap that trading cluster is deactivated, then tried `trading-api` tools anyway, reported 401 as a fix-worthy bug.
  - Root cause: `trading-api.md` skill has no instruction like "if trading cluster is deactivated per state doc, do not attempt tool calls; report deactivation state and offer reactivation path."
  - Fix shape: skill content edit, one paragraph. Out of any current slice scope — file as standalone followup.
  - Priority LOW — cosmetic; tools will fail-loud anyway via the 401, no system impact.
- **LOW (2026-05-15, Slice 3c.1 audit) — `Agent: unknown` in approval prompts for `shell_exec`.**
  - Symptom: Slice 3c live smoke test 2026-05-15 17:00 Athens produced approval prompt with `Agent: unknown`. `src/tools/executor.js` line 135 uses `options.agent || 'unknown'` when calling `approvalGate.requestApproval`. `src/agents/registry.js` line 391 does NOT pass `agent` in the options object to `toolExecutor.run(messages, {model, system})`.
  - Root cause: the agent context flow from `agent.process()` → `toolExecutor.run()` is missing the agent name. The executor knows what tool is being called but not which agent asked.
  - Fix shape: thread `agent: this.name` (or equivalent) through the `toolExecutor.run` options. Small dispatch (single file, single line, plus a test).
  - Priority LOW — cosmetic in the prompt only; audit log records `auditActor` correctly because that's wired at tool-construction time.
- **MEDIUM (2026-05-15, Slice 3c.1 audit) — `_matchDestructivePattern` future-greediness watch.**
  - Symptom: brief 3c.1 speculated `_matchDestructivePattern` was catching `pm2 list`. Audit found it was actually step 3 (gatedTools) that caught it; the destructive verb-scoped patterns correctly distinguish `pm2 stop/delete/restart` from `pm2 list/logs`. Not a current bug.
  - Watch shape: when Slice 6 adds per-specialist read-only tools, the destructive verb list should be reviewed against the new verb surfaces. If anyone adds e.g. `git push` as an allowlisted form, the gate's `_matchDestructivePattern` would still gate `git push --force`, which is the correct second-line behaviour — but the interaction between allowlist and gate destructive patterns is now load-bearing. Document the interaction in the inline comment near `_matchDestructivePattern`.
  - Fix shape: documentation-only at present; revisit when Slice 6 expands the allowlist surface.
  - Priority MEDIUM — no functional issue today, but the layered defences now depend on each other in a non-obvious way; a future expansion of either layer needs to consider both.

### Content pipelines

- Content Studio dashboard fails on large file uploads. Workaround: Claude Code direct upload. Resolution pending.
- YouTube auto-publish carparked. Awaiting Emma to test pipeline end-to-end.

### Ad Agency

- Rex sub-role is a UI placeholder with no backing workflow.
- chatId hardcoded to Tyson — Em can't see FSC-side ad activity directly.
- Flow States Retreats account (`act_464237024205104`) currently dormant but still hardcoded in Ledger Ad Creation workflow.

### Infrastructure / process

- n8n root SSH disable is parked. DigitalOcean console auth broken — too risky to proceed currently.
- Process risk: ad-hoc commits getting tangled across Charlie sessions. Mitigated by `CLAUDE_CODE_OPERATING_RULES.md` (committed today). Watch for re-occurrence.
- SproutCode content automation not yet built. Currently fully manual.

---

## Section 8 — Recent significant changes

Rolling list of last 30 days. Most recent at top.

### 2026-05-03

- **Charlie Overhaul Phase 1, 2, 2.5, 3 design complete.** Foundation docs committed: `CEO_OPERATING_MODEL.md`, `CHARLIE_OVERHAUL.md`, `LOCATIONS.md`, `KEYWORD_REFERENCE.md`, `CLAUDE_CODE_OPERATING_RULES.md`, `CLAUDE_CODE_INVENTORY.md`, `CHARLIE_ROLE.md`, `FLOW_OS_SPECIALISTS.md`, this file.
- **Phase 4 implementation pre-slice in progress.** Two pre-slice docs remaining: this file (in flight) and `N8N_WORKFLOW_INDEX.md` (planned next session).
- **Touch-up commit** on `CLAUDE_CODE_OPERATING_RULES.md` to fix code-fence artefacts from initial paste.

### 2026-04-29

- Trading scanner fix committed (`ca41c2c`). Sat unpushed in main briefly — flagged as a process risk; mitigated by new Claude Code operating rules.
- Crete-related FSC credential additions (`add74af`).

### 2026-04-28

- Crete pipeline planning revisited.

### 2026-04-26

- Bruce S. converted GHL Support Bot trial → paid ($29/mth).

### 2026-04 — FSC 1:1 cohort onboarding wave

- 5 active 1:1 mentoring clients onboarded between 9-18 April: Eliza J., Natalie C., Lucy H., Katlen Q., Sinead Q.
- This cohort represents a major delivery commitment for Emma over the next 5-6 months. Watch for capacity strain.

### 2026-04 — FSC As Seen In conversions

- Kylie F., Elise C. converted As Seen In ($297 each).

### 2026-04 — Tyson DFY build

- Kylie F. DFY content setup ($1,400 AUD).

### 2026-04 — FSC payment plan onboarding

- Tracy R. onboarded 1% Club payment plan ($350/mth, cancels 21 July).

---

## Section 9 — Upcoming engagement events

Forward-looking events Charlie should surface before they hit. Generated from the engagement schedule in Section 1.

### Within next 30 days

- **2026-05-08 (approx)** — Sarah H. As Seen In second payment of $149 due
- **2026-05** — FSC 1:1 monthly recurring continues for Eliza J., Natalie C. (next charge 9 May), Katlen Q., Sinead Q. (next charge 18 May)
- **2026-05** — Flow OS sub renewals continue across all 9 paid subs

### Within next 90 days

- **2026-07-21** — Tracy R. 1% Club payment plan cancellation. Surface for retention conversation.
- **2026-09-09** — Eliza J. and Natalie C. 6-month 1:1 mentoring concludes. Renewal/follow-on conversation needed.
- **2026-09-18** — Katlen Q. and Sinead Q. 6-month 1:1 mentoring concludes. Renewal/follow-on conversation needed.
- **2026-10-12** — Lucy H. 1:1 mentoring renewal point (PIF for 6 months from 12 Apr).

---

## Section 10 — Known unknowns / TBD

Things this v1 doc doesn't capture that should be filled in over time.

- **Stripe MRR independent verification.** Calculated MRR ($1,541 Flow OS + $4,502 FSC = $6,043) is from this session's data. Charlie should reconcile against Stripe directly via the Stripe read tools and surface any drift in the morning digest.
- **GHL pipeline-state per business unit at session start.** Charlie pulls current state via GHL operators; this doc references rather than duplicates.
- **SproutCode beta user count** (lives in SproutCode GHL).
- **Crete EOI count** (lives in Crete GHL).
- **Active investor conversations for SproutCode** (currently Tyson tracks personally; not yet structured for Charlie surface).

---

## Maintenance log

This section captures changes to the state doc over time. New entries appended at top.

- **2026-05-13 — Slice 2c Task 8 rate-claim audit (Section 7 — Known issues).** Reviewed every bullet under Memory layer, Tool surface, Skill files, Content pipelines, Ad Agency, and Infrastructure / process. No rate-claim language found that lacks a time series. Closest pattern is `Filesystem MCP fails to start every restart` — conditional ("on every restart"), not a rate-over-time claim, and left as-is. Canonical bad-pattern reference from Slice 2b hotfix ("PM2 process heavy churn (53+ restarts / 13m)") is absent from the current section. No rewrites. **Tyson review required** before merging the PR carrying this audit (per CHARLIE_OVERHAUL.md maintenance rule that state-doc edits touching known-issues need human sign-off).
- **2026-05-03 — v1 created.** Initial population covering 9 paid Flow OS subs, 4 internal users, 1 paid + 1 free + 4 trial GHL Support Bot users, 10 active FSC engagements, 3 cross-dimensional clients (Lucy H. VIP, Eliza J. + Gutful, Kylie F.), SproutCode pre-revenue beta + seed-stage, Crete EOI-phase, Trading Operator only on Personal. Authored by Tyson + Claude (chat) per Phase 3 Component 2.
