#!/usr/bin/env python3
"""Generic interpose→parallel fix for Heartbeat: Start* nodes.

Bug class: Heartbeat: Start was wired serially between trigger and first
downstream node. n8n's Postgres `executeQuery` operation replaces the output
items with the query result row, so the original trigger payload (webhook
body / headers, Telegram message) was lost downstream — breaking any
workflow whose downstream nodes read from the trigger payload.

Fix: re-wire each `Heartbeat: Start*` node from interposed-serial to
parallel-branch off its upstream. Upstream now fans out to BOTH the
original first downstream AND the heartbeat. The heartbeat becomes an
empty-outgoing sink (side-effect only).

Idempotent: applying this script to a workflow that's already in the
fixed state is a no-op.
"""
import copy
import json
import sys


def find_incoming(wf, target_name):
    """Return list of (src_name, branch_idx, position_in_branch) for every edge
    pointing to target_name."""
    incoming = []
    for src, conn in wf.get("connections", {}).items():
        for branch_idx, branch in enumerate(conn.get("main", []) or []):
            for pos, c in enumerate(branch):
                if c.get("node") == target_name:
                    incoming.append((src, branch_idx, pos))
    return incoming


def is_already_fixed(wf, hb_name):
    """A heartbeat is already in the fixed state when it has no outgoing edges
    (it's a sink). If outgoing is non-empty, it's still serially interposed."""
    out = wf.get("connections", {}).get(hb_name, {}).get("main", [[]])
    return all(not branch for branch in out)


def fix_one(wf, hb_name):
    """Convert one Heartbeat: Start* from interposed-serial to parallel-branch.
    Returns (fixed: bool, action: str)."""
    if not any(n["name"] == hb_name for n in wf.get("nodes", [])):
        return False, f"node {hb_name!r} not found"

    if is_already_fixed(wf, hb_name):
        return False, f"{hb_name!r} already fixed (no outgoing edges)"

    # What does the heartbeat currently feed (this is what its UPSTREAM should
    # have been feeding originally)?
    hb_outgoing = wf["connections"][hb_name].get("main", [[]])
    original_downstream = []
    for branch in hb_outgoing:
        original_downstream.extend(branch)

    # Find the upstream that points to this heartbeat. Should be exactly one
    # — the trigger node.
    incoming = find_incoming(wf, hb_name)
    if len(incoming) != 1:
        return False, f"{hb_name!r} has {len(incoming)} incoming edges, expected 1"

    upstream, upstream_branch, _pos = incoming[0]

    # Replace the upstream's edge to hb_name with the original_downstream items
    # PLUS hb_name added at the end (parallel sibling).
    upstream_branch_list = wf["connections"][upstream]["main"][upstream_branch]
    new_branch = []
    for c in upstream_branch_list:
        if c.get("node") == hb_name:
            # expand to original_downstream
            new_branch.extend(original_downstream)
        else:
            new_branch.append(c)
    new_branch.append({"node": hb_name, "type": "main", "index": 0})
    wf["connections"][upstream]["main"][upstream_branch] = new_branch

    # Heartbeat is now a sink (empty outgoing).
    wf["connections"][hb_name] = {"main": [[]]}

    return True, f"rewired {upstream!r} → [{', '.join(repr(c['node']) for c in original_downstream)}, {hb_name!r}]"


def fix_workflow(wf):
    """Fix every node whose name starts with 'Heartbeat: Start' in this workflow.
    Returns list of (hb_name, fixed, action)."""
    results = []
    hb_names = [n["name"] for n in wf.get("nodes", []) if n["name"].startswith("Heartbeat: Start")]
    for hb_name in hb_names:
        fixed, action = fix_one(wf, hb_name)
        results.append((hb_name, fixed, action))
    return results


# Settings whitelist for PUT body — same as b_common.trim_for_put
_ALLOWED_SETTINGS_KEYS = {
    "executionOrder", "saveDataSuccessExecution", "saveDataErrorExecution",
    "saveExecutionProgress", "saveManualExecutions", "callerPolicy",
    "errorWorkflow", "timezone", "executionTimeout", "availableInMCP",
}


def trim_for_put(wf):
    raw = wf.get("settings") or {"executionOrder": "v1"}
    settings = {k: v for k, v in raw.items() if k in _ALLOWED_SETTINGS_KEYS}
    return {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": settings,
    }


if __name__ == "__main__":
    src = sys.argv[1]
    wf = json.load(open(src))
    print(f"=== fixing {wf.get('name')!r} (id={wf.get('id')}) ===")
    results = fix_workflow(wf)
    for hb_name, fixed, action in results:
        prefix = "✓" if fixed else "·"
        print(f"  {prefix} {hb_name!r}: {action}")
    out = src.replace(".live.json", ".fixed.json")
    json.dump(trim_for_put(wf), open(out, "w"), indent=2)
    print(f"  wrote {out}")
