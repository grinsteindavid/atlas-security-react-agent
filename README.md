# ATLAS (Adversarial Thought & Logic Analysis System)

Lean MVP to learn attacker thinking with a deterministic ReAct loop over OWASP Juice Shop (or a mock target). Built with LangGraphJS + OpenAI.

## Vision
- Simulate attacker cognition (Reason → Act → Observe).
- Prioritize hypothesis generation and evidence over exploit delivery.
- Produce a clear cognition trace for review and learning.

## Architecture (ReAct, LangGraph StateGraph)
- **Nodes**:
  - Cortex (LLM reasoning, GPT-4o-mini, temp 0).
  - Senses (deterministic tools; no LLM-generated payloads).
  - Reporter (final trace).
- **State**:
  - `observations[]`: raw HTTP responses/headers (truncated, redacted if needed).
  - `reasoningLog[]`: `{thought, hypothesis, owasp_category, confidence_0_1, observation_ref, timestamp}`.
  - `decision`: `probe` or `report`.

## Tools (deterministic)
1. `httpGet` — crawl breadth-first (depth/host capped), capture headers/body snippet, cookie jar.
2. `httpPost` — json/form with cookie jar; mild schema deviations allowed.
3. `inspectHeaders` — CSP, HSTS, CORS, cache headers.
4. `provokeError` — malformed JSON to elicit verbose errors (non-exploit).
5. `measureTiming` — control vs test payload timing deltas.

## Reasoning node (Cortex)
- Input: latest observations.
- Output: strict JSON with OWASP mapping; reject/retry if invalid JSON or missing category.
- Guardrails: no exploit payload suggestions; must cite `observation_ref`; confidence 0–1.

## Reporter
- Emits `reasoning_trace.json` with run metadata (target, start/end, tool calls) and findings: `{owasp_category, evidence, severity_guess, suggested_next_probe?, observation_ref}`.

## Safety & scope
- Target allowlist (env), max requests per run, per-request timeout, crawl depth limit.
- Redact large bodies; cap captured bytes (e.g., 2 KB).
- Deterministic tools only; no generated payloads.

## Local dev (Docker-first)
Use a simple `docker-compose.yml`:
- `juice-shop`: exposed on `3000`.
- `atlas-agent`: Node 18+, depends_on juice-shop, connects to `http://juice-shop:3000`.

Env (.env):
```
TARGET_URL=http://juice-shop:3000
OPENAI_API_KEY=...
MAX_REQ_PER_RUN=80
REQ_TIMEOUT_MS=5000
```

Commands (after packages are added):
```
docker compose up --build
docker compose run atlas-agent pnpm dev   # or npm run dev
```

## MVP flow (attacker-first steps)
1) Recon GETs: `/`, robots, assets → note titles/forms/scripts/headers.  
2) Session surface: observe Set-Cookie flags; reuse cookies.  
3) Auth probing: POST benign creds; compare timing vs malformed.  
4) Reflection/error pokes: harmless noisy params + malformed JSON.  
5) Header audit: CSP/HSTS/CORS/cache.  
6) Unauth access checks: obvious protected routes/APIs.  
7) Light state-change pokes: near-valid bodies to test validation.  
8) Timing control/test pairs.

## Expected Juice Shop signals (easy wins)
- Missing/weak HSTS & CSP.
- Verbose error responses on malformed JSON.
- Reflected input in pages or API error bodies.
- Unauth access to some API routes/assets.
- Timing variance on auth endpoints (possible user-enum hint).

## Coding roadmap
1. Init Node project; add `@langchain/langgraph`, `@langchain/openai`, `axios`, `tough-cookie`.  
2. Implement tools with cookie jar, timeout, rate limit, and depth caps.  
3. Build cortex prompt + JSON schema validation + retry on invalid output.  
4. Wire StateGraph: start → probe (tools) → cortex → decision (probe/report) → reporter.  
5. Add mock mode (recorded fixtures) for deterministic runs; default to Juice Shop for manual.  
6. Run and review `reasoning_trace.json`; iterate on prompt and tool coverage.

## Code structure (JS + JSDoc)
- `src/config.js` — env/limits constants.  
- `src/state.js` — state helpers for observations/logs.  
- `src/httpClient.js` — axios client with cookie jar, body snippet helper.  
- `src/tools.js` — deterministic tools (GET/POST/header audit/error provoke/timing), budget guard.  
- `src/cortex.js` — reasoning node (OpenAI when key present, stub fallback).  
- `src/reporter.js` — write `reasoning_trace.json`.  
- `src/graph.js` — StateGraph wiring nodes.  
- `src/index.js` — entrypoint to run once.