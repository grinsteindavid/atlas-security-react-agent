import { client, toObservation } from "./httpClient.js";
import { addObservation } from "./state.js";
import { TARGET_URL, MAX_REQ_PER_RUN } from "./config.js";

let requestCount = 0;

/**
 * Enforce a per-run HTTP budget.
 * @throws {Error} when budget exceeded
 */
function checkBudget() {
  if (requestCount >= MAX_REQ_PER_RUN) {
    throw new Error(`Request budget exceeded (${MAX_REQ_PER_RUN})`);
  }
}

/**
 * Resolve a path against the configured target URL.
 * @param {string} path
 * @returns {string}
 */
function buildUrl(path) {
  return new URL(path, TARGET_URL).toString();
}

/**
 * GET wrapper with observation logging.
 * @param {object} state
 * @param {string} path
 * @param {string} label
 */
async function httpGet(state, path, label = "httpGet") {
  checkBudget();
  requestCount += 1;
  const url = buildUrl(path);
  const startedAt = Date.now();
  const resp = await client.get(url);
  return addObservation(
    state,
    toObservation(resp, { tool: "httpGet", label, url, method: "GET", startedAt })
  );
}

/**
 * POST wrapper with observation logging.
 * @param {object} state
 * @param {string} path
 * @param {any} data
 * @param {string} label
 */
async function httpPost(state, path, data, label = "httpPost") {
  checkBudget();
  requestCount += 1;
  const url = buildUrl(path);
  const startedAt = Date.now();
  const resp = await client.post(url, data, {
    headers: { "Content-Type": "application/json" },
  });
  return addObservation(
    state,
    toObservation(resp, {
      tool: "httpPost",
      label,
      url,
      method: "POST",
      startedAt,
      note: "json",
    })
  );
}

/**
 * Header audit via GET.
 * @param {object} state
 * @param {string} path
 * @param {string} label
 */
async function inspectHeaders(state, path = "/", label = "inspectHeaders") {
  checkBudget();
  requestCount += 1;
  const url = buildUrl(path);
  const startedAt = Date.now();
  const resp = await client.get(url);
  return addObservation(
    state,
    toObservation(resp, {
      tool: "inspectHeaders",
      label,
      url,
      method: "GET",
      startedAt,
      note: "header audit",
    })
  );
}

/**
 * Send malformed JSON to provoke verbose errors.
 * @param {object} state
 * @param {string} path
 * @param {string} label
 */
async function provokeError(state, path, label = "provokeError") {
  checkBudget();
  requestCount += 1;
  const url = buildUrl(path);
  const startedAt = Date.now();
  const malformed = "{ bad: }";
  const resp = await client.post(url, malformed, {
    headers: { "Content-Type": "application/json" },
  });
  return addObservation(
    state,
    toObservation(resp, {
      tool: "provokeError",
      label,
      url,
      method: "POST",
      startedAt,
      note: "malformed json",
    })
  );
}

/**
 * Compare timing between control and test POST bodies.
 * @param {object} state
 * @param {string} path
 * @param {any} controlData
 * @param {any} testData
 * @param {string} label
 */
async function measureTiming(state, path, controlData, testData, label = "measureTiming") {
  checkBudget();
  requestCount += 2;
  const url = buildUrl(path);

  const startCtrl = Date.now();
  const ctrlResp = await client.post(url, controlData, {
    headers: { "Content-Type": "application/json" },
  });
  const ctrlElapsed = Date.now() - startCtrl;

  const startTest = Date.now();
  const testResp = await client.post(url, testData, {
    headers: { "Content-Type": "application/json" },
  });
  const testElapsed = Date.now() - startTest;

  const obs = addObservation(
    state,
    toObservation(testResp, {
      tool: "measureTiming",
      label,
      url,
      method: "POST",
      startedAt: startTest,
      note: `ctrl=${ctrlElapsed}ms test=${testElapsed}ms delta=${testElapsed - ctrlElapsed}ms`,
    })
  );

  return { observation: obs, controlMs: ctrlElapsed, testMs: testElapsed };
}

export {
  httpGet,
  httpPost,
  inspectHeaders,
  provokeError,
  measureTiming,
};
