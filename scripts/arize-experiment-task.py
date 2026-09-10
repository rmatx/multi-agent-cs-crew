"""
Experiment task: replay one run-sheet scenario against the DEPLOYED crew.

    ax experiments run --name <name> \
        --dataset RGF0YXNldDozNjQ1ODc6bnZZNg== \
        --task scripts/arize-experiment-task.py --concurrency 2

Each dataset row carries the question, the identity and the LABELS the run sheet asserts
(expected_status / expected_agent / expected_tools). This returns what the crew ACTUALLY did, so
the comparison is a real regression check rather than a vibe: the run sheet a reviewer downloads
is the same file that produced the labels.

WHY A COOKIE. `/api/chat` picks its engine per request — the crew only for a caller that came
through the reviewer gate, otherwise the keyless deterministic engine (server/runtime/demoGate.ts).
The gate proof is a SHA-256 of the password under a versioned label, so it is derived here rather
than scraped from a browser session. The password itself comes from the environment and is never
written down:

    FINAL_DEMO_PASSWORD=… ax experiments run …

Without it every row would silently run the deterministic engine and the experiment would measure
the wrong system while looking perfectly healthy.
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.request

BASE = os.environ.get("NOVAMART_BASE", "https://multi-agent-cs-crew-production.up.railway.app")
GATE_LABEL = "novamart-reviewer-gate-v1:"          # must match server/runtime/demoGate.ts
GATE_COOKIE = "novamart_reviewer"

_password = os.environ.get("FINAL_DEMO_PASSWORD", "").strip()
if not _password:
    raise SystemExit("FINAL_DEMO_PASSWORD is required, or every row runs the keyless engine")
_token = hashlib.sha256(f"{GATE_LABEL}{_password}".encode()).hexdigest()


def _identity(row: dict) -> dict:
    """Only send ids that the scenario actually has — an empty string is not an order id."""
    out: dict[str, int] = {}
    for src, dst in (("order_id", "orderId"), ("user_id", "userId")):
        raw = str(row.get(src) or "").strip()
        if raw:
            out[dst] = int(raw)
    return out


def task(dataset_row: dict) -> dict:
    row = dataset_row.get("additional_properties") or dataset_row

    body = json.dumps({
        "message": row["message"],
        "identity": _identity(row),
        # Trace on: agent identity and tool calls only reach the client on trace frames, and
        # without them there is nothing to compare against expected_agent / expected_tools.
        "clientFlags": {"trace": True},
    }).encode()

    req = urllib.request.Request(
        f"{BASE}/api/chat",
        data=body,
        headers={"content-type": "application/json", "cookie": f"{GATE_COOKIE}={_token}"},
    )

    frames = []
    engine = None
    with urllib.request.urlopen(req, timeout=240) as resp:
        engine = resp.headers.get("x-novamart-engine")
        for line in resp:
            text = line.decode("utf-8", "replace").strip()
            if text.startswith("data:"):
                try:
                    frames.append(json.loads(text[5:].strip()))
                except json.JSONDecodeError:
                    pass

    hops = [f["agentId"] for f in frames if f.get("type") == "agent_hop"]
    tools = [f["tool"].replace("mcp__novamart__", "") for f in frames if f.get("type") == "tool_call"]
    done = next((f for f in frames if f.get("type") == "done"), None)
    esc = next((f for f in frames if f.get("type") == "escalation"), None)

    status = done.get("status") if done else "no_terminal_frame"
    # No hop means the coordinator answered it itself — a real outcome, not a missing value.
    chain = hops or ["triage-router"]
    agent_final = chain[-1]

    """
    Agent match is membership in the CHAIN, not equality with the last hop, because that is what
    the run sheet's label means. It records the SPECIALIST that owned the turn: `return-boundary`
    is labelled `returns-advisor` and really does run returns-advisor → escalation-handoff. Scoring
    it against the last hop marked two correct escalations as failures and would have reported
    7/10 for a system that had actually done the right thing 9 times.
    """
    agent_hit = row.get("expected_agent") in chain

    return {
        "engine": engine,
        "status": status,
        "agent_final": agent_final,
        "agent_chain": " → ".join(chain),
        "tools": ",".join(tools),
        "ticket": (esc or {}).get("ticketStubId", ""),
        "reason_code": (esc or {}).get("reasonCode", ""),
        # Scored against the labels the run sheet asserts.
        "status_match": status == row.get("expected_status"),
        "agent_match": agent_hit,
        "expected_status": row.get("expected_status"),
        "expected_agent": row.get("expected_agent"),
        "scenario_id": row.get("scenario_id"),
        "title": row.get("title"),
    }
