/**
 * Create the initial agent state for a single run.
 */
function createInitialState() {
  return {
    observations: [],
    reasoningLog: [],
    decision: "probe",
    runStartedAt: new Date().toISOString(),
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
