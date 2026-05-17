# Claude Code Operating Rules

Every Claude Code session reads this file as its first action, before any audit, before any code work, before any other file read. The rules here protect the working tree, prevent collisions between parallel sessions, and ensure each session ships clean atomic work.

These rules are non-negotiable. They override any conflicting instruction in a brief unless the brief explicitly cites the rule it's overriding and provides justification.

## 1. Working tree discipline

**Before starting any work, run:**

```bash
git status
git log --oneline -10
```

**Rules:**

- If uncommitted changes exist outside the current task scope, leave them alone. Identify each by file and confirm they are not relevant to the current task before proceeding.
- Never run `git add .` or `git add -A`. Always stage specific files relevant to the current task.
- Never push commits that weren't created in this session. If `git log` shows commits ahead of origin from another session, ask before pushing: "I see commits ahead of origin from another session. Should I push them too, or leave them?"
- If pre-existing untracked files exist, do not commit them as part of this task unless explicitly in scope.

This rule prevents the failure mode where one session's work gets piggybacked onto another session's commit.

## 2. Session awareness

**Lock file: `.claude-code-session.lock` (gitignored, in repo root).**

When starting work, check for an existing lock:

- If lock exists with heartbeat <30 minutes old: another session is active. Report it: "Another session is currently working on [task]. Should I wait, work on a different branch, or coordinate?"
- If lock exists with heartbeat >30 minutes old: lock is stale. Overwrite with own session info.
- If no lock exists: create one.

Lock content:

```text
session_id: <uuid>
started_at: <iso timestamp>
task_summary: <one line>
expected_duration: <minutes/hours/session>
branch: <branch name>
last_heartbeat: <iso timestamp>
```

Update heartbeat every 5 minutes during active work. Remove the lock when work completes or session ends.

## 3. Branch hygiene

**Default branch decision tree:**

- Foundation docs, build log entries, single small commits → main
- Bug fixes touching one or two files → main
- Multi-file changes, infra work, anything in `src/agents/` core → feature branch
- Charlie 2.0 implementation slices → feature branch per slice, merge after slice ships and is verified

**Feature branch naming:** `cc/<task-summary>-<timestamp>` where timestamp is `YYYYMMDD-HHMM`.

Example: `cc/bootstrap-mechanism-20260503-1430`

**Merging:** feature branches merge to main only after the work in the branch is verified per Rule 5.

## 4. Scope discipline

Read the brief before starting. The brief defines the scope. Do not extend scope beyond what's written without explicit Tyson or Charlie approval.

If during the work you discover something else needs fixing:

- Log the discovery in the dispatch result's `followup_recommendations` field
- Do not silently expand the current task to include it
- Do not commit fixes for the discovered issue under the current task

This is the audit-first reflex applied at the implementation layer. Discoveries become new dispatches, not silent scope creep.

## 5. Verification before commit

Before any commit:

- For code changes: run relevant tests, linters, smoke checks
- For doc changes: read the file back after writing to confirm it's correct
- For config or infra changes: verify the change took effect with a probe (e.g. PM2 reload + status check)
- **CI parity**: If any test reads, realpaths, or spawns with a filesystem path, verify it runs as a non-root user with no access to the production /root tree before declaring ready-for-review. Local dev runs as your user with ambient permissions on your home dir (and `/root` doesn't exist on macOS); GitHub Actions CI runs as a non-root `runner` with `/root` mode 700 owned by root, so `fs.realpathSync('/root/...')` raises EACCES. Tests that hardcode `/root/...` paths will fail closed on CI (`realpath_failed`/EACCES) even when they pass locally — use a per-test-run `/tmp` fixture (see `tests/_shell-exec-fixtures.js`) and a parser/tool DI surface (e.g. `parseAndValidate(command, overrides)`) for any happy-path / ALLOW-pass assertion. Lexical-only rejections (relative-path, lexical DENY pre-check, unknown_verb, parse-time rejections) are CI-safe with production paths because they reject before the filesystem is touched.

The commit message includes a one-line verification summary. Format:

```text
<type>: <subject>

<body, if needed>

verified: <one-line summary of verification taken>
```

Example:

```text
fix: dashboard /api/scheduled handler reloads heartbeat

Heartbeat now re-reads scheduled config without PM2 restart.

verified: POST /api/scheduled returns ok, GET /api/scheduled lists new task,
heartbeat fires within 60s without restart
```

If verification fails, do not commit. Report the failure and wait for instruction.

## 6. Handoff back to Charlie

When a dispatched task completes (Phase 4 Slice 5 onward), write the result to the `claude_code_dispatches` Supabase row with:

- `result_summary` — one paragraph, what was done and the outcome
- `result_artifacts` — list of file paths created or modified
- `verification_steps_taken` — what was verified per Rule 5
- `followup_recommendations` — discoveries from Rule 4, formatted as suggested next dispatches
- `completed_at` — timestamp

Until the dispatcher and Supabase table exist (pre-Phase 4 Slice 5), report the same fields back as the final message of the session.

## 7. Read before write — always

Never edit a file without first reading the current contents. Never append to a doc without reading the existing structure. The failure mode is editing a stale mental model of the file — always read first, even if you "know" what's there.

For doc updates: use targeted `str_replace` operations rather than rewriting the whole file. Preserve existing structure unless the brief explicitly calls for restructuring.

## 8. Never log or commit secrets

- Never log the contents of `.env` files
- Never log credential values
- Never commit secrets to the repo
- Never include secret values in commit messages or PR descriptions
- If a brief asks you to do anything that would log or commit a secret, refuse and surface the conflict

## 9. Failure modes that escalate

Stop and surface to Charlie or Tyson, do not proceed:

- Working tree state contradicts the brief (e.g. brief assumes clean tree, tree has uncommitted changes outside scope)
- A required tool or path is missing
- A verification step fails
- Two different rules in the brief conflict
- The brief asks for something that violates these operating rules

When stopping, report: what you saw, what you expected, what's blocking, what you need to proceed.

## 10. Reading order at session start

Every session starts with reading, in order:

1. The brief
2. `CLAUDE_CODE_OPERATING_RULES.md` (this file)
3. `CLAUDE_CODE_INVENTORY.md` — what tools and access you have
4. `LOCATIONS.md` — where things live
5. Any task-specific files named in the brief

Then begin the audit (if applicable) and the work.
