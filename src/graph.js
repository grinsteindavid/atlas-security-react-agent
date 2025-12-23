import { createInitialState } from "./state.js";
import {
  httpGet,
  httpPost,
  inspectHeaders,
  provokeError,
  measureTiming,
} from "./tools.js";
import { runCortex } from "./cortex.js";
import { writeTrace } from "./reporter.js";
import { MAX_REQ_PER_RUN, MAX_HOPS } from "./config.js";

function markVisited(state, path) {
  if (!path) return;
  if (!state.visitedPaths.includes(path)) {
    state.visitedPaths.push(path);
  }
}

async function dispatchTool(state, toolName, args = {}) {
  switch (toolName) {
    case "http_get": {
      const path = args.path ?? "/";
      markVisited(state, path);
      console.log(`[tool] http_get ${path} label=${args.label ?? "httpGet"}`);
      await httpGet(state, path, args.label ?? "httpGet");
      break;
    }
    case "http_post": {
      const path = args.path ?? "/";
      console.log(`[tool] http_post ${path} label=${args.label ?? "httpPost"}`);
      await httpPost(state, path, args.body ?? {}, args.label ?? "httpPost");
      break;
    }
    case "inspect_headers": {
      const path = args.path ?? "/";
      markVisited(state, path);
      console.log(`[tool] inspect_headers ${path} label=${args.label ?? "inspectHeaders"}`);
      await inspectHeaders(state, path, args.label ?? "inspectHeaders");
      break;
    }
    case "provoke_error": {
      const path = args.path ?? "/";
      console.log(`[tool] provoke_error ${path} label=${args.label ?? "provokeError"}`);
      await provokeError(state, path, args.label ?? "provokeError");
      break;
    }
    case "measure_timing": {
      const path = args.path ?? "/";
      console.log(`[tool] measure_timing ${path} label=${args.label ?? "measureTiming"}`);
      await measureTiming(
        state,
        path,
        args.control ?? {},
        args.test ?? {},
        args.label ?? "measureTiming"
      );
      break;
    }
    default: {
      // Fallback: simple GET /
      const path = "/";
      markVisited(state, path);
      console.log(`[tool] fallback http_get ${path}`);
      await httpGet(state, path, "httpGet");
    }
  }
}

/**
 * Run adaptive Reason -> Act -> Observe loop.
 */
async function runOnce() {
  const state = createInitialState();

  let nextTool = "http_get";
  let nextArgs = { path: "/", label: "seed" };

  while (true) {
    if ((state.hops ?? 0) >= MAX_HOPS) {
      state.stopReason = "max_hops";
      console.log(`[stop] max_hops reached (${MAX_HOPS})`);
      break;
    }
    if ((state.metrics?.requests ?? 0) >= MAX_REQ_PER_RUN) {
      state.stopReason = "budget_exhausted";
      console.log(`[stop] budget_exhausted (${state.metrics?.requests}/${MAX_REQ_PER_RUN})`);
      break;
    }

    await dispatchTool(state, nextTool, nextArgs);
    state.hops += 1;

    const cortexRes = await runCortex(state);
    console.log(
      `[cortex] decision=${cortexRes.decision} next_tool=${cortexRes.next_tool ?? "none"} hops=${
        state.hops
      } requests=${state.metrics?.requests ?? 0}`
    );
    state.decision = cortexRes.decision;
    state.reasoningLog.push(cortexRes.log);
    state.llmMeta = cortexRes.llmMeta ?? null;
    state.decisions.push({
      hop: state.hops,
      decision: cortexRes.decision,
      next_tool: cortexRes.next_tool ?? null,
      timestamp: new Date().toISOString(),
    });

    if (cortexRes.decision === "report") {
      state.stopReason = "decision_report";
      break;
    }
    if ((state.metrics?.requests ?? 0) >= MAX_REQ_PER_RUN) {
      state.stopReason = "budget_exhausted";
      break;
    }

    nextTool = cortexRes.next_tool ?? "http_get";
    nextArgs = cortexRes.next_args ?? { path: "/" };
  }

  const path = await writeTrace(state);
  console.log(`Trace written to ${path}`);
}

export { runOnce };
