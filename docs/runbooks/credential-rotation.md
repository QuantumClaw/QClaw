# Credential rotation runbook

How to rotate any shared credential (API keys, OAuth secrets, database passwords) used by services in the QClaw / Flow OS stack without breaking downstream consumers.

Written 2026-05-21 from gaps surfaced during the May 19 Anthropic key rotation. Three rotations missed consumers; each gap maps to a step below.

Rotation is not "edit a value and move on." It is: **inventory → propagate → verify each consumer → audit reverse pointers → only then delete the old credential**. Skipping any step has caused silent failures lasting days.

## Pre-rotation checklist

Before rotating ANY credential, do all of the following.

### 1. Inventory every consumer

**(a) n8n credentials**

Find every workflow that references the credential being rotated:

```sql
SELECT we.id, we.name, we.active
FROM workflow_entity we
WHERE we.nodes::text LIKE '%<credential_id>%'
  AND we."isArchived" = false;
```

Run on the n8n postgres container:

```bash
ssh n8n
docker exec n8n-postgres psql -U n8nuser -d n8n -tA -c "<query>"
```

**Do not filter by `active = true`.** Inactive workflows still reference credentials and will fail on activation if missed. Workflows that look dormant today get reactivated next quarter.

**(b) Filesystem env files**

Grep for the key VALUE prefix (not the variable name), since the same variable name can hold different values across services:

```bash
sudo grep -rln "<KEY_VALUE_PREFIX>" \
  /root/.quantumclaw/.env \
  /home/n8nadmin/n8n-project/.env \
  /etc/environment 2>/dev/null
```

The value prefix is safer than `grep ANTHROPIC_API_KEY` because some env files use different variable names for the same logical credential.

**(c) Repo for any hardcoded references**

Should return zero per [SECURITY.md](../../SECURITY.md), but verify:

```bash
grep -rn "<KEY_VALUE_PREFIX>" /root/QClaw/src/ 2>/dev/null
```

**(d) Standalone services that load env at startup**

These are the easy-to-miss consumers. Any service that reads `.env` once at process start and caches the value will NOT pick up rotation by just editing the file — it needs a process restart.

Known cache-at-startup consumers:

- `clipper-worker` (`src/clipper/main.py`) — calls `load_env()` + `os.environ.setdefault()` at module import. Requires `sudo pm2 restart clipper-worker --update-env` after rotation. Lesson 61 banked 2026-05-20.

Add new ones to this list as they're discovered.

### 2. Classify each consumer's reload mechanism

For every consumer from step 1, document which of these three patterns applies:

| Pattern | Reload mechanism |
|---|---|
| n8n credential reference (id pointer) | Live re-read on next workflow execution. No service restart needed. |
| Service env-var consumer with hot reload | Picks up on next request. Rare — most services snapshot at startup. |
| Service env-var consumer that caches at startup | **Requires `sudo pm2 restart <service> --update-env`**. Editing `.env` is not enough. |

Misclassifying a startup-cache consumer as live-reload is the most common rotation gap.

### 3. Decide rotation cadence

| Strategy | Risk | When to use |
|---|---|---|
| Big-bang (delete old, create new, propagate) | Visible failures if a consumer is missed | Credentials with ≤2 consumers, or when active failure is acceptable |
| Phased (create new, propagate, then delete old) | Consumers can drift indefinitely if not actively swept | Credentials with many consumers |

**Phased is safer.** It preserves a rollback window and lets you verify each consumer before commitment.

## During rotation

### 1. Update credentials in this order

**(a) Filesystem env files first** — on every host (covers every `.env` from step 1.b above).

**(b) Then n8n credentials_entity** — paste the new value into the credential's value field via the n8n UI. Save.

**(c) Then `pm2 restart --update-env` every standalone service from step 1.d.**

The `--update-env` flag is critical. Without it, PM2 reuses the cached environment from when the process was first started, even after a restart. This was the May 20 clipper-worker gap.

### 2. Verify each consumer immediately

Do not batch verification to the end. Verify as you go:

- **n8n consumer:** trigger a workflow that uses the credential, confirm 200 response. For schedule-triggered workflows without a manual trigger, use the on-demand webhook if one exists, OR fire `/api/v1/workflows/:id/execute` (note: this may 405 on some n8n configs — fall back to UI).
- **Standalone service:** invoke its endpoint, confirm 200.
- **Filesystem-only:** trigger the downstream consumer (e.g. if a script reads the .env and writes to an API, run the script).

If verification fails for any consumer, **stop and surface**. Do not delete the old credential.

### 3. Leave the old credential valid

The old credential remains valid until step 3 below. This is intentional — gives a rollback window.

## Post-rotation cleanup

### 1. Delete the old credential

Only after ALL consumers verified working with the new credential:

- **n8n:** UI → Credentials → old credential → Delete. (Or via the n8n API.)
- **Provider dashboard:** if the old credential exists in any other store (Anthropic dashboard, Cloudflare, Meta Business, etc.), revoke it there too.

### 2. Reverse-pointer audit

**This step catches missed consumers.** Run the n8n SQL query from step 1.a again, this time with the OLD credential id:

```sql
SELECT id, name FROM workflow_entity
WHERE nodes::text LIKE '%<old_credential_id>%'
  AND "isArchived" = false;
```

Expected: zero rows.

Any row found is a missed consumer that will fail on next run. The Meta Ads Optimisation Agent failure was caught five days late because this audit was not performed during May 19 rotation.

### 3. Sweep production error logs

For any RLS-protected production tables where errors get persisted, sweep recent rows for the old key's failure signature:

```sql
-- Example for Content Studio pipeline (adapt per project):
SELECT id, status, error_message, updated_at
FROM content_studio_jobs
WHERE error_message ILIKE '%authentication_error%'
  AND updated_at > now() - interval '7 days';
```

If rows appear with the old-key signature, those jobs need replay.

## Gaps surfaced during May 19–20 Anthropic key rotation

Each gap maps to a step above. Documented to keep the runbook honest about what failed and why.

**clipper-worker was missed** (May 20 incident, 5 days post-rotation):

- Caches env at module import via `load_env()` + `os.environ.setdefault()`. Editing `.env` alone did not propagate.
- Maps to step 1.d (consumer inventory missed standalone services) and step 2.c (no service-side verification post-rotation).
- Fix: `sudo pm2 restart clipper-worker --update-env`.

**Meta Ads Optimisation Agent (`lf955LDteJ512RQi`)** — stale credential pointer:

- Workflow active and cron-scheduled. `eXhIwRbh7FBgb6O3` was deleted before the consumer audit ran. Workflow failed silently in daily cron for 5 days (2026-05-20 through 2026-05-21).
- Maps to step 3.2 (reverse-pointer audit not performed before old credential deletion).
- Compounding factor: this node used `predefinedCredentialType` + `nodeCredentialType: "anthropicApi"`, not the generic `httpHeaderAuth` pattern used elsewhere — so the May 19 batch fix that re-pointed the other workflows wouldn't have worked here without creating a new `anthropicApi`-type credential. Resolution: Tyson created `1yrpJ3S4Gw6YSUSJ` ("Anthropic - QuantumClaw (anthropicApi)") and the workflow was repointed to it on 2026-05-21.

**Trading - Weekly Analyst (`vjj2uBIPc07FpIxx`)** — same stale pointer, masked by inactive state:

- Workflow inactive, so the failure didn't surface in execution logs.
- Maps to step 3.2 + the **inactive-workflow blind spot**: an audit query filtered by `active=true` would have missed this entirely. The query in step 1.a deliberately includes inactive workflows.

## Related

- [SECURITY.md](../../SECURITY.md) — overall security posture, AGEX protocol (future automation of this runbook)
- [QCLAW_BUILD_LOG.md](../../QCLAW_BUILD_LOG.md) — chronological record of past rotations and incidents
- [LOCATIONS.md](../../LOCATIONS.md) — where credentials and env files live
