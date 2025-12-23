import fs from "fs/promises";

/**
 * Persist the reasoning trace and observations to disk.
 * If no path provided, writes to traces/trace-<runId>.json (gitignored).
 * @param {object} state
 * @param {string} [path]
 * @returns {Promise<string>} written file path
 */
async function writeTrace(state, path) {
  const targetPath =
    path ??
    `traces/trace-${state.runId ?? new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  const payload = {
    run_id: state.runId,
    target: process.env.TARGET_URL ?? "http://juice-shop:3000",
    startedAt: state.runStartedAt,
    finishedAt: new Date().toISOString(),
    observations: state.observations,
    reasoningLog: state.reasoningLog,
    metrics: state.metrics,
    llmMeta: state.llmMeta,
    decisions: state.decisions,
    hops: state.hops,
    stopReason: state.stopReason,
    visitedPaths: state.visitedPaths,
    requestBudget: {
      used: state.metrics?.requests ?? 0,
      max: Number.parseInt(process.env.MAX_REQ_PER_RUN ?? "80", 10),
    },
    nodesVisited: ["probe", "cortex", "report"],
  };

  await fs.mkdir("traces", { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf-8");
  return targetPath;
}

export { writeTrace };
