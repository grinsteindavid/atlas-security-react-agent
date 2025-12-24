import { client, toObservation } from "./httpClient.js";
import { addObservation } from "./state.js";
import { TARGET_URL, MAX_REQ_PER_RUN } from "./config.js";
import { isStaticPath } from "./pathUtils.js";

function addCandidate(state, path) {
  if (!path || typeof path !== "string") return;
  if (state.visitedPaths.includes(path)) return;
  if (state.candidates.includes(path)) return;
  state.candidates.push(path);
}

function extractPathsFromContent(content) {
  if (typeof content !== "string") return [];
  const found = [];
  let m;

  // Standard href/action/src attributes
  const attrRegex = /(?:href|action|src)\s*=\s*["']([^"']+)["']/gi;
  while ((m = attrRegex.exec(content)) !== null) found.push(m[1]);

  // Hash-based SPA routes: /#/path or #/path
  const hashRouteRegex = /#\/([-\w\/]+)/g;
  while ((m = hashRouteRegex.exec(content)) !== null) found.push(`/#/${m[1]}`);

  // Paths in JS strings: "/path/to/something" (starting with /)
  const jsPathRegex = /["'`](\/[-\w\/]+)["'`]/g;
  while ((m = jsPathRegex.exec(content)) !== null) {
    const p = m[1];
    // Skip static assets and common non-paths
    if (!/\.(css|js|png|jpg|ico|svg|woff|map)$/i.test(p)) {
      found.push(p);
    }
  }

  // RouterLink / ng-href / v-bind:href patterns
  const frameworkRegex = /(?:routerLink|ng-href|:href|to)\s*=\s*["']([^"']+)["']/gi;
  while ((m = frameworkRegex.exec(content)) !== null) found.push(m[1]);

  // Fetch/axios calls: fetch("/path") or axios.get("/path")
  const fetchRegex = /(?:fetch|axios\.\w+|\$\.\w+)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = fetchRegex.exec(content)) !== null) found.push(m[1]);

  // URL patterns in comments or docs: GET /path, POST /path
  const methodRegex = /(?:GET|POST|PUT|DELETE|PATCH)\s+(\/[-\w\/{}:]+)/g;
  while ((m = methodRegex.exec(content)) !== null) found.push(m[1].replace(/\{[^}]+\}/g, "1"));

  return found;
}

function addCandidatesFromContent(state, baseUrl, content) {
  const found = extractPathsFromContent(content);
  
  for (const raw of found) {
    try {
      let candidatePath = null;

      // Handle hash routes
      if (raw.startsWith("/#/") || raw.startsWith("#/")) {
        candidatePath = raw.startsWith("#") ? `/${raw}` : raw;
      }
      // Handle absolute paths starting with /
      else if (raw.startsWith("/") && !raw.startsWith("//")) {
        candidatePath = raw.split("?")[0];
      }
      // Standard URL resolution for relative/full URLs
      else {
        const resolved = new URL(raw, baseUrl);
        if (resolved.origin !== new URL(TARGET_URL).origin) continue;
        candidatePath = resolved.pathname;
      }

      // Filter out static assets before adding
      if (candidatePath && !isStaticPath(candidatePath)) {
        addCandidate(state, candidatePath);
      }
    } catch (_err) {
      continue;
    }
  }
}

/**
 * Enforce a per-run HTTP budget.
 * @param {object} state
 * @throws {Error} when budget exceeded
 */
function checkBudget(state) {
  const currentRequests = state?.metrics?.requests ?? 0;
  if (currentRequests >= MAX_REQ_PER_RUN) {
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
 * Increment request metrics for a tool.
 * @param {object} state
 * @param {string} tool
 * @param {number} count
 */
function incrementMetrics(state, tool, count = 1) {
  if (!state.metrics) return;
  state.metrics.requests += count;
  state.metrics.perTool[tool] = (state.metrics.perTool[tool] ?? 0) + count;
}

/**
 * Record an error in metrics.
 * @param {object} state
 * @param {string} tool
 * @param {string} url
 * @param {Error} err
 */
function recordError(state, tool, url, err) {
  if (!state.metrics) return;
  state.metrics.errors.push({
    tool,
    url,
    message: err?.message ?? "unknown error",
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET wrapper with observation logging.
 * @param {object} state
 * @param {string} path
 * @param {string} label
 */
async function httpGet(state, path, label = "httpGet") {
  checkBudget(state);
  incrementMetrics(state, "httpGet");
  const url = buildUrl(path);
  const startedAt = Date.now();
  let resp;
  try {
    resp = await client.get(url);
  } catch (err) {
    recordError(state, "httpGet", url, err);
    throw err;
  }
  const obs = addObservation(
    state,
    toObservation(resp, { tool: "httpGet", label, url, method: "GET", startedAt })
  );
  addCandidatesFromContent(state, url, resp?.data);
  return obs;
}

/**
 * POST wrapper with observation logging.
 * @param {object} state
 * @param {string} path
 * @param {any} data
 * @param {string} label
 */
async function httpPost(state, path, data, label = "httpPost") {
  checkBudget(state);
  incrementMetrics(state, "httpPost");
  const url = buildUrl(path);
  const startedAt = Date.now();
  let resp;
  try {
    resp = await client.post(url, data, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    recordError(state, "httpPost", url, err);
    throw err;
  }
  const obs = addObservation(
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
  return obs;
}

/**
 * Header audit via GET.
 * @param {object} state
 * @param {string} path
 * @param {string} label
 */
async function inspectHeaders(state, path = "/", label = "inspectHeaders") {
  checkBudget(state);
  incrementMetrics(state, "inspectHeaders");
  const url = buildUrl(path);
  const startedAt = Date.now();
  let resp;
  try {
    resp = await client.get(url);
  } catch (err) {
    recordError(state, "inspectHeaders", url, err);
    throw err;
  }
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
  checkBudget(state);
  incrementMetrics(state, "provokeError");
  const url = buildUrl(path);
  const startedAt = Date.now();
  const malformed = "{ bad: }";
  let resp;
  try {
    resp = await client.post(url, malformed, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    recordError(state, "provokeError", url, err);
    throw err;
  }
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
 * Fetch CAPTCHA metadata to obtain captchaId and image reference.
 * @param {object} state
 * @param {string} path
 * @param {string} label
 */
async function captchaFetch(state, path = "/rest/captcha", label = "captchaFetch") {
  checkBudget(state);
  incrementMetrics(state, "captchaFetch");
  const url = buildUrl(path);
  const startedAt = Date.now();
  let resp;
  try {
    resp = await client.get(url);
  } catch (err) {
    recordError(state, "captchaFetch", url, err);
    throw err;
  }
  const data = resp?.data ?? {};
  state.captcha = {
    captchaId: data.captchaId ?? data.id ?? null,
    captcha: data.captcha ?? null,
    answer: data.answer ?? null,
    fetchedAt: new Date().toISOString(),
  };
  return addObservation(
    state,
    toObservation(resp, {
      tool: "captchaFetch",
      label,
      url,
      method: "GET",
      startedAt,
      note: "captcha",
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
  checkBudget(state);
  incrementMetrics(state, "measureTiming", 2);
  const url = buildUrl(path);

  const startCtrl = Date.now();
  let ctrlResp;
  try {
    ctrlResp = await client.post(url, controlData, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    recordError(state, "measureTiming", url, err);
    throw err;
  }
  const ctrlElapsed = Date.now() - startCtrl;

  const startTest = Date.now();
  let testResp;
  try {
    testResp = await client.post(url, testData, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    recordError(state, "measureTiming", url, err);
    throw err;
  }
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
  captchaFetch,
  extractPathsFromContent,
};
