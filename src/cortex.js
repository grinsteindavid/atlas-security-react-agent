import { ChatOpenAI } from "@langchain/openai";
import { TARGET_URL, MAX_REQ_PER_RUN, MAX_HOPS } from "./config.js";

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
  ];

  const remainingBudget = Math.max(0, (MAX_REQ_PER_RUN ?? 0) - (state.metrics?.requests ?? 0));
  const remainingHops = Math.max(0, (MAX_HOPS ?? 0) - (state.hops ?? 0));

  const prompt = [
    {
      role: "system",
      content:
        "You are the Cortex of an attacker-simulation agent.\n" +
        "Respond with RAW JSON only (no code fences, no prose).\n" +
        "Schema: {decision, next_tool?, next_args?, thought, hypothesis, owasp_category, confidence_0_1, observation_ref}.\n" +
        "decision must be 'probe' or 'report'. If decision is 'probe', choose next_tool from allowlist and valid next_args.\n" +
        "Allowlist tools: http_get {path,label?}, http_post {path,body,label?}, inspect_headers {path}, provoke_error {path}, measure_timing {path,control,test}.\n" +
        "Cite an observation_ref from the inputs. No exploit payloads. Respect remaining budget and hops.",
    },
    {
      role: "user",
      content: JSON.stringify({
        target: TARGET_URL,
        observations: state.observations.slice(-5),
        remainingBudget,
        remainingHops,
        visitedPaths: state.visitedPaths,
      }),
    },
  ];

  async function requestDecision() {
    const res = await model.invoke(prompt);
    const text = res.content;
    const parsed = typeof text === "string" ? JSON.parse(text) : text;
    if (!parsed?.decision) throw new Error("Missing decision");
    return parsed;
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

  const nextTool = allowedTools.includes(parsed.next_tool) ? parsed.next_tool : null;
  const nextArgs = parsed.next_args && typeof parsed.next_args === "object" ? parsed.next_args : {};

  return {
    decision: parsed.decision === "probe" ? "probe" : "report",
    next_tool: nextTool,
    next_args: nextArgs,
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
