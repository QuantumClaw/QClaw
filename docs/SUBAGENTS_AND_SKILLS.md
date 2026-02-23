# Sub-agents and Skills: User and Orchestrator Guide

How **users** and the **main PA (orchestrator, e.g. Echo)** can create sub-agents and add skills or tools to them. British English.

---

## Orchestrator task allocation (main chat)

When you chat with the **primary agent** (Echo by default) in the main human interface:

- The primary sees a **Sub-agents** section in its system prompt listing every other agent and their **Purpose** (from each agent’s SOUL.md).
- It can **choose the best sub-agent** for the user’s request and **delegate** by replying with a special block. The runtime then runs that sub-agent with the given task and returns a combined response to the user (e.g. “I asked **Scout** to handle this. Here’s their response: …”). This saves resources by using specialists only when needed and keeps a single chat interface.

**Delegation format** (used by the primary only; do not type this yourself unless you are extending the system):

```
DELEGATE_TO=<agent_name>
TASK=<clear task for that agent>
END_DELEGATE
```

- The primary must output **only** this block when delegating (no extra text before or after).
- Implementation: `src/agents/registry.js` — primary’s prompt is augmented with `_getSubAgentsSection()`, and after the LLM reply the registry parses for this block (`Agent._parseDelegation`), runs the chosen sub-agent’s `process(task, context)`, and returns the combined reply to the user.

---

## Current behaviour

- **Agents** are discovered at startup from `workspace/agents/<name>/`. Each folder is one agent (SOUL.md + optional `skills/`).
- **Skills** are markdown files in `workspace/agents/<agent>/skills/*.md` or `workspace/shared/skills/*.md`. Shared skills are available to every agent.
- **Tools** (MCP, etc.) are configured separately; skills describe API/documentation the agent uses when reasoning.
- New or changed agents/skills are picked up only after a **restart** (`qclaw restart`), unless you add a reload hook (see below).

---

## 1. Users: creating a sub-agent by hand

**Step 1: Create the folder**

```bash
# From your QClaw project/data directory (where config lives)
mkdir -p workspace/agents/scout/skills
mkdir -p workspace/agents/scout/memory
```

**Step 2: Add SOUL.md**

Create `workspace/agents/scout/SOUL.md`:

```markdown
# Scout

## Identity
You are Scout, a research sub-agent.

## Purpose
Fast, focused research and fact-gathering. You report back to the main agent or user with structured findings.

## Personality
Concise, evidence-based. No fluff. Cite sources.

## Rules
- Follow the Trust Kernel (VALUES.md)
- Log actions to the audit trail
- When in doubt, ask for clarification
```

**Step 3: Add skills (optional)**

Drop one or more `.md` files in `workspace/agents/scout/skills/`, e.g. `web-research.md`:

```markdown
# Web Research

## Auth
Base URL: (none for public search)
Header: Authorization: Bearer {{secrets.brave_api_key}}

## Endpoints
GET (search) — use Brave Search API for factual queries.
```

**Step 4: Restart**

```bash
qclaw restart
```

The new agent appears in the dashboard (Agents tab) and in the chat agent selector. It uses the same model/router and memory as configured; you can later add per-agent model config if the codebase supports it.

---

## 2. Users: adding a skill to an existing agent

**Option A: One agent only**

- Put the skill file in that agent’s folder:
  - `workspace/agents/echo/skills/my-api.md`
- Restart (or use reload if implemented).

**Option B: All agents (shared)**

- Put the skill in the shared folder:
  - `workspace/shared/skills/my-api.md`
- Create the file with the same markdown structure (Auth, Endpoints, etc.).
- Restart (or use reload if implemented).

**Skill file minimum** (see [SKILLS.md](SKILLS.md)):

- `# Skill Name`
- `## Auth` (Base URL, Header with `{{secrets.key}}`)
- `## Endpoints` (method, path, short description)

Use `{{secrets.something}}` so the runtime resolves keys from the credential store.

---

## 3. Orchestrator (main PA): creating sub-agents and skills

The **orchestrator** (Echo / primary agent) does not today have built-in “create sub-agent” or “add skill” tools that the runtime recognises. It can still help in two ways:

**A) Tell the user exactly what to do**

- The main PA can output step-by-step instructions (folder paths, SOUL.md text, skill markdown).
- User creates the files (or runs CLI commands if you add them) and restarts.

**B) Use a file-writing tool (e.g. MCP Filesystem)**

- If the agent has access to an MCP filesystem (or similar) tool with access to the workspace:
  - It can create `workspace/agents/<name>/SOUL.md` and `workspace/agents/<name>/skills/<name>.md`.
- The runtime will **not** see the new agent or skill until the next **restart**.
- So the PA should say: “I’ve created Scout. Run **qclaw restart** so it’s loaded.”

To make this reliable:

- Ensure the filesystem tool’s workspace root is the QClaw data/config directory (so `workspace/agents/` exists).
- Optionally add a **reload** mechanism (see below) so the PA can ask the runtime to reload agents/skills without a full restart.

---

## 4. Making it easier: CLI and API

The following are **recommended** so both users and the orchestrator can create sub-agents and add skills easily.

### 4.1 CLI: `qclaw agent add`

- Interactive: ask for name, short purpose, optional “copy SOUL from: echo”.
- Create `workspace/agents/<name>/` and `skills/`, write a default SOUL.md.
- Print: “Agent <name> created. Run **qclaw restart** to load it.”

### 4.2 CLI: `qclaw skill add [agent-name]`

- Interactive: ask for agent (or “shared”), skill name, then paste or path to markdown.
- Write `workspace/agents/<agent>/skills/<name>.md` or `workspace/shared/skills/<name>.md`.
- Print: “Skill added. Run **qclaw restart** to load it.” (Or “Skill added and reloaded.” if reload exists.)

### 4.3 API: POST /api/agents (create agent)

- Body: `{ "name": "scout", "purpose": "Research sub-agent", "copySoulFrom": "echo" }`.
- Server creates the folder and SOUL.md (and optionally skills/).
- Returns 201 and message that restart is required (or triggers reload if implemented).

### 4.4 API: POST /api/skills (add skill)

- Body: `{ "agent": "scout", "name": "web-research", "content": "# Web Research\n\n## Auth\n..." }` or `agent: "shared"`.
- Server writes the file under `workspace/agents/<agent>/skills/` or `workspace/shared/skills/`.
- Returns 201 and message that restart is required (or triggers reload).

### 4.5 Reload without restart (optional)

- Add a **reload** step that:
  - Re-scans `workspace/agents/` and `workspace/shared/skills/`.
  - Rebuilds the in-memory agent registry and skill loader (or merges in new agents/skills).
- Expose via:
  - CLI: `qclaw reload` (or `qclaw agent reload`),
  - API: `POST /api/reload` (or `POST /api/agents/reload`).
- Then the PA (via MCP or API) can create a sub-agent or skill and call reload so the new agent/skill is available without a full process restart.

---

## 5. Summary

| Who            | Create sub-agent today              | Add skill today                          | Easier with |
|----------------|-------------------------------------|------------------------------------------|-------------|
| **User**       | Create folder + SOUL.md + restart   | Add .md in agent/skills or shared/skills + restart | `qclaw agent add`, `qclaw skill add` |
| **Orchestrator** | No built-in tool; can use MCP file write + tell user to restart | Same; can write .md via MCP + restart   | API + reload hook |

Implementing the CLI commands and optional API + reload will let users and the main PA easily create sub-agents and add skills/tools to them, with or without a full restart.
