# ATLAS (Adversarial Thought & Logic Analysis System)

A security reconnaissance agent that **learns attacker thinking** through hypothesis-driven exploration. Built with LangGraph StateGraph + OpenAI, targeting OWASP Juice Shop as a practice environment.

## Project Intent

ATLAS is an **educational tool** designed to:

1. **Learn attacker cognition** — Model the Hypothesize → Plan → Act → Evaluate cycle
2. **Generate evidence, not exploits** — Observe and document, never attack
3. **Produce learning artifacts** — Clear reasoning traces for review and study

The agent forms security hypotheses, gathers evidence through safe reconnaissance, and outputs structured findings mapped to OWASP categories.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LangGraph StateGraph                  │
│                                                         │
│   ┌─────────┐     ┌─────────┐     ┌──────────┐        │
│   │  Probe  │────▶│ Cortex  │────▶│ Reporter │        │
│   │ (Tools) │◀────│  (LLM)  │     │ (Trace)  │        │
│   └─────────┘     └─────────┘     └──────────┘        │
│        │                │                              │
│        ▼                ▼                              │
│   Parallel HTTP    Hypothesis-First                    │
│   Execution        Reasoning                           │
└─────────────────────────────────────────────────────────┘
```

### Nodes

| Node | Purpose |
|------|---------|
| **Probe** | Executes 1-5 tools in parallel per hop |
| **Cortex** | LLM reasoning (GPT-4o-mini, temp 0) with hypothesis-first prompting |
| **Reporter** | Writes structured trace with findings and OWASP mappings |

### Reasoning Cycle (ReAct)

1. **Hypothesize** — What vulnerability might exist? Map to OWASP category
2. **Plan** — Which tools would provide evidence for/against?
3. **Act** — Execute tools (batch, parallel)
4. **Evaluate** — Adjust confidence based on results

### Confidence Calibration

| Level | Range | Meaning |
|-------|-------|---------|
| Speculation | 0.1–0.3 | Pattern suggests possibility, no evidence |
| Indirect | 0.4–0.6 | Circumstantial evidence (e.g., 401 response) |
| Direct | 0.7–0.9 | Clear evidence (e.g., stack trace, data leak) |

---

## Tools (Deterministic)

| Tool | Description |
|------|-------------|
| `http_get` | GET request with cookie jar, body snippet capture |
| `http_post` | POST JSON with cookie jar |
| `inspect_headers` | Audit CSP, HSTS, CORS, server headers |
| `provoke_error` | Send malformed JSON to surface verbose errors |
| `measure_timing` | Compare control vs test request timing |
| `captcha_fetch` | Fetch CAPTCHA metadata for form testing |

All tools are **deterministic** — no LLM-generated payloads.

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- OpenAI API key
- Node.js 20+ (for local development)

### Option 1: Docker Compose (Recommended)

The `docker-compose.yml` defines two services:

| Service | Description | Runs By Default |
|---------|-------------|-----------------|
| `target` | OWASP Juice Shop on port 3000 | ✅ Yes |
| `atlas-agent` | The ATLAS agent | ❌ No (profile required) |

#### Step 1: Start Juice Shop

```bash
# Start only the target (Juice Shop)
docker compose up -d
```

Juice Shop will be available at `http://localhost:3000`.

#### Step 2: Create `.env` file

```bash
# Required
OPENAI_API_KEY=sk-your-key-here

# Optional (defaults shown)
TARGET_URL=http://target:3000
MAX_REQ_PER_RUN=80
MAX_HOPS=40
REQ_TIMEOUT_MS=5000
```

#### Step 3: Run the Agent

```bash
# Run agent alongside target
docker compose --profile agent up atlas-agent
```

Or run both together:

```bash
docker compose --profile agent up
```

#### Step 4: View Results

```bash
ls traces/
cat traces/trace-*.json | jq .
```

### Option 2: Local Development

```bash
# 1. Start Juice Shop
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure .env for local
echo "TARGET_URL=http://localhost:3000" >> .env
echo "OPENAI_API_KEY=sk-your-key" >> .env

# 4. Run the agent
npm run dev

# 5. Run tests
npm test
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | **Required** for LLM reasoning |
| `TARGET_URL` | `http://target:3000` | Target URL (use `target` in Docker, `localhost` locally) |
| `MAX_REQ_PER_RUN` | `80` | HTTP request budget per run |
| `MAX_HOPS` | `40` | Max reasoning iterations |
| `REQ_TIMEOUT_MS` | `5000` | Per-request timeout (ms) |
| `MAX_HITS_PER_PATH` | `2` | Max requests to same path |
| `WAIT_FOR_TARGET_MS` | `0` | Wait for target availability at startup |
| `JUICE_SHOP_PORT` | `3000` | Host port for Juice Shop |

---

## Output: Reasoning Trace

Each run produces `traces/trace-<timestamp>.json`:

```json
{
  "run_id": "2025-12-24T08-00-00-000Z",
  "target": "http://target:3000",
  "summary": {
    "findingsCount": 5,
    "owaspCategories": [
      { "category": "A05:2021-Security Misconfiguration", "count": 3 }
    ],
    "toolUsage": { "http_get": 12, "inspect_headers": 4, "provoke_error": 3 },
    "batchStats": { "totalBatches": 8, "totalActions": 24 }
  },
  "findings": [
    {
      "type": "security_misconfiguration",
      "subtype": "missing_csp",
      "severity": "low",
      "evidence": "No Content-Security-Policy header",
      "owasp": "A05:2021-Security Misconfiguration"
    }
  ],
  "reasoningLog": [
    {
      "thought": "The API returns JSON without auth headers...",
      "hypothesis": "API endpoints may lack authentication",
      "owasp_category": "A01:2021-Broken Access Control",
      "confidence_0_1": 0.6
    }
  ]
}
```

---

## Safety & Scope

- **Target allowlist** — Only connects to configured `TARGET_URL`
- **Request budget** — Capped at `MAX_REQ_PER_RUN` (default 80)
- **Timeout** — Per-request timeout prevents hanging
- **Body redaction** — Response bodies capped at 2KB
- **No exploits** — Tools are observational only

---

## Code Structure

```
src/
├── index.js        # Entrypoint
├── config.js       # Environment & limits
├── constants.js    # Tool lists, patterns, confidence levels
├── state.js        # Initial state factory
├── graph.js        # LangGraph StateGraph (probe → cortex → report)
├── cortex.js       # LLM reasoning with hypothesis-first prompt
├── tools.js        # Deterministic HTTP tools
├── httpClient.js   # Axios client with cookie jar
├── pathUtils.js    # Path scoring & classification
└── reporter.js     # Trace writer with findings extraction
```

---

## Expected Findings (Juice Shop)

The agent typically detects:

- ❌ Missing HSTS header
- ❌ Missing Content-Security-Policy
- ❌ CORS wildcard (`Access-Control-Allow-Origin: *`)
- ❌ Server/version disclosure
- ❌ Verbose error responses (stack traces)
- ❌ Unprotected API endpoints

---

## License

MIT