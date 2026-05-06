# Charlie Overhaul

Running architecture document for Charlie 2.0. This overhaul redesigns Charlie to serve the operating model defined in `CEO_OPERATING_MODEL.md`.

## Status

- Phase 1 (Role spec + failure catalogue): COMPLETE
- Phase 2 (Code-grounded audit): COMPLETE — see /tmp/charlie_phase2_audit.md
- Phase 2.5 (CEO Operating Model spec): COMPLETE — see CEO_OPERATING_MODEL.md
- Phase 3 (Charlie 2.0 design): COMPLETE
- Phase 4 (Implementation): IN PROGRESS — pre-slice foundation

## Failure patterns being addressed

- A: Hallucinated context
- B: Stale memory / lost state
- C: False completion reports
- D: Phantom tool use
- E: Lane violations

## Phase 2 headline finding

Charlie has been built as if he reads canonical docs at session start, but the runtime opens almost none of them. Every failure pattern is a downstream consequence of this doc-runtime gap. Phase 3 treats this as the single root cause.

## Phase 3 design — six components

1. Bootstrap mechanism
2. Canonical doc loading
3. Skill loading strategy (pragmatic split, upgradeable interface)
4. Tool surface overhaul
5. Verification gates (soft + hard)
6. Claude Code delegation bridge

(Designs to be appended as each is locked.)

## Phase 3 design (locked)

This section captures the locked design for Charlie 2.0 across six components. Phase 4 implements these in vertical slices.

### Architectural rules (apply across all components)

**Single Source of Location (SSL).** A top-level `LOCATIONS.md` in this repo is the canonical map of where every piece of state, log, config, and doc lives. When something moves, `LOCATIONS.md` is updated, and any reference to the old location updates from there. No silent stale references.

**Interface-first design.** Every component is built behind a stable interface (`bootstrap()`, `loadSkills()`, `claude_code_dispatch()`, etc.). Implementations can be upgraded without touching consumers.

**Observability mandatory.** Every load, every gate trigger, every dispatch, every tool call writes to a structured log. File-based first (location in `LOCATIONS.md`), Supabase-migrated as the system matures.

**Lane discipline at runtime, not just prompt.** Where Charlie should not act, he does not have the tool. Where a specialist should not act, they do not have the tool. Prompt instructions reinforce; tool registry enforces.

### Component 1 — Bootstrap mechanism

**Purpose:** Replace the current per-message stateless prompt assembly with a session-bootstrapped context load. Closes failure pattern A (hallucinated context) and B (stale memory).

**Session model:**
- One bootstrap per session, cached in memory keyed by Telegram user ID
- Session boundary: 30-min silence or `/session` reset
- BootstrapResult cached and reused within session

**Five-layer load (in order):**
- Layer 1: Identity — `CEO_OPERATING_MODEL.md`, `CHARLIE_ROLE.md`, `SOUL.md`, `VALUES.md`
- Layer 2: State — `FLOW_OS_STATE.md`, last 7 days of `QCLAW_BUILD_LOG.md` (cap 50 entries)
- Layer 3: Specialists — `FLOW_OS_SPECIALISTS.md`
- Layer 4: Recent context — last 24h of memory entries (cap 30), recent audit log entries
- Layer 5: Live probes — PM2, n8n heartbeat, memory layer reachability, Supabase reachability (parallel, 5s timeout each)

**Interface:** `bootstrap(sessionContext) → BootstrapResult` in `src/agents/bootstrap.js`. `BootstrapResult` is a structured object consumed by `_buildSystemPrompt`.

**Observability:** Every bootstrap writes to `~/.quantumclaw/bootstrap.log` (location declared in `LOCATIONS.md`). Failed probes or missing docs surfaced in Charlie's first response of the session. `/bootstrap-status` command returns current state on demand.

**Migration path:** File-based logs and in-memory cache for v1. Supabase migration when needed, transparent to consumers via interface.

**Slice 1 design lock (2026-05-06):**

Three decisions resolved at Slice 1 kickoff, captured here as the canonical record.

- *Runtime confirmed.* Node.js, in-process inside QClaw, at `src/agents/bootstrap.js`. External Python script and n8n-orchestrated alternatives considered and rejected — both add a serialisation boundary and break the in-memory cache model.
- *Layer 5 probe set finalised.* Five probes, parallel, 5s timeout each: n8n reachable, heartbeat freshness summary (raw read from `workflow_heartbeats`, not via the dormancy alerter cadence list), PM2 process roll-call (quantumclaw, trading-worker, clipper-worker, charlie-watcher), Supabase reachable, memory layer reachable. Deferred for v2: Charlie task queue depth, recent error-workflow fires, per-workflow execution counts.
- *Output format confirmed both.* Structured `BootstrapResult` JSON for `_buildSystemPrompt`; human-readable markdown summary appended to `~/.quantumclaw/bootstrap.log`; `/bootstrap-status` Telegram command returns the markdown summary on demand.

### Component 2 — Canonical doc loading

**Purpose:** Collapse the dual-reality problem (docs describe a system that doesn't run). Locks single sources of truth across business state.

**Doc set:**

*Identity layer (rarely changes, manual edits only):*
- `CEO_OPERATING_MODEL.md`
- `CHARLIE_ROLE.md`
- `LOCATIONS.md`

*State layer (Charlie writes routine, Tyson approves significant):*
- `FLOW_OS_STATE.md` — single source for all business state across Flow OS, FSC, SproutCode, Crete, and Personal. Sections: active engagements, active leads, content pipeline state, infrastructure snapshot, trust gradient registry, known issues, recent significant changes (rolling 30 days)

*Operational layer (append-only, never rewritten):*
- `QCLAW_BUILD_LOG.md`
- Bootstrap log, audit log, gate log

*Capability layer (Tyson approves changes):*
- `FLOW_OS_SPECIALISTS.md` — specialist registry
- `N8N_WORKFLOW_INDEX.md` — every active workflow with id, name, purpose, trigger, last verified, owner

**Maintenance rules:**
- Charlie writes autonomously to: `FLOW_OS_STATE.md` (routine), `QCLAW_BUILD_LOG.md`, all logs
- Charlie surfaces for Tyson approval before writing: trust gradient changes, new specialists, workflow index changes, identity-layer edits
- Tyson edits directly (with Claude help): `CEO_OPERATING_MODEL.md`, `CHARLIE_ROLE.md`, high-level direction in state doc

**Freshness thresholds:**
- `FLOW_OS_STATE.md`: warn if >24h since update during business hours
- `N8N_WORKFLOW_INDEX.md`: warn if any workflow's last-verified >7 days ago
- `FLOW_OS_SPECIALISTS.md`: warn if >30 days since review

**v1 specialist registry (complete list):**

Belongs to Flow OS:
- Build Specialist (QClaw, coordinates with Claude Code)
- QA Operator (QClaw)
- Lead Handler — Flow OS (QClaw + Flow OS GHL)
- Flow OS GHL Operator (Flow OS GHL sub-account)
- GHL Support Bot (Flow OS GHL sub-account, Flow OS product)
- Flow OS GHL Marketing (QClaw — content creation + distribution)
- Ads Operator — Flow OS (Meta Ads API, account `act_414785961683125`)
- Community Manager — Flow OS (`portal.flowos.tech`)

Belongs to Flow States Collective:
- Content Studio Operator (QClaw — Emma's podcast pipeline only, Clipper as internal sub-component)
- Community Manager — FSC (`https://fsc.app.clientclub.net/home`)
- Ads Operator — Emma Maidment Business (Meta Ads API, account `act_1426936257455201`)
- FSC GHL Operator (FSC GHL sub-account)

Belongs to SproutCode:
- SproutCode Operator (SproutCode infra + SproutCode GHL sub-account)

Belongs to Crete:
- Crete Operations Specialist (QClaw + n8n + Crete GHL sub-account)
- Crete Marketing Operator (QClaw — content creation + distribution for Crete)

Belongs to Personal:
- Trading Operator (QClaw — monitoring scoped, no execution)

Deferred: Retreat Planner (FSC), Stripe Operator (read-only reporting only — currently Charlie capability)

**Phase 4 prerequisite:** focused session to populate `N8N_WORKFLOW_INDEX.md` from current production workflows. Tyson + Claude Code, estimated 2-3 hours, before Charlie 2.0 ships.

> **Footnote (added 2026-05-03):** This registry section is a snapshot from Phase 3 design. The canonical current registry is `FLOW_OS_SPECIALISTS.md`. Notable evolution since this design was written: the two Ads Operator entries (Flow OS and Emma Maidment Business) have been consolidated into a single Ad Agency Operator specialist matching the actual running architecture. Always read `FLOW_OS_SPECIALISTS.md` for current truth.

### Component 3 — Skill loading strategy

**Purpose:** Replace the unrouted skill concatenation (every loaded skill in every prompt) with a pragmatic always-on/on-demand split. Closes failure pattern D (phantom tools — load-bearing skills currently unsymlinked) and reduces prompt bloat.

**Always-on skills (load every prompt):**
- `identity.md` — derived from `CHARLIE_ROLE.md`
- `lanes.md` — explicit in-lane vs out-of-lane behaviour, escalation paths
- `verification-reflexes.md` — cite-or-don't-claim, audit-before-brief, verify-before-claim, "I don't know" as first-class output
- `architecture-pillars.md` — 7 Pillars framework (currently unsymlinked, promoted)
- `security.md` — security gate checklist, credential rules (currently unsymlinked, promoted)
- `delegation.md` — how to route work to Claude Code, specialists, Tyson
- `bootstrap-awareness.md` — Charlie's understanding of his own bootstrap state

**On-demand skills (load when triggered):**
- `build.md`, `qa.md`, `task-queue.md`, `trading.md`, `content-studio.md`, `clipper.md`, `community-manager.md` (FSC and Flow OS variants), plus per-specialist skills as added

**Routing rules (initial keyword-based):**
- "build", "modify", "fix", "implement", "deploy", "ship" → `build.md`
- "qa", "test", "audit", "verify" → `qa.md`
- "schedule", "task", "delegate", "queue" → `task-queue.md`
- "trade", "trading", "scanner", "position" → `trading.md`
- Combination "Emma + content/podcast/reel/Buzzsprout" → `content-studio.md` (Emma alone does NOT trigger)
- "clip", "clipper", "vertical", "captions" → `clipper.md`
- "community", "members", "engagement", "GHL communities" → community-manager skill (variant by business unit context)

Hard cap of 4 on-demand skills per prompt. If more match, top 4 by keyword density load, others in skill load log.

**Interface:** `loadSkills(context) → SkillLoadResult`. The result includes `always_on`, `on_demand`, `considered_but_dropped`, and `total_token_estimate`.

**Observability:** Skill load log file-based first (location in `LOCATIONS.md`), Supabase later. `KEYWORD_REFERENCE.md` cheat sheet generated for Tyson reference.

**Upgrade path:** Keyword routing → Haiku-based intent classification (when 2-4 weeks of routing telemetry available) → learned router (Phase 5+). All upgrades behind same interface.

**Phase 4 task:** audit all 21 existing skill files. Decide always-on vs on-demand vs archive. Update `community-manager.md` to reference GHL Communities (not Skool). Symlink discipline in `src/agents/skills/`.

### Component 4 — Tool surface overhaul

**Purpose:** Encode lane discipline at the tool level. Closes failure patterns D (phantom tool use) and E (lane violations) structurally.

**Read-only observation tools (always available to Charlie):**
- `read_file(path)` — whitelisted paths only, never `.env` or secrets
- `grep_repo(pattern, path)`
- `list_dir(path)`
- `git_status()`, `git_log(n)`, `git_diff()` — read-only
- `pm2_status()`
- `n8n_workflow_get(id)`, `n8n_workflow_list()`, `n8n_executions_recent(workflow_id, n)`
- `tail_log(name, lines)` — name-scoped
- `supabase_select(table, query)` — whitelisted tables, read-only

**Build/infrastructure tools (scope: Build Specialist only):**
- `claude_code_dispatch(brief, scope)` — see Component 6
- `git_commit(message)`, `git_push()` — only after Claude Code work
- `pm2_restart(process)` — approval gate for `quantumclaw` itself
- `n8n_workflow_update(id, json)` — audit-then-update flow enforced

**GHL operator tools (scope: per-business-unit GHL Operators only, NOT Charlie):**
- `ghl_contact_get`, `ghl_contact_search`, `ghl_pipeline_state`, `ghl_conversation_get`
- `ghl_message_draft` (drafts only, no autonomous send)
- `ghl_pipeline_move` (pre-authorised rules per unit; everything else needs Tyson approval)
- `ghl_tag_update`
- All scoped by `account` parameter — operators cannot reach across business units

**Stripe tools (Charlie + relevant operators, READ-ONLY):**
- `stripe_customer_get`, `stripe_revenue_summary`, `stripe_subscription_list`
- No write operations exist as tools. Tyson executes manually.

**Communication tools (scope: Charlie):**
- `telegram_send(message)`
- `email_send_draft(to, subject, body)` — drafts only, no autonomous send

**Memory tools (scope: Charlie):**
- `memory_remember(fact, scope)`, `memory_recall(query)`
- `state_doc_update(section, content)` — autonomous for routine
- `state_doc_propose_update(section, content)` — surfaces for Tyson approval

**Per-specialist tools (Phase 4 detail):**
- Cloudflare R2 tools — Clipper, Content Studio, Crete Marketing, Flow OS GHL Marketing (each scoped to own bucket/folder)
- Buzzsprout, Blotato, AssemblyAI, Substack — Content Studio
- Per-specialist tool registry detailed in Phase 4 implementation, not now. Principle: domain ownership = tool ownership.

**Removals:**
- `spawn_agent` — creates dead stubs, removed
- Filesystem MCP preset — fails to start, removed; replaced by `read_file`/`list_dir`

**Narrowed:**
- `shell_exec` — narrowed to read-only allowlist (`ls`, `cat`, `grep`, `find`, `git status`, `git log`, `git diff`, `pm2 list`, `pm2 logs --nostream`, etc.). Full allowlist deferred to Phase 4. No paths under `src/agents/skills/` writable.

**Tool registration interface:**
{
name, description, parameters,
scope: [agent_name, ...],
audit_level: 'log' | 'log_and_alert' | 'require_approval',
rate_limit: {calls_per_minute, calls_per_hour},
handler
}

Out-of-scope tool calls return structured `{error: 'out_of_scope', suggestion: 'delegate to <correct_agent>'}`.

### Component 5 — Verification gates

**Purpose:** Close failure patterns A, C, D structurally — claims must be backed by audit log evidence. Soft (prompt) + hard (runtime) enforcement.

**Soft enforcement — `verification-reflexes.md` always-on skill:**
- Cite or don't claim — every factual statement needs source (file:line, command output, log entry, audit log, memory entry)
- Audit before brief — implementation briefs require code-grounded audit attached
- Verify before claim — no "done" without probe/log/test/tool result
- "I don't know" is first-class output, paired with the verification step that would resolve it
- Escalate on lane boundary — name boundary explicitly, propose right next executor

**Hard enforcement — five runtime gates:**

1. *Completion claim gate.* Patterns: "done", "shipped", "deployed", "completed", "fixed", "working", "running", "live", "passed", "succeeded". Verifies matching successful tool call in audit log within last N minutes.

2. *Delegation claim gate.* Patterns: "Claude Code is working on", "I've sent X to specialist Y", "dispatched to". Verifies matching dispatch entry in `claude_code_dispatches` table or specialist invocation log.

3. *State claim gate.* Patterns: "the workflow is", "the process is", "X is currently". Verifies matching probe call within last 5 minutes.

4. *Tool existence gate.* Verifies any tool name referenced in response resolves against current registered tool list for Charlie's scope.

5. *Lane boundary gate.* Out-of-scope tool calls already blocked by registry; gate creates structured error response Charlie can act on.

**Gate behaviour:**
- Failed gate triggers regeneration with structured error feedback
- 3 regeneration attempts max, then escalate to Tyson
- Every gate trigger logged with: timestamp, gate, claim, verification attempted, result, action

**Gate log:** file-based first, location in `LOCATIONS.md`. Phase 5+ surfaces in QClaw dashboard.

**Implementation:**
generateResponse(prompt) {
let response = llm(prompt);
for (let attempt = 0; attempt < 3; attempt++) {
const gateResults = runGates(response, auditLog, toolRegistry);
if (gateResults.allBlocked.length === 0) return response;
logGateTriggers(gateResults);
prompt = augmentPromptWithGateFeedback(prompt, gateResults);
response = llm(prompt);
}
return escalateToTyson(response, gateResults);
}

Each gate is a separate function with its own claim patterns and verification logic. Independently tunable.

**v1 scope:** response-level gates only. Streaming-level gates (block tokens as composed) are Phase 5+ if response-level proves insufficient.

### Component 6 — Claude Code delegation bridge

**Purpose:** Eliminate Tyson as the human bridge between Charlie and Claude Code. Single most important component for the daily rhythm working.

**Dispatch model:**
- Bidirectional, asynchronous
- Charlie dispatches → immediate ack with task_id → result returns later
- Charlie tracks dispatched tasks via Supabase `claude_code_dispatches` table
- Specialists dispatch via Charlie, not directly

**Scope levels:**
- *audit* / *read_only* — autonomous for Charlie
- *write* / *infra* — requires Tyson authorisation per task type and trust gradient
- *critical* (credential rotation, schema migration, financial paths) — explicit per-task Tyson approval, never blanket

**Dispatch interface:**
claude_code_dispatch(brief, scope) → {
task_id, status: 'queued' | 'in_progress' | 'awaiting_authorisation',
dispatched_at, estimated_completion,
authorisation_required, authorisation_note
}

**Brief template (in `delegation.md` always-on skill):**
Task: <one-line>
Repo: <path>
Mode: AUDIT ONLY | AUDIT THEN IMPLEMENT | IMPLEMENT WITH AUDIT GATE
Business unit: <unit>
Context
Audit scope (AUDIT FIRST for all IMPLEMENT modes)
Acceptance criteria
Constraints
Deliverable

`IMPLEMENT WITH AUDIT GATE` is the only mode that can skip prior audit, and it requires explicit per-task Tyson approval.

**Dispatcher worker:**
- PM2 process `claude-code-dispatcher`
- Polls `claude_code_dispatches` for queued
- Single instance for v1 with priority ordering
- Concurrency upgrade (worker pool N=2-3) when queue length warrants

**State transitions:**
- queued → awaiting_authorisation (if needed) → authorised
- authorised → in_progress
- in_progress → complete | failed | timeout

**Authorisation flow:**
- In-session dispatches: inline in chat ("here's the brief, approve/modify/reject?")
- Cross-session non-urgent: batched into morning/evening digest
- Urgent (revenue at risk, workflow broken): separate Telegram message
- Authorisation timeout: 24h default, 1h for urgent

**Result delivery:**
- In-session: surfaced in Charlie's next reply
- Cross-session: lands in next morning digest "What ran overnight"
- Failed/timed-out: surfaced immediately on next interaction with structured failure report

**Integration with Component 5 gates:**
- Gate 2 (delegation claim) verifies dispatch row exists before allowing "Claude Code is working on" claims
- Gate 1 (completion claim) verifies row status is `complete` before allowing "Claude Code completed" claims

**Phase 5+ priority promotion:** autonomous follow-up chaining. After 4 weeks of clean dispatch operation across audit and read_only scopes, promote: "Charlie can autonomously dispatch a follow-up if the prior dispatch's result included specific recommended next steps within his lane." This is a named priority promotion, not generic future work — required for daily rhythm flow.

**v1 implementation order (Phase 4):**
1. Supabase `claude_code_dispatches` table
2. `claude_code_dispatch` tool registered for Charlie, audit + read_only scope unlocked
3. PM2 dispatcher worker polling table, invoking Claude Code CLI
4. Result write-back, Charlie's read path
5. Component 5 gates 1 and 2 integration
6. (After stable) write/infra scope behind Tyson authorisation
7. Brief template refinements based on dispatch quality observation
8. Result surfacing in morning digest

## Phase 4 — implementation slicing

Six vertical slices, each independently auditable and shippable. Slices ship in this order; each gate-checked before next begins.

**Pre-slice (foundation):**
- `LOCATIONS.md` created and populated
- `N8N_WORKFLOW_INDEX.md` populated via focused Tyson + Claude Code session
- `FLOW_OS_STATE.md` initial population from current state
- `FLOW_OS_SPECIALISTS.md` populated from v1 specialist registry above
- `CHARLIE_ROLE.md` written from Phase 1 role spec
- `KEYWORD_REFERENCE.md` cheat sheet generated

**Slice 1 — Bootstrap and canonical doc loading.**
Bootstrap mechanism + the always-on canonical docs reading. Ship and observe before next slice.

**Slice 2 — Skill loading strategy.**
`loadSkills(context)` interface, keyword routing, skill audit and re-symlinking, missing skills wired (`build.md`, `qa.md`, `task-queue.md`, `trading.md`, `architecture-pillars.md`, `security.md`).

**Slice 3 — Tool surface overhaul.**
Narrow tools added (`read_file`, `grep_repo`, `pm2_status`, `n8n_workflow_get`, etc.). `shell_exec` narrowed. `spawn_agent` and broken filesystem MCP removed. Tool registration interface with scope.

**Slice 4 — Verification gates (soft + hard).**
`verification-reflexes.md` skill written and loaded. `runGates()` runtime function with five gates. Gate log in place.

**Slice 5 — Claude Code delegation bridge.**
Supabase table, `claude_code_dispatch` tool, PM2 dispatcher worker, result write-back, gate integration.

**Slice 6 — Specialist scaffolding.**
Specialist registry materialised as actual sub-agent shells with their scoped tools. Initially most are stubs that route back to Charlie; live ones (Content Studio Operator existing pipeline, Community Manager existing skill) get migrated to the new pattern.

Each slice ends with: documentation update in `CHARLIE_OVERHAUL.md`, build log entry, brief Tyson review, then next slice begins.

## Phase 5+ roadmap

After Charlie 2.0 stable:
- Specialist hardening (each specialist independently reliable to Charlie 2.0 standard)
- State model and dispatch layer (structured state object, queryable handoff records)
- Daily rhythm scaffolding (morning/evening digest generation, overnight dispatch)
- *Priority promotion:* autonomous Claude Code follow-up chaining (target: 4 weeks of clean dispatch operation)
- Intent classification skill router (replace keyword routing)
- Streaming-level verification gates (if response-level proves insufficient)
- Gate log surface in QClaw dashboard
- Trust calibration ongoing — task types move up/down trust gradient based on observed reliability
