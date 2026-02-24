# Dashboard UI — Scrutiny & Gaps

Critical review of the dashboard (Chat, Overview, Channels, Usage, Agents, Skills, Memory, Config, Logs). British English.

## Summary

The dashboard is functional for viewing and chat but **lacks basic CRUD, discovery, and resilience** expected of a control plane. Many tabs are read-only with no way to add, edit, or act from the UI.

---

## 1. Chat

**Works:** WebSocket chat, thread list, agent selector, image paste/upload/drop, pairing banner, markdown rendering, copy code.

**Missing / weak:**
- **No reconnection UX** — If WS drops, user only sees "Offline"; no "Reconnect" button.
- **No loading state** when switching threads — History can take a moment; no spinner or skeleton.
- **Thread list** — No delete/archive thread; no thread naming; "New Chat" creates an in-memory view but backend has no "thread create" API.
- **Agent selector** — Only lists agents; no indication of which model each uses without opening Agents tab.
- **No "Copy dashboard URL"** in the UI — User must run `qclaw dashboard` in a terminal to get the URL for another device.

---

## 2. Overview

**Works:** Status, degradation, agents count, memory type, tunnel/AGEX, quick stats (messages, cost, tokens).

**Missing / weak:**
- **No Refresh button** — Data is stale until user switches tabs and back.
- **Tunnel URL** — If tunnel is active, the URL is shown in a card but not copyable (no copy button).
- **No link to Config** — Can't jump to change port/tunnel from here.
- **Stats** — "Messages" and "Cost" come from different endpoints; no single source of truth for "today".

---

## 3. Channels

**Works:** Lists channels (Telegram, dashboard), paired users table (from threads).

**Missing / weak:**
- **No add/enable channel** — Cannot enable Telegram or another channel from the UI; must use config/CLI.
- **No "Test" action** — e.g. "Send test message" for Telegram.
- **Paired table** — Shows threads, not explicit "paired users" from channel config; can be misleading.
- **No Refresh button.**

---

## 4. Usage

**Works:** Total spend, messages, tokens; bar by channel; recent activity table parsed from audit.

**Missing / weak:**
- **Cost by model/agent** — Parsed from audit detail strings (fragile); no dedicated cost API by model or agent.
- **No date range** — Only "all time" and whatever audit returns; no "Today / This week / This month".
- **No export** — No CSV/JSON export for accounting.
- **Recent activity** — Depends on audit format; breaks if audit format changes.
- **No Refresh button.**

---

## 5. Agents

**Works:** Cards with name, provider/model, skills count, threads, messages.

**Missing / weak:**
- **Read-only** — No "Add agent", "Edit", "View SOUL", "View skills". All agent management is CLI/workspace.
- **No link to agent's skills** — Can't jump to Skills filtered by agent.
- **No Refresh button.**

---

## 6. Skills

**Works:** Table of name, endpoints, reviewed status, source.

**Missing / weak:**
- **No add skill** — No "Add from URL", "Paste markdown", or "Upload .md file". Docs say dashboard can add skills; UI has no form or drop zone.
- **No view content** — Cannot expand to see skill markdown or endpoints.
- **No approve/reject** — Unreviewed skills show badge but no "Approve" / "Docs only" / "Delete" actions (docs describe this workflow).
- **No delete** — Cannot remove a skill from the UI.
- **No Refresh button.**

---

## 7. Memory

**Works:** Cards (graph/vector/knowledge); search box and results.

**Missing / weak:**
- **No graph visualisation** — Docs mention "Interactive knowledge graph visualiser"; UI only has search and raw result blobs. No nodes/edges, no "see relationships".
- **No entity list** — Cannot list "all people" or "all companies" from the graph.
- **Search results** — Rendered as raw content/score; format depends on Cognee/SQLite response shape; can be messy.
- **No Refresh button** for the cards (e.g. after new messages).

---

## 8. Config

**Works:** Nested keys rendered; leaf values editable with Save button or Enter.

**Missing / weak:**
- **Nested objects** — Only leaf values have inputs; cannot add or remove keys from nested objects (e.g. `channels.telegram.enabled`).
- **No validation** — Invalid values (e.g. port "abc") are sent to API; error handling is generic.
- **No "Reset to default"** — Can't revert a key to a known default.
- **Sensitive fields** — Masked as "***"; no "Change" flow (e.g. set new token).
- **No Refresh button** — If config is changed elsewhere, UI is stale until reload.

---

## 9. Logs (Audit)

**Works:** List of audit entries; Refresh and "Errors only" buttons.

**Missing / weak:**
- **No live tail** — No auto-refresh or "Live" toggle; user must click Refresh.
- **No search/filter** — Cannot filter by actor, action, or text.
- **No export** — No download as file.
- **No pagination** — Limit 100; no "Load more" or page size.

---

## 10. Cross-cutting

- **No global "Refresh" or "Sync"** — Each tab loads once on open; no way to refresh all.
- **Token/URL discovery** — If user loses the dashboard URL, they must run `qclaw dashboard`; no in-UI "Copy link" or "Show URL".
- **Error handling** — Many `catch` blocks set innerHTML to "Error: ..." or leave tables empty; no toast or persistent error banner.
- **Mobile** — Layout is responsive but thread list and some tables are cramped; no dedicated mobile nav (e.g. bottom bar).
- **Accessibility** — No ARIA labels, focus management, or keyboard shortcuts for main actions.

---

## Recommendations (priority)

1. **High:** Add "Copy dashboard URL" (with token) in topbar so users can open on another device without CLI.
2. **High:** Add Refresh button to Overview, Channels, Usage, Agents, Skills, Memory (and keep existing in Logs).
3. **High:** Skills: implement "Add skill" (URL or paste) and Approve/Reject/Delete for unreviewed skills if backend supports it.
4. **Medium:** Logs: add "Live" (auto-refresh every 5s) and simple text filter.
5. **Medium:** Usage: add date range (today / week / month) and a proper cost-by-model API if available.
6. **Medium:** Memory: add a simple entity list and, if feasible, a minimal graph view (e.g. D3 or similar).
7. **Low:** Config: add validation and "Change" flow for masked secrets; optional "Reset to default" per key.
8. **Low:** Chat: add "Reconnect" button when WS is offline; loading state when switching threads.

---

## Backend gaps that block UI

- **Skills:** API has list only; no `POST /api/skills` (add), `GET /api/skills/:name` (content), `POST /api/skills/:name/approve`, `DELETE /api/skills/:name`.
- **Agents:** No add/edit from API; agents are workspace-driven.
- **Channels:** No "enable channel" or "test channel" API.
- **Costs:** No aggregated cost-by-model or cost-by-agent; audit log is the only source and is text-based.

Implementing the high-priority UI items (copy URL, refresh buttons, and any add/approve skills) will still improve usability even where backend is not yet extended.
