# LOCATIONS

Single source of location for everything in the QClaw / Flow OS / FSC / SproutCode / Crete / Personal stack. Anything that has a "where does this live" answer is recorded here. When something moves, this file is updated; everything else reads from here.

This file is the second thing every agent reads at session start, after its identity layer.

## Repository

- QClaw repo: `/root/QClaw` on qclaw server
- GitHub: `github.com/tysonven/QClaw`
- Default branch: `main`
- CI/CD: GitHub Actions auto-deploys on push to main

## Identity layer (canonical, rarely changes)

- `CEO_OPERATING_MODEL.md` — operating model and trust gradient (north star)
- `CHARLIE_ROLE.md` — Charlie's role spec
- `CHARLIE_OVERHAUL.md` — running architecture doc for Charlie 2.0
- `LOCATIONS.md` — this file

### Charlie identity files — repo-canonical, runtime via symlink

The repo at `/root/QClaw/workspace/...` is the canonical source for Charlie's
identity. Runtime paths are symlinks pointing into the repo. Edits go through
git, not via runtime mutation. Enforced by:
- `src/dashboard/server.js` PUT /api/agents/:name/soul refuses 409 when target is a symlink
- `src/security/trust-kernel.js` load() refuses default-write when target is a symlink

| Layer | Canonical (repo) | Runtime (symlink) |
|---|---|---|
| SOUL  | `workspace/agents/charlie/SOUL.md`     | `~/.quantumclaw/workspace/agents/charlie/SOUL.md` → repo |
| VALUES | `workspace/VALUES.md`                  | `~/.quantumclaw/VALUES.md` → repo |
| IDENTITY | `workspace/agents/charlie/IDENTITY.md` | `~/.quantumclaw/workspace/agents/charlie/IDENTITY.md` → repo |

For sub-agents that aren't yet repo-canonicalized (`echo`, `dispatch-zeta`,
`patcher`, `n8n-workflow-fixer`, `claude-code-ig-fix`, `post-auditor`),
runtime files at `~/.quantumclaw/workspace/agents/<name>/` remain regular
files and are still mutable via the dashboard. Reconciliation TBD.

- Repo-tracked workspace seeds (consumed by `qclaw onboard` for fresh
  installs): `workspace/agents/charlie/SOUL.md`, `workspace/VALUES.md`,
  `workspace/agents/charlie/IDENTITY.md`

## State layer (Charlie writes routine, Tyson approves significant)

- `FLOW_OS_STATE.md` — single source for current business state across Flow OS, FSC, SproutCode, Crete, Personal
- `FLOW_OS_SPECIALISTS.md` — specialist registry
- `N8N_WORKFLOW_INDEX.md` — every active n8n workflow

## Operational layer (append-only, never rewritten)

- `QCLAW_BUILD_LOG.md` — chronological build log
- Bootstrap log: `~/.quantumclaw/bootstrap.log` (file-based, mode 0600, written by `src/agents/bootstrap.js` — file-based per Phase 4 Slice 1; Supabase migration deferred)
- Audit log: `~/.quantumclaw/audit.db` (SQLite via `better-sqlite3`) with JSONL fallback at `~/.quantumclaw/audit.jsonl` — read interface `AuditLog.recent(limit, agent)` (`src/security/audit.js`)
- Gate log: `~/.quantumclaw/gate.log` (file-based, will surface in QClaw dashboard post-Phase-5)
- Skill load log: `~/.quantumclaw/skill-load.log` (file-based, JSON Lines, mode 0600, written by `src/agents/skill-loader.js` from Slice 2b — one entry per `loadSkills()` call. Supabase migration deferred post-Phase-4.) `userId` field semantics: Telegram-sourced calls carry the Telegram user id; non-Telegram callers (scheduled heartbeat tasks in `src/core/heartbeat.js`, CLI `agent.process()` invocations in `src/cli/index.js`) pass no userId, which surfaces as the string `"null"` in the log — by design, since these calls have no Telegram user. Identified Slice 2c Task 6.
- Claude Code dispatch log: Supabase table `claude_code_dispatches` (Phase 4 Slice 5)
- Tool registration / call log: `~/.quantumclaw/tool-call.log` (file-based, JSON Lines, mode 0600, written by `src/tools/registry.js` from Slice 3a — one entry per registration event with `{ts, event, source, tool, scope, ...}`). Tests can override via `QCLAW_TOOL_CALL_LOG_PATH`. Slice 3b extends the same log to routing decisions; Slice 3c covers per-call execution.
- Channel events log: `~/.quantumclaw/channel-events.log` (file-based, JSON Lines, mode 0600, written by `src/channels/manager.js` from Slice 3e — one entry per Telegram channel state transition: transient/non_transient/unknown errors, retry_scheduled/succeeded, degraded, recovery_attempt/succeeded/failed, manual_intervention_required, stopped). Field-presence convention documented in `/tmp/slice3e_design.md` §5. Bot-token URLs are scrubbed via `_scrubToken` before write. Tests can override via `QCLAW_CHANNEL_EVENTS_LOG_PATH`.

## Capability layer

- Channel manager: `src/channels/manager.js` — Telegram (grammY) channel adapter. Slice 3e (2026-05-21): runner update-loop errors are classified + retried + degraded via `_onRunnerFailure` + `_attemptRecovery`; process no longer crashes on 401/429/etc. Pure error classifier at `src/channels/grammy-error-classifier.js` (input: error from grammY runner; output: `{kind, httpStatus?, networkCode?, shouldRetry, backoffMs?, reason}`; no side effects). Recovery timer fires every 5 min, capped at 12 attempts (1h) before emitting `manual_intervention_required`. State machine: `starting → active → retrying/degraded → active|degraded → stopped`. Surfaced via dashboard `/api/channels` `status` field.
- Skill files (canonical SSOT): `/root/QClaw/src/agents/skills/` — enforced by `SKILL_EDIT_ALLOWLIST` in `src/security/approval-gate.js`. Edits go through git, not via runtime mutation. Archived skills live at `src/agents/skills/archive/` (preserved via git history, excluded from runtime by `loadSkills`).
- Skill frontmatter (canonical keyword source): each skill `.md` declares `name`, `category` (always-on | on-demand | specialist-scope | archive), `surface` (prompt | tool | both), `keywords` (required iff on-demand), `description`. Spec landed in Slice 2a.
- Skill loader: `src/agents/skill-loader.js` — `loadSkills(context) → SkillLoadResult` is the canonical agent-level skill-loading code path (Slice 2b Task 4). Reads canonical SSOT directly, partitions by category, applies hard-cap-4 to on-demand routing. Tool registration stays in `Agent.load()` until Slice 3 (audit T7).
- Skill router: `src/agents/skill-router.js` — token-level keyword matching with combination-trigger filter (Slice 2b Task 5). LLM-driven router is the Phase 5+ replacement behind the same `loadSkills` interface.
- Bootstrap Layer 6: `bootstrap.skills.always_on` — populated by `_layer6Skills` (`src/agents/bootstrap.js`); cached per session by the existing 30-min bootstrap TTL; reused by `loadSkills` via `context.bootstrap` so always-on skills don't re-read on every message inside the cache window.
- Generated keyword reference: `KEYWORD_REFERENCE.md` at repo root — generated from skill frontmatter via `node scripts/regen-keyword-reference.js`. Marked GENERATED at top; do not hand-edit. Will be retired when intent classification replaces keyword routing (Phase 5+).
- Skill symlinks (Charlie runtime): `/root/.quantumclaw/workspace/agents/charlie/skills/` — every file is a symlink into `/root/QClaw/src/agents/skills/`. As of Slice 2b: 15 symlinks (17 post-Slice-2a Task 1, minus 2 archived in 2b — `charlie-cto.md` and `agent-coordination.md`).
- Tool registry: `src/tools/registry.js` — `ToolRegistry` class. Three storage maps: `_builtins` (`get_current_time`, `calculate`, `web_fetch`, `search_knowledge`, `shell_exec`, `n8n_workflow_update`), `_apiTools` (preset HTTP tools + per-agent skill-defined HTTP tools), `_tools` (live MCP server tools). Public registration surface: `registerBuiltin(name, def)`, `registerSkillTool(agentName, skillName, parsedSkill, toolDef)`, `enablePreset`, `addCustom`, `addRemote`. Every entry carries an explicit `scope` field — `'shared'` for utility/memory/comms/read-only tools, or `[agent_name, ...]` for domain tools (Slice 3a `shared__` rule; see CHARLIE_OVERHAUL.md Component 4). Sibling files in `src/tools/`: `executor.js` (agentic loop + AGEX gates), `mcp-client.js` (MCP stdio/SSE transport), `shell-exec.js` (factory), `shell-exec-parser.js` (Slice 3d hand-rolled argv parser — exports `parseAndValidate(command)` returning `{ok, argv, schemaKey, resolvedPaths} | {ok:false, error, reason, detail}`; pure function, no env / fs / spawn at parse time), `shell-exec-verb-schemas.js` (Slice 3d per-verb schemas, `VERB_BINARY`, `SAFE_ENV`, `DENY_PREFIXES`/`DENY_GLOBS`, dangerous-git-config-key lists, `resolvePath` realpath + DENY/ALLOW chain), `shell-exec-spawn.js` (Slice 3d `spawnWithCaps` — `child_process.spawn` with `shell:false`, hardcoded `SAFE_ENV` including `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=/dev/null`, 30s timeout, 1 MiB combined output cap via hand-rolled accumulator, realpath substitution into argv before spawn), `n8n-workflow-update.js` (factory). Slice 3d (2026-05-16): `shell_exec` is enabled with a 5-verb structural surface (`ls`, `cat`, `git status`, `git log`, `pm2 list`); 4 rounds of adversarial review converged the design. Kill-switch `QCLAW_SHELL_EXEC_ENABLED=0`/`false`/`no`/`off` registers `createDisabledShellExecTool` for emergency rollback. Verification harness: `scripts/verify-shell-exec-parser.js`. Replaces the deleted Slice 3c allowlist (`shell-exec-allowlist.js`) and its harness — three rounds of adversarial review surfaced 4 CRITICAL bypasses in the regex-on-shell-string approach.

## Reference docs (Tyson and Claude Code)

- `KEYWORD_REFERENCE.md` — skill loading keyword cheat sheet
- `CLAUDE_CODE_OPERATING_RULES.md` — Claude Code session discipline
- `CLAUDE_CODE_INVENTORY.md` — Claude Code tool surface and access

## Infrastructure

- QClaw server: `ssh qclaw` → `138.68.138.214`, port 4000
- qclaw requires **git ≥ 2.30**. The Slice 3d `shell_exec` repo-local git-config trust-boundary argument depends on git 2.30's alias-resolution hardening (alias-overrides-of-built-in-commands are silently ignored in 2.30+). Pre-Unit-3-merge verification in `CHARLIE_OVERHAUL.md` Slice 3d pre-merge checklist. Tyson runs `git --version` on qclaw before merging Slice 3d Unit 3; if < 2.30, halt and escalate.
- n8n server: `ssh n8n` → `157.230.216.158`, Docker Compose
- Dashboard: `agentboardroom.flowos.tech`
- Supabase project: `fdabygmromuqtysitodp`
- Secondary Supabase project (LinkedIn lead gen): `zshmlgtvhdneekbfcyjc` — separate from main QClaw Supabase. Used by Tyson personal brand LinkedIn lead gen workflows for prospect tracking, engagement counters, and analytics. Schema and tables are LinkedIn-cluster-specific; not part of the main canonical state architecture. To be inventoried in the LinkedIn-cluster reconciliation work.
- Cloudflare R2: used by Clipper, Content Studio, Crete Marketing, Flow OS GHL Marketing (each scoped to own bucket/folder)
- n8n internal Postgres database — used by some n8n workflows for state/dedup logic (e.g. Morning Light WL→HL conflict resolution). Distinct from external Supabase. Hidden architectural dependency; access scope is internal-to-n8n only, not externally queryable from the Charlie or QClaw stack.

## Secrets and credentials

- QClaw-side secrets: `/root/.quantumclaw/.env` (root-owned, 600 permissions)
- Symlink for sudo flowos access: `/home/flowos/.quantumclaw/.env` (intentional, root-managed)
- n8n-side secrets: `/home/n8nadmin/n8n-project/.env` (compose env_file)
- Supabase credentials in n8n: "Supabase FSC" credential
- Never log secret values. Never commit secrets to repo.

## Business unit portals and accounts

- Flow OS community portal: `portal.flowos.tech`
- FSC community portal: `https://fsc.app.clientclub.net/home`
- GHL sub-accounts: Flow OS, FSC, SproutCode, Crete (one each)
- Meta Ads accounts:
  - Flow OS: `act_414785961683125`
  - Emma Maidment Business: `act_1426936257455201`
  - Flow States Retreats: `act_464237024205104` (currently dormant)

## Migration notes

When migrating any location (e.g. file-based log → Supabase table):
1. Update this file with the new location
2. Update any code or doc that references the old location
3. Note the migration in the build log
4. Verify all consumers pick up the new location before retiring the old
