/**
 * Create the initial agent state for a single run.
 */
const SEED_CANDIDATES = [];

function createInitialState() {
  return {
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
    observations: [],
    reasoningLog: [],
    decision: "probe",
    runStartedAt: new Date().toISOString(),
    metrics: {
      requests: 0,
      perTool: {},
      errors: [],
    },
    toolUsage: {
      http_get: 0,
      http_post: 0,
      inspect_headers: 0,
      provoke_error: 0,
      measure_timing: 0,
      captcha_fetch: 0,
    },
    llmMeta: null,
    visitedPaths: [],
    hops: 0,
    stopReason: null,
    decisions: [],
    captcha: null,
    candidates: [...SEED_CANDIDATES],
    lastAction: null,
    pathHits: {},
    captchaUsed: false,
    pathStats: {},
    skippedHops: 0,
  };
}

/**
 * Add an observation to state and return it.
 * @param {object} state
 * @param {object} observation
 */
function addObservation(state, observation) {
  state.observations.push(observation);
  return observation;
}

/**
 * Update path stats with latest hit info.
 * @param {object} state
 * @param {string} path
 * @param {object} info
 */
function updatePathStats(state, path, info) {
  if (!path || !info) return;
  const prev = state.pathStats[path] ?? {};
  state.pathStats[path] = {
    ...prev,
    lastStatus: info.status ?? prev.lastStatus ?? null,
    lastTool: info.tool ?? prev.lastTool ?? null,
    lastObservationId: info.observationId ?? prev.lastObservationId ?? null,
    hits: (prev.hits ?? 0) + 1,
    lastAt: new Date().toISOString(),
  };
}

export { createInitialState, addObservation, updatePathStats };
