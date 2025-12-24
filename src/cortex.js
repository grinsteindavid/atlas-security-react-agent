import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { MAX_REQ_PER_RUN, MAX_HOPS, MAX_HITS_PER_PATH } from "./config.js";
import { ALLOWED_TOOLS, MAX_ACTIONS_PER_DECISION } from "./constants.js";
import { scorePath } from "./pathUtils.js";

/**
 * Schema for a single action in batch execution.
 */
const ActionSchema = z.object({
  tool: z.enum(ALLOWED_TOOLS),
  args: z.object({
    path: z.string(),
    label: z.string().optional(),
    body: z.record(z.unknown()).optional(),
    control: z.record(z.unknown()).optional(),
    test: z.record(z.unknown()).optional(),
  }),
  rationale: z.string(),
});

/**
 * Zod schema for validating Cortex LLM responses.
 * Supports both legacy single-action and new batch actions.
 */
const CortexResponseSchema = z.object({
  decision: z.enum(["probe", "report"]),
  // Legacy single action (backward compat)
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
  // New batch actions
  next_actions: z.array(ActionSchema).max(MAX_ACTIONS_PER_DECISION).optional(),
  thought: z.string(),
  hypothesis: z.string(),
  owasp_category: z.string(),
  confidence_0_1: z.number().min(0).max(1),
  observation_ref: z.string().nullable(),
});

/**
 * Validate raw LLM output against the Cortex schema.
 * @param {unknown} data - Parsed JSON from LLM
 * @returns {object} Validated response
 * @throws {Error} If validation fails
 */
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
        "You are the Cortex of a security reconnaissance agent. Your goal is to LEARN attacker thinking by forming hypotheses and gathering evidence.\n\n" +
        "OUTPUT: RAW JSON only (no code fences, no prose).\n" +
        "SCHEMA: {decision, next_actions[], thought, hypothesis, owasp_category, confidence_0_1, observation_ref}\n\n" +
        "REASONING CYCLE (ReAct):\n" +
        "1. HYPOTHESIZE: Based on observations, what vulnerability might exist? Map to OWASP category.\n" +
        "2. PLAN: Which tools would provide evidence for/against this hypothesis?\n" +
        "3. ACT: Specify 1-5 actions in next_actions array to execute in parallel.\n" +
        "4. EVALUATE: After results, adjust hypothesis confidence based on evidence.\n\n" +
        "NEXT_ACTIONS FORMAT (array of 1-5 actions):\n" +
        "[{tool, args: {path, label?, body?, control?, test?}, rationale}]\n" +
        "Tools: http_get, http_post, inspect_headers, provoke_error, measure_timing, captcha_fetch\n\n" +
        "CONFIDENCE CALIBRATION:\n" +
        "- 0.1-0.3: Speculation (pattern suggests possibility, no evidence yet)\n" +
        "- 0.4-0.6: Indirect evidence (e.g., 401 response hints at auth, but unconfirmed)\n" +
        "- 0.7-0.9: Direct evidence (e.g., stack trace exposed, data leaked, header missing)\n\n" +
        "PRIORITY TARGETS:\n" +
        "- API endpoints: /api/*, /rest/*, /graphql (data exposure, auth flaws)\n" +
        "- Auth flows: login, register, password reset, token endpoints\n" +
        "- Sensitive paths: /admin, /swagger, /debug, /.git, /backup\n\n" +
        "THOUGHT & HYPOTHESIS are the primary learning artifacts. Explain your reasoning clearly.\n" +
        "Cite observation_ref from inputs. No exploit payloads. Respect budget.",
    },
    {
      role: "user",
      content: JSON.stringify({
        observations: state.observations.slice(-8),
        remainingBudget,
        remainingHops,
        visitedPaths: state.visitedPaths,
        candidates: state.candidates.slice(0, 15),
        candidateScores,
        lastDecisions,
        pathStatsSummary,
        captcha: state.captcha,
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

  // Normalize to next_actions array (support legacy single action)
  let nextActions = parsed.next_actions ?? [];
  if (nextActions.length === 0 && parsed.next_tool) {
    nextActions = [{
      tool: parsed.next_tool,
      args: parsed.next_args ?? { path: "/" },
      rationale: "legacy single action",
    }];
  }

  return {
    decision: parsed.decision,
    next_actions: nextActions,
    // Legacy fields for backward compat
    next_tool: parsed.next_tool ?? nextActions[0]?.tool ?? null,
    next_args: parsed.next_args ?? nextActions[0]?.args ?? {},
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
