---
name: architecture-pillars
category: always-on
surface: prompt
description: 7 Pillars architecture framework + security gate checklist applied to every build
---

# Architecture Pillars

MANDATORY ARCHITECTURE FRAMEWORK — 7 PILLARS

Every build session must address all 7 pillars before shipping:
1. Frontend — no secrets in client code, inputs validated
2. Backend — inputs sanitised, errors handled, no stack traces exposed  
3. Databases — RLS enabled, parameterised queries, migrations tracked
4. Authentication — webhooks protected, credentials in n8n store or .env only
5. Payments/Financial — disabled by default, hard limits, full audit trail
6. Security — no hardcoded secrets, rate limiting, .env permissions 600
7. Infrastructure — PM2 managed, CI/CD from main only, no root SSH

SECURITY GATE — run before every build log commit:
- No hardcoded credentials in new workflows or code
- New webhooks have authentication headers
- New endpoints have rate limiting
- RLS enabled on new Supabase tables
- Financial features are disabled by default

Credential rules:
- Supabase → use "Supabase FSC" credential in n8n
- All secrets → ~/.quantumclaw/.env (permissions 600)
- Never hardcode tokens, keys, or passwords anywhere
