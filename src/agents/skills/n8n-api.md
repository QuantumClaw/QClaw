---
name: n8n-api
category: on-demand
surface: both
keywords: [n8n, workflow, webhook]
description: n8n REST API — list workflows, inspect node configs, query execution history for diagnostics
---

# n8n API

## Auth
Base URL: https://webhook.flowos.tech/api/v1
Header: X-N8N-API-KEY: {{secrets.n8n_api_key}}

## Endpoints
GET /workflows?limit=200 - List all n8n workflows (find any workflow by scanning this list)
GET /workflows/{{id}} - Get details of one workflow by ID (nodes, connections, active state)
GET /executions/{{id}} - Get full details of a single execution (error messages, node outputs)
GET /executions?workflowId={{workflow_id}} - List recent executions for a workflow
GET /executions?workflowId={{workflow_id}}&status={{status}} - Filter executions by status (success, error, waiting)

## Permissions
- http: [webhook.flowos.tech]
- shell: none
- file: none

## Diagnostic approach
When asked about ANY n8n workflow:
1. Use get_workflows_limit_200 to list all workflows and find the one you need by name
2. Use get_workflows_id with the workflow's ID to inspect its nodes
3. Use get_executions_workflowid_workflow_id_status_status with status=error to find recent failures
4. Use get_executions_id on a failing execution to see the exact error message
5. Map the failing node type to a likely cause:
   - Anthropic / Claude nodes → credits exhausted
   - Instagram / Facebook nodes → IG_ACCESS_TOKEN expired
   - R2 / Cloudflare URL → file missing or wrong path (404)
   - Google Sheets → OAuth expired
   - Blotato → API key invalid
   - Postgres / Supabase → DB credentials issue
   - scheduleTrigger not firing → workflow deactivated or n8n down

## Usage Notes
- NEVER say "I don't have access to that workflow" — always call get_workflows first
- Workflow IDs are short alphanumeric strings from n8n URLs (e.g. 44g7cbGz5osQ1pcBVhIoz)
- n8n runs at https://webhook.flowos.tech — never localhost from qclaw
- Dispatched task bodies may include a workflow ID directly; otherwise find by name
