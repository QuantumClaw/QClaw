<!-- GENERATED FROM SKILL FRONTMATTER — DO NOT EDIT BY HAND. Regenerate with: node scripts/regen-keyword-reference.js -->
# Keyword Reference

This is the cheat sheet for which keywords trigger which skills in Charlie's prompt assembly. It exists because keyword-based routing is brittle — Tyson uses this to be deliberate about loading the right skill into Charlie's context.

This will be retired when intent classification replaces keyword routing (planned Phase 5+, after 2-4 weeks of routing telemetry).

## Always-on skills (always loaded, no keyword needed)

These load on every prompt regardless of message content:

- `architecture-pillars.md` — 7 Pillars architecture framework + security gate checklist applied to every build
- `bootstrap-awareness.md` — Charlie's understanding of his own session-start state — what bootstrap loaded, freshness, probe results, cache hit vs cold
- `delegation.md` — How Charlie routes work to Claude Code, specialists, sub-agents, and Tyson — dispatch contract, escalation paths, sub-agent coordination
- `identity.md` — Charlie's identity at message-time — who is acting, across which business units, with what greeting cadence
- `lanes.md` — In-lane vs out-of-lane behaviour — what Charlie does directly vs delegates, plus the use-tools-first and never-dump-on-Tyson anti-patterns
- `security.md` — Security gate checklist applied to every build session — credential rules, .env hygiene, webhook auth, RLS
- `verification-reflexes.md` — Cite-or-don't-claim, audit-before-brief, verify-before-claim, and "I don't know" as first-class output — Charlie's non-negotiable verification reflexes

## On-demand skills (triggered by keywords)

| Keyword(s) | Skill loaded |
|---|---|
| build, modify, fix, implement, deploy, ship | `build.md` |
| revenue, mrr, reporting, bi, financials | `business-intelligence.md` |
| clip, clipper, vertical, captions | `clipper.md` |
| community, members, engagement, lives, gamification, retention, flowos, portal-flowos, flow-os-community | `community-manager-flow-os.md` |
| community, members, engagement, lives, gamification, retention, fsc, clientclub, flow-states-collective | `community-manager-fsc.md` |
| content, podcast, reel, buzzsprout | `content-studio.md` |
| ghl, contacts, opportunities, conversations | `ghl.md` |
| n8n, workflow, webhook | `n8n-api.md` |
| route, dispatch | `n8n-router.md` |
| qa, test, audit, verify | `qa.md` |
| qclaw, build, modify, fix, implement, deploy, ship | `qclaw-dev.md` |
| stripe, customer, invoice, payment | `stripe.md` |
| schedule, task, delegate, queue | `task-queue.md` |
| trade, trading, scanner, position | `trading-api.md` |
| trade, trading, scanner, position | `trading.md` |

## Combination triggers

Some keywords are too ambiguous on their own. They only trigger skill loading when paired with a domain keyword:

- **Emma + content / podcast / reel / Buzzsprout** → `content-studio` _(Emma alone does NOT trigger — content keyword required.)_
- **community + GHL or specific portal name** → `community-manager (variant by business unit context)` _(Routes to FSC vs Flow OS variant by context.)_

## Hard limits

- Hard cap of 4 on-demand skills per prompt
- If more than 4 keywords match, top 4 by keyword density load
- Dropped skills logged in skill load log (`~/.quantumclaw/skill-load.log`)

## How to use this file

When you want Charlie to load a specific skill, include the trigger keyword in your message. Example:

- "Help me think through the Trading scanner heartbeat" → triggers `trading.md`
- "Audit the dashboard wiring" → triggers `qa.md` and `build.md`
- "Walk me through this n8n workflow" → triggers `build.md`

When you want Charlie to *not* load a skill, avoid the keyword. Example:

- Casual mention of Emma without content keywords → `content-studio.md` not loaded
- General "what's pending" question → no on-demand skills loaded

## Maintenance

This file is generated from YAML frontmatter on each skill in `src/agents/skills/`. To change which skills are always-on or which keywords route to which skill, edit the skill's frontmatter and regenerate:

```sh
node scripts/regen-keyword-reference.js
```

The combination-trigger block at the top of the script is a small hardcoded list (currently Emma+content and community variants). When more combinations emerge they should migrate to a config file.

Frontmatter spec (per skill .md):

```yaml
---
name: <slug>
category: always-on | on-demand | specialist-scope | archive
surface: prompt | tool | both
keywords: [k1, k2, ...]   # required iff category=on-demand
description: <one-line>
---
```
