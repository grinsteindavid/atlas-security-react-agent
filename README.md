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
- Emits timestamped traces under `traces/trace-<runId>.json` (gitignored) with: run metadata (target, start/end), nodes visited, request budget used/max, observations, reasoning log, tool metrics, and LLM meta (attempts/fallback).

### Sample trace (excerpt)
```json
{
  "run_id": "2025-12-23T15-35-30-289Z",
  "target": "http://juice-shop:3000",
  "observations": [
    {
      "tool": "httpGet",
      "label": "adminPage",
      "url": "http://juice-shop:3000/#/administration",
      "status": 200,
      "latencyMs": 7
    },
    {
      "tool": "httpPost",
      "label": "feedbackProbe",
      "url": "http://juice-shop:3000/api/Feedbacks",
      "status": 500,
      "note": "json"
    }
  ],
  "reasoningLog": [
    {
      "owasp_category": "A1: Injection",
      "observation_ref": "httpPost-…",
      "confidence_0_1": 0.8
    }
  ],
  "metrics": { "requests": 6, "perTool": { "httpGet": 3, "httpPost": 1, "inspectHeaders": 1, "provokeError": 1 } },
  "llmMeta": { "attempts": 2, "usedFallback": false }
}
```

## Safety & scope
- Target allowlist (env), max requests per run, per-request timeout, crawl depth limit.
- Redact large bodies; cap captured bytes (e.g., 2 KB).
- Deterministic tools only; no generated payloads.

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- OpenAI API key

### Option 1: Docker (Recommended)

1. **Clone and setup environment**
   ```bash
   git clone <repo-url>
   cd atlas-security-react-agent
   cp .env.example .env  # or create .env manually
   ```

2. **Configure `.env`**
   ```
   TARGET_URL=http://juice-shop:3000
   OPENAI_API_KEY=sk-your-key-here
   MAX_REQ_PER_RUN=80
   MAX_HOPS=40
   REQ_TIMEOUT_MS=5000
   WAIT_FOR_TARGET_MS=30000
   ```

3. **Run with Docker Compose**
   ```bash
   docker compose up --build
   ```
   This starts both Juice Shop (target) and the ATLAS agent.

4. **View results**
   ```bash
   ls traces/
   cat traces/trace-*.json | jq .
   ```

### Option 2: Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start Juice Shop separately** (in another terminal)
   ```bash
   docker run -d -p 3000:3000 bkimminich/juice-shop
   ```

3. **Configure `.env` for local**
   ```
   TARGET_URL=http://localhost:3000
   OPENAI_API_KEY=sk-your-key-here
   ```

4. **Run the agent**
   ```bash
   npm run dev
   ```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET_URL` | `http://juice-shop:3000` | Target web application URL |
| `OPENAI_API_KEY` | — | Required for LLM reasoning |
| `MAX_REQ_PER_RUN` | `80` | Max HTTP requests per run |
| `MAX_HOPS` | `8` | Max reasoning iterations |
| `REQ_TIMEOUT_MS` | `5000` | Per-request timeout |
| `WAIT_FOR_TARGET_MS` | `0` | Wait for target availability |
| `MAX_HITS_PER_PATH` | `2` | Max hits per unique path |

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