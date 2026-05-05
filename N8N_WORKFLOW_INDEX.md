# N8N Workflow Index

This is the canonical workflow registry for every active workflow on `webhook.flowos.tech`. Charlie reads it at session bootstrap (per the Phase 3 Component 1 bootstrap design) so he never reasons about workflows from name alone — every workflow has a documented purpose, owner, trigger, and known-issue context grounded in the workflow's actual node structure.

This file is the sixth canonical doc Charlie reads at session start, after `CEO_OPERATING_MODEL.md`, `CHARLIE_ROLE.md`, `LOCATIONS.md`, `FLOW_OS_STATE.md`, and `FLOW_OS_SPECIALISTS.md`.

**Last updated:** 2026-05-04

## Maintenance rules

- **Charlie writes autonomously to:** Recent activity fields (execution counts, last-successful timestamps), heartbeat status changes, error workflow setting changes (when verified by probe).
- **Charlie surfaces for Tyson approval before writing:** new workflow entries, category changes, bucket promotions/demotions, ownership changes, purpose paragraph rewrites.
- **Tyson edits directly (with Claude (chat) help):** structural changes (e.g. splitting the file when it grows beyond manageable), category definitions, format conventions.
- **Refresh cadence:** Charlie probes workflow execution stats at every bootstrap (per Phase 3 Component 1 Layer 5). Static fields (purpose, trigger, ownership) refresh only on Tyson-approved updates.

## Architectural principles for this doc

- **Single file for v1.** The doc is structured by category internally. If the file grows beyond manageable (rough threshold: 100+ workflows or 5000+ lines), it splits into `n8n-workflows/<category>.md` files with this file becoming the index. Migration is locked via the Single Source of Location pattern (`LOCATIONS.md` updates point to the new structure; nothing else breaks).
- **Workflow IDs are canonical.** Names can change; IDs cannot. Every reference to a workflow in this doc, in `FLOW_OS_SPECIALISTS.md`, and in code uses the workflow ID.
- **Live data pulled from n8n at bootstrap.** This doc captures static structure (purpose, trigger, ownership). Execution stats are pulled live by Charlie from n8n's API at every bootstrap so the "Recent activity" fields are never more than one bootstrap stale.
- **Cross-references are authoritative.** Ownership references `FLOW_OS_SPECIALISTS.md`. Operational state references `FLOW_OS_STATE.md`. Skill file references the relevant skill files. Charlie reads through cross-references rather than duplicating content.

## Categories index

11 categories identified in the discovery audit (2026-05-04). Status legend: `documented` = full entries written, `pending` = entries to come.

| Category | Workflow count | Status |
|---|---|---|
| Trading | 5 | documented |
| Crete | 4 | documented |
| Flow OS GHL Marketing | 5 | documented |
| Ad Agency | 6 | documented |
| Tyson personal brand — LinkedIn | 5 | documented |
| Tyson personal brand — Instagram | 3 | documented |
| Flow OS — Client integrations | 2 | documented |
| Cross-cutting + token refresh | 3 | documented |
| Flow OS Blog | 1 | pending |
| Flow OS Infographics | 1 | pending |
| FSC Content Studio | 1 | pending |
| Various utilities and standalone | 10 | pending |

Total: 46 active workflows.

---

## Trading cluster

5 workflows. All belong to **Personal** (Tyson's own setup) per `FLOW_OS_SPECIALISTS.md`. Specialist owner: **Trading Operator** (monitoring scoped, no execution). Skill file: `trading.md` (with known config drift flagged in the relevant entries below).

### Trading - Market Scanner

- **ID:** `3YahxqOguET3pifj`
- **Belongs to:** Personal (Tyson's own setup)
- **Specialist owner:** Trading Operator (per `FLOW_OS_SPECIALISTS.md` — monitoring scoped, no execution)
- **Trigger:** `scheduleTrigger` "Smart Schedule" with three asymmetric cron expressions: `0 */1 * * 1` (hourly on Mondays), `0 */2 * * 2-5` (every 2h Tue–Fri), `0 */4 * * 0,6` (every 4h weekends) — all UTC.
- **Purpose:** Polymarket prediction-market edge scanner. Fetches four pages of Polymarket market data, merges them into a single feed, runs a `code` node (`Analyse Edge`) that filters markets by question type and minimum volume, then dispatches each candidate to the local Monte Carlo worker (`Run Market Simulations` → `http://localhost:4001/simulate` per `trading-api.md`) for probability simulation. The downstream `Build Run Summary` code node partitions sims into `highEdge / noEdge / neutral` buckets using **asymmetric thresholds (+0.07 high, −0.10 no, volume ≥ 5000)** — these were rewritten in the Apr 29 fix commit (`ca41c2c`) and now diverge from the `min_edge_threshold: 0.30` value documented in `trading.md` line 305 (Phase 2 audit flagged this drift). On `Has Edge?` true, fires `Notify Edge` Telegram alert; either way fires `Notify Heartbeat` and `Save Simulations` (Supabase) before terminating in `NoOp End`.
- **Heartbeat:** Y (`Notify Heartbeat` httpRequest node).
- **Error workflow:** `7kpNnMtnuDWXgWcX` (Trading - Error Handler).
- **Recent activity:** 76 executions in last 7 days. Last successful execution `2026-05-04T05:00:00 UTC`. Most recent execution `2026-05-04T09:00:00 UTC` returned `status=error, finished=False`.
- **Bucket:** M
- **Known issues:** Elevated error rate visible in last 7 days (heuristic count: ~50 of 76 unfinished/errored). The Error Handler is firing on each one (26 successful Error Handler runs in 7d, well-correlated with Scanner errors), so failures are surfacing — but the underlying error path is still active despite today's `monte_carlo.py` `/simulate` JSON fix (commit `deb6970` deployed ~08:02 UTC). Confirmed by Tyson: today's 09:00 UTC run errored, and a subsequent error fired at ~12:00 Athens time post-fix. The JSON fix addressed one failure mode but not all. **Follow-up dispatch needed**: read recent error executions, identify the post-fix failure path, scope a fix. Bundle with the broader heartbeat + errorWorkflow backlog dispatch since both are mission-critical Trading reliability work. The `trading.md` skill file's `min_edge_threshold: 0.30 (30%)` documentation is stale relative to the current `+0.07 / −0.10` thresholds in the workflow.
- **Last verified:** 2026-05-04
- **Notes:** Created 2026-04-03; major rewrite Apr 29 (`updatedAt: 2026-04-29T20:14 UTC`) per build log "Trading - Market Scanner JSON fix" session. Reads `TELEGRAM_TRADING_CHAT_ID` and `SIM_HOST` from n8n env. Uses `Save Simulations` to persist to Supabase `trading_positions` table per `trading.md`. Skill file: `trading.md` (with known config drift).

### Trading - Position Monitor

- **ID:** `UYA0JppH7eqyI7fQ`
- **Belongs to:** Personal (Tyson's own setup)
- **Specialist owner:** Trading Operator
- **Trigger:** `scheduleTrigger` "Every 15 Minutes" (`minutesInterval: 15`).
- **Purpose:** Runs every 15 minutes to keep Polymarket open-position state current. `Fetch Open Positions` calls the local trading worker, `Evaluate Positions` (code node) computes any state transitions or alerts based on current prices, `Update Positions` writes the new state back, and the `Has Alerts?` IF gates the `Notify Monitor` Telegram message so only meaningful changes notify (not every 15-minute heartbeat).
- **Heartbeat:** N (no node named heartbeat; the workflow itself is the high-frequency probe).
- **Error workflow:** none.
- **Recent activity:** 100+ executions in last 7 days (API limit hit). Last successful execution `2026-05-04T09:15:36 UTC`. 100 successes / 0 errors in returned window — workflow is healthy.
- **Bucket:** M
- **Known issues:** No `errorWorkflow` set despite mission-critical financial-adjacent monitoring. Backlog item per discovery audit (heartbeat + errorWorkflow gap on 13 mission-critical workflows).
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-06` — has not been touched in nearly 4 weeks; current 100% success rate in 7d window suggests it's stable. Talks to local trading worker (port 4001) and Supabase `trading_positions`. Skill file: `trading.md`.

### Trading - Trade Executor

- **ID:** `fq7spfyiNcpt8Mf7`
- **Belongs to:** Personal (Tyson's own setup)
- **Specialist owner:** Trading Operator (read-only scope; this workflow executes trades but is gated)
- **Trigger:** `webhook` POST `/webhook/trading-execute` (responseMode: `responseNode`).
- **Purpose:** Externally invokable trade-execution endpoint. `Validate Secret` code node checks the inbound `TRADING_WEBHOOK_SECRET` header, `Fetch Config` reads the `trading_config` Supabase table, and the `Trading Enabled?` IF gates execution: when false (the current state per `FLOW_OS_STATE.md` "trading_enabled: false") the webhook responds via `Respond Disabled`; when true, `Prepare Trade` → `Execute Trade` → `Save Position` → `Notify Trade` → `Respond OK`. The hard gate at the trading_enabled config flag is a safety mechanism — even with valid webhook + secret, no trade executes unless Tyson has flipped the config.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 7 days. No finished executions in the last 100 returned by the API. **Expected** — `trading_enabled` is false per `trading.md` and `FLOW_OS_STATE.md`, so the webhook is intentionally not being called.
- **Bucket:** S→M when `trading_enabled` flips to true (intentionally idle until trading is enabled; not a silent failure)
- **Known issues:** None — zero executions is the desired state. When trading is eventually enabled, this workflow becomes mission-critical and should get heartbeat + errorWorkflow before flipping the config.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-04` — stable. `TRADING_WEBHOOK_SECRET` validation per `trading.md` rule 5. Reads/writes `trading_config` and `trading_positions` Supabase tables. Skill file: `trading.md`.

### Trading - Weekly Analyst

- **ID:** `vjj2uBIPc07FpIxx`
- **Belongs to:** Personal (Tyson's own setup)
- **Specialist owner:** Trading Operator
- **Trigger:** `scheduleTrigger` "Monday 9am" with cron expression `0 9 * * 1` (Monday 09:00 UTC).
- **Purpose:** Weekly analyst pass over the previous 7 days of trading activity. `Fetch Week Trades` reads `trading_positions` from Supabase, `Calculate Stats` (code) produces summary metrics, `Claude Analysis` calls Anthropic for narrative analysis, `Save Report` writes to `trading_analyst_reports` Supabase table, and `Send Report` posts the summary to Telegram per `trading.md` line 351-354.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** **0 executions in last 30 days.** Probe earlier today (`/tmp/trading_weekly_analyst_probe.md`) confirmed: trigger config is correct, workflow is `active=true`, but the four Mondays it should have fired (Apr 7, 14, 21, 28) all show no execution row. Silent failure — exactly the pattern heartbeat + errorWorkflow are designed to surface, and didn't, because this workflow has neither.
- **Bucket:** M (silent failure currently — formerly S given low frequency)
- **Known issues:** **Schedule registration appears unbound in n8n's scheduler.** Most likely cause: cron registration didn't survive an n8n restart/upgrade event after the workflow's last update (`2026-04-07T09:03 UTC`). Fix is mechanical (deactivate/reactivate forces re-registration) but should be done with heartbeat + errorWorkflow added first so the next outage surfaces within hours. Investigation recommended before fix to confirm root cause and check for sibling workflows with the same dormancy pattern.
- **Last verified:** 2026-05-04
- **Notes:** Skill file `trading.md` line 81 says "Charlie can trigger manually via n8n workflow vjj2uBIPc07FpIxx" — that manual path may still work even though the schedule is dark. Worth probing as part of the fix. Probe report: `/tmp/trading_weekly_analyst_probe.md`.

### Trading - Error Handler

- **ID:** `7kpNnMtnuDWXgWcX`
- **Belongs to:** Cross-cutting (despite the `Trading -` name prefix; **also serving Crete workflows** per Phase 2 audit and discovery report — see Notes)
- **Specialist owner:** Trading Operator (current owner; rename + re-scope decided 2026-05-04 — see Known issues)
- **Trigger:** `errorTrigger` (n8n's built-in error trigger node — fires when any other workflow with `settings.errorWorkflow` set to this ID raises an unhandled error).
- **Purpose:** Centralised error notifier. Two-node workflow: `Error Trigger` receives the failing-workflow context payload from n8n; `Notify Telegram` posts a structured Telegram alert with workflow name, last node executed, error message, and execution ID. Created Apr 29 as part of the Trading Market Scanner remediation session (`ca41c2c`) so future Scanner regressions surface within minutes rather than the 25-hour detection lag of the Apr 28 incident.
- **Heartbeat:** N (a heartbeat on an error handler would be redundant — its own silent failure would not be visible from inside it).
- **Error workflow:** none (don't recurse).
- **Recent activity:** 26 executions in last 7 days (oldest `2026-04-30T00:00:06 UTC`, most recent `2026-05-04T09:00:07 UTC`). All 26 finished successfully — i.e. the handler reliably notifies when invoked. Notification volume tracks Market Scanner error rate.
- **Bucket:** M
- **Known issues:** Naming + scope mismatch — currently named "Trading - Error Handler" but actually serves four workflows: `3YahxqOguET3pifj` (Trading Market Scanner), `tnvXFYvODL1PrhJa` (Crete - Content Generator), `zXKBjp3yjW2oR2Mj` (Crete - Content Publish), `9kTWhh9PlxMpyMlp` (Crete - Scheduled Publisher). Three of those four are Crete, not Trading. **Decision (2026-05-04 by Tyson)**: rename to neutral identity — proposed "Shared Error Handler" — with functionality unchanged. Per-domain handlers deferred to Phase 5+ if needed. Rename to be executed as a separate small dispatch (workflow rename + update of `settings.errorWorkflow` references in dependent workflows is mechanical but needs careful verification that all four references update consistently). Until rename ships, this entry remains under the current name with this note as the canonical reference.
- **Last verified:** 2026-05-04
- **Notes:** `availableInMCP: false` (the only Trading workflow with this set false — it's an internal handler, not for direct invocation). Created and last-updated identical timestamps `2026-04-29T20:00:29 UTC` matching commit `ca41c2c`. As more workflows get the heartbeat + errorWorkflow pattern (per the discovery audit's mission-critical backlog), invocation volume on this workflow will grow substantially. Skill file: `trading.md` (mentioned in the Apr 29 fix narrative).

---

---

## Crete cluster

4 workflows. All belong to **Crete** (village development project + personal-business automations) per `FLOW_OS_SPECIALISTS.md`. Specialist owner across all 4: **Crete Marketing Operator** (content creation + distribution for Crete projects). Skill file: `crete-marketing.md` (with load-bearing operational detail per Phase 2 audit; **stale on the 2026-04-30 schema additions** — reconciliation pending in Phase 4 Slice 2).

Recent significant change: 2026-04-30 publishing pipeline hardening session per `QCLAW_BUILD_LOG.md`. Scope was a **resilience layer** addressing four visibility-related failure modes: silent inserts of broken rows (fixed by throw-on-missing-URL + photo library fallback), hourly retry loops on permanently-broken rows (fixed by `publish_attempts` column with `<3` filter + `Validate Media` flipping Instagram-with-null-media to `failed` pre-Blotato), failures with no diagnostic trail (fixed by `last_error` and `last_attempt_at` columns + error-output branches capturing exception messages), and silent-success-but-no-output (fixed by per-workflow heartbeat node firing regardless of item count). Explicit non-goals of the hardening: fixing the agentboardroom image generator endpoint (deferred, blocked on dashboard auth at the time), reducing Blotato API failure rates, network/timeout issues, anything upstream of the n8n workflow boundary.

### Crete - Content Generator

- **ID:** `tnvXFYvODL1PrhJa`
- **Belongs to:** Crete
- **Specialist owner:** Crete Marketing Operator (per `FLOW_OS_SPECIALISTS.md`)
- **Trigger:** `scheduleTrigger` "Schedule 08:00 UTC" with cron expression `0 0 8 * * *` (6-field n8n format with leading second; fires daily at 08:00:00 UTC).
- **Purpose:** Daily generator for Crete marketing content. `Fetch Calendar` reads scheduled slots from `crete_content_queue` Supabase, `Filter Due Slots` keeps only today's pending rows, `Build Prompt` + `Claude API` produce the post copy, `Build Row` shapes the record, `Insert to Supabase` writes a `status=pending_review` row. The image leg is a router: `Image Router` + `Needs Image?` IF gates whether the row needs an image asset; if yes, `Generate Text Card` calls the dashboard text-card endpoint (per Apr 30 build log diagnosis at `src/dashboard/server.js:1926`); if photo-based content, `Needs Photo?` IF + `Fetch Photo Library` → `Select Random Photo` pulls from the R2 photo library, with `Photo Fallback` + `Telegram Fallback Alert` covering the case where the library lookup fails. Final `Telegram Notify` posts a "ready for review" alert with the row ID; `Heartbeat` notifies success per the standard pattern.
- **Heartbeat:** Y (`Heartbeat` httpRequest node).
- **Error workflow:** `7kpNnMtnuDWXgWcX` (Trading - Error Handler — pending rename to "Shared Error Handler" per Trading cluster decision).
- **Recent activity:** 6 executions in last 7 days. 5 successes / 1 error (heuristic). Last successful execution `2026-05-03T12:00:00 UTC`.
- **Bucket:** M
- **Known issues:** Image generator root cause from the Apr 30 session is **still unresolved** — per `QCLAW_BUILD_LOG.md`, code review of `src/dashboard/server.js` couldn't find a smoking gun and the diagnosis was deferred until n8n-host shell access lands. As of the 2026-05-04 SSH probe (separate session work today), n8n SSH is now infrastructure-unblocked, so this investigation can resume in the next available quiet slot. The `Photo Fallback` + library-lookup work added on 2026-04-30 is the workaround that keeps the pipeline running; the underlying text-card generation issue (failures since Apr 21 per build log) is non-blocking but unfixed.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-05-02T08:35 UTC` — the Apr 30 hardening session's commit landed Apr 30 but the workflow itself was last tweaked May 2 (likely the cap-hashtags / JPEG-fix work per recent commits `e4ad82c` "Cap Hashtags" and `bdc0e6f` "force JPEG output"). Inserts to Supabase `crete_content_queue` table. Image library lives in Cloudflare R2 (Crete Marketing bucket scope per `LOCATIONS.md`). Skill file: `crete-marketing.md`.

### Crete - Content Publish

- **ID:** `zXKBjp3yjW2oR2Mj`
- **Belongs to:** Crete
- **Specialist owner:** Crete Marketing Operator
- **Trigger:** `webhook` POST `/webhook/crete-content-publish` (responseMode: `responseNode`).
- **Purpose:** Per-row publisher invoked by Scheduled Publisher (and on-demand from the dashboard). Receives a Crete content row ID; `Get Content` fetches it from `crete_content_queue`; `Extract Item` shapes the publish payload; `Validate Media` runs platform-specific media checks; `Validation Failed?` IF short-circuits to `Mark Failed (Validation)` + `Telegram Validation Failed` + `Respond Validation Failed` if media is missing or malformed (this is the path the Apr 30 hardening session added to stop the silent-fail cascade where `media_url=NULL` rows were being posted to Blotato and silently rejected). On success: `Platform Switch` routes to one of `Facebook Post` (httpRequest), `LinkedIn Post (Blotato)`, `Instagram Post (Blotato)`, or `Other Platform Skip`; per-platform `Restore Fields` `set` nodes preserve canonical row state across the platform-specific transformations; `Update Status` writes `published` back to Supabase; `Telegram Notify` posts the success message; `Respond` returns the success payload. Failure path uses `Increment Attempts` + `Patch Attempts` to update the new `publish_attempts` column added Apr 30, plus `Telegram Publish Failed` + `Respond Publish Failed`. `Heartbeat` fires at the end.
- **Heartbeat:** Y (`Heartbeat` httpRequest node).
- **Error workflow:** `7kpNnMtnuDWXgWcX` (pending rename).
- **Recent activity:** 100+ executions in last 7 days (API limit). **14 successes / 86 errors-or-unfinished (heuristic).** Last successful execution `2026-05-02T15:02:34 UTC` — i.e. no successes in nearly 2 days at audit time despite continued invocations.
- **Bucket:** M
- **Known issues:** 86% failure rate over 7d (14 successes / 86 errors-or-unfinished). Last successful publish: `2026-05-02T15:02:34 UTC`. **This is the visibility layer working, not a regression.** The Apr 30 hardening session was a resilience layer (silent-fail prevention, retry-loop suppression, error capture, heartbeat coverage), not a root-cause fix on the underlying APIs or upstream content quality. Pre-Apr-30 the same failures occurred but were invisible — silent NULL-media inserts, hourly retry loops on broken rows, no error trail. Post-Apr-30 they show as loud failures with `last_error` populated. The next layer of work is identifying what is consistently failing now that it's visible. Diagnostic SQL to start with:

  ```sql
  SELECT last_error, COUNT(*), MIN(last_attempt_at), MAX(last_attempt_at), array_agg(DISTINCT platform) FROM crete_content_queue WHERE last_error IS NOT NULL AND last_attempt_at > now() - interval '7 days' GROUP BY last_error ORDER BY COUNT(*) DESC
  ```

  Group by error → dispatch list. Tracked as a high-priority follow-up dispatch alongside the Market Scanner post-fix diagnostic. Also: `crete-marketing.md` skill file is stale on the Apr 30 schema additions (`publish_attempts`, `last_error`, `last_attempt_at`) — Phase 4 Slice 2 reconciliation list per `FLOW_OS_SPECIALISTS.md`.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-30T14:00:39 UTC` — matches the hardening session timestamp. Talks to: Facebook Graph API, Blotato API (LinkedIn + Instagram), Supabase `crete_content_queue`, Telegram Bot API. Migration that added the retry-tracking columns committed at `n8n-workflows/migrations/2026_04_30_crete_publish_retry_tracking.sql`. Skill file: `crete-marketing.md` (stale).

### Crete - Content Regenerate

- **ID:** `KKjw893zwzHwv1o6`
- **Belongs to:** Crete
- **Specialist owner:** Crete Marketing Operator
- **Trigger:** `webhook` POST `/webhook/crete-content-regenerate` (responseMode: `responseNode`).
- **Purpose:** On-demand regeneration of a single Crete content row. Invoked from the dashboard (per `crete-marketing.md`: "Dashboard approve/reject buttons trigger n8n webhooks") when an operator rejects a generated row and wants new copy. `Get Content` reads the original row, `Build Prompt` constructs a regenerate prompt using the original calendar slot context, `Claude API` produces new copy, `Parse Response` extracts the new content, `Update Row` writes the new copy back to the same `crete_content_queue` row (rather than creating a new row), `Telegram Notify` posts the "regenerated, ready for review" alert, `Respond` returns success.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 4 executions in last 7 days. All 4 successful. Last successful execution `2026-05-02T15:01:25 UTC`.
- **Bucket:** S
- **Known issues:** No `errorWorkflow` set — out of step with the other 3 Crete workflows which all wire to `7kpNnMtnuDWXgWcX`. The on-demand nature of this workflow (low volume, human-initiated) makes silent failure less likely to go unnoticed (operator notices the regenerate button didn't work), so urgency is lower than for the scheduled workflows — but worth adding for consistency in the heartbeat-pattern sweep dispatch.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-11T11:25 UTC` — has not been touched since the original Crete pipeline build, predating the Apr 30 hardening. Talks to: Anthropic API (Claude), Supabase `crete_content_queue`, Telegram. Skill file: `crete-marketing.md`.

### Crete - Scheduled Publisher

- **ID:** `9kTWhh9PlxMpyMlp`
- **Belongs to:** Crete
- **Specialist owner:** Crete Marketing Operator
- **Trigger:** `scheduleTrigger` "Hourly Schedule" with cron expression `0 0 * * * *` (6-field n8n format with leading second; fires at the top of every hour, every day).
- **Purpose:** Hourly poller that drives the publishing leg of the Crete pipeline. `Query Approved Due` reads `crete_content_queue` for rows with `status=approved` and `scheduled_for <= now`, indexed by the partial index `idx_crete_content_queue_publishable` added in the Apr 30 migration. For each due row, `Trigger Publish` POSTs to the Content Publish webhook (`zXKBjp3yjW2oR2Mj` via `/webhook/crete-content-publish`). `Build Summary` aggregates per-run stats (rows attempted, successes, failures); `Heartbeat` notifies completion regardless of outcome. The hourly cadence means a typical day fires 24 times; many fires find no due rows and complete without invoking Content Publish.
- **Heartbeat:** Y (`Heartbeat` httpRequest node).
- **Error workflow:** `7kpNnMtnuDWXgWcX` (pending rename).
- **Recent activity:** 100+ executions in last 7 days (API limit). 97 successes / 3 errors (heuristic). Last successful execution `2026-05-04T09:00:00 UTC` — running healthy at the hour level.
- **Bucket:** M
- **Known issues:** This workflow itself is healthy, but its downstream dependency (Content Publish, `zXKBjp3yjW2oR2Mj`) has been failing for ~86% of the rows it dispatches. So Scheduled Publisher's "successful" runs include cases where it dispatched a row that subsequently failed at Content Publish. Charlie's reporting on Crete pipeline health needs to combine **both** workflows' status to give Tyson an accurate picture — Scheduled Publisher's heartbeat alone says "I ran" but doesn't say "the rows I dispatched actually published."

  **Structural reporting note for Phase 4 Slice 1 design:** This workflow is an orchestrator — it invokes Content Publish 0-N times per hour depending on queue state. Its own heartbeat says "I dispatched X rows, completed without error" but does not report whether those X rows actually published successfully (that's downstream Content Publish's job). Scheduled Publisher can be 100% green while Content Publish is 86% red, and a Charlie digest reading just heartbeats would conclude "Crete pipeline healthy" when reality is broken. Charlie's digest must combine heartbeats AND downstream success rates for orchestration workflows. General principle, not Crete-specific — applies to any workflow whose primary job is invoking other workflows.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-30T14:59 UTC` — second touch of the Apr 30 hardening session. The Hourly Schedule's 6-field cron leverages n8n's seconds-precision; same pattern as Content Generator's daily 08:00 trigger. Skill file: `crete-marketing.md` (note: skill file is stale on the schema additions per Phase 2 audit).

---

## Flow OS GHL Marketing cluster

5 workflows. All belong to **Flow OS** per `FLOW_OS_SPECIALISTS.md`. Specialist owner across all 5: **Flow OS GHL Marketing**. Skill file: `ghl-marketing.md` (load-bearing per Phase 2 audit; **stale on the distribution architecture** — see Publisher entry).

Cluster-level findings:
- **Heartbeat + errorWorkflow gap is total: 0/5** workflows have either. This cluster is the largest single contributor to the 13-workflow heartbeat-pattern backlog from the discovery audit.
- **Orchestrator + downstream pattern present** — Scheduled Publisher (every 15 min poller) invokes Publisher (per-row publishing webhook). Same structural reporting note as Crete: orchestrator can be 100% green while downstream is failing, so Charlie's digest must combine orchestrator heartbeats AND downstream success rates.
- **Schedule timezone interpretation:** cron expressions in this cluster appear to fire in `America/New_York` despite node names stating `UTC` — surfaced per-workflow; tracked as a system-wide cluster-sweep item in the maintenance log.
- **Bot identity split confirmed (2026-05-04):** Content Generator delivers approval-pending Telegram messages via `flowstatesads_bot` while Approval Handler's `telegramTrigger` listens on a different bot. End-to-end approval loop broken at the bot-identity boundary, not at trigger registration. Tracked as work-list item.

### GHL Marketing: Approval Handler

- **ID:** `ptHK2TZq5XppKOOg`
- **Belongs to:** Flow OS
- **Specialist owner:** Flow OS GHL Marketing (per `FLOW_OS_SPECIALISTS.md`)
- **Trigger:** Two triggers in one workflow — `telegramTrigger` "Telegram Trigger" (listens for `message` updates) and `webhook` POST `/webhook/ghl-marketing-regenerate` "Dashboard Regenerate Webhook" (responseMode: `onReceived`).
- **Purpose:** Two-track approval flow for generated GHL Marketing draft posts. Track A (Telegram): when Tyson replies to the approval-pending Telegram message, `Telegram Trigger` fires, `Parse Reply` extracts the action (approve / regenerate / feedback), `Route Action` switches to: **approve** → `Approve in Supabase` (sets row `status=approved`) → `Trigger Publisher` (POSTs to the Publisher webhook) → `Confirm Approval` (Telegram acknowledgement); **regenerate** → `Save Feedback to Supabase` (captures Tyson's regenerate prompt) → `Fetch Original Draft` → `Regenerate Content (Claude)` → `Parse Regenerated` → `Save New Draft` → `Send Revised to Telegram` (new approval-pending message). Track B (Dashboard): `Dashboard Regenerate Webhook` + `Parse Dashboard Input` + `Normalize Trigger` lets the dashboard's reject/regenerate UI feed into the same regenerate path. The whole workflow is the human-in-the-loop layer that gates publishing on Tyson's explicit approval per `ghl-marketing.md` line 686-691 distribution flow.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 7 days. **Per probe `/tmp/approval_handler_probe.md` (2026-05-04): 0 executions in API's last 200 rows.** With Content Generator producing 2 approval-pending drafts in the same window, this should have shown some activity — see Known issues for confirmed root cause.
- **Bucket:** M (silent failure here breaks the GHL Marketing approval loop end-to-end)
- **Known issues:** Approval Handler's Telegram trigger listens on a bot that does not match the bot Content Generator publishes through. Per probe (`/tmp/content_generator_telegram_probe.md` + Tyson direct verification 2026-05-04): Content Generator delivers approval-pending messages to chat thread `flowstatesads_bot`. If Approval Handler's `telegramTrigger` is configured against `@tyson_quantumbot` or any other bot's API token, replies in the `flowstatesads_bot` thread never reach this workflow's trigger — the approval loop is broken at the bot-identity boundary, not at the trigger-registration layer. The workflow is not necessarily dormant in the Trading Weekly Analyst sense; it has nothing to react to because upstream Telegram delivery is split across bots. Fix is part of the same bot-consolidation dispatch as Content Generator's bug (a) below. Plus: no heartbeat/errorWorkflow — joins cluster-wide gap. The dashboard regenerate webhook path remains functional independent of the Telegram bot question (Tyson confirmed working dashboard reject-with-feedback flow on 2026-05-04).

  **Cross-reference (2026-05-04 probe):** Bot Router on the same bot (`flowstatesads_bot`) was confirmed dormant via direct probe. Approval Handler likely shares the same trigger-registration failure since both `telegramTrigger`s depend on the same n8n Telegram listener subscription. Bundle Approval Handler verification + recovery into the same dispatch as Bot Router.

- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-22T11:20 UTC`. The two-trigger pattern is unusual — most workflows in the index have one trigger. Talks to: Telegram Bot API (read + write), Anthropic API (Claude regenerate), Supabase. Cross-references the Publisher webhook by URL (not workflow ID). Skill file: `ghl-marketing.md` (stale on distribution architecture).

### GHL Marketing: Content Generator

- **ID:** `Awo65rdSe5BvDHtC`
- **Belongs to:** Flow OS
- **Specialist owner:** Flow OS GHL Marketing
- **Trigger:** `scheduleTrigger` "Cron MWF 07:00 UTC" with cron expression `0 7 * * 1,3,5` (Mon/Wed/Fri at minute 0, hour 7).
- **Purpose:** 3×/week content generator for the GHL Support Specialist marketing campaign. `Determine Post Type` rotates between the Mon/Wed/Fri archetype (per `ghl-marketing.md` line 656: Monday pain-led, Wednesday value-led, Friday offer-led), `Fetch Recent Hooks` pulls recent post hooks from Supabase to enforce the "no repeat hook within 2 weeks" rule (line 662), `Prepare Prompt Data` builds the LLM prompt from the day's archetype + audience segment + tone rules from the skill file, `Generate Content (Claude)` produces the draft via Anthropic API, `Parse Response` extracts copy + hashtags + suggested image, `Save to Supabase` writes a `status=pending_approval` draft row, `Assign Image URL` assigns an image asset, and `Send to Telegram` posts the approval-pending message that Tyson reacts to via the Approval Handler workflow.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 2 executions in last 7 days. Both successful end-to-end (per probe `/tmp/content_generator_telegram_probe.md` — all 9 nodes ran, no errors, Telegram API returned `ok:true` with assigned message IDs). Last successful execution `2026-05-01T11:00:00 UTC`. Note: the cron `0 7 * * 1,3,5` named "07:00 UTC" actually fires at 11:00 UTC — see Known issues.
- **Bucket:** M
- **Known issues:** Two confirmed bugs (per probe at `/tmp/content_generator_telegram_probe.md`, executions 723440 + 724863):

  **(a) Bot identity split.** Send to Telegram delivers messages successfully (Telegram API returns `ok:true` with message IDs) — but to chat thread `flowstatesads_bot` (8622820007 / "Flow States Ads Agent"), not the operations bot Tyson normally monitors (`@tyson_quantumbot` per `ui.html:570`). Approval Handler's `telegramTrigger` appears to listen on a different bot, breaking the approval loop end-to-end. Tyson can see the messages by opening the `flowstatesads_bot` chat directly, but the design intent (single approval thread visible alongside other ops alerts) is broken. Fix dispatch needed: consolidate to single bot, OR explicitly document the multi-bot split as intentional.

  **(b) Empty Draft ID in Telegram message.** Template at Send to Telegram uses `{{ $json[0].id }}` — at that node `$json` is the Save-to-Supabase response object, not an array, so the expression evaluates undefined and the message reads "Draft ID:" with nothing after it. Confirmed by Tyson's screenshot 2026-05-04. Fix: change to `{{ $json.id }}` or equivalent. Trivial dispatch.

  Schedule timezone naming mismatch (cron "07:00 UTC" actually fires at 11:00 UTC due to n8n's NY-timezone evaluation) — see cluster-sweep correction pass tracked in maintenance log. No heartbeat/errorWorkflow — joins cluster-wide gap.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-27T13:12 UTC`. Talks to: Anthropic API, Supabase (`marketing_drafts` table per probe), Telegram Bot API (via `flowstatesads_bot` credential). Cross-reference: `ghl-marketing.md` for ICA archetypes (line 530-535), tone rules (line 545-553), three core pain points (line 559-565), content calendar (line 656-660). Skill file: `ghl-marketing.md`.

### GHL Marketing: Publisher

- **ID:** `fonuRTyqepxdyIdf`
- **Belongs to:** Flow OS
- **Specialist owner:** Flow OS GHL Marketing
- **Trigger:** `webhook` POST `/webhook/ghl-marketing-publish` (responseMode: `responseNode`).
- **Purpose:** Per-draft publisher that distributes an approved row to multiple platforms. `Fetch Draft` reads the row from Supabase, `Prepare` builds per-platform payloads. The LinkedIn leg has special handling: `LI Guard Check` queries Blotato for recent LinkedIn post timing (Blotato enforces a minimum gap between LinkedIn posts to avoid rate limiting), `LI Guard Apply` decides whether to defer this LinkedIn post, and `Skip LinkedIn?` IF either skips (defer) or proceeds via `LinkedIn Post (Blotato)`. In parallel: `Facebook Post` posts to Facebook Graph API directly, `IG Post (Blotato)` posts to Instagram via Blotato. After all platforms attempted, `Compute Final` aggregates per-platform results into a row state, `Update Supabase` writes the publish state back, `Telegram Notify` posts a per-publish summary, `Respond` returns the response payload to the caller. **Note:** this implementation contradicts `ghl-marketing.md` line 690 which says "On approval → pushed to GHL Social Planner via API → GHL Social Planner distributes" — actual implementation distributes directly.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 1 execution in last 7 days. Successful. Last successful execution `2026-04-30T09:24:55 UTC`.
- **Bucket:** M
- **Known issues:** **Skill file mismatch on distribution architecture** — `ghl-marketing.md` describes a GHL Social Planner intermediate; actual workflow goes direct-to-platform via Facebook Graph API + Blotato. Skill file reconciliation pending Phase 4 Slice 2. No heartbeat or errorWorkflow. Low recent activity (1 execution in 7d) is consistent with the Mon/Wed/Fri generator cadence + Tyson's approval throughput — and with the bot identity split confirmed in Content Generator's entry: if approvals aren't reaching Approval Handler via the right bot, Publisher only fires on the dashboard regenerate path or scheduled-publisher path, not via approve-via-Telegram.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-29T19:11 UTC`. Talks to: Facebook Graph API, Blotato API (LinkedIn + Instagram), Supabase. The `LI Guard Check` + `LI Guard Apply` pattern is a workflow-internal rate-limiter for LinkedIn — interesting precedent for cross-cluster reuse. Skill file: `ghl-marketing.md` (stale on architecture).

### GHL Marketing: Scheduled Publisher

- **ID:** `dHceOMijUOcnEowO`
- **Belongs to:** Flow OS
- **Specialist owner:** Flow OS GHL Marketing
- **Trigger:** `scheduleTrigger` "Every 15 min" (`minutesInterval: 15`).
- **Purpose:** Every-15-minute orchestrator for time-scheduled GHL Marketing publishing. `Fetch Due Drafts` queries Supabase for rows with `status=approved` and `scheduled_for <= now`, `Split Rows` fans out one item per due draft, `Fire Publisher` POSTs each to the Publisher webhook (`fonuRTyqepxdyIdf` via `/webhook/ghl-marketing-publish`). The 15-minute cadence means Approval Handler can mark a row `approved` with a future `scheduled_for` and this orchestrator will pick it up at the right window.
- **Heartbeat:** N (despite firing every 15 min — same pattern as Crete Scheduled Publisher).
- **Error workflow:** none.
- **Recent activity:** 100+ executions in last 7 days (API limit). 100 successes / 0 errors (heuristic). Last successful execution `2026-05-04T10:30:54 UTC` — running healthy at the 15-minute level.
- **Bucket:** M
- **Known issues:** **Same orchestrator/downstream reporting trap as Crete Scheduled Publisher.** This workflow is 100% green on its own heartbeat-equivalent (it simply succeeds when it polls), but a green status here says nothing about whether the rows it dispatched to Publisher actually published successfully. Charlie's digest reading just this workflow's status would conclude "GHL Marketing pipeline healthy" when reality could be "fan-out succeeded, downstream Publisher failed silently". The general principle from the Crete cluster applies: orchestrator workflows need composite heartbeat + downstream-success reporting. Most pressing because the Publisher workflow doesn't have heartbeat/errorWorkflow either, so the orchestrator's green status is the only signal the pipeline emits.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-22T11:20 UTC`. Talks to: Supabase (read), Publisher workflow (HTTP). Stable since the original GHL Marketing build. Skill file: `ghl-marketing.md`.

### GHL Marketing: Weekly Report

- **ID:** `jRiiOsWneQAtfVPD`
- **Belongs to:** Flow OS
- **Specialist owner:** Flow OS GHL Marketing
- **Trigger:** `scheduleTrigger` "Sunday 20:00 UTC" with cron expression `0 20 * * 0` (Sunday at minute 0, hour 20).
- **Purpose:** Weekly Sunday-evening recap of the GHL Marketing campaign performance. `Calculate Date Range` resolves the 7-day window, `Fetch Marketing Stats` pulls the week's draft + publish + engagement metrics from Supabase, `Aggregate Stats` computes summary numbers, `Generate Report (Claude Haiku)` produces a narrative (Haiku per `ghl-marketing.md` line 698 cost-efficiency rule: "All copy generation uses Claude Sonnet (cost-efficient)" — Weekly Report uses Haiku, even cheaper, appropriate for summary narration), `Format Report` shapes the message, `Send Report to Telegram` posts to Tyson's chat.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 1 execution in last 7 days. Successful. Last successful execution `2026-05-04T00:00:00 UTC`. Note: the cron `0 20 * * 0` named "Sunday 20:00 UTC" fires at 00:00 UTC Monday, which is 20:00 NY time Sunday — confirming the cluster-wide NY-timezone interpretation. Tyson would have received the report at 03:00 Athens time Monday, not 23:00 Athens time Sunday as a UTC reading would imply.
- **Bucket:** S
- **Known issues:** **Schedule timezone naming mismatch** (same pattern as Content Generator) — actual fire is Sunday 20:00 NY = Monday 00:00 UTC, not "Sunday 20:00 UTC" as the node name suggests. Worth rolling into the cluster-wide schedule audit. No heartbeat/errorWorkflow, but low frequency and weekly visibility in Tyson's Telegram makes silent failure detectable. Note: this report posts via the same Telegram node configuration as Content Generator — likely also via `flowstatesads_bot`, so same bot-identity-split implications apply (Tyson would need to check the `flowstatesads_bot` thread to find the weekly report).
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-21T13:24 UTC`. Talks to: Supabase (read), Anthropic API (Claude Haiku), Telegram. Skill file: `ghl-marketing.md`.

---

## Ad Agency cluster

6 workflows. All belong to **Shared** (Ad Agency Operator serves Flow OS + Emma Maidment Business + Flow States Retreats per `FLOW_OS_SPECIALISTS.md`). Specialist owner across all 6: **Ad Agency Operator**. Skill file: `ads-agency.md` (`src/agents/skills/ads-agency.md`, 2,293 bytes, mtime 2026-03-27 — covers webhook routing keywords from Charlie's perspective; not stale on the architecture).

Cluster-level findings:
- **Rex (Strategist) confirmed UI-only** — searched all 75 workflows in n8n for any name containing "rex" or "strategist" → zero matches. Rex remains a UI stub at `ui.html:531` per `FLOW_OS_SPECIALISTS.md` Ad Agency Operator entry. **No 6th specialist-named workflow exists.** The 6 workflows in this cluster are the 5 named in `FLOW_OS_SPECIALISTS.md` + the **Telegram Bot Router** (`lu39mAN7epBRK3Kw`) which serves as the conversational entry point for the whole agency from Telegram.
- **Bot identity confirmed `flowstatesads_bot`** — the Telegram Bot Router's `Help Reply` node identifies itself as "*Flow States Ads Agent*" (same bot as the GHL Marketing Content Generator probe 2026-05-04). High-confidence cross-cluster confirmation: **11 workflows now confirmed on `flowstatesads_bot`** (6 Ad Agency + 5 Flow OS GHL Marketing). Work-list item 8 (bot consolidation) spans both clusters.
- **Heartbeat + errorWorkflow gap is total: 0/6.** Joins the cluster-wide backlog alongside Flow OS GHL Marketing's 0/5.
- **Hardcoded accounts** confirmed unchanged from `FLOW_OS_SPECIALISTS.md`: Ledger has EMB + Flow States Retreats; Optimisation has all three (incl. Flow OS); other 4 take account dynamically via webhook payload or have no account context.
- **Multi-user pattern** — Bot Router has explicit Tyson + Em authorisation gates: copy + brief + research available to both, ad creation + optimisation report Tyson-only, with Em-uses-copy → Tyson-notified hooks. Reflects the Ad Agency Operator entry's `creator: tyson|emma` routing.
- **Schedule timezone observation does not apply** to this cluster — Optimisation uses `hoursInterval: 24` (relative interval, not cron), Bot Router uses `telegramTrigger`, the other 4 are webhook-only. No further entries to add to the timezone cluster-sweep work-list item 7.
- **Bot Router confirmed dormant via direct probe (2026-05-04)** — see Bot Router Known Issues. The Ad Agency conversational layer end-to-end is broken at the trigger-registration level; sub-role workflows remain reachable via dashboard/direct webhook calls.

### Flow States — Competitor Ad Research

(Scout sub-role per `FLOW_OS_SPECIALISTS.md`.)

- **ID:** `QnCEES9T7WxW5vVR`
- **Belongs to:** Shared
- **Specialist owner:** Ad Agency Operator (per `FLOW_OS_SPECIALISTS.md`)
- **Trigger:** `webhook` POST `/webhook/competitor-research` (responseMode: `responseNode`).
- **Purpose:** On-demand competitor ad research backing the Ad Agency's Scout sub-role. `Parse Research Request` extracts brand name + research intent from the inbound payload, `Route Research Intent` switches on action type (research / save / list). Research path: `Build Research Prompt` → `Claude Ad Research` (httpRequest to Anthropic) → `Format Research Reply`. Save path (when Tyson flags an ad for the swipe file): `Parse Ad to Save` → `Claude Parse Ad` (extract structured ad metadata) → `Save Ad to Supabase` → `Format Save Reply`. List path (return current swipe-file inventory): `Fetch Competitor Ads` → `Format List Reply`. All paths converge at `Send Research Reply` (Telegram) + `Webhook Response`. The Telegram chatId comes from the inbound webhook payload (`={{ $json.chatId }}`) — no hardcoded chatId, so the bot identity is whichever credential the Telegram node is wired to.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 1 execution in last 7 days. 1 success / 0 errors. Last successful execution `2026-05-03T12:57:43 UTC`.
- **Bucket:** S
- **Known issues:** No heartbeat/errorWorkflow — joins cluster-wide gap. Workflow name "Flow States — Competitor Ad Research" sounds FSC-aligned but it's account-agnostic (no hardcoded `act_*`). Per the Ad Agency cross-reference audit (2026-05-03), the workflow name itself ties scope to FSC but the implementation accepts any brand passed via the webhook payload — no behavioural lock to FSC-only.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-04T18:01 UTC`. Talks to: Anthropic API (Claude), Supabase (swipe file table), Telegram. Skill file: `ads-agency.md` (covers the routing keywords Charlie recognises for triggering this workflow). Cross-reference: `FLOW_OS_SPECIALISTS.md` Ad Agency Operator entry — Scout sub-role.

### Meta Ads Ad Creation Agent

(Ledger sub-role per `FLOW_OS_SPECIALISTS.md`.)

- **ID:** `lrGcirtmOHb1xTq8`
- **Belongs to:** Shared (account-hardcoded scope: EMB + Flow States Retreats)
- **Specialist owner:** Ad Agency Operator
- **Trigger:** `webhook` POST `/webhook/ad-creation-agent` (responseMode: `lastNode`).
- **Purpose:** Multi-step conversational ad creation flow backing the Ad Agency's Ledger sub-role. Receives Telegram messages relayed from the Bot Router and walks through a step-by-step ad-build wizard: account selection → mode selection (new campaign vs add-to-existing) → objective (if new campaign) → audience config (if new campaign) → campaign / ad-set selection → copy source (use existing variant or new copy) → copy text → URL → budget → creative asset (image upload via Telegram). Session state persists in Supabase between webhook calls (`Load Session` / `Create or Update Session`). On final asset receipt, `Prepare Build Data` → `Process Image Upload` → `Download Image Binary` → `Convert Binary to Base64` → `Upload Image to Meta v3` → `Create Campaign` (if new) → `Create Ad Set` (if new) → `Create Ad Creative` → `Create Ad` → `Format Success Message` → `Send Success Reply` + `Delete Session (Complete)`. The flow is gated on Tyson per the Bot Router's "Ad Creation Gate (Tyson Only)" — Em is shown a "not authorised" reply.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 30 days. **Expected** — ad creation is human-initiated and infrequent; consistent with `FLOW_OS_SPECIALISTS.md` Ad Agency Operator caveat that the agency has been low-usage for ad creation specifically.
- **Bucket:** M
- **Known issues:** Hardcoded to **Emma Maidment Business** (`act_1426936257455201`) and **Flow States Retreats** (`act_464237024205104`) — Flow OS account (`act_414785961683125`) is **not** in this workflow; ad creation for Flow OS is not currently supported. Flow States Retreats is dormant per `FLOW_OS_STATE.md` Section 5 + `LOCATIONS.md:73`, but the hardcoded reference remains — pending cleanup per `FLOW_OS_SPECIALISTS.md` Ad Agency Operator caveats. No heartbeat/errorWorkflow. The 51-node multi-step wizard pattern would be hard to add a heartbeat to meaningfully (heartbeat-per-step isn't useful) — a different observability strategy (e.g. session-table TTL monitoring) may serve better than the standard heartbeat pattern.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-04T18:01 UTC`. Talks to: Meta Graph API v3 (campaigns / ad sets / ad creatives / ads / image upload), Supabase (`ad_creation_sessions` table per `QCLAW_BUILD_LOG.md:128`), Telegram. The conversational state is persisted across many webhook invocations — silent failure mid-flow would leave a stale session row. Skill file: `ads-agency.md`.

### Meta Ads Copy Agent

(Penny sub-role per `FLOW_OS_SPECIALISTS.md`.)

- **ID:** `0sIugM5o5wTwpflq`
- **Belongs to:** Shared
- **Specialist owner:** Ad Agency Operator
- **Trigger:** `webhook` POST `/webhook/meta-ads-copy-agent` (responseMode: `responseNode`).
- **Purpose:** Generates 5 ad copy variants from an offer + angle + format + creator brief. `Parse Input` extracts the brief fields, `Build Copy Request` shapes the LLM prompt (drawing on the GHL Support Specialist tone rules per `ghl-marketing.md` lines 545-553 — also referenced for Ad Agency copy generation), `Generate Ad Copy Variants` (httpRequest to Anthropic) produces 5 variants, `Format Output` shapes them for delivery, `Save Copy to Supabase` persists them with UTM URLs (per `QCLAW_BUILD_LOG.md:127` "copy_agent_output stores copy variants with UTM URLs"), `Send Copy to Tyson (Telegram)` posts to Telegram, `Webhook Response` returns the variants. The Telegram chatId is dynamic via the inbound webhook (`={{ $('Webhook Trigger').first().json.body.chatId || '1375806243' }}`) with `1375806243` (Tyson) as fallback.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 30 days. Consistent with `FLOW_OS_SPECIALISTS.md` low-usage note.
- **Bucket:** S
- **Known issues:** No heartbeat/errorWorkflow. The fallback chatId `'1375806243'` (Tyson hardcoded) is a sensible default for missing-payload cases; no specific concern. No hardcoded accounts — fully dynamic via the `creator: tyson|emma` field in the payload (the routing decision happens server-side in this workflow's prompt via creator field, not via account ID).
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-04T18:01 UTC`. Talks to: Anthropic API, Supabase (`copy_agent_output` table), Telegram. UTM convention used: `utm_source=meta&utm_medium=paid_social&utm_campaign=[offer-slug]&utm_content=[angle-slug]&utm_term=[creator]` per `QCLAW_BUILD_LOG.md:135-136`. Skill file: `ads-agency.md`.

### Meta Ads Creative Brief Agent

(Frame sub-role per `FLOW_OS_SPECIALISTS.md`.)

- **ID:** `TtSUyKpvE5f9iQZg`
- **Belongs to:** Shared
- **Specialist owner:** Ad Agency Operator
- **Trigger:** `webhook` POST `/webhook/meta-ads-creative-brief` (responseMode: `responseNode`).
- **Purpose:** Generates a creative brief for a video ad (script, visual direction, production notes). `Parse Input` extracts the brief request (offer / angle / format / hook / creator), `Build Brief Request` shapes the LLM prompt, `Generate Creative Brief` (httpRequest to Anthropic) produces the brief, `Format Output` packages it, `Send Brief to Tyson (Telegram)` posts a short Telegram acknowledgement (the full brief is delivered separately — per the Bot Router's Brief Confirmation node text "Full brief has been sent to Tyson's email"), `Webhook Response` returns the brief.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 30 days.
- **Bucket:** S
- **Known issues:** `chatId` hardcoded to `1375806243` (Tyson) in `Send Brief to Tyson (Telegram)` — **by design.** Per Tyson 2026-05-04: ads sign-off authority is Tyson's based on ads experience; Em creates brief requests via Bot Router, Tyson reviews and approves. The hardcoded chatId enforces that approval routing. Operational decision, not a bug. No heartbeat/errorWorkflow — joins cluster-wide gap.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-03-26T16:40 UTC` — has not been touched in nearly 6 weeks, the second-oldest `updatedAt` in the cluster after Bot Router. Talks to: Anthropic API, Telegram. Skill file: `ads-agency.md`.

### Meta Ads Optimisation Agent

(Optimisation reporting sub-role per `FLOW_OS_SPECIALISTS.md`.)

- **ID:** `lf955LDteJ512RQi`
- **Belongs to:** Shared (covers all 3 Meta accounts)
- **Specialist owner:** Ad Agency Operator
- **Trigger:** Two triggers — `scheduleTrigger` "Daily Schedule (9am)" with `hoursInterval: 24` (every 24 hours from activation, not cron-based), AND `webhook` POST `/webhook/meta-ads-optimisation-trigger` "Webhook Trigger (On-Demand)" (responseMode: `responseNode`) for on-demand pulls (e.g. from the Bot Router's "Show me the latest ad performance" intent route).
- **Purpose:** Daily 7-day-window performance report across all three Meta ad accounts. `Set Date Range & Accounts` defines the window and the three account IDs (`act_414785961683125` Flow OS, `act_1426936257455201` EMB, `act_464237024205104` Flow States Retreats), `Split Accounts` fans out per-account, `Fetch Ad Insights` (httpRequest to Meta Graph) pulls insight data, `Process & Score Insights` (code) produces per-account stats and a combined narrative score, `Build Opt Analysis Request` + `AI Optimisation Analysis` (httpRequest to Anthropic) generates an optimisation narrative, `Format Report` shapes the Telegram report, `Send Report to Tyson (Telegram)` posts the report. Optional `Log Report (Optional)` Airtable node is currently disabled.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 33 executions in last 7 days. **18 successes / 15 errors (heuristic).** Last successful execution `2026-05-04T04:00:40 UTC`. **All 33 executions in the 30d window happened in the last 7 days** — none between days 7 and 30, suggesting the workflow either was inactive earlier, or had its activation reset around the Apr 29 update.
- **Bucket:** M
- **Known issues:** **Elevated error rate (~45%) in last 7 days post-Apr-29 update.** `updatedAt: 2026-04-29T14:29 UTC` lines up with the Trading session's broader ops work that week. Possible causes: Meta Ads API rate limiting (3 accounts × per-account fetch may hit limits), Flow States Retreats account dormancy returning errors, or an issue introduced in the Apr 29 update. Same diagnostic flavour as Trading Market Scanner's post-fix error mode and Crete Content Publish's visibility findings — these warrant a small batch dispatch that reads recent error executions across the three workflows and identifies the per-workflow failure paths. The 33-vs-7-expected execution count over 7d (workflow has both 24h schedule AND on-demand webhook) suggests Bot Router on-demand calls are firing it ~26 extra times per week, or a tighter schedule is firing than the trigger config implies. **`chatId` hardcoded to Tyson** for the Send Report node — Em can't pull the report directly via Bot Router (the "Report Restricted (Emma)" node in Bot Router enforces this; she gets a "Tyson notified" message instead). No heartbeat/errorWorkflow.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-04-29T14:29 UTC`. Talks to: Meta Graph API (Insights endpoint per account), Anthropic API, Telegram. The disabled Airtable node hints at a planned-but-not-shipped reporting persistence layer. Skill file: `ads-agency.md`.

### Meta Ads Telegram Bot Router

(Conversational entry point — not a sub-role per `FLOW_OS_SPECIALISTS.md` but the unifying surface that Tyson + Em interact with.)

- **ID:** `lu39mAN7epBRK3Kw`
- **Belongs to:** Shared
- **Specialist owner:** Ad Agency Operator
- **Trigger:** `telegramTrigger` listening for `message` and `callback_query` updates on the **`flowstatesads_bot`** Telegram bot (inferred from the `Help Reply` node identifying itself as "*Flow States Ads Agent*"; credential ID not exposed in the API response but the node text confirms identity).
- **Purpose:** Conversational orchestrator for the entire Ad Agency. Routes inbound Telegram messages from `flowstatesads_bot` to the right sub-role workflow via Claude-based intent classification. Flow: `Telegram Trigger` → `Parse Message` → `Authorisation Gate` (whitelist of authorised user IDs — Tyson + Em) → `Parse Intent` (uses `Build Anthropic Request` + `Intent Classifier (Claude)` for fuzzy intent matching) → `Intent Router` switch routing to: **Copy** (acks → calls Penny via `Call Copy Agent` → returns variants → "Notify Tyson if Emma requested" hook → `Send Tyson Notification`); **Brief** (acks → calls Frame via `Call Brief Agent` → confirmation message); **Report** (`Tyson Only Gate` — Em gets `Report Restricted (Emma)` reply; Tyson path triggers Optimisation Agent on-demand webhook); **Ad Creation** (`Ad Creation Gate (Tyson Only)` — Em gets `Ad Creation Not Authorised`; Tyson path checks `Active Ad Session` and either forwards to in-flight Ledger session or starts new one); **Iterate** (call Penny in iterate mode for variant refinement); **Research** (call Scout via `Call Research Agent`); **Help** (static help text identifying the bot as "Flow States Ads Agent"); **Unknown** (fallback help text).
- **Heartbeat:** N (its own silent failure means the entire Ad Agency conversational interface goes dark — confirmed dormant per Known issues below).
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 30 days. **Confirmed dormant via direct Tyson probe 2026-05-04** — see Known issues.
- **Bucket:** M (silent failure here breaks the entire Ad Agency conversational layer end-to-end; only the dashboard-modal paths and direct sub-role webhook calls remain functional)
- **Known issues:** **Confirmed dormant per direct probe (2026-05-04):** Tyson sent test message to `flowstatesads_bot` ("show me the latest ad performance") — no reply received. Bot Router's `telegramTrigger` is registered `active=true` in n8n DB but is not actually firing. Same failure mode as Trading Weekly Analyst's cron registration. Recovery path: deactivate/reactivate to force trigger re-registration, add heartbeat + errorWorkflow before flipping back active so next outage surfaces within hours. Bundle with the heartbeat + errorWorkflow sweep dispatch (work-list item already tracking 13 mission-critical workflows missing the pattern; Bot Router joins this as the highest-impact target since silent failure breaks the entire Ad Agency conversational layer end-to-end).

  **Operational reality (per Tyson 2026-05-04):** Bot Router was set up as the conversational orchestrator for the Ad Agency cluster but never adopted in daily flow. Sub-role workflows (Scout, Penny, Frame, Ledger, Optimisation) are invoked directly via dashboard or specific webhooks rather than through Bot Router's intent-classified routing. Tyson currently copy-pastes between workflows because the agents don't chain. The orchestration architecture exists in code but not in operational use. This is a load-bearing finding for Phase 4+ specialist communication contract design — specialists without a defined inter-specialist contract default to humans-as-integrator. Charlie 2.0's design must include defined inter-specialist invocation routes via Charlie-as-router.
- **Last verified:** 2026-05-04
- **Notes:** `updatedAt: 2026-03-19T14:00 UTC` — oldest `updatedAt` in the cluster (almost 7 weeks). Talks to: Anthropic API (Claude intent classifier), all 5 other Ad Agency workflows (via their webhooks), Telegram, Supabase (active session check). The Bot Router is the de-facto authorisation layer for the cluster — Tyson-only gates on Optimisation Report and Ad Creation are enforced here, not at the downstream workflow level. If Em finds a way to call those downstream webhooks directly, the gates wouldn't apply — a defence-in-depth concern that's structurally fine for an internal-bot-only setup but worth flagging if the webhooks are ever exposed. Skill file: `ads-agency.md` + cross-reference `FLOW_OS_SPECIALISTS.md` Ad Agency Operator entry.

---

## Tyson Personal Brand — LinkedIn cluster

5 workflows. All belong to **Personal** (Tyson personal brand). **Specialist owner: None — Tyson directly.** No agent specialist currently exists for personal brand LinkedIn lead gen in `FLOW_OS_SPECIALISTS.md`. No skill file exists in `src/agents/skills/` for these workflows.

Cluster-level findings:
- **Heartbeat + errorWorkflow gap is total: 0/5.** Joins the cluster-wide backlog.
- **Separate Supabase project** — 4 of 5 workflows talk to `zshmlgtvhdneekbfcyjc.supabase.co`, distinct from the main QClaw Supabase (`fdabygmromuqtysitodp`). LinkedIn lead gen data lives in its own project. Documented in `LOCATIONS.md` under "Secondary Supabase projects".
- **OpenAI, not Anthropic** — every LinkedIn workflow uses OpenAI nodes. Different LLM stack from the Anthropic-on-Claude pattern across the rest of the ecosystem.
- **Slack + Email, not Telegram** — alerting is via Slack channels and email reports, not Telegram. The cross-cluster bot consolidation work-list item 8 does not affect this cluster.
- **No chain orchestration** — all 5 are independently scheduled with shared database. Same humans-as-integrator failure mode as Ad Agency Bot Router; same Phase 4+ specialist communication contract concern (work-list item 12 applies — and is the third pattern observation supporting the item-12 reframe from Phase 5+ tidy to Phase 4+ load-bearing).
- **Schedule timezone NY pattern confirmed for 5 more workflows** — adding to cluster-sweep work-list item 7. Affected cron expressions: Analytics Collection (`0 0 8 * * *`), Weekly Report (`0 0 9 * * 1`), Content Schedule (`0 0 8 * * 1,3,5`), Lead Gen (`0 0 9 * * 1-5`), Follow-up (`0 0 11 * * 2,4`).
- **No `FLOW_OS_STATE.md` entry currently** for LinkedIn lead gen — recommended as work-list item 17.

### linkedIn analytics and monitoring

- **ID:** `yPt090tPv4FJtwAZ`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly.
- **Trigger:** Three `scheduleTrigger` nodes — "Analytics Collection Trigger" `0 0 8 * * *` (daily 08:00 NY), "Weekly Report Trigger" `0 0 9 * * 1` (Mon 09:00 NY), "System Health Monitor" `0 0 * * * *` (every hour, top of hour).
- **Purpose:** Three-track analytics + reporting + health for the LinkedIn lead-gen pipeline. **Daily Analytics:** `Recent Posts Query` reads recent posts from Supabase, `LinkedIn Post Analytics` computes per-post engagement, `Analytics Database Update` writes back, `AI Performance Analyzer` (OpenAI) generates narrative analysis, `Parse Performance Analysis` shapes output, `Insights Logger` persists. **Weekly Report (Mon 09:00 NY):** `Weekly Metrics Query` reads aggregate stats, `Lead Metrics Query` + `Engagement Metrics Query` compute per-axis numbers, `Merge Weekly Metrics` combines them, `AI Report Generator` (OpenAI) produces narrative, `Parse Report` shapes, `Email Report Sender` emails the report, `Slack Weekly Summary` posts to Slack, `Report Archive` persists. **System Health (hourly):** `System Health Query` checks pipeline state, `Health Alert Filter` IF triggers `Slack Health Alert` if anomalous, `Alert Logger` persists.
- **Heartbeat:** N (the "System Health Monitor" trigger is essentially the cluster's de-facto observability layer for LinkedIn ops — the closest thing to a heartbeat across the 5 LinkedIn workflows, though it monitors Supabase state rather than firing per-workflow heartbeats).
- **Error workflow:** none.
- **Recent activity:** 100+ executions in last 7 days (API limit hit). All 100 successful. Last successful execution `2026-05-04T12:00:00 UTC`. The 100+ count is dominated by the hourly System Health Monitor (24×7=168 hourly fires expected; capped at 100 per query).
- **Bucket:** M (the only operational visibility layer for the LinkedIn cluster — its silent failure leaves the rest of the cluster invisible)
- **Known issues:** **Schedule timezone naming mismatch** for both "08:00" and "09:00" Mon-named cron expressions — joins cluster-sweep work-list item 7. No heartbeat/errorWorkflow on this workflow itself, which is paradoxical given it serves as the cluster's observability layer.

  **[Tyson decision 2026-05-04]** Weekly LinkedIn reports go to `tyson@flowos.tech`. Tyson has not received reports recently — verify whether the Email Report Sender is currently configured to that destination, and if not, update the workflow to route there. Two possible states: (a) workflow is currently sending reports to a different/old address, in which case route reconfiguration is needed; (b) workflow is silently broken and not sending reports at all (same shape as Bot Router and Approval Handler dormancy patterns). Verification probe needed to disambiguate. Bundle into the heartbeat + errorWorkflow sweep dispatch.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2025-06-06`, `updatedAt: 2026-03-26T08:48 UTC`. Talks to: Supabase (LinkedIn project `zshmlgtvhdneekbfcyjc`, multiple tables for posts/leads/engagement/insights), OpenAI (analysis + reporting), Slack (alerts + weekly summary), email (weekly report). The hourly System Health Monitor is unique across all 4 prior documented clusters — no other workflow has an hourly self-health-check cadence. **No skill file**.

### LinkedIn Content Generation

- **ID:** `qszqid6NY51SoX95`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly (no agent specialist exists for personal brand LinkedIn).
- **Trigger:** `scheduleTrigger` "Content Schedule Trigger" with cron expression `0 0 8 * * 1,3,5` (6-field; Mon/Wed/Fri 08:00 NY = 12:00 UTC per cluster-wide timezone observation), AND `chatTrigger` "When chat message received" (n8n's built-in chat-UI trigger, allows manual on-demand generation from the n8n editor).
- **Purpose:** 3×/week scheduled content generation publishing directly to Tyson's LinkedIn personal profile. `Content Pillar Selector` rotates between content pillars per the day, `Fetch LinkedIn URN` resolves the personal-profile URN from the LinkedIn API, `Merge URN and Pillar` shapes the publish target, `AI Content Generator` (OpenAI) produces the post, `Parse and Quality Check` validates output, `Content Quality Gate` IF gates publishing on quality threshold, `Publish to LinkedIn` POSTs directly to `api.linkedin.com` (not via Blotato), `Extract Post ID` captures the published-post ID, `Database Logger` persists to the LinkedIn Supabase, `Slack Notification` posts confirmation to Tyson's Slack. Failure path uses `Failed Content Logger`. The `Fetch Recent Posts` + `Fetch Top Performing Posts` + `Build Content Context` nodes feed the chat-trigger path with historical context for on-demand generation.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 3 executions in last 7 days. All 3 successful. Last successful execution `2026-05-04T12:00:00 UTC`. Matches the M/W/F 08:00 NY (12:00 UTC) cadence — May 4 is Mon, May 1 was Fri, Apr 29 was Wed = 3 fires expected, 3 observed.
- **Bucket:** M
- **Known issues:** **Schedule timezone naming mismatch** (cron `0 0 8 * * 1,3,5` named "08:00" but fires at 12:00 UTC = 08:00 NY) — joins cluster-sweep work-list item 7. No heartbeat/errorWorkflow — joins cluster-wide gap. The chat-trigger path is functional but not exposed outside the n8n editor — only Tyson can use it from inside n8n's UI.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2025-06-06`, `updatedAt: 2026-03-26T08:48 UTC` — has not been touched in nearly 6 weeks; current 100% success rate suggests it's stable. Talks to: LinkedIn API (api.linkedin.com), Supabase (LinkedIn project `zshmlgtvhdneekbfcyjc`), OpenAI, Slack. **No skill file** — workflow purpose inferred from node structure.

### LinkedIn Engagement Automation

- **ID:** `VMqrrhecG2hrpn4C`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly.
- **Trigger:** `scheduleTrigger` "Engagement Monitor Trigger" with cron expression `0 0 */4 * * *` (every 4 hours, top of hour) AND `webhook` POST `/webhook/linkedin-engagement-webhook` "LinkedIn Webhook Trigger" (responseMode: `responseNode`).
- **Purpose:** Every-4-hour automated engagement (commenting + liking) on Tyson's LinkedIn feed. `LinkedIn Feed Monitor` (n8n LinkedIn node) pulls recent feed items, `AI Content Analyzer` (OpenAI) classifies each post, `Parse Content Analysis` shapes the analysis, `Check Engagement Rate Limit` queries Supabase for the per-day engagement counter, `Merge Analysis and Rate Limit` decides which posts to engage with, `Engagement Filter` IF gates on threshold, `Comment or Like Router` IF picks action type. For comments: `AI Response Generator` produces a comment, `Response Quality Gate` + `Quality Check` IF validates, `LinkedIn Comment Creator` posts the comment. For likes: `LinkedIn Like Action` posts the reaction. `Engagement Logger` + `Rate Limit Tracker` persist counters to Supabase. The webhook leg lets external triggers fire engagement on-demand. `Fetch Engagement Weights` + `Merge Engagement Context` weight engagement decisions per content type/author/topic.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 39 executions in last 7 days. All 39 successful. Last successful execution `2026-05-04T12:00:00 UTC`. Cadence check: `*/4` hours = 6 fires/day × 7 days = 42 expected; 39 observed (some hours may have produced no engagement-eligible posts and short-circuited at the gate, but they should still appear as executions).
- **Bucket:** M
- **Known issues:** No heartbeat/errorWorkflow. The `Check Engagement Rate Limit` node is essential — autonomous LinkedIn engagement without a rate limit risks account flagging by LinkedIn's anti-abuse heuristics.

  **[Tyson to verify in Supabase]** Daily rate limit value not currently known. Worth verifying that the configured limit is conservative relative to LinkedIn's anti-abuse heuristics — autonomous engagement without sufficient rate limiting risks account flagging. Added to post-doc-pass work list as small verification task.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2025-06-06`, `updatedAt: 2026-03-26T08:48 UTC`. Talks to: LinkedIn API (via n8n's LinkedIn node — credential-managed, not direct httpRequest), Supabase (LinkedIn project `zshmlgtvhdneekbfcyjc`), OpenAI. **No skill file**.

### LinkedIn Lead Generation (Apify + Browserflow)

- **ID:** `jmIA9yKIJobsIC60`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly.
- **Trigger:** Two `scheduleTrigger` nodes — "Lead Generation Trigger" with cron `0 0 9 * * 1-5` (weekdays 09:00 NY = 13:00 UTC) AND "Follow-up Trigger" with cron `0 0 11 * * 2,4` (Tue/Thu 11:00 NY = 15:00 UTC).
- **Purpose:** Two-phase LinkedIn outreach automation. **Phase 1 — Outreach (weekday 09:00 NY):** `Launch Apify LinkedIn Scraper` POSTs to `api.apify.com` to start a LinkedIn search-result scrape (Apify actor `curious_coder~linkedin-pr…` — name truncated in API response), `Wait for Apify Results` polls until the actor completes, `Fetch Apify Results` retrieves the prospect list, `Parse Prospect List` shapes records, `AI Lead Scorer` (OpenAI) scores each prospect 1-10, `Parse Lead Score` extracts the score, `Lead Qualification Filter` IF gates on threshold (low scorers go to `Low Score Logger`), `Check Daily Rate Limit` queries Supabase for the daily connection-request counter, `Rate Limit Gate` IF stops on cap, `AI Personalization Engine` (OpenAI) writes a personalised connection note, `Send Connection via Browserflow` POSTs to `api.browserflow.io` to send the connection request via browser automation (Browserflow handles the browser session and cookies; no LinkedIn API write here), `Prospect Database Logger` persists to Supabase, `Update Rate Limit Counter` increments the daily counter. **Phase 2 — Follow-up (Tue/Thu 11:00 NY):** `Query Accepted Connections` reads Supabase for connections that accepted in the last N days, `AI Follow-up Generator` (OpenAI) writes a follow-up message, `Send Follow-up via Browserflow` posts it via Browserflow, `Follow-up Tracker` updates Supabase.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 6 executions in last 7 days. **2 successes / 4 errors (heuristic).** Last successful execution `2026-04-30T15:00:00 UTC`. **Most recent execution `2026-05-01T13:00:00 UTC` errored** (`status=error, finished=False`). The cluster's **only error-prone workflow** — same diagnostic flavour as Trading Market Scanner / Crete Content Publish / GHL Marketing Optimisation Agent.
- **Bucket:** M
- **Known issues:** **Elevated error rate (~67% over 7d).** Possible causes: Apify actor failures (rate limits, target page changes, scraper detection by LinkedIn), Browserflow session expiry, OpenAI rate limits, daily-rate-limit logic blocking after a successful outreach, or an issue introduced upstream. Same flavour as the other errored-mission-critical workflows; bundle into the same batch diagnostic dispatch. **Schedule timezone naming** — cron `0 0 9 * * 1-5` and `0 0 11 * * 2,4` named for NY hours but fire at UTC+4. Joins cluster-sweep. No heartbeat/errorWorkflow — particularly painful here given this is the workflow most likely to need observability.

  **PhantomBuster transition history:** Discovery audit referenced "PhantomBuster free plan limits" — this is operational history, not current state. Per Tyson 2026-05-04: workflow was originally built with PhantomBuster, transitioned to Apify + Browserflow at some point, transition was never fully completed. Current implementation uses Apify + Browserflow exclusively. PhantomBuster references in audit context are stale historical residue and should be ignored. Worth a sweep of skill files, old briefs, and any other docs for residual PhantomBuster references that should be updated or removed.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2025-06-06`, `updatedAt: 2026-03-26T08:47 UTC`. Talks to: api.apify.com (LinkedIn scraper actor), api.browserflow.io (browser-automation outreach), Supabase (LinkedIn project `zshmlgtvhdneekbfcyjc`), OpenAI. Browserflow is a niche browser-automation service — single-vendor dependency worth flagging. **No skill file**.

### Master avatar social media machine V1

- **ID:** `NhTdMXeqliW6dPDr`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly. (Note: workflow is structured to potentially distribute to Flow OS company page LinkedIn but that branch is currently disabled; see Known Issues.)
- **Trigger:** `scheduleTrigger` "Schedule Trigger" — params truncated in API response; need a follow-up probe to confirm cadence.
- **Purpose:** Avatar-video generation pipeline distributed to multiple social platforms. `AI Writer` (OpenAI) produces a script, `AI Research - Report` + `AI Research - Top 10` (Perplexity) ground the content in current sources. `Setup Heygen` configures the Heygen API call, IF branch decides between `Create Avatar Video WITH Background Video` and `Create Avatar Video WITHOUT Background Video` (both Heygen httpRequest nodes), `Get Avatar Video` polls until video is ready, `If Video Done` IF gates distribution. `Upload media` (Blotato) uploads the video to Blotato, `5min Wait` for processing, then fan-out to per-platform Blotato nodes: **active** = LinkedIn, Facebook, Instagram, Twitter, YouTube; **disabled** = TikTok, Bluesky, Pinterest, "Flow Os LinkedIn" (a separate LinkedIn endpoint, possibly a Flow OS company-page route). `Send a message` (Slack) posts a final completion notification.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 2 executions in last 7 days. All 2 successful.
- **Bucket:** S
- **Known issues:** V1 is current and correct (no V2 successor). Disabled platforms (TikTok, Bluesky, Pinterest) are intentionally off — Tyson is not using them currently. The disabled "Flow Os LinkedIn" branch reflects a real operational issue: Tyson lost access to the Flow OS company LinkedIn page, so the branch was disconnected. Workflow currently produces content for Tyson personal brand only. If/when Flow OS company page access is regained, the disabled branch can be reactivated. The workflow was originally adapted from a third-party template and customised for Flow OS avatar-style videos. Cluster fit: workflow distributes to LinkedIn but also Facebook, Instagram, Twitter, YouTube — fit anomaly within the LinkedIn cluster but no other "multi-platform" cluster exists in the index. Tyson decision 2026-05-04: keep in LinkedIn cluster for now (single-workflow categories are overkill); reconsider if more multi-platform workflows surface in remaining clusters. No heartbeat/errorWorkflow.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2025-07-15`, `updatedAt: 2026-03-26T08:48 UTC`. Talks to: OpenAI (script writing), Perplexity (research), Heygen (avatar video generation), Blotato (multi-platform distribution), Slack (notifications). 36 nodes total of which 14 are Sticky Notes (workflow-internal documentation) and 4 are disabled — high cosmetic-vs-functional ratio, normal for an experiment-heavy personal-brand workflow. **No skill file**.

---

## Tyson Personal Brand — Instagram cluster

3 workflows. All belong to **Personal** (Tyson personal brand). **Specialist owner: None — Tyson directly.** No agent specialist exists for personal brand Instagram in `FLOW_OS_SPECIALISTS.md`. No skill file in `src/agents/skills/`.

Cluster-level findings:
- **Heartbeat + standard errorWorkflow gap: 0/3** — but the Reels Auto-Publisher has a workflow-internal `errorTrigger` + Slack catch-all (rare across the index) which gives partial coverage of the same observability concern. The other 2 workflows have no error handling beyond Slack-on-success.
- **Google Sheets is the data layer**, not Supabase. **Only cluster in the index using Google Sheets** as primary data layer (other clusters: main Supabase or LinkedIn's secondary Supabase). The reel queue (`251.mp4`–`500.mp4` rows + `posted_at` + `post_url` etc.) lives in Google Sheets per `FLOW_OS_STATE.md` Section 4.
- **LLM stack: Anthropic** (Claude Haiku for caption generation) — back to ecosystem default after the LinkedIn cluster's OpenAI fork. Confirms memory's note that Claude Haiku replaced an earlier hardcoded Code node for captions.
- **Alerting: Slack-only** across all 3. No Telegram. Reinforces work-list item 18 (alerting platform consolidation — Tyson's lean toward Path A) — particularly concerning for Token Expiry Monitor whose Slack-only alerts are the only signal Charlie or Tyson would receive about IG token expiry, and Tyson reports rarely checking Slack.
- **No orchestrator** — third "no orchestrator at all" cluster (LinkedIn first). Workflows coordinate via the shared Google Sheet. Adds the third data point supporting work-list item 12 (specialist-to-specialist communication contract reframe to Phase 4+ load-bearing).
- **Schedule timezone NY pattern confirmed for 6 more cron expressions**: Token Monitor (1 cron), Reels Auto-Publisher (4 separate crons named "Every 5 Hours"), Performance Sync (1 cron). Cluster-sweep work-list item 7 running tally now **14 workflows**.

### Instagram Token Expiry Monitor

- **ID:** `cP5TjJ3DFle6r6FC`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly.
- **Trigger:** `scheduleTrigger` "Every Monday at 9am" with cron expression `0 0 9 * * 1` (6-field; Monday 09:00 NY = 13:00 UTC per cluster-wide timezone observation).
- **Purpose:** Weekly check of the Instagram Graph API access token's expiry timestamp. `Check Token Expiry` calls Facebook Graph API to fetch the current token's `expires_at`, `Parse Expiry Data` computes days remaining, `Needs Alert?` IF gates: if token is within the alert window, `Slack — Token Alert` posts a "renew the IG token" message; otherwise `Slack — Token OK` posts a confirmation. The whole workflow is the **only line of defence against silent IG token expiry** — when this token expires, the Reels Auto-Publisher's `Create Media Container` and `Publish Media` calls will fail, breaking the reel engine entirely.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** **0 executions in last 30 days.** API returned 0 rows in the last 100. Workflow is `active=true` but the cron has not fired any of the four expected Monday windows (Apr 7, 14, 21, 28). **Silent dormancy** — exact same diagnostic shape as Trading Weekly Analyst and Bot Router (telegramTrigger). Likely cause: cron registration unbound from n8n's scheduler after a restart event since the last `updatedAt: 2026-03-26T08:49 UTC`.
- **Bucket:** **M** (this is the IG ecosystem's only token-expiry early-warning system; silent dormancy here means token expiry would land as a Reels Auto-Publisher production failure rather than a planned renewal)
- **Known issues:** Confirmed silent dormancy in this audit (2026-05-04). Third confirmed dormant trigger pattern after Trading Weekly Analyst and Bot Router — pattern now established as common rather than isolated, likely cron registration cleared by n8n event since `updatedAt: 2026-03-26`. Recovery: deactivate/reactivate to force trigger re-registration, add heartbeat + errorWorkflow before flipping back active. **Tyson confirms 2026-05-04** the IG token is recent enough that standard heartbeat + errorWorkflow sweep dispatch timing catches it before expiry — no special handling needed. Bundle with sweep dispatch (work-list item already tracking). Schedule timezone naming mismatch (cron named "9am" but fires at 13:00 UTC = 09:00 NY) — joins cluster-sweep work-list item 7. Slack-only alerting is brittle per work-list item 18 — even if workflow recovers, alerts to a channel Tyson rarely checks risk delaying response.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2026-03-16T09:01 UTC`, `updatedAt: 2026-03-26T08:49 UTC` — has not been touched in nearly 6 weeks. Talks to: Facebook Graph API (Meta endpoint that returns IG token metadata), Slack. **No skill file**.

### Instagram Trial Reels Auto-Publisher

- **ID:** `44g7cbGz5osQ1pcBVhIoz`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly.
- **Trigger:** Two triggers — `errorTrigger` "Workflow Error Trigger" (handles in-workflow errors via Slack catch-all) AND `scheduleTrigger` "Every 5 Hours" with **four** cron expressions in one trigger node: `0 21 * * *` (21:00 NY = 01:00 UTC), `0 2 * * *` (02:00 NY = 06:00 UTC), `0 7 * * *` (07:00 NY = 11:00 UTC), `0 11 * * *` (11:00 NY = 15:00 UTC). Trigger named "Every 5 Hours" but the four windows are not exactly 5h apart (5h / 5h / 4h / 10h overnight gap). 4 fires/day matches `FLOW_OS_STATE.md` "4-5 reels per day" cadence.
- **Purpose:** End-to-end auto-publisher for the 30-Day Operator Reel Engine (Batch 2, posts 251–500 per `FLOW_OS_STATE.md` Section 4). Per scheduled fire: `Get Next Pending Row` (Google Sheets) reads the queue, `Filter Unposted Rows` filters where `posted == FALSE`, `Has Pending Row?` IF gates: if no rows, `No Pending Posts (Stop)`. If pending, `Build Video URL` constructs the R2 URL (`r2.dev/reels/<filename>`), `Validate R2 URL (HEAD)` does a HEAD request to confirm the file exists, `URL Returns 200?` IF either short-circuits to `Slack — URL Error` or proceeds. Caption generation: `Build Caption Prompt` shapes the prompt using the row's content theme + ICA archetype hints (Sophie / Tom per state doc), `Call Claude Haiku` (Anthropic API — Haiku for cost efficiency on captions) generates the caption, `Extract Caption` parses it. IG publishing: `Create Media Container` POSTs the video URL + caption to `graph.facebook.com` Reels endpoint, `Save Container ID` captures the container ID, `Wait 30s (Initial Processing)` lets Meta process the video, then a polling loop: `Increment Poll Counter` + `Poll Media Status` + `Merge Poll Result` + `Status = FINISHED?` IF + `Poll Timed Out?` IF + `Wait 15s (Poll Retry)` until container is ready or timeout fires. On success: `Publish Media` posts the container as a live reel, `Merge Publish Result` shapes the result, `Mark Posted = TRUE` updates the Google Sheet, `Slack — Success` notifies. Error paths: `Slack — Processing Error` (in-flow processing failure), `Slack — URL Error` (R2 file missing), `Slack — Catch-All Error` (any uncaught error via the workflow-internal errorTrigger).
- **Heartbeat:** N (no node named heartbeat; the cluster's de-facto observability is the Slack — Success node firing per publish, plus the workflow-internal `errorTrigger` + Slack catch-all)
- **Error workflow:** none (workflow has its own `errorTrigger` for in-workflow handling — this is a different mechanism from `settings.errorWorkflow` which references an external workflow).
- **Recent activity:** 27 executions in last 7 days (matches expected 4 fires/day × 7 days = 28 with 1 short by edge of the window). All 27 successful. Last successful execution `2026-05-04T11:00:00 UTC` (= 07:00 NY = "0 7 * * *" cron, confirms NY-timezone evaluation).
- **Bucket:** M
- **Known issues:** **Schedule timezone naming mismatch** — node named "Every 5 Hours" but actual fire times are `21:00 / 02:00 / 07:00 / 11:00 NY` (= `01:00 / 06:00 / 11:00 / 15:00 UTC`). Each cron expression individually joins cluster-sweep work-list item 7. **Slack-only alerting is brittle** per work-list item 18 — including the catch-all error path. **Token dependency on Token Expiry Monitor** which is currently dormant — when the IG token does eventually expire, Auto-Publisher will fail at `Create Media Container`/`Publish Media` and surface via the `Slack — Catch-All Error` path; no proactive renewal warning until Token Monitor is recovered. **`Validate R2 URL (HEAD)` step is the only guard against missing reel files** — if a reel is queued but the R2 file is missing or moved, the URL check catches it and Slack-alerts; but no automated remediation. The workflow's internal `errorTrigger` + Slack catch-all is the rare partial-coverage pattern noted in the cluster intro — closest thing to standard heartbeat+errorWorkflow in this cluster.

  **Compound silent-failure risk:** Two compounding silent-failure paths exist for the IG production pipeline. (1) Token Expiry Monitor (`cP5TjJ3DFle6r6FC`) is currently dormant — when IG token does eventually expire, no proactive renewal warning fires until Token Monitor is recovered. (2) Reels Auto-Publisher's own catch-all error path is Slack-only (per work-list item 18: Tyson rarely checks Slack). So even if IG token expires and reels begin failing at `Create Media Container`/`Publish Media`, the failure surfaces only in a Slack channel Tyson doesn't check. The two failure paths compound: silent token expiry → silent reel publishing failure → no Tyson awareness until manually noticed. Mitigation in the heartbeat + errorWorkflow sweep dispatch should explicitly route catch-all alerts to Telegram given alerting platform consolidation work-list item 18 lean toward Path A.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2026-03-05T15:00 UTC`, `updatedAt: 2026-04-14T16:38 UTC` — touched ~3 weeks ago, possibly the Claude Haiku caption-generation upgrade per memory ("caption generation Claude Haiku API replaced hardcoded Code node"). Talks to: Google Sheets (reel queue), Cloudflare R2 (`r2.dev/reels/`), Anthropic API (Claude Haiku for captions), Facebook Graph API (Reels endpoint), Slack. The 30-Day Operator Reel Engine context per `FLOW_OS_STATE.md` Section 4: Batch 2 (251–500) underway, 4-5 reels per day cadence, ICA archetypes Sophie + Tom, Batch 2 themes (Revenue Leakage, Offer Clarity, AI + Automation for Operators, Founder Operating Rhythm, Scaling Without Breaking).

  **Workflow design 2026-03 by Tyson built from scratch** — deliberate choices on (a) workflow-internal `errorTrigger` + Slack catch-all rather than external `settings.errorWorkflow`, (b) Google Sheets as data layer rather than Supabase (the only such cluster in the index), (c) 4 separate cron expressions in one trigger node giving 4 fires/day at 21:00/02:00/07:00/11:00 NY — non-uniform 5h/5h/4h/9h overnight gap is intentional. The internal-errorTrigger pattern is a useful precedent for the heartbeat sweep dispatch design — demonstrates that in-workflow `errorTrigger` nodes work as a self-contained alternative to `settings.errorWorkflow`.

### Sync Instagram Performance Data

- **ID:** `EtJlwFvdpfpYoEfC`
- **Belongs to:** Personal (Tyson personal brand)
- **Specialist owner:** None — Tyson directly.
- **Trigger:** `scheduleTrigger` "Every Day at 10am" with cron expression `0 0 10 * * *` (6-field; Daily 10:00 NY = 14:00 UTC).
- **Purpose:** Daily metrics sync from Instagram Graph back into the Google Sheet that the Reels Auto-Publisher writes into. `Get All Rows` reads the full sheet, `Filter Eligible Rows` keeps rows where `posted == TRUE` and within the metrics window, `Aggregate All Items` collects them, `Fetch IG Insights` calls Facebook Graph API for per-post metrics (impressions, reach, saves, plays, etc.), `Parse Metrics` shapes them, `Update Sheet with Metrics` writes the metrics back to per-row columns, `Slack — Sync Complete` notifies.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 6 executions in last 7 days. All 6 successful. Last successful execution `2026-05-03T14:00:00 UTC` (= 10:00 NY ✓). Daily cadence: 7 expected, 6 observed (one fire either short of the window or skipped).
- **Bucket:** S (analytics-only; failure means Tyson loses one day of metrics visibility but doesn't break the production reel engine)
- **Known issues:** **Schedule timezone naming mismatch** — joins cluster-sweep work-list item 7. **Slack-only alerting** per work-list item 18 — sync-complete Slack messages going unread means Tyson can't easily verify daily metrics are flowing in. No heartbeat/errorWorkflow. The workflow doesn't differentiate between "Instagram metrics genuinely zero" and "Insights API returned no data" — silent zeros could mask a metrics pipeline issue.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2026-03-06T19:00 UTC`, `updatedAt: 2026-03-26T08:47 UTC` — has not been touched in ~6 weeks; current 100% success rate suggests it's stable. Talks to: Google Sheets (read + write same sheet as Reels Auto-Publisher), Facebook Graph API (Insights endpoint), Slack. The shared Google Sheet is the implicit data layer connecting all 3 cluster workflows — there is no Supabase, no separate database project, just the sheet. Performance metrics live in per-row columns alongside the post URL and posted-at timestamp.

---

## Flow OS Client integrations cluster

This cluster contains 2 active workflows. A third intake workflow (`intake-kylie-content-system`, `qOwJhClx5BnOeycf`) was initially categorised here per discovery audit but reclassified to "Various utilities and standalone" after Tyson confirmed 2026-05-04 that the form's GHL destination is the FSC GHL sub-account, not the Flow OS GHL sub-account.

Both workflows are paying-client integrations. **Specialist owner: None — integration workflows. Tyson directly responsible.** No agent specialist exists in `FLOW_OS_SPECIALISTS.md` for client-specific integrations. No skill file in `src/agents/skills/`.

Cluster-level findings:
- **Heartbeat + standard errorWorkflow gap: 0/2.** Morning Light has workflow-internal duplicate-error handling and Gutful has validate-email gates, but no standard `settings.errorWorkflow` and no heartbeat node on either.
- **Both are webhook-triggered** (no schedules) — so no schedule timezone work-list contributions from this cluster.
- **Both ultimately write to Flow OS GHL sub-account** via `services.leadconnectorhq.com` (the canonical contact store per `LOCATIONS.md`). Net pattern: thin webhook → field-map → GHL upsert adapters.
- **Recent activity diverges sharply:** Morning Light 100+/7d (100% success); Gutful 0 in 30d. Gutful's 0 is cross-corroborated by Flow OS downstream automations as business-side dormancy on the Gutful Shopify store, not a webhook-broken state — see Gutful entry.
- **Inactive predecessor sweep** — 3 inactive workflows look like predecessor/template versions: `E4PDhQyrGbd8lAQi` "Master MLM avatar social media machine V1", `9mgN68ib4BLn8W5w` "MASTER WL to HL", `gCG5uP4sggi8MFob` "Production - Wellness Living to FlowOS [Morning Light]". Worth a Tyson decision pass on whether to archive these formally. Adds to work-list item 9 (V1/V2/V3 cleanup sweep). No inactive Gutful V1/V2 found — the V3 predecessors may have been hard-deleted rather than deactivated.
- **No orchestrator** — 2 independent webhook adapters, no cross-workflow chaining. The "no orchestrator at all" observation continues but is genuinely fine here: integration adapters don't need an orchestrator, they just react to upstream webhooks. Different shape from LinkedIn/Instagram clusters' "no orchestrator" pattern.

### 21/10/25 Morning Light WL to HL

- **ID:** `TikJkWLzpreI6iTa`
- **Belongs to:** Flow OS (paying client integration — **Kayla N. / Morning Light Yoga & Pilates**, $297 unlimited per `FLOW_OS_STATE.md` Section 1)
- **Specialist owner:** None — integration workflow. Tyson directly responsible. Cross-reference: `FLOW_OS_STATE.md` Section 1 for client status.
- **Trigger:** `webhook` POST `/webhook/wl-production` (responseMode: `responseNode`).
- **Purpose:** Real-time integration that pipes Kayla N.'s **WellnessLiving** booking platform events into her **Flow OS GHL sub-account** as contacts. WellnessLiving (Kayla's class-booking system) fires a webhook on customer events; this workflow receives the payload, `Validate WellnessLiving Webhook` (code) checks it's authentic, `Map WL -> HL` shapes the WL booking record into the HL contact schema, `Edit Fields` finalises, `Get Contact` queries GHL via `services.leadconnectorhq.com` to check for an existing contact match. `If has contact id` IF gates: existing contact → `Merge Tags` (code) merges WL tags with existing tags + `Put` updates via GHL API. New contact → `Merge to create new contact` shapes the create payload + creates via GHL API. `Detect Duplicate Error` + `If Duplicate Error?` IF + `Log Error in Custom Field` handle the rare race condition where two webhooks for the same email arrive in flight. Postgres node (`Execute a SQL query`) + `Select best data` resolves which WL record wins when conflicts arise. `Respond 200` returns success to WellnessLiving so it doesn't retry. **Failure impact for Kayla:** if this workflow silently fails, new WellnessLiving bookings stop appearing in her Flow OS GHL contacts — she'd lose the automation she's paying for.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 100+ executions in last 7 days (API limit hit). All 100 successful. Last successful execution `2026-05-04T12:31:19 UTC`. Highest-frequency client integration in the index — Kayla's class bookings are firing webhooks continuously throughout the day.
- **Bucket:** M
- **Known issues:** **Date-prefixed workflow name** ("21/10/25" = 21 October 2025 in DD/MM/YY) is non-canonical naming — looks like a snapshot timestamp added during deployment. `createdAt: 2025-09-23` precedes the 21/10/25 date in the name, so the date represents either a deployment milestone or a post-creation rename. Worth canonicalising as part of Tyson's cleanup pass (e.g. rename to "Morning Light WL→HL" without the date prefix). No heartbeat/errorWorkflow despite being mission-critical for a paying client at 100+/7d. **Inactive predecessor candidates** in n8n: `9mgN68ib4BLn8W5w` "MASTER WL to HL" (looks like the template), `gCG5uP4sggi8MFob` "Production - Wellness Living to FlowOS [Morning Light]" (looks like an older Morning Light version). Decision pending Tyson on archive — joins work-list item 9.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2025-09-23T11:20 UTC`, `updatedAt: 2026-02-27T10:41 UTC` — has not been touched in over 2 months, current 100% success rate suggests it's stable. Talks to: WellnessLiving (incoming webhook), GHL via `services.leadconnectorhq.com`, **n8n's internal Postgres database** (not external Supabase) for the conflict-resolution Postgres node. Per Tyson 2026-05-04: this is n8n's own database, distinct from the main QClaw Supabase + LinkedIn secondary Supabase + Instagram cluster's Google Sheets. n8n internal Postgres is a previously-undocumented data layer worth surfacing in `LOCATIONS.md`. **Stripe payer:** Kayla N. ($297/mth). **No skill file** — workflow purpose inferred from node structure + state doc.

### Gutful Shopify to Flow OS V3

- **ID:** `9VqCAnczY5gFJcRE`
- **Belongs to:** Flow OS (paying client integration — **Michael Y. / Gutful**, $297 unlimited per `FLOW_OS_STATE.md` Section 1; **cross-dimensional client** — Eliza J. co-runs Gutful operationally per `FLOW_OS_STATE.md` Section 2)
- **Specialist owner:** None — integration workflow. Tyson directly responsible. Cross-reference: `FLOW_OS_STATE.md` Section 1 + Section 2 cross-dimensional clients (Eliza J. + Gutful linkage).
- **Trigger:** **Two webhook triggers** in one workflow — `webhook` POST `/webhook/shopify-customer` (responseMode: `responseNode`) AND `webhook` POST `/webhook/shopify-order` (responseMode: `responseNode`).
- **Purpose:** Real-time integration that pipes Mikey's **Gutful Shopify store** customer + order events into his **Flow OS GHL sub-account** as contacts. Two parallel webhook paths from the same Shopify store: **Customer path** — Shopify fires `/webhook/shopify-customer` on new customer creation, `Validate Shopify Customer Webhook` (code) checks authenticity, `Validate Customer Email` IF gates on email presence, `Map Customer Fields1` (set) shapes payload, `Generate Customer Tags1` (code) builds Gutful-specific tags, `Upsert HighLevel Contact (Customer)1` creates or updates the contact via `services.leadconnectorhq.com`, `Respond Customer Success1` or `Respond Customer Error1` returns to Shopify. **Order path** — Shopify fires `/webhook/shopify-order` on order placement, mirror flow with Order-specific field mapping and tags. The two paths share Postgres-node-based deduplication (`Execute a SQL query2` and `Execute a SQL query3`) to prevent the customer-then-order race from creating duplicate contacts. **Failure impact for Mikey:** if this workflow silently fails, Gutful's Shopify activity stops flowing into his Flow OS GHL — order/customer events lost, downstream automations (welcome flows, abandoned-cart, etc.) silently broken.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 30 days. 0 executions in entire 100-row API window. Cross-corroborated 2026-05-04 by Tyson: Flow OS downstream automations catching Gutful customer-purchase data show last execution 2026-04-17 — since downstream activity requires upstream webhook delivery, the silence is most likely business-side dormancy on Gutful Shopify (low volume), not n8n-side webhook breakage. Workflow remains healthy and ready when activity resumes.
- **Bucket:** M
- **Known issues:** 30-day silent period diagnostic: Tyson cross-reference 2026-05-04 — Flow OS downstream automations that catch Gutful customer-purchase data show last successful execution 2026-04-17. Since downstream automations only fire when upstream webhooks deliver, this corroborates business-side dormancy on Gutful Shopify rather than a webhook-broken state. Most likely reading: Gutful is genuinely quiet (low order/customer volume in the past month); workflow is healthy and ready when activity resumes. Tyson plans to send a check-in email to Mikey or Eliza for confirmation. **Operational caveat:** Tyson is not contracted to manage Gutful's n8n workflow operationally — Gutful pays $297/mth for the Flow OS subscription which includes the integration, but ongoing workflow health is not part of the deliverable. If a fix becomes needed, contract scoping conversation with Mikey/Eliza precedes any work. No heartbeat/errorWorkflow despite being mission-critical paying-client integration. **"V3" suffix** implies V1/V2 predecessors existed — neither found in active or inactive workflow list, suggesting hard deletion. V3 has been stable since the original build (4 months untouched). Joins work-list item 9 (V1/V2/V3 cleanup sweep) — for this workflow specifically, the cleanup is "confirm V3 is canonical and current" rather than "archive predecessors". **Cross-dimensional context worth preserving:** Eliza J. is on FSC 1:1 mentoring with Emma ($919/mth from 9 Apr 2026 per `FLOW_OS_STATE.md`); any Gutful conversation factors in Eliza's parallel relationship.
- **Last verified:** 2026-05-04
- **Notes:** `createdAt: 2025-10-14T11:13 UTC`, `updatedAt: 2026-01-08T12:41 UTC` — not touched in nearly 4 months; the workflow has been stable since the V3 build, which is positive — the 0-execution count is most likely Shopify-side dormancy than n8n-side rot, corroborated by downstream-automation evidence. Talks to: Shopify (incoming webhooks), GHL via `services.leadconnectorhq.com`, Supabase (Postgres for dedup; **[needs Tyson input]** on whether this Postgres node uses the same n8n internal database as Morning Light, or external Supabase). **Stripe payer:** Michael Y. (the contractual relationship is with Mikey; Eliza is operational co-runner, not a Flow OS direct customer). **No skill file**.

---

## Cross-cutting + Token Refresh cluster

3 workflows. Both functional refreshers belong to **Cross-cutting infrastructure** (supporting paying-client integrations). The third is an archive candidate. **Specialist owner: None — infrastructure workflows. Tyson directly responsible.**

Cluster-level findings:
- **Heartbeat + standard errorWorkflow gap: 0/3.** All 3 use `Handle Error` code-node patterns internally but no `settings.errorWorkflow` and no heartbeat node.
- **All 3 use the legacy `cron` node** (`n8n-nodes-base.cron`) rather than `scheduleTrigger`. The legacy cron uses interval-based scheduling (`everyX, value: 12` = every 12 hours), not cron expressions. **Therefore no contribution to schedule-timezone cluster-sweep work-list item 7** — these fire every 12 hours from activation, irrespective of timezone naming.
- **Real-time confirmation of API unreliability:** discovery audit yesterday (2026-05-04) reported 13 execs/7d for both functional refreshers. Today's probe (2026-05-05) reports 0 in 7d AND 0 in entire 100-row API window. Same workflows, 24h gap, no workflow update in between. This is work-list item 19 hitting actively-running infrastructure — escalates the API investigation from retrospective concern to **blocker on Phase 4 Slice 1**.
- **Cross-workflow search confirmed:** zero references to `N3VF1VKlekDdhxGU` across all 75 workflows (active + inactive). Nothing calls it via Execute Workflow. Archive approved by Tyson 2026-05-05.
- **Naming convention renames confirmed by Tyson 2026-05-05** for both functional refreshers — see per-entry Known Issues. Bundle with V1/V2/V3 cleanup dispatch (work-list item 9).
- **Shared `highlevel_tokens` table architecture confirmed intentional** by Tyson 2026-05-05 — same purpose (GHL OAuth refresh), one shared table, different keys per domain (Gutful keyed by `location_id`, Morning Light keyed by `id = 1`).
- **Postgres credential audit pending:** both functional refreshers use credential `qGUxEHfEZkZGdAcZ` "Supabase Postgres DB". The credential name suggests external Supabase, but cluster 7's Morning Light entry described the main-workflow Postgres node as "n8n internal." Worth confirming whether the credential ID resolves to external Supabase or n8n internal — added as work-list item 22.
- **Workflow age timeline supports the archive recommendation:** N3VF1 created 2025-10-04 (oldest, abandoned with empty cron params), Morning Light refresher 2025-10-05 (one day later — built next, with working schedule + Postgres), Gutful refresher 2025-10-14 (10 days later — appears to be a copy-and-modify of Morning Light's pattern).

### shopify > hl refresh token DB

- **ID:** `b36b4MKe1p6wQbTQ`
- **Belongs to:** Cross-cutting (infrastructure). Domain: **Gutful / Mikey** — supports the Gutful Shopify→FOS V3 workflow (`9VqCAnczY5gFJcRE`).
- **Specialist owner:** None — infrastructure workflow. Supports paying client integrations. Tyson directly responsible.
- **Trigger:** `cron` (legacy n8n cron node, not `scheduleTrigger`) with `triggerTimes: { mode: everyX, value: 12 }` — fires every 12 hours from activation.
- **Purpose:** Periodically refreshes the GHL OAuth token for **Mikey's Gutful GHL sub-account** (location_id `biianjtJPDFAGcw79LdL`) so the Gutful Shopify→FOS V3 workflow's `Upsert HighLevel Contact` calls keep authenticating. `Get Refresh Token from DB` (Postgres) reads the latest refresh_token from `highlevel_tokens` table filtered by Gutful's location_id, `Check Token Exists` IF gates on row presence, `Get Credentials` (code) shapes the OAuth refresh request, `Refresh Token Request` (httpRequest to `services.leadconnectorhq.com`) exchanges the refresh_token for a new access_token + refresh_token pair, `Check Success` IF gates on response, `Process Tokens` (code) extracts the new tokens, `Store New Tokens in DB` (Postgres upsert) writes them back to `highlevel_tokens` overwriting the row. Failure paths: `Handle Error` (code) for refresh failure, `Handle No Token` for missing initial token, `Send email` (DISABLED) — never wired up. **Failure impact for Mikey:** if this workflow silently fails, Gutful's GHL OAuth token expires (typically every 24 hours per GHL's OAuth model), and the Shopify→FOS V3 workflow's HL upsert calls start returning 401, breaking Gutful's order/customer sync.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** **Discrepancy flagged for cluster-sweep verification.** Discovery audit (2026-05-04) reported 13 executions/7d. Today's probe (2026-05-05) reports 0 executions in last 7d AND 0 in entire 100-row API window. Same API endpoint, 24h gap, no workflow update in between (`updatedAt: 2026-01-08`). Most likely reading: the executions-history API unreliability (work-list item 19) — workflow probably fired every 12h as expected (~14 times in 7d); the API just isn't returning the rows. UI cross-check needed to confirm.
- **Bucket:** M
- **Known issues:** **Rename confirmed by Tyson 2026-05-05** — current name "shopify > hl refresh token DB" is ad-hoc and uses ASCII greater-than as separator (renders awkwardly in tables and search). Confirmed rename: **`Flow OS Client — Gutful — GHL OAuth Refresh`** following the `<business unit> — <client> — <purpose>` convention. Don't rename in n8n now — bundle with V1/V2/V3 cleanup dispatch (work-list item 9). **API execution count discrepancy** between yesterday's audit (13/7d) and today's probe (0/7d) — same workflow, same API, 24h gap. Strongly corroborates work-list item 19 in real time. Worth UI cross-check before any operational action. **No heartbeat/errorWorkflow** despite being mission-critical infrastructure for Mikey's paying integration. **Disabled "Send email" node** in the error path — was wired then disabled; either replaced by silent-failure or replaced by a different mechanism not visible in the workflow surface. **Shared Postgres credential** with Morning Light refresher (`qGUxEHfEZkZGdAcZ` "Supabase Postgres DB") — both refreshers write to the same `highlevel_tokens` table. **Confirmed intentional by Tyson 2026-05-05:** same purpose (GHL OAuth refresh), one shared table, different keys per domain (Gutful keyed by `location_id`, Morning Light keyed by `id`). **Postgres credential audit pending** (work-list item 22) — confirm whether `qGUxEHfEZkZGdAcZ` actually points to external Supabase or n8n's internal DB despite the credential name.
- **Last verified:** 2026-05-05
- **Notes:** `createdAt: 2025-10-14T18:04 UTC`, `updatedAt: 2026-01-08T11:54 UTC` — 4 months untouched, suggesting stable. Talks to: GHL via `services.leadconnectorhq.com`, Postgres (Supabase Postgres DB credential, target table `highlevel_tokens`). The Gutful location_id `biianjtJPDFAGcw79LdL` is hardcoded in the SQL — if Gutful's GHL sub-account ever gets a new location_id or if Mikey adds a second GHL sub-account, this workflow needs to be updated or duplicated. **No skill file**.

### HL refresh token to supabase DB

- **ID:** `02Dob9FCEkXZFDAs`
- **Belongs to:** Cross-cutting (infrastructure). Domain: **Morning Light / Kayla N.** — supports the Morning Light WL→HL workflow (`TikJkWLzpreI6iTa`).
- **Specialist owner:** None — infrastructure workflow. Supports paying client integrations. Tyson directly responsible.
- **Trigger:** `cron` (legacy n8n cron node) with `triggerTimes: { mode: everyX, value: 12 }` — fires every 12 hours.
- **Purpose:** Periodically refreshes the GHL OAuth token for **Kayla N.'s Morning Light GHL sub-account** so the Morning Light WL→HL workflow's `Get Contact` / `Put` / contact-create calls keep authenticating. `Get Refresh Token from DB` (Postgres) reads the latest refresh_token from `highlevel_tokens` table filtered by `id = 1` (single Morning Light row), then identical refresh-and-write pattern as the Gutful refresher: `Check Token Exists` → `Get Credentials` → `Refresh Token Request` → `Check Success` → `Process Tokens` → `Store New Tokens in DB`. Failure paths same as Gutful refresher: `Handle Error`, `Handle No Token`, `Send email` (DISABLED). **Failure impact for Kayla:** identical shape to Gutful — GHL OAuth expires every ~24h, Morning Light WL→HL workflow's HL calls start returning 401, breaking the high-volume (100+/7d) WellnessLiving→GHL sync that Kayla is paying for.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** **Same discrepancy as Gutful refresher.** Discovery audit reported 13/7d; today's probe reports 0/7d AND 0 in entire 100-row API window. Most likely the API unreliability pattern (work-list item 19). UI cross-check needed.
- **Bucket:** M
- **Known issues:** **Rename confirmed by Tyson 2026-05-05** — current name "HL refresh token to supabase DB" is ad-hoc. Confirmed rename: **`Flow OS Client — Morning Light — GHL OAuth Refresh`** following the `<business unit> — <client> — <purpose>` convention. Don't rename in n8n now — bundle with V1/V2/V3 cleanup dispatch (work-list item 9). **API execution count discrepancy** between yesterday and today (same as Gutful refresher) — work-list item 19 affecting this workflow in real time. **No heartbeat/errorWorkflow** despite being mission-critical infrastructure for Kayla's paying integration (her main workflow runs 100+/7d — token refresh failure here means high-volume downstream breakage). **Same disabled "Send email" node** as Gutful refresher. **Shared Postgres credential** with Gutful refresher (`qGUxEHfEZkZGdAcZ` "Supabase Postgres DB") — both refreshers write to the same `highlevel_tokens` table; Morning Light row is keyed by `id = 1` (single row, low ceremony) while Gutful is keyed by location_id. **Confirmed intentional by Tyson 2026-05-05:** same purpose (GHL OAuth refresh), one shared table, different keys per domain. **Postgres credential audit pending** (work-list item 22) — same concern as Gutful refresher.
- **Last verified:** 2026-05-05
- **Notes:** `createdAt: 2025-10-05T13:04 UTC`, `updatedAt: 2026-04-20T09:33 UTC` — touched ~2 weeks ago (more recently than Gutful refresher). Talks to: GHL via `services.leadconnectorhq.com`, Postgres (Supabase Postgres DB credential). The `id = 1` SQL filter assumes a single Morning Light token row — if a second Morning Light location is added or the schema changes, this workflow needs updating. **No skill file**. Created 2025-10-05, one day after the abandoned `N3VF1VKlekDdhxGU` (2025-10-04) — strongly suggests this workflow was the second-attempt iteration that succeeded where N3VF1 didn't.

### HighLevel OAuth Token Refresh

- **ID:** `N3VF1VKlekDdhxGU`
- **Belongs to:** Cross-cutting (infrastructure) — but functionally orphaned.
- **Specialist owner:** None.
- **Trigger:** `cron` (legacy n8n cron node) with **empty parameters** (`{}`). Cron has no schedule configured — explains zero executions ever. Workflow is `active=true` in n8n DB but the trigger is structurally non-firing.
- **Purpose:** Appears to be the **first-attempt scaffold** for a generic HighLevel OAuth token refresher, abandoned mid-build before the per-domain Gutful and Morning Light refreshers were built. 9 nodes including: `Cron Trigger` (empty params), `Get Credentials` (code), `Refresh Token Request` (httpRequest to `services.leadconnectorhq.com`), `Check Success` (IF), `Process Tokens` (code), `Store Tokens & Instructions` (code — note: NOT a Postgres write like the working refreshers; just a code node), `Handle Error` (code), `Slack Notification` (httpRequest), `Success Notification` (httpRequest). Critically: no Postgres node (so no actual token persistence — confirms scaffold-not-finished status). Created 2025-10-04, the day BEFORE the Morning Light refresher (2025-10-05) which appears to have been the successful second attempt with proper Postgres token storage.
- **Heartbeat:** N
- **Error workflow:** none.
- **Recent activity:** 0 executions in last 7d. 0 in 30d. **0 in entire 100-row API window.** Confirms zero-executions-ever state — workflow has structural reasons for never firing (empty cron params + no callers).
- **Bucket:** **A — archive approved.**
- **Known issues:** **Archive approved by Tyson 2026-05-05** — bundle with V1/V2/V3 cleanup sweep dispatch (work-list item 9). Cross-workflow Execute search confirmed zero references across all 75 workflows; no other workflow affected by archiving. Recent `updatedAt` (Apr 20) was likely metadata-only (tag/reorder), not functional change. **Recommendation:** deactivate (do not delete — preserve for archaeological reference). The Slack-notification path is a useful precedent if Tyson ever wants Slack alerts on token-refresh events for the working refreshers, but the rest is not load-bearing.
- **Last verified:** 2026-05-05
- **Notes:** `createdAt: 2025-10-04T11:43 UTC`, `updatedAt: 2026-04-20T14:50 UTC`. Talks to: GHL via `services.leadconnectorhq.com`, Slack (`hooks.slack.com`). **No skill file**.

## Maintenance log

This section captures changes to the workflow index over time. Most recent at top.

- **2026-05-04 — Pending cluster-sweep tracked: schedule timezone correction across N clusters.** n8n cron evaluation runs in America/New_York (UTC-4 EDT) not UTC despite node names. Affects at minimum: Crete Content Generator (committed, technically-misleading UTC claim), GHL Marketing Content Generator + Weekly Report (this commit). Likely affects unevaluated clusters too. Sweep correction post-cluster-11 will decide between: rename nodes (cosmetic), compensate cron (functional), or change n8n timezone config (cleanest fix). Tracked as work-list item.

- **2026-05-04 — v1 created with Trading cluster (5 of 46 workflows documented).** Format conventions locked: cron in backticks, workflow IDs in backticks, "S→M when X" notation for conditional workflows, cross-references to `FLOW_OS_SPECIALISTS.md` and `FLOW_OS_STATE.md`, `[needs Tyson input]` preferred over synthesised purpose. Trading cluster used as template-establishing first pass. Notable findings: Trading - Weekly Analyst silently dormant since 2026-04-04 (cron registration likely cleared by n8n restart event); Trading - Market Scanner has ongoing post-JSON-fix error mode that needs separate diagnostic; Trading - Error Handler rename decision logged (to be executed in separate dispatch). Authored by Tyson + Claude (chat) per Phase 3 Component 2.
