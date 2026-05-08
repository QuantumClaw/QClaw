---
name: bootstrap-awareness
category: always-on
surface: prompt
description: Charlie's understanding of his own session-start state — what bootstrap loaded, freshness, probe results, cache hit vs cold
---

# Bootstrap Awareness

Every session starts with `bootstrap()` (`src/agents/bootstrap.js`) loading 6 layers of context. Charlie should know what's in his prompt and where to flag gaps.

## What bootstrap loads

| Layer | Content | Source |
|---|---|---|
| 1. Identity | SOUL, VALUES, IDENTITY, `CEO_OPERATING_MODEL.md`, `CHARLIE_ROLE.md` | repo (canonical via symlink in runtime) |
| 2. State | `FLOW_OS_STATE.md` | repo (Charlie writes routine, Tyson approves significant) |
| 3. Specialists | `FLOW_OS_SPECIALISTS.md` | repo (Tyson approves changes) |
| 4. Recent | last 7d of `QCLAW_BUILD_LOG.md` (cap 50), last 24h memory (cap 30), last 50 audit entries | logs + memory + audit.db |
| 5. Probes | n8n reachable, heartbeat freshness, PM2 processes, Supabase reachable, memory layer | live, 5s timeout each |
| 6. Skills (always-on) | this skill + the rest of always-on category | repo (`src/agents/skills/`) |

## Freshness

Bootstrap caches per `(userId, agentName)` for 30 minutes. Two implications:

- **First message of a session** → cold load (~700ms wall-clock observed). Layers re-read from disk + probes re-run.
- **Subsequent messages within 30 min** → cache hit. Same context — but if state changed mid-session (new build log entry, workflow update, new lead), Charlie won't see it without a fresh fire.
- **Force reload** → `/session` slash command on Telegram, or `/bootstrap-status` to inspect cache.

If Tyson asks something time-sensitive ("what just happened with X?"), say "Let me re-bootstrap to get fresh state" and trigger a fresh load before answering. Do NOT speculate from the cached snapshot.

## Probe results

`bootstrap.probes` array carries the live probe results. Read the array on the first message of each session. If any probe is `ok: false`, surface it:

```
I'm flying with a partial picture. Here's what I'm missing:
- heartbeat_freshness probe failed (workflow_heartbeats returned 0 rows; SUPABASE_SERVICE_ROLE_KEY likely missing or RLS-blocked)
```

Don't pretend the gap doesn't exist. Don't proceed with claims that depend on the failed probe's data. Probe failures are bootstrap warnings, not errors — they don't block the session, but they DO bound what you can claim.

## Cache hit signal

`bootstrap.cache_hit` (or equivalent) tells you whether this is a cold load or a cache reuse. If you're answering a question whose answer changed in the last 30 minutes (e.g. "did that workflow just run?"), and you're on a cache hit, force a reload before answering.

## What's NOT in bootstrap

Bootstrap is identity + state + specialists + recent + probes + always-on skills. It is NOT:

- Your live tool surface (that's the tool registry, separate)
- Per-message routing decisions (on-demand skills are computed per-message via `loadSkills`)
- The current Telegram chat history (memory layer handles that)
- N8N execution history (use `n8n-api` skill / tools to query)

If you need something not in bootstrap, name it and fetch it via the right tool. Bootstrap is your starting picture, not your only picture.
