import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { MAX_REQ_PER_RUN, MAX_HOPS } from "./config.js";
import { ALLOWED_TOOLS, MAX_ACTIONS_PER_DECISION, TOOL_DEFINITIONS } from "./constants.js";
import { scorePath } from "./pathUtils.js";
import { extractFindings } from "./reporter.js";
import { getSessionSummary } from "./httpClient.js";

/**
 * Schema for action arguments (flexible for all tools).
 */
const ActionArgsSchema = z.object({
  path: z.string(),
  label: z.string().optional(),
  body: z.record(z.unknown()).optional(),
  control: z.record(z.unknown()).optional(),
  test: z.record(z.unknown()).optional(),
}).passthrough();

/**
 * Schema for a single action in batch execution.
 */
const ActionSchema = z.object({
  tool: z.enum(ALLOWED_TOOLS),
  args: ActionArgsSchema,
  rationale: z.string().optional().default(""),
});

/**
 * Zod schema for validating Cortex LLM responses.
 */
const CortexResponseSchema = z.object({
  decision: z.enum(["probe", "report", "continue"]).transform((val) =>
    val === "continue" ? "probe" : val
  ),
  next_actions: z.array(ActionSchema).max(MAX_ACTIONS_PER_DECISION).optional().default([]),
  thought: z.string(),
  hypothesis: z.string(),
  owasp_category: z.string(),
  confidence_0_1: z.number().min(0).max(1),
  observation_ref: z.union([z.string(), z.null()]).optional().default(null),
});

/**
 * Build system prompt with tool definitions.
 * @returns {string}
 */
function buildSystemPrompt() {
  const toolsText = TOOL_DEFINITIONS.map(
    (t) => `- ${t.name}: ${t.description}`
  ).join("\n");

  return `You are a security reconnaissance agent analyzing a web application.

RESPONSE FORMAT: Raw JSON object (no markdown, no code fences).

REQUIRED FIELDS:
- decision: "probe" (continue testing) or "report" (finish)
- next_actions: array of actions when decision is "probe"
- thought: your reasoning process
- hypothesis: what vulnerability you suspect
- owasp_category: e.g. "A01:2021-Broken Access Control"
- confidence_0_1: 0.0-1.0 confidence level
- observation_ref: ID from observations or null

ACTION FORMAT: {"tool": "tool_name", "args": {"path": "/endpoint"}, "rationale": "why"}

AVAILABLE TOOLS:
${toolsText}

STRATEGY:
- Check candidateScores for high-priority unvisited paths
- Prioritize API endpoints (/api/*, /rest/*) and auth paths
- Skip paths already in currentFindings
- Avoid paths in recentErrors
- Vary tools: GET → inspect_headers → provoke_error

CONFIDENCE: 0.1-0.3 speculation | 0.4-0.6 indirect evidence | 0.7-0.9 confirmed`;
}

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

  // Build context for LLM
  const remainingBudget = Math.max(0, (MAX_REQ_PER_RUN ?? 0) - (state.metrics?.requests ?? 0));
  const remainingHops = Math.max(0, (MAX_HOPS ?? 0) - (state.hops ?? 0));
  const candidateScores = state.candidates
    .slice(0, 15)
    .map((p) => scorePath(p, state))
    .sort((a, b) => b.score - a.score);

  const currentFindings = extractFindings(state).map((f) => ({
    type: f.subtype,
    path: f.path,
    owasp: f.owasp,
  }));

  const sessionState = await getSessionSummary();

  const recentErrors = (state.metrics?.errors ?? []).slice(-5).map((e) => ({
    path: e.path ?? e.url,
    tool: e.tool,
  }));

  const prompt = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        observations: state.observations.slice(-8),
        remainingBudget,
        remainingHops,
        candidateScores: candidateScores.slice(0, 10),
        currentFindings,
        sessionState,
        recentErrors,
        captcha: state.captcha,
      }),
    },
  ];

  async function requestDecision() {
    const res = await model.invoke(prompt);
    let text = res.content;
    // Strip markdown code fences if present
    if (typeof text === "string") {
      text = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    }
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
