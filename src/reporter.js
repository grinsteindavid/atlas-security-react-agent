import fs from "fs/promises";

/**
 * Persist the reasoning trace and observations to disk.
 * @param {object} state
 * @param {string} path
 * @returns {Promise<string>} written file path
 */
async function writeTrace(state, path = "reasoning_trace.json") {
  const payload = {
    target: process.env.TARGET_URL ?? "http://juice-shop:3000",
    startedAt: state.runStartedAt,
    finishedAt: new Date().toISOString(),
    observations: state.observations,
    reasoningLog: state.reasoningLog,
  };
  await fs.writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
  return path;
}

export { writeTrace };
