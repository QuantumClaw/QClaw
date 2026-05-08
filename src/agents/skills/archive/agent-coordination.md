---
name: agent-coordination
category: archive
surface: prompt
description: Sub-agent coordination via Echo audit log queries and task assignment (folds into delegation.md in Slice 2b)
---

# Agent Coordination

## Purpose
Query and coordinate sub-agents (currently: Echo)

## Capabilities

### Query Echo's Activity
- Read Echo's recent actions from audit trail
- Check Echo's current task status
- Review Echo's memory for context

### Task Assignment
- Assign structured tasks to Echo
- Set success criteria and deadlines
- Provide necessary context

### Status Aggregation
- Collect completion reports from Echo
- Aggregate multi-agent activity
- Generate strategic summaries

## Endpoints

### Local Agent Query
```bash
# View Echo's recent audit log
cat ~/.quantumclaw/workspace/agents/echo/memory/audit.log | tail -n 50

# Check Echo's memory state
ls -la ~/.quantumclaw/workspace/agents/echo/memory/

# View agent registry
cat ~/.quantumclaw/workspace/agents.json
```

## Permissions
- file: Read all agent directories
- file: Write to own coordination logs
- shell: Limited to agent query commands

## Protocol

### Assigning Tasks to Echo
1. Define clear objective
2. Specify success criteria
3. Set escalation triggers
4. Log assignment to audit trail

### Reviewing Echo's Work
1. Query relevant audit entries
2. Verify completion against criteria
3. Extract insights for strategic use
4. Acknowledge or request refinement

## Source
Created for Charlie's strategic coordination role. Reviewed: true
