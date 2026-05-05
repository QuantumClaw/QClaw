"""Shared helpers for Sub-project B batch builders + ongoing n8n workflow tooling.

Heartbeat-node template + graph rewriting helpers. Plain string concatenation only —
NEVER use .format() or f-strings to template SQL containing n8n's {{ ... }} expressions
(both collapse `{{` to `{` and break interpolation; learned in Batch 0/1).

CRITICAL — Heartbeat: Start wiring (post-2026-05-05 regression fix):
n8n's Postgres `executeQuery` operation REPLACES the output items with the SQL
query result row. If a Heartbeat: Start is wired serially between trigger and
first downstream (i.e., trigger -> heartbeat -> work), the trigger payload
(webhook headers/body, Telegram message) is LOST and downstream nodes that
read $json fail. ALWAYS use parallel_branch_off() to wire trigger-fed Start
heartbeats. The pre-PUT validator validate_start_heartbeats_are_parallel()
fails closed on any Heartbeat: Start* node with non-empty outgoing edges.

Cited incident: 2026-05-05 16:43 - 18:46 UTC, Morning Light WL→HL pipeline
broken in production for ~5 hours, ~6,500 failed executions on a paying
client integration. See QCLAW_BUILD_LOG.md.
"""
import copy

PG_CRED = {"id": "qGUxEHfEZkZGdAcZ", "name": "Supabase Postgres DB"}

WF_ID_EXPR = "'" + "{{ $workflow.id }}" + "'::text"
EXEC_ID_EXPR = "'" + "{{ $execution.id }}" + "'::text"


def _q(status, wf_name, meta_js=None):
    """Build a record_heartbeat() SQL statement for an n8n Postgres node.

    status: 'started' | 'success' | 'error' | 'partial'
    wf_name: hardcoded workflow display name
    meta_js: optional inline n8n JS expression body for metadata jsonb arg
             (the JSON.stringify wrapper is added here)

    Returns SQL with proper {{ ... }} expression markers preserved.
    """
    parts = [
        "select public.record_heartbeat(",
        WF_ID_EXPR, ", ",
        "'" + status + "'::text, ",
        "'" + wf_name + "'::text, ",
        EXEC_ID_EXPR,
    ]
    if meta_js:
        parts.append(", '" + "{{ JSON.stringify(" + meta_js + ") }}" + "'::jsonb")
    parts.append(");")
    return "".join(parts)


def heartbeat_node(name, query, position, continue_on_fail=True):
    """A Postgres heartbeat node — always continueOnFail=true, always retry 2× / 2s."""
    return {
        "parameters": {
            "operation": "executeQuery",
            "query": query,
            "options": {},
        },
        "name": name,
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.6,
        "position": list(position),
        "credentials": {"postgres": copy.deepcopy(PG_CRED)},
        "continueOnFail": continue_on_fail,
        "retryOnFail": True,
        "maxTries": 2,
        "waitBetweenTries": 2000,
    }


# --- Graph rewriting helpers ---

def remove_node(wf, name):
    """Remove a node from nodes list and from connections (both as src and dst).
    WARNING: does not preserve transitive paths; use replace_node() if old_name had
    both incoming AND outgoing edges that need to be inherited."""
    wf["nodes"] = [n for n in wf["nodes"] if n["name"] != name]
    if name in wf.get("connections", {}):
        del wf["connections"][name]
    for src, conn in wf.get("connections", {}).items():
        for branch in conn.get("main", []):
            branch[:] = [c for c in branch if c.get("node") != name]


def insert_after(wf, src_node, new_node, branch_idx=0):
    """Interpose new_node between src_node and src_node's current downstream on
    branch_idx. new_node inherits src_node[branch_idx]'s outgoing edges; src_node
    now points only to new_node on that branch.

    DO NOT USE FOR HEARTBEAT: START NODES WIRED OFF A TRIGGER. Postgres
    `executeQuery` replaces the output items with the SQL query result row, so
    interposing a heartbeat between trigger and first work-node loses the
    trigger payload. Use parallel_branch_off() instead. The pre-PUT validator
    validate_start_heartbeats_are_parallel() fails closed on this misuse.
    """
    src_conns = wf["connections"].setdefault(src_node, {"main": []})["main"]
    while len(src_conns) <= branch_idx:
        src_conns.append([])
    existing_outs = src_conns[branch_idx]
    if existing_outs:
        wf["connections"].setdefault(new_node["name"], {"main": [[]]})
        wf["connections"][new_node["name"]]["main"][0] = list(existing_outs)
    src_conns[branch_idx] = [{"node": new_node["name"], "type": "main", "index": 0}]


def append_after(wf, src_node, new_node, branch_idx=0):
    """Add new_node as an additional downstream of src_node[branch_idx], without
    redirecting existing connections. Safe for terminal-side Success/Error
    heartbeats (no payload-replacement issue downstream)."""
    src_conns = wf["connections"].setdefault(src_node, {"main": []})["main"]
    while len(src_conns) <= branch_idx:
        src_conns.append([])
    src_conns[branch_idx].append({"node": new_node["name"], "type": "main", "index": 0})


def parallel_branch_off(wf, trigger_node, hb_node, branch_idx=0):
    """Wire a Heartbeat: Start* node as a PARALLEL SIBLING off the trigger,
    not interposed. Trigger fans out to BOTH (a) the original first downstream
    nodes and (b) the heartbeat. The heartbeat is a sink — empty outgoing.

    Use this for every Heartbeat: Start* added off a trigger node. Replaces
    the previous (broken) insert_after pattern.

    Idempotent: if the heartbeat is already a parallel sibling sink, no-op.
    """
    hb_name = hb_node["name"]
    if not any(n["name"] == hb_name for n in wf.get("nodes", [])):
        wf.setdefault("nodes", []).append(hb_node)

    src_conns = wf.setdefault("connections", {}).setdefault(trigger_node, {"main": []})["main"]
    while len(src_conns) <= branch_idx:
        src_conns.append([])
    branch = src_conns[branch_idx]

    # Add heartbeat to trigger's outgoing if not already there.
    if not any(c.get("node") == hb_name for c in branch):
        branch.append({"node": hb_name, "type": "main", "index": 0})

    # Heartbeat is a sink (empty outgoing).
    wf["connections"][hb_name] = {"main": [[]]}


def replace_node(wf, old_name, new_node):
    """Surgical drop-in replacement: capture old_name's incoming + outgoing edges,
    splice new_node in at the same graph position, then remove old_name. Critical
    for mid-graph swaps where remove_node() would orphan the downstream."""
    incoming = []
    for src, conn in wf.get("connections", {}).items():
        for branch_idx, branch in enumerate(conn.get("main", [])):
            for c in branch:
                if c.get("node") == old_name:
                    incoming.append((src, branch_idx))
    outgoing = wf.get("connections", {}).get(old_name, {"main": [[]]}).get("main", [[]])
    wf["nodes"] = [n for n in wf["nodes"] if n["name"] != old_name]
    if old_name in wf.get("connections", {}):
        del wf["connections"][old_name]
    for src, branch_idx in incoming:
        branch = wf["connections"][src]["main"][branch_idx]
        wf["connections"][src]["main"][branch_idx] = [c for c in branch if c.get("node") != old_name]
    if not any(n["name"] == new_node["name"] for n in wf["nodes"]):
        wf["nodes"].append(new_node)
    for src, branch_idx in incoming:
        wf["connections"][src]["main"][branch_idx].append(
            {"node": new_node["name"], "type": "main", "index": 0}
        )
    if any(branch for branch in outgoing):
        wf["connections"][new_node["name"]] = {"main": [list(b) for b in outgoing]}


def get_node_pos(wf, name):
    for n in wf["nodes"]:
        if n["name"] == name:
            return tuple(n.get("position", [0, 0]))
    return (0, 0)


def offset(pos, dx, dy):
    return [pos[0] + dx, pos[1] + dy]


# --- Settings whitelist for PUT body ---

# n8n's PUT API rejects unknown settings keys (additionalProperties:false).
# Add new keys here as they surface; never just pass settings verbatim.
_ALLOWED_SETTINGS_KEYS = {
    "executionOrder",
    "saveDataSuccessExecution",
    "saveDataErrorExecution",
    "saveExecutionProgress",
    "saveManualExecutions",
    "callerPolicy",
    "errorWorkflow",
    "timezone",
    "executionTimeout",
    "availableInMCP",
}


def trim_for_put(wf):
    """n8n PUT body limited to {name, nodes, connections, settings}, AND `settings`
    is itself filtered to only the known-allowed keys."""
    raw = wf.get("settings") or {"executionOrder": "v1"}
    settings = {k: v for k, v in raw.items() if k in _ALLOWED_SETTINGS_KEYS}
    return {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": settings,
    }


# --- Pre-PUT validators ---

def validate_no_orphans(wf, tag=""):
    """Sanity check: every node must be reachable from connections, except the trigger
    which sits at the entry. Returns list of orphan node names."""
    all_names = {n["name"] for n in wf["nodes"]}
    referenced = set(wf.get("connections", {}).keys())
    for src, conn in wf.get("connections", {}).items():
        for branch in conn.get("main", []):
            for c in branch:
                referenced.add(c["node"])
    return sorted(all_names - referenced)


def validate_no_brace_collapse(wf, tag=""):
    """Sanity check: every Postgres heartbeat node SQL must contain `{{ $workflow.id }}`
    and `{{ $execution.id }}` (double-brace, n8n expression syntax preserved). Returns
    list of node names whose SQL has collapsed braces."""
    bad = []
    for n in wf.get("nodes", []):
        if n.get("type") != "n8n-nodes-base.postgres":
            continue
        if not n.get("name", "").startswith("Heartbeat"):
            continue
        q = n.get("parameters", {}).get("query", "")
        if "{{ $workflow.id }}" not in q or "{{ $execution.id }}" not in q:
            bad.append(n["name"])
    return bad


def validate_start_heartbeats_are_parallel(wf, tag=""):
    """Fail-closed validator for the 2026-05-05 regression class.

    Every node whose name starts with `Heartbeat: Start` MUST be wired as a
    parallel-branch sink — empty outgoing edges. If any has non-empty outgoing
    edges, it's still serially interposed between trigger and first downstream,
    which means n8n's Postgres `executeQuery` will replace the trigger payload
    and downstream nodes that read $json will fail.

    Returns a list of (node_name, downstream_targets) tuples for nodes that
    fail the check. Empty list = clean.
    """
    bad = []
    for n in wf.get("nodes", []):
        name = n.get("name", "")
        if not name.startswith("Heartbeat: Start"):
            continue
        outs = wf.get("connections", {}).get(name, {}).get("main", [])
        downstream = []
        for branch in outs:
            for c in branch:
                downstream.append(c.get("node"))
        if downstream:
            bad.append((name, downstream))
    return bad


def validate_all(wf, tag=""):
    """Run every validator. Returns dict of {check_name: failures}.
    A clean workflow returns all-empty values."""
    return {
        "orphans": validate_no_orphans(wf, tag),
        "brace_collapse": validate_no_brace_collapse(wf, tag),
        "start_heartbeats_serial": validate_start_heartbeats_are_parallel(wf, tag),
    }


def assert_clean_for_put(wf, tag=""):
    """Raise on any validator failure. Use as a hard gate before any PUT."""
    results = validate_all(wf, tag)
    failures = {k: v for k, v in results.items() if v}
    if failures:
        msg = f"validators failed for {tag!r}:"
        for k, v in failures.items():
            msg += f"\n  {k}: {v}"
        raise AssertionError(msg)
