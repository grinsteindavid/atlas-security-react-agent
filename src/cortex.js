import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { MAX_REQ_PER_RUN, MAX_HOPS, MAX_HITS_PER_PATH } from "./config.js";
import { ALLOWED_TOOLS } from "./constants.js";
import { scorePath } from "./pathUtils.js";

const CortexResponseSchema = z.object({
  decision: z.enum(["probe", "report"]),
  next_tool: z.enum(ALLOWED_TOOLS).optional(),
  next_args: z
    .object({
      path: z.string().optional(),
      label: z.string().optional(),
      body: z.record(z.unknown()).optional(),
      control: z.record(z.unknown()).optional(),
      test: z.record(z.unknown()).optional(),
    })
    .optional(),
  thought: z.string(),
  hypothesis: z.string(),
  owasp_category: z.string(),
  confidence_0_1: z.number().min(0).max(1),
  observation_ref: z.string().nullable(),
});

function validateCortexResponse(data) {
  const result = CortexResponseSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Schema validation failed: ${errors}`);
  }
  return result.data;
}

/**
 * Fallback decision when no LLM key is available.
 * @param {object} state
 */
function stubDecision(state) {
  const latest = state.observations.at(-1);
  return {
    decision: "report",
    log: {
      thought: "Fallback decision without LLM key.",
      hypothesis: "Collected basic surface info for review.",
      owasp_category: "A05:2021-Security Misconfiguration",
      confidence_0_1: 0.3,
      observation_ref: latest?.id ?? null,
      timestamp: new Date().toISOString(),
    },
    llmMeta: {
      attempts: 0,
      usedFallback: true,
      reason: "no_api_key",
    },
  };
}

/**
 * Run the reasoning (Cortex) node: invoke LLM if available, else stub.
 * @param {object} state
 * @returns {Promise<{decision: 'probe'|'report', log: object, next_tool?: string, next_args?: object, llmMeta: object}>}
 */
async function runCortex(state) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return stubDecision(state);

  const model = new ChatOpenAI({
    apiKey,
    model: "gpt-4o-mini",
    temperature: 0,
  });

  const latest = state.observations.at(-1);
  const allowedTools = [
    "http_get",
    "http_post",
    "inspect_headers",
    "provoke_error",
    "measure_timing",
    "captcha_fetch",
  ];

  const remainingBudget = Math.max(0, (MAX_REQ_PER_RUN ?? 0) - (state.metrics?.requests ?? 0));
  const remainingHops = Math.max(0, (MAX_HOPS ?? 0) - (state.hops ?? 0));
  const candidateScores = state.candidates
    .slice(0, 15)
    .map((p) => scorePath(p, state))
    .sort((a, b) => b.score - a.score);
  const lastDecisions = state.decisions.slice(-5);
  const pathStatsSummary = Object.entries(state.pathStats ?? {})
    .map(([path, stat]) => ({
      path,
      hits: stat.hits ?? 0,
      lastStatus: stat.lastStatus ?? null,
      lastTool: stat.lastTool ?? null,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 10);

  const prompt = [
    {
      role: "system",
      content:
        "You are the Cortex of an attacker-simulation agent targeting a web application.\n" +
        "Respond with RAW JSON only (no code fences, no prose).\n" +
        "Schema: {decision, next_tool?, next_args?, thought, hypothesis, owasp_category, confidence_0_1, observation_ref}.\n" +
        "decision must be 'probe' or 'report'. If decision is 'probe', choose next_tool from allowlist and valid next_args.\n" +
        "Allowlist tools: http_get {path,label?}, http_post {path,body,label?}, inspect_headers {path}, provoke_error {path}, measure_timing {path,control,test}, captcha_fetch {path}.\n\n" +
        "STRATEGY:\n" +
        "1. Start by exploring the seed response to discover the application structure (SPA routes, API endpoints, JS files).\n" +
        "2. Prioritize API endpoints (/api/*, /rest/*, /v1/*, /graphql) - they expose data and auth flaws.\n" +
        "3. Use candidateScores to pick high-score unvisited paths. NEVER repeat a path you already visited.\n" +
        "4. After GET on an API endpoint returning JSON, try POST with empty body {} or provoke_error to surface stack traces.\n" +
        "5. Look for auth endpoints (login, register, password, token, session, oauth) and test them.\n" +
        "6. Use inspect_headers to check security headers, CORS policy, server info disclosure.\n" +
        "7. Use diverse tools - don't just do http_get repeatedly. Vary: GET → inspect_headers → provoke_error → POST.\n" +
        "8. If you see 401/403, note it as potential auth bypass target. If 500 with stack trace, note information disclosure.\n" +
        "9. Look for sensitive paths: /admin, /debug, /config, /backup, /ftp, /.git, /swagger, /graphql.\n\n" +
        "Cite an observation_ref from the inputs. No exploit payloads. Respect remaining budget and hops.",
    },
    {
      role: "user",
      content: JSON.stringify({
        observations: state.observations.slice(-5),
        remainingBudget,
        remainingHops,
        visitedPaths: state.visitedPaths,
        recentPaths: state.visitedPaths.slice(-3),
        candidates: state.candidates.slice(0, 10),
        candidateScores,
        lastDecisions,
        pathStatsSummary,
        captcha: state.captcha,
        hints: [
          "Pick paths from candidateScores with highest score (unvisited API/auth paths)",
          "After http_get on API endpoint, follow up with provoke_error or http_post",
          "Use inspect_headers on endpoints returning 401/403 to check auth mechanisms",
          "Try http_post with {} body on API endpoints to test for missing auth",
          "Fetch JavaScript files to discover more API endpoints",
          "If you keep hitting same path, STOP and pick a different one from candidates",
          "Look for patterns: /api/v1/*, /graphql, /swagger.json, /openapi.json",
        ],
      }),
    },
  ];

  async function requestDecision() {
    const res = await model.invoke(prompt);
    const text = res.content;
    const parsed = typeof text === "string" ? JSON.parse(text) : text;
    return validateCortexResponse(parsed);
  }

  let parsed;
  let lastErr;
  const attempts = 2;
  for (let i = 0; i < attempts; i += 1) {
    try {
      parsed = await requestDecision();
      break;
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) {
        parsed = null;
      }
    }
  }

  if (!parsed) {
    return {
      decision: "report",
      log: {
        thought: `Fallback after LLM error: ${lastErr?.message}`,
        hypothesis: "Use collected signals to report.",
        owasp_category: "A05:2021-Security Misconfiguration",
        confidence_0_1: 0.2,
        observation_ref: latest?.id ?? null,
        timestamp: new Date().toISOString(),
      },
      llmMeta: {
        attempts,
        usedFallback: true,
        model: "gpt-4o-mini",
        error: lastErr?.message ?? "unknown",
      },
    };
  }

  return {
    decision: parsed.decision,
    next_tool: parsed.next_tool ?? null,
    next_args: parsed.next_args ?? {},
    log: {
      thought: parsed.thought ?? "n/a",
      hypothesis: parsed.hypothesis ?? "n/a",
      owasp_category: parsed.owasp_category ?? "A05:2021-Security Misconfiguration",
      confidence_0_1: Number(parsed.confidence_0_1 ?? 0.3),
      observation_ref: parsed.observation_ref ?? latest?.id ?? null,
      timestamp: new Date().toISOString(),
    },
    llmMeta: {
      attempts,
      usedFallback: false,
      model: "gpt-4o-mini",
    },
  };
}

export { runCortex };
