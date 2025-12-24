import { extractFindings, summarizeOwaspCategories } from "../src/reporter.js";

describe("extractFindings", () => {
  function createObservation(overrides = {}) {
    return {
      id: "test-obs-1",
      url: "http://localhost:3000/api/test",
      status: 200,
      headers: {},
      bodySnippet: "",
      ...overrides,
    };
  }

  test("detects stack trace disclosure in 500 responses", () => {
    const state = {
      observations: [
        createObservation({
          status: 500,
          bodySnippet: '{"error":{"message":"Error","stack":"Error: Something\\n    at..."}}',
        }),
      ],
    };
    const findings = extractFindings(state);
    const stackFinding = findings.find((f) => f.subtype === "stack_trace");
    expect(stackFinding).toBeDefined();
    expect(stackFinding.type).toBe("information_disclosure");
    expect(stackFinding.severity).toBe("medium");
    expect(stackFinding.owasp).toBe("A05:2021-Security Misconfiguration");
  });

  test("detects CORS wildcard", () => {
    const state = {
      observations: [
        createObservation({
          headers: { "access-control-allow-origin": "*" },
        }),
      ],
    };
    const findings = extractFindings(state);
    const corsFinding = findings.find((f) => f.subtype === "cors_wildcard");
    expect(corsFinding).toBeDefined();
    expect(corsFinding.type).toBe("security_misconfiguration");
    expect(corsFinding.evidence).toBe("Access-Control-Allow-Origin: *");
  });

  test("detects missing HSTS header", () => {
    const state = {
      observations: [createObservation({ headers: {} })],
    };
    const findings = extractFindings(state);
    const hstsFinding = findings.find((f) => f.subtype === "missing_hsts");
    expect(hstsFinding).toBeDefined();
    expect(hstsFinding.evidence).toBe("No Strict-Transport-Security header");
  });

  test("does not flag missing HSTS if present", () => {
    const state = {
      observations: [
        createObservation({
          headers: { "strict-transport-security": "max-age=31536000" },
        }),
      ],
    };
    const findings = extractFindings(state);
    const hstsFinding = findings.find((f) => f.subtype === "missing_hsts");
    expect(hstsFinding).toBeUndefined();
  });

  test("detects missing CSP header", () => {
    const state = {
      observations: [createObservation({ headers: {} })],
    };
    const findings = extractFindings(state);
    const cspFinding = findings.find((f) => f.subtype === "missing_csp");
    expect(cspFinding).toBeDefined();
  });

  test("detects auth error disclosure", () => {
    const state = {
      observations: [
        createObservation({
          status: 401,
          bodySnippet: '{"error":{"name":"UnauthorizedError","message":"No auth"}}',
        }),
      ],
    };
    const findings = extractFindings(state);
    const authFinding = findings.find((f) => f.subtype === "auth_error_details");
    expect(authFinding).toBeDefined();
    expect(authFinding.owasp).toBe("A01:2021-Broken Access Control");
  });

  test("detects server banner disclosure", () => {
    const state = {
      observations: [
        createObservation({
          headers: { server: "nginx/1.18.0", "x-powered-by": "Express" },
        }),
      ],
    };
    const findings = extractFindings(state);
    const serverFinding = findings.find((f) => f.subtype === "server_banner");
    expect(serverFinding).toBeDefined();
    expect(serverFinding.severity).toBe("info");
  });

  test("deduplicates findings", () => {
    const state = {
      observations: [
        createObservation({
          id: "obs-1",
          headers: { "access-control-allow-origin": "*" },
        }),
        createObservation({
          id: "obs-2",
          url: "http://localhost:3000/api/other",
          headers: { "access-control-allow-origin": "*" },
        }),
      ],
    };
    const findings = extractFindings(state);
    const corsFindings = findings.filter((f) => f.subtype === "cors_wildcard");
    expect(corsFindings.length).toBe(1);
  });

  test("handles empty observations", () => {
    const state = { observations: [] };
    const findings = extractFindings(state);
    expect(findings).toEqual([]);
  });

  test("handles null/undefined observations", () => {
    expect(extractFindings({ observations: null })).toEqual([]);
    expect(extractFindings({})).toEqual([]);
  });
});

describe("summarizeOwaspCategories", () => {
  test("counts OWASP categories from reasoning log", () => {
    const reasoningLog = [
      { owasp_category: "A05:2021-Security Misconfiguration" },
      { owasp_category: "A05:2021-Security Misconfiguration" },
      { owasp_category: "A01:2021-Broken Access Control" },
    ];
    const summary = summarizeOwaspCategories(reasoningLog);
    expect(summary).toContainEqual({
      category: "A05:2021-Security Misconfiguration",
      count: 2,
    });
    expect(summary).toContainEqual({
      category: "A01:2021-Broken Access Control",
      count: 1,
    });
  });

  test("sorts by count descending", () => {
    const reasoningLog = [
      { owasp_category: "A01" },
      { owasp_category: "A05" },
      { owasp_category: "A05" },
      { owasp_category: "A05" },
    ];
    const summary = summarizeOwaspCategories(reasoningLog);
    expect(summary[0].category).toBe("A05");
    expect(summary[0].count).toBe(3);
  });

  test("handles missing owasp_category", () => {
    const reasoningLog = [{ owasp_category: "A05" }, { thought: "test" }, {}];
    const summary = summarizeOwaspCategories(reasoningLog);
    expect(summary).toContainEqual({ category: "A05", count: 1 });
    expect(summary).toContainEqual({ category: "Unknown", count: 2 });
  });

  test("handles empty/null reasoning log", () => {
    expect(summarizeOwaspCategories([])).toEqual([]);
    expect(summarizeOwaspCategories(null)).toEqual([]);
    expect(summarizeOwaspCategories(undefined)).toEqual([]);
  });
});
