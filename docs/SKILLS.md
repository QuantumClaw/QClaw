# Writing Skills

Skills are how your agent learns to use new tools. They're markdown files. No code. No manifests. No package managers.

## How Skills Work

When your agent needs to do something (send an email, check a calendar, query a database), it reads the relevant `SKILL.md` file. That file tells it what endpoints to hit, what auth to use, what the response format looks like, and any quirks to watch out for.

Your agent reads markdown the way you'd read documentation.

## Skill File Structure

Create a folder in `workspace/skills/your-skill/` with a `SKILL.md` file:

```
workspace/
  skills/
    google-calendar/
      SKILL.md
    stripe-payments/
      SKILL.md
    custom-crm/
      SKILL.md
```

## SKILL.md Format

```markdown
# Google Calendar

Read and manage calendar events.

## Auth

- Type: OAuth2 / Bearer token
- Key: `{{secrets.google_api_key}}`
- Base URL: `https://www.googleapis.com/calendar/v3`

## Endpoints

### List Events
- GET `/calendars/{calendarId}/events`
- Query params: `timeMin`, `timeMax`, `maxResults`, `orderBy`
- Response: `{ items: [{ summary, start, end, description }] }`

### Create Event
- POST `/calendars/{calendarId}/events`
- Body: `{ summary, start: { dateTime }, end: { dateTime }, description }`

## Quirks

- DateTime must be RFC3339 with timezone: `2026-02-19T09:00:00Z`
- Primary calendar ID is literally the string `primary`
- Max 250 results per page, use `pageToken` for pagination

## Examples

To get today's events:
GET /calendars/primary/events?timeMin=2026-02-19T00:00:00Z&timeMax=2026-02-19T23:59:59Z&orderBy=startTime&singleEvents=true
```

## Key Sections

- **Auth**: What credentials are needed. Use `{{secrets.key_name}}` to reference encrypted secrets.
- **Endpoints**: What the agent can call. Method, path, params, response shape.
- **Quirks**: The stuff that isn't obvious. Date formats, pagination, rate limits, undocumented behaviour.
- **Examples**: Concrete calls the agent can reference.

## Permission Detection

QuantumClaw scans skill files for permission keywords:

- `file`, `read`, `write`, `delete` → filesystem permissions
- `http`, `fetch`, `api`, `endpoint` → network permissions
- `exec`, `command`, `shell`, `bash` → execution permissions
- `database`, `sql`, `query` → database permissions

These are checked against the Trust Kernel (VALUES.md). If a skill needs permissions the Trust Kernel denies, it won't load.

## Built-In vs Custom Skills

**Built-in skills** ship with QuantumClaw in `src/skills/`. You don't touch these.

**Custom skills** live in `workspace/skills/`. These are yours. Drop a folder with a SKILL.md and it's available immediately, no restart needed.

## Sharing Skills

Built something useful? Submit it:

1. Test it with your agent
2. Make sure auth uses `{{secrets.key_name}}` (no hardcoded keys)
3. Open a [skill submission](https://github.com/QuantumClaw/QClaw/issues/new?template=skill_submission.md) on GitHub
4. Or submit a PR adding it to `workspace/shared/skills/`

## Tips

- Keep skills focused. One service per skill.
- Document the quirks. That's the most valuable part.
- Include error responses so your agent knows what failure looks like.
- Use `## Quirks` liberally. Every API has them.
- Your agent can read API docs and write skills itself. Ask it to.
