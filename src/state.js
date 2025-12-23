/**
 * Create the initial agent state for a single run.
 */
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
    llmMeta: null,
    visitedPaths: [],
    hops: 0,
    stopReason: null,
    decisions: [],
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

export { createInitialState, addObservation };
