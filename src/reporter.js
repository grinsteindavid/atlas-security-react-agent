import fs from "fs/promises";

/**
 * Extract security findings from observations.
 * @param {object} state
 * @returns {object[]} Array of finding objects
 */
function extractFindings(state) {
  const findings = [];
  const seen = new Set();

  for (const obs of state.observations ?? []) {
    const url = obs.url ?? "";
    const headers = obs.headers ?? {};
    const body = obs.bodySnippet ?? "";

    // Stack trace disclosure (500 with stack)
    if (obs.status >= 500 && body.includes('"stack"')) {
      const key = `stack_trace:${new URL(url).pathname}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          type: "information_disclosure",
          subtype: "stack_trace",
          severity: "medium",
          path: new URL(url).pathname,
          evidence: "Server returned stack trace in error response",
          owasp: "A05:2021-Security Misconfiguration",
          observationId: obs.id,
        });
      }
    }

    // CORS wildcard
    if (headers["access-control-allow-origin"] === "*") {
      const key = "cors_wildcard";
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          type: "security_misconfiguration",
          subtype: "cors_wildcard",
          severity: "low",
          path: new URL(url).pathname,
          evidence: "Access-Control-Allow-Origin: *",
          owasp: "A05:2021-Security Misconfiguration",
          observationId: obs.id,
        });
      }
    }

    // Missing HSTS
    if (!headers["strict-transport-security"]) {
      const key = "missing_hsts";
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          type: "security_misconfiguration",
          subtype: "missing_hsts",
          severity: "low",
          path: new URL(url).pathname,
          evidence: "No Strict-Transport-Security header",
          owasp: "A05:2021-Security Misconfiguration",
          observationId: obs.id,
        });
      }
    }

    // Missing CSP
    if (!headers["content-security-policy"]) {
      const key = "missing_csp";
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          type: "security_misconfiguration",
          subtype: "missing_csp",
          severity: "low",
          path: new URL(url).pathname,
          evidence: "No Content-Security-Policy header",
          owasp: "A05:2021-Security Misconfiguration",
          observationId: obs.id,
        });
      }
    }

    // Auth error disclosure
    if (obs.status === 401 && body.includes("UnauthorizedError")) {
      const key = `auth_disclosure:${new URL(url).pathname}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          type: "information_disclosure",
          subtype: "auth_error_details",
          severity: "low",
          path: new URL(url).pathname,
          evidence: "Detailed auth error structure exposed",
          owasp: "A01:2021-Broken Access Control",
          observationId: obs.id,
        });
      }
    }

    // Server/version disclosure
    if (headers["server"] || headers["x-powered-by"]) {
      const key = "server_disclosure";
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          type: "information_disclosure",
          subtype: "server_banner",
          severity: "info",
          path: new URL(url).pathname,
          evidence: `Server: ${headers["server"] ?? ""}, X-Powered-By: ${headers["x-powered-by"] ?? ""}`.trim(),
          owasp: "A05:2021-Security Misconfiguration",
          observationId: obs.id,
        });
      }
    }
  }

  return findings;
}

/**
 * Summarize OWASP category counts from reasoning log.
 * @param {object[]} reasoningLog
 * @returns {{category: string, count: number}[]}
 */
function summarizeOwaspCategories(reasoningLog) {
  const counts = {};
  for (const entry of reasoningLog ?? []) {
    const cat = entry.owasp_category ?? "Unknown";
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}

/**
 * Persist the reasoning trace and observations to disk.
 * @param {object} state
 * @param {string} [path]
 * @returns {Promise<string>} written file path
 */
async function writeTrace(state, path) {
  const targetPath =
    path ??
    `traces/trace-${state.runId ?? new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  const findings = extractFindings(state);
  const owaspSummary = summarizeOwaspCategories(state.reasoningLog);

  const payload = {
    run_id: state.runId,
    target: process.env.TARGET_URL ?? "http://juice-shop:3000",
    startedAt: state.runStartedAt,
    finishedAt: new Date().toISOString(),
    summary: {
      findingsCount: findings.length,
      owaspCategories: owaspSummary,
      toolUsage: state.toolUsage ?? {},
      skippedHops: state.skippedHops ?? 0,
    },
    findings,
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

export { writeTrace, extractFindings, summarizeOwaspCategories };
