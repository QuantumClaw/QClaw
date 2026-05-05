# Heartbeat-on-execute pattern for n8n workflows

## Why we don't trust n8n's executions API

n8n stores executions in a global FIFO that prunes by count, not by age (`EXECUTIONS_DATA_PRUNE_MAX_COUNT`, default 10000). On the FlowOS host, a single high-volume webhook (`TikJkWLzpreI6iTa` "Morning Light WL→HL") generates ~24,000 executions/day and consumes 99.15% of that buffer. Every other workflow's history is evicted within ~7 hours — by the time a probe asks "did workflow X fire in the last 7 days?", the rows have been deleted from Postgres. Cursor pagination and date filters do not help; the data is physically gone. Full investigation: [`workspace/n8n_api_reliability_investigation.md`](https://...) (saved 2026-05-05).

The fix is to record a heartbeat from each workflow itself into a Supabase table we control, with retention we choose. Charlie's bootstrap probe and downstream dashboards read that table instead of the n8n API.

## What to record

Two heartbeats per execution:

1. **At the trigger entry** — immediately after the trigger node, before any downstream work runs. Status = `started`. This proves the trigger fired.
2. **At each terminal node** — one path per outcome, status = `success` or `error` (or `partial` if the workflow handles partial failure explicitly). Idempotency on `(workflow_id, execution_id)` means the same row gets upgraded in place from `started` → `success`/`error`.

Do **not** fire one heartbeat per item in a batch. The point is "did the workflow run", not "what did each item do." Item-level data goes in `metadata` if it matters.

## Standard node config

You have two equivalent transports for calling `record_heartbeat()` from a workflow.
**Prefer the Postgres node** when the workflow already has the `Supabase Postgres DB`
credential (`qGUxEHfEZkZGdAcZ`) attached or available — it's one fewer secret in
flight, lower latency, and simpler. Use the HTTP Request node only when the workflow
has no Postgres credential and adding one is heavier than wiring an HTTP call.

### Option 1 (preferred): Postgres node

| Field | Value |
|---|---|
| Operation | `Execute Query` |
| Credential | `Supabase Postgres DB` (`qGUxEHfEZkZGdAcZ`) |
| Query | see snippets below |
| Continue On Fail | **`true`** — heartbeat failure must NEVER fail the workflow |
| Retry On Fail | true, 2 tries, 2000 ms wait |

**SQL templating gotcha (re-learned twice in Batch 0/1):** the `query` field in
n8n's Postgres node is in *fixed* mode (it does NOT start with `=`), so:

- `{{ $workflow.id }}` and other expressions ARE interpolated — good.
- A literal `=` adjacent to `{{...}}` becomes a literal `=` in the SQL string.
  *Do not write* `'={{ $workflow.id }}'`. Write `'{{ $workflow.id }}'`.
- If you generate this SQL via Python `str.format()` or f-strings, `{{` / `}}`
  collapse to single braces. Build the string by plain concatenation only, or
  the workflow_id will land as `{ $workflow.id }` literally and the rows will
  be invisible to your queries.

### Option 2: HTTP Request node

Use only when there is no Postgres credential available to the workflow.

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `https://fdabygmromuqtysitodp.supabase.co/rest/v1/rpc/record_heartbeat` |
| Authentication | None (set headers manually below) |
| Send Headers | yes |
| Headers | `apikey: ={{$env.SUPABASE_SERVICE_ROLE_KEY}}`<br>`Authorization: =Bearer {{$env.SUPABASE_SERVICE_ROLE_KEY}}`<br>`Content-Type: application/json` |
| Send Body | yes, JSON |
| Body | see snippets below |
| **On Error** | **`Continue (using error output)`** — heartbeat failure must NEVER fail the workflow |
| Retry on Fail | 1 attempt, 2s wait |

> **Why service role key (not anon):** the `record_heartbeat` RPC is `SECURITY DEFINER` with `EXECUTE` granted only to `service_role`. Anon and authenticated cannot call it. This is intentional — it's the choke point.
>
> **Why a separate env var, not the existing `SUPABASE_ANON_KEY`:** the anon key cannot insert. Per the existing FSC-credential memo, do not strip the inline `apikey` header thinking the FSC credential covers it — the FSC `httpHeaderAuth` is a no-op; this header is what actually authenticates.

### Postgres node SQL — start heartbeat (off the trigger)

```sql
select public.record_heartbeat(
  '{{ $workflow.id }}'::text,
  'started'::text,
  '<workflow name>'::text,
  '{{ $execution.id }}'::text
);
```

Hardcode the workflow name as a string literal in each workflow's SQL — passing
`{{ $workflow.name }}` is fine but not necessary, and avoids comma-escape issues
if the name contains a comma.

### Postgres node SQL — success heartbeat (off terminal node)

```sql
select public.record_heartbeat(
  '{{ $workflow.id }}'::text,
  'success'::text,
  '<workflow name>'::text,
  '{{ $execution.id }}'::text,
  '{{ JSON.stringify({rows: $json.length}) }}'::jsonb
);
```

The `jsonb` argument is optional. If you don't need metadata, drop the last line
(and the trailing comma) and call `record_heartbeat` with 4 args.

### Postgres node SQL — error heartbeat (off error branch / Error Trigger)

```sql
select public.record_heartbeat(
  '{{ $workflow.id }}'::text,
  'error'::text,
  '<workflow name>'::text,
  '{{ $execution.id }}'::text,
  '{{ JSON.stringify({node: $json.error?.node?.name || "unknown", message: $json.error?.message || "no message"}) }}'::jsonb
);
```

### HTTP Request body — start / success / error

If you must use the HTTP Request transport (Option 2), the request is:

- **Method:** `POST`
- **URL:** `https://fdabygmromuqtysitodp.supabase.co/rest/v1/rpc/record_heartbeat`
- **Headers:** `apikey: ={{$env.SUPABASE_SERVICE_ROLE_KEY}}`, `Authorization: =Bearer {{$env.SUPABASE_SERVICE_ROLE_KEY}}`, `Content-Type: application/json`
- **On Error:** `Continue (using error output)`

Body — start:

```json
{
  "p_workflow_id":   "{{$workflow.id}}",
  "p_status":        "started",
  "p_workflow_name": "{{$workflow.name}}",
  "p_execution_id":  "{{$execution.id}}"
}
```

Body — success (with optional metadata):

```json
{
  "p_workflow_id":   "{{$workflow.id}}",
  "p_status":        "success",
  "p_workflow_name": "{{$workflow.name}}",
  "p_execution_id":  "{{$execution.id}}",
  "p_metadata":      { "rows": "={{$json.length}}" }
}
```

Body — error:

```json
{
  "p_workflow_id":   "{{$workflow.id}}",
  "p_status":        "error",
  "p_workflow_name": "{{$workflow.name}}",
  "p_execution_id":  "{{$execution.id}}",
  "p_metadata":      {
    "node":  "={{$json.error.node?.name || 'unknown'}}",
    "message": "={{$json.error.message || $json.message || 'no message'}}"
  }
}
```

> The HTTP transport requires `SUPABASE_SERVICE_ROLE_KEY` in n8n's env. If only
> `SUPABASE_ANON_KEY` exists, the call returns 401 — anon's EXECUTE was revoked
> on `record_heartbeat()` deliberately (see migration
> `2026_05_05_record_heartbeat_grant_authenticated.sql`).

## Wiring rules

- **Wire heartbeats off always-emits parents** — the trigger node itself (Schedule, Webhook, Manual, Cron), or a node that always fires. Per the existing memo on n8n empty-input behaviour: a heartbeat downstream of a node that may emit zero items will be silently skipped, defeating the whole point.
- **Branch the start heartbeat on a separate path from the main work.** Don't put it in the main pipeline — that couples its failure to the workflow's failure. Put it on a parallel branch with `Continue (using error output)`.
- **The terminal-node success heartbeat goes after the last business-critical node**, not after the heartbeat itself. Heartbeats are observability, not state.
- **Error Trigger workflows or the workflow's own error branch should always end in an error heartbeat.** `partial` is reserved for workflows that explicitly handle "some items succeeded, some failed" (e.g. fan-out batch jobs).

## Idempotency contract

The `record_heartbeat` RPC is idempotent on `(workflow_id, execution_id)` when `execution_id` is provided:

- First call inserts the row.
- Subsequent calls with the same `(workflow_id, execution_id)` **update the existing row in place** — `status`, `metadata`, and `workflow_name` are overwritten. The `id` and `created_at` are preserved.
- This is what lets the same row transition `started` → `success`/`error`/`partial` without leaving stale `started` rows around.
- Without `execution_id`, every call inserts a new row (no idempotency available — the workflow is responsible for not double-firing).

## Reading the data

Charlie's bootstrap probe and dashboards should read via Supabase REST/RPC with the **authenticated** role (read-only). Example query — last 30 days of heartbeats per workflow:

```sql
select workflow_id,
       workflow_name,
       count(*) filter (where status = 'success') as ok,
       count(*) filter (where status = 'error')   as err,
       max(started_at) as last_seen
from public.workflow_heartbeats
where started_at > now() - interval '30 days'
group by workflow_id, workflow_name
order by last_seen desc;
```

Dormancy rule of thumb: if `last_seen` is older than 2× the workflow's expected fire interval, treat it as suspicious and investigate.

## Retention

Default Supabase retention is unbounded — heartbeat rows live forever. The proposal in the work-list is to keep 30 days of detail and archive older rows (target schema for the archive: same shape, `workflow_heartbeats_archive`, repointed by a nightly `move-and-delete` job). That archive job is **not part of this sub-project**; defer until after Sub-projects B and C land and we can see real volume.

Estimated volume at steady state with all 20 instrumented workflows + Morning Light: ~50,000 heartbeats/day. 30 days ≈ 1.5M rows. Comfortable on Supabase's free tier; no immediate concern.

## Schema reference

See [`n8n-workflows/migrations/2026_05_05_workflow_heartbeats.sql`](n8n-workflows/migrations/2026_05_05_workflow_heartbeats.sql) for the canonical DDL. RPC signature:

```
record_heartbeat(
  p_workflow_id   text          NOT NULL,
  p_status        text          NOT NULL,  -- started | success | error | partial
  p_workflow_name text          DEFAULT NULL,
  p_execution_id  text          DEFAULT NULL,
  p_metadata      jsonb         DEFAULT NULL
) RETURNS uuid
```
