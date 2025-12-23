# Dynamic Agent Refactor Plan

Goal: make the agent adaptive—select next probes based on findings, loop until a stop condition, then report with a rich trace.

## Minimal scope
- Keep probes deterministic and safe (no exploit payloads).
- Add a dispatch loop: `probe -> cortex -> decision` repeated until report or budget reached.
- Cortex chooses next tool (from an allowlist) based on recent observations and remaining budget.

## Data contract changes
- **Cortex output JSON**: `{ decision: "probe"|"report", next_tool?: string, next_args?: object, thought, hypothesis, owasp_category, confidence_0_1, observation_ref }`
- **State additions**: visited endpoints, remaining budget, last_tool, last_error (optional).
- **Trace**: record `decision` and `next_tool` per hop.

## Graph changes
1) Add a **dispatch node** that maps `next_tool` to a tool function; default to a small safe probe if missing.
2) Loop edges: `START -> dispatch -> cortex -> (dispatch | report) -> END`.
3) Stop conditions: budget exhausted, max hops (e.g., 8), or `decision === "report"`.

## Tool catalog (safe)
- `http_get`: args `{ path, label? }`
- `http_post`: args `{ path, body, label? }`
- `inspect_headers`: args `{ path }`
- `provoke_error`: args `{ path }`
- `measure_timing`: args `{ path, control, test }`

## Prompt tweaks
- Instruct Cortex to pick `next_tool` + `next_args` from the allowlist.
- Remind: raw JSON only, no fences, no exploit payloads.
- Require citing `observation_ref` from inputs and respect remaining budget/hops.

## Coverage/avoid repeats
- Track visited paths; Cortex should prefer unvisited routes unless following up an error.
- Allow repeat only for purposeful follow-up (e.g., after a 500).

## Reporting/trace
- Include per-hop decisions, chosen tools, and stop reason (report, budget, max hops).
- Keep existing metrics; add `hops` and `stopReason`.

## Implementation steps
1) Update Cortex output schema and prompt to emit `next_tool`, `next_args`.
2) Add dispatch node mapping tool names to functions; validate args; default fallback tool if absent.
3) Rewire graph for looping and stop conditions (budget/max hops).
4) Extend trace to log per-hop decisions and stop reason.
5) Test locally (Docker agent) to ensure valid JSON and loop termination.
