import { StateGraph, END } from "@langchain/langgraph";
import { createInitialState } from "./state.js";
import {
  httpGet,
  httpPost,
  inspectHeaders,
  provokeError,
  measureTiming,
  captchaFetch,
} from "./tools.js";
import { runCortex } from "./cortex.js";
import { writeTrace } from "./reporter.js";
import { MAX_REQ_PER_RUN, MAX_HOPS, MAX_HITS_PER_PATH } from "./config.js";
import { updatePathStats } from "./state.js";
import { isStaticPath, isApiOrAuthPath } from "./pathUtils.js";
import { DIVERSITY_INTERVAL, REQUIRED_DIVERSITY_TOOLS } from "./constants.js";

/**
 * Mark a path as visited in state.
 * @param {object} state
 * @param {string} path
 */
function markVisited(state, path) {
  if (!path) return;
  if (!state.visitedPaths.includes(path)) {
    state.visitedPaths.push(path);
  }
}

/**
 * Increment hit count for a path.
 * @param {object} state
 * @param {string} path
 */
function recordHit(state, path) {
  if (!path) return;
  state.pathHits[path] = (state.pathHits[path] ?? 0) + 1;
}

/**
 * Check if a path can be hit again within limits.
 * @param {object} state
 * @param {string} path
 * @returns {boolean}
 */
function canHit(state, path) {
  if (!path) return false;
  const hits = state.pathHits[path] ?? 0;
  return hits < MAX_HITS_PER_PATH;
}

/**
 * Pop a valid candidate path from the queue.
 * @param {object} state
 * @param {boolean} [preferApi=false] - Prioritize API/auth paths
 * @returns {string|null}
 */
function consumeCandidate(state, preferApi = false) {
  if (preferApi) {
    // First pass: look for API/auth paths only
    for (let i = 0; i < state.candidates.length; i++) {
      const path = state.candidates[i];
      const staticAndSeen = isStaticPath(path) && (state.pathHits[path] ?? 0) >= 1;
      if (!state.visitedPaths.includes(path) && canHit(state, path) && !staticAndSeen && isApiOrAuthPath(path)) {
        state.candidates.splice(i, 1);
        return path;
      }
    }
  }
  // Second pass: any valid non-static path
  while (state.candidates.length > 0) {
    const path = state.candidates.shift();
    const staticAndSeen = isStaticPath(path) && (state.pathHits[path] ?? 0) >= 1;
    if (!state.visitedPaths.includes(path) && canHit(state, path) && !staticAndSeen) {
      return path;
    }
  }
  return null;
}

/**
 * Select the best path for a tool invocation.
 * @param {object} state
 * @param {string} toolName
 * @param {string} desiredPath - LLM-suggested path
 * @returns {string|null}
 */
function choosePath(state, toolName, desiredPath) {
  // 1. Try LLM's desired path if valid
  if (desiredPath) {
    const sameAsLast =
      state.lastAction?.tool === toolName && state.lastAction?.path === desiredPath;
    const staticAndSeen = isStaticPath(desiredPath) && (state.pathHits[desiredPath] ?? 0) >= 1;
    if (!sameAsLast && canHit(state, desiredPath) && !staticAndSeen && !isStaticPath(desiredPath)) {
      return desiredPath;
    }
  }
  // 2. Fallback: prefer API/auth paths from candidates
  const apiCandidate = consumeCandidate(state, true);
  if (apiCandidate) return apiCandidate;
  // 3. Any valid candidate
  const anyCandidate = consumeCandidate(state, false);
  if (anyCandidate) return anyCandidate;
  // 4. Return null to signal skip (don't force root)
  return null;
}

/**
 * Dispatch a tool by name with arguments.
 * @param {object} state
 * @param {string} toolName
 * @param {object} [args={}]
 * @returns {Promise<boolean>} Success indicator
 */
async function dispatchTool(state, toolName, args = {}) {
  try {
    switch (toolName) {
      case "http_get": {
        const path = choosePath(state, "http_get", args.path ?? "/");
        if (!path) {
          console.log(`[tool] http_get skipped - no valid path`);
          return false;
        }
        markVisited(state, path);
        recordHit(state, path);
        console.log(`[tool] http_get ${path} label=${args.label ?? "httpGet"}`);
        const obs = await httpGet(state, path, args.label ?? "httpGet");
        updatePathStats(state, path, { status: obs?.status, tool: "http_get", observationId: obs?.id });
        state.lastAction = { tool: "http_get", path };
        break;
      }
      case "http_post": {
        const path = choosePath(state, "http_post", args.path ?? "/");
        if (!path) {
          console.log(`[tool] http_post skipped - no valid path`);
          return false;
        }
        markVisited(state, path);
        recordHit(state, path);
        console.log(`[tool] http_post ${path} label=${args.label ?? "httpPost"}`);
        const mergedBody = { ...(args.body ?? {}) };
        if (path.includes("Feedbacks") && state.captcha?.captchaId) {
          if (!mergedBody.captchaId) mergedBody.captchaId = state.captcha.captchaId;
          if (!mergedBody.captcha && state.captcha.answer) mergedBody.captcha = state.captcha.answer;
        }
        const obs = await httpPost(state, path, mergedBody, args.label ?? "httpPost");
        updatePathStats(state, path, { status: obs?.status, tool: "http_post", observationId: obs?.id });
        state.lastAction = { tool: "http_post", path };
        break;
      }
      case "inspect_headers": {
        const path = choosePath(state, "inspect_headers", args.path ?? "/");
        if (!path) {
          console.log(`[tool] inspect_headers skipped - no valid path`);
          return false;
        }
        markVisited(state, path);
        recordHit(state, path);
        console.log(`[tool] inspect_headers ${path} label=${args.label ?? "inspectHeaders"}`);
        const obs = await inspectHeaders(state, path, args.label ?? "inspectHeaders");
        updatePathStats(state, path, { status: obs?.status, tool: "inspect_headers", observationId: obs?.id });
        state.lastAction = { tool: "inspect_headers", path };
        break;
      }
      case "captcha_fetch": {
        const path = choosePath(state, "captcha_fetch", args.path ?? "/rest/captcha");
        if (!path) {
          console.log(`[tool] captcha_fetch skipped - no valid path`);
          return false;
        }
        markVisited(state, path);
        recordHit(state, path);
        console.log(`[tool] captcha_fetch ${path} label=${args.label ?? "captchaFetch"}`);
        const obs = await captchaFetch(state, path, args.label ?? "captchaFetch");
        updatePathStats(state, path, { status: obs?.status, tool: "captcha_fetch", observationId: obs?.id });
        state.lastAction = { tool: "captcha_fetch", path };
        break;
      }
      case "provoke_error": {
        const path = choosePath(state, "provoke_error", args.path ?? "/");
        if (!path) {
          console.log(`[tool] provoke_error skipped - no valid path`);
          return false;
        }
        markVisited(state, path);
        recordHit(state, path);
        console.log(`[tool] provoke_error ${path} label=${args.label ?? "provokeError"}`);
        const obs = await provokeError(state, path, args.label ?? "provokeError");
        updatePathStats(state, path, { status: obs?.status, tool: "provoke_error", observationId: obs?.id });
        state.lastAction = { tool: "provoke_error", path };
        break;
      }
      case "measure_timing": {
        const path = choosePath(state, "measure_timing", args.path ?? "/");
        if (!path) {
          console.log(`[tool] measure_timing skipped - no valid path`);
          return false;
        }
        markVisited(state, path);
        recordHit(state, path);
        console.log(`[tool] measure_timing ${path} label=${args.label ?? "measureTiming"}`);
        const result = await measureTiming(
          state,
          path,
          args.control ?? {},
          args.test ?? {},
          args.label ?? "measureTiming"
        );
        updatePathStats(state, path, {
          status: result?.observation?.status,
          tool: "measure_timing",
          observationId: result?.observation?.id,
        });
        state.lastAction = { tool: "measure_timing", path };
        break;
      }
      default: {
        console.log(`[tool] unknown tool ${toolName}, skipping`);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error(`[tool] ${toolName} failed:`, err.message);
    if (!state.metrics) state.metrics = { requests: 0, perTool: {}, errors: [] };
    state.metrics.errors.push({
      tool: toolName,
      path: args.path,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
    return false;
  }
}

/**
 * Determine if tool diversity requires forcing a specific tool.
 * @param {object} state
 * @returns {string|null} Tool name to force, or null
 */
function shouldForceTool(state) {
  if (state.hops < DIVERSITY_INTERVAL) return null;
  for (const tool of REQUIRED_DIVERSITY_TOOLS) {
    if ((state.toolUsage[tool] ?? 0) === 0) {
      return tool;
    }
  }
  if (state.hops % DIVERSITY_INTERVAL === 0) {
    const leastUsed = REQUIRED_DIVERSITY_TOOLS.reduce((a, b) =>
      (state.toolUsage[a] ?? 0) <= (state.toolUsage[b] ?? 0) ? a : b
    );
    if ((state.toolUsage[leastUsed] ?? 0) < state.hops / DIVERSITY_INTERVAL) {
      return leastUsed;
    }
  }
  return null;
}

/**
 * Increment usage counter for a tool.
 * @param {object} state
 * @param {string} toolName
 */
function trackToolUsage(state, toolName) {
  if (state.toolUsage && toolName in state.toolUsage) {
    state.toolUsage[toolName] += 1;
  }
}

/**
 * Execute multiple tools in parallel.
 * @param {object} state
 * @param {Array<{tool: string, args: object, rationale: string}>} actions
 * @returns {Promise<{successes: number, failures: number}>}
 */
async function dispatchToolsBatch(state, actions) {
  if (!actions || actions.length === 0) {
    return { successes: 0, failures: 0 };
  }

  // Prepare all dispatch promises
  const dispatches = actions.map(({ tool, args }) => {
    return dispatchTool(state, tool, args)
      .then((success) => ({ tool, success }))
      .catch(() => ({ tool, success: false }));
  });

  // Execute in parallel
  const results = await Promise.all(dispatches);

  let successes = 0;
  let failures = 0;
  for (const { tool, success } of results) {
    if (success) {
      trackToolUsage(state, tool);
      successes += 1;
    } else {
      failures += 1;
    }
  }

  return { successes, failures };
}

/**
 * Probe node: executes selected tools (batch or single).
 */
async function probeNode(state) {
  const actions = state.nextActions ?? [];

  // Fallback to legacy single action
  if (actions.length === 0) {
    const toolName = state.nextTool ?? "http_get";
    const args = state.nextArgs ?? { path: "/", label: "seed" };
    const success = await dispatchTool(state, toolName, args);
    if (success) {
      trackToolUsage(state, toolName);
      state.consecutiveSkips = 0;
    } else {
      state.skippedHops = (state.skippedHops ?? 0) + 1;
      state.consecutiveSkips = (state.consecutiveSkips ?? 0) + 1;
    }
    state.hops += 1;
    return state;
  }

  // Batch execution
  console.log(`[probe] executing ${actions.length} actions in parallel`);
  const { successes, failures } = await dispatchToolsBatch(state, actions);

  if (successes > 0) {
    state.consecutiveSkips = 0;
  } else {
    state.skippedHops = (state.skippedHops ?? 0) + 1;
    state.consecutiveSkips = (state.consecutiveSkips ?? 0) + 1;
  }

  state.hops += 1;
  state.batchStats = state.batchStats ?? { totalBatches: 0, totalActions: 0 };
  state.batchStats.totalBatches += 1;
  state.batchStats.totalActions += actions.length;

  console.log(`[probe] batch complete: ${successes} succeeded, ${failures} failed`);
  return state;
}

/**
 * Cortex node: LLM reasoning to decide next action(s).
 */
async function cortexNode(state) {
  const cortexRes = await runCortex(state);
  const actionCount = cortexRes.next_actions?.length ?? 0;
  console.log(
    `[cortex] decision=${cortexRes.decision} actions=${actionCount} hops=${
      state.hops
    } requests=${state.metrics?.requests ?? 0}`
  );

  state.decision = cortexRes.decision;
  state.reasoningLog.push(cortexRes.log);
  state.llmMeta = cortexRes.llmMeta ?? null;
  state.decisions.push({
    hop: state.hops,
    decision: cortexRes.decision,
    actions: cortexRes.next_actions?.map((a) => ({ tool: a.tool, path: a.args?.path })) ?? [],
    thought: cortexRes.log.thought,
    hypothesis: cortexRes.log.hypothesis,
    timestamp: new Date().toISOString(),
  });

  // Tool diversity enforcement
  const forcedTool = shouldForceTool(state);
  if (forcedTool) {
    console.log(`[diversity] forcing ${forcedTool} (usage: ${state.toolUsage[forcedTool] ?? 0})`);
    state.nextActions = [{ tool: forcedTool, args: { path: "/" }, rationale: "diversity enforcement" }];
    state.nextTool = forcedTool;
    state.nextArgs = { path: "/", label: `forced-${forcedTool}` };
  } else {
    state.nextActions = cortexRes.next_actions ?? [];
    state.nextTool = cortexRes.next_tool ?? "http_get";
    state.nextArgs = cortexRes.next_args ?? { path: "/" };
  }

  return state;
}

/**
 * Report node: writes final trace.
 */
async function reportNode(state) {
  const path = await writeTrace(state);
  console.log(`Trace written to ${path}`);
  return state;
}

/**
 * Router function: determines next node based on state.
 */
function decisionRouter(state) {
  // Check stop conditions
  if ((state.hops ?? 0) >= MAX_HOPS) {
    state.stopReason = "max_hops";
    console.log(`[stop] max_hops reached (${MAX_HOPS})`);
    return "report";
  }
  if ((state.metrics?.requests ?? 0) >= MAX_REQ_PER_RUN) {
    state.stopReason = "budget_exhausted";
    console.log(`[stop] budget_exhausted (${state.metrics?.requests}/${MAX_REQ_PER_RUN})`);
    return "report";
  }
  if ((state.consecutiveSkips ?? 0) >= 3) {
    state.stopReason = "no_valid_paths";
    console.log(`[stop] no_valid_paths after ${state.consecutiveSkips} consecutive skips`);
    return "report";
  }
  if (state.decision === "report") {
    state.stopReason = "decision_report";
    return "report";
  }

  return "probe";
}

/**
 * Build the StateGraph for the ReAct loop.
 */
function buildGraph() {
  const graph = new StateGraph({
    channels: {
      runId: { value: (a, b) => b ?? a },
      observations: { value: (a, b) => b ?? a },
      reasoningLog: { value: (a, b) => b ?? a },
      decision: { value: (a, b) => b ?? a },
      runStartedAt: { value: (a, b) => b ?? a },
      metrics: { value: (a, b) => b ?? a },
      toolUsage: { value: (a, b) => b ?? a },
      llmMeta: { value: (a, b) => b ?? a },
      visitedPaths: { value: (a, b) => b ?? a },
      hops: { value: (a, b) => b ?? a },
      stopReason: { value: (a, b) => b ?? a },
      decisions: { value: (a, b) => b ?? a },
      captcha: { value: (a, b) => b ?? a },
      candidates: { value: (a, b) => b ?? a },
      lastAction: { value: (a, b) => b ?? a },
      pathHits: { value: (a, b) => b ?? a },
      captchaUsed: { value: (a, b) => b ?? a },
      pathStats: { value: (a, b) => b ?? a },
      skippedHops: { value: (a, b) => b ?? a },
      consecutiveSkips: { value: (a, b) => b ?? a },
      nextTool: { value: (a, b) => b ?? a },
      nextArgs: { value: (a, b) => b ?? a },
      nextActions: { value: (a, b) => b ?? a },
      batchStats: { value: (a, b) => b ?? a },
    },
  });

  graph.addNode("probe", probeNode);
  graph.addNode("cortex", cortexNode);
  graph.addNode("report", reportNode);

  graph.setEntryPoint("probe");
  graph.addEdge("probe", "cortex");
  graph.addConditionalEdges("cortex", decisionRouter, {
    probe: "probe",
    report: "report",
  });
  graph.addEdge("report", END);

  return graph.compile();
}

/**
 * Run the agent once using StateGraph.
 */
async function runOnce() {
  const initialState = createInitialState();
  initialState.nextTool = "http_get";
  initialState.nextArgs = { path: "/", label: "seed" };
  initialState.nextActions = [];
  initialState.consecutiveSkips = 0;

  const app = buildGraph();
  await app.invoke(initialState);
}

export {
  runOnce,
  buildGraph,
  shouldForceTool,
  decisionRouter,
};
