import { StateGraph, START, END } from "@langchain/langgraph";
import { createInitialState } from "./state.js";
import { httpGet, inspectHeaders, provokeError } from "./tools.js";
import { runCortex } from "./cortex.js";
import { writeTrace } from "./reporter.js";

/**
 * Probe node: run deterministic sensing steps and return observations.
 * @param {object} state
 */
async function probeNode(state) {
  await httpGet(state, "/");
  await inspectHeaders(state);
  await provokeError(state, "/api/Feedbacks");
  return {};
}

/**
 * Cortex node: call reasoning and append log.
 * @param {object} state
 */
async function cortexNode(state) {
  const res = await runCortex(state);
  return {
    decision: res.decision,
    reasoningLog: [...state.reasoningLog, res.log],
    llmMeta: res.llmMeta ?? null,
  };
}

/**
 * Reporter node: write trace to disk.
 * @param {object} state
 */
async function reportNode(state) {
  const path = await writeTrace(state);
  console.log(`Trace written to ${path}`);
  return { done: true };
}

/**
 * Build and compile the LangGraph workflow.
 */
function buildGraph() {
  const workflow = new StateGraph({
    channels: {
      runId: {
        value: (_prev, update) => update,
        default: () => null,
      },
      runStartedAt: {
        value: (_prev, update) => update,
        default: () => null,
      },
      observations: {
        value: (prev, updates) => [...prev, ...(updates ?? [])],
        default: () => [],
      },
      reasoningLog: {
        value: (prev, updates) => [...prev, ...(updates ?? [])],
        default: () => [],
      },
      decision: {
        value: (_prev, update) => update ?? "probe",
        default: () => "probe",
      },
      metrics: {
        value: (prev, update) => ({ ...(prev ?? {}), ...(update ?? {}) }),
        default: () => ({ requests: 0, perTool: {}, errors: [] }),
      },
      llmMeta: {
        value: (_prev, update) => update ?? null,
        default: () => null,
      },
    },
  });

  workflow.addNode("probe", probeNode);
  workflow.addNode("cortex", cortexNode);
  workflow.addNode("report", reportNode);

  workflow.addEdge(START, "probe");
  workflow.addEdge("probe", "cortex");
  workflow.addEdge("cortex", "report");
  workflow.addEdge("report", END);

  return workflow.compile();
}

/**
 * Run one full Reason -> Act -> Observe cycle.
 */
async function runOnce() {
  const app = buildGraph();
  const state = createInitialState();
  await app.invoke(state);
}

export { runOnce };
