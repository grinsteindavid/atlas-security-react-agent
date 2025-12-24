import { shouldForceTool, decisionRouter } from "../src/graph.js";
import { isApiOrAuthPath } from "../src/pathUtils.js";
import { MAX_REQ_PER_RUN, MAX_HOPS } from "../src/config.js";
import { createInitialState } from "../src/state.js";
import { CONFIDENCE_LEVELS, MAX_ACTIONS_PER_DECISION } from "../src/constants.js";

describe("isApiOrAuthPath", () => {
  test("returns true for API paths", () => {
    expect(isApiOrAuthPath("/api/users")).toBe(true);
    expect(isApiOrAuthPath("/api/v1/products")).toBe(true);
    expect(isApiOrAuthPath("/rest/products")).toBe(true);
    expect(isApiOrAuthPath("/v1/users")).toBe(true);
    expect(isApiOrAuthPath("/v2/orders")).toBe(true);
    expect(isApiOrAuthPath("/graphql")).toBe(true);
  });

  test("returns true for auth paths", () => {
    expect(isApiOrAuthPath("/login")).toBe(true);
    expect(isApiOrAuthPath("/auth/callback")).toBe(true);
    expect(isApiOrAuthPath("/register")).toBe(true);
    expect(isApiOrAuthPath("/password/reset")).toBe(true);
    expect(isApiOrAuthPath("/token")).toBe(true);
    expect(isApiOrAuthPath("/session")).toBe(true);
    expect(isApiOrAuthPath("/account")).toBe(true);
  });

  test("returns true for admin paths", () => {
    expect(isApiOrAuthPath("/admin")).toBe(true);
    expect(isApiOrAuthPath("/admin/users")).toBe(true);
  });

  test("returns true for sensitive paths", () => {
    expect(isApiOrAuthPath("/swagger")).toBe(true);
    expect(isApiOrAuthPath("/openapi")).toBe(true);
    expect(isApiOrAuthPath("/config")).toBe(true);
    expect(isApiOrAuthPath("/debug")).toBe(true);
    expect(isApiOrAuthPath("/backup")).toBe(true);
  });

  test("returns false for static/generic paths", () => {
    expect(isApiOrAuthPath("/")).toBe(false);
    expect(isApiOrAuthPath("/about")).toBe(false);
    expect(isApiOrAuthPath("/contact")).toBe(false);
    expect(isApiOrAuthPath("/styles.css")).toBe(false);
  });

  test("handles null/undefined", () => {
    expect(isApiOrAuthPath(null)).toBe(false);
    expect(isApiOrAuthPath(undefined)).toBe(false);
    expect(isApiOrAuthPath("")).toBe(false);
  });

  test("is case insensitive", () => {
    expect(isApiOrAuthPath("/API/Users")).toBe(true);
    expect(isApiOrAuthPath("/LOGIN")).toBe(true);
    expect(isApiOrAuthPath("/Admin")).toBe(true);
  });
});

describe("shouldForceTool", () => {
  function createState(overrides = {}) {
    return {
      hops: 0,
      toolUsage: {
        http_get: 0,
        http_post: 0,
        inspect_headers: 0,
        provoke_error: 0,
        measure_timing: 0,
        captcha_fetch: 0,
      },
      ...overrides,
    };
  }

  test("returns null before DIVERSITY_INTERVAL hops", () => {
    const state = createState({ hops: 3 });
    expect(shouldForceTool(state)).toBeNull();
  });

  test("forces inspect_headers if never used after interval", () => {
    const state = createState({
      hops: 5,
      toolUsage: { http_get: 5, http_post: 0, inspect_headers: 0, provoke_error: 0 },
    });
    expect(shouldForceTool(state)).toBe("inspect_headers");
  });

  test("forces provoke_error if inspect_headers used but provoke_error not", () => {
    const state = createState({
      hops: 5,
      toolUsage: { http_get: 4, http_post: 0, inspect_headers: 1, provoke_error: 0 },
    });
    expect(shouldForceTool(state)).toBe("provoke_error");
  });

  test("returns null if both required tools have been used", () => {
    const state = createState({
      hops: 6,
      toolUsage: { http_get: 4, http_post: 0, inspect_headers: 1, provoke_error: 1 },
    });
    expect(shouldForceTool(state)).toBeNull();
  });

  test("forces least used tool at diversity interval multiples", () => {
    const state = createState({
      hops: 10,
      toolUsage: { http_get: 8, http_post: 0, inspect_headers: 1, provoke_error: 1 },
    });
    const forced = shouldForceTool(state);
    expect(["inspect_headers", "provoke_error"]).toContain(forced);
  });
});

describe("decisionRouter", () => {
  function createState(overrides = {}) {
    return {
      hops: 0,
      metrics: { requests: 0, perTool: {}, errors: [] },
      consecutiveSkips: 0,
      decision: "probe",
      ...overrides,
    };
  }

  test("returns 'report' when max hops reached", () => {
    const state = createState({ hops: MAX_HOPS });
    expect(decisionRouter(state)).toBe("report");
    expect(state.stopReason).toBe("max_hops");
  });

  test("returns 'report' when budget exhausted", () => {
    const state = createState({
      hops: 5,
      metrics: { requests: MAX_REQ_PER_RUN, perTool: {}, errors: [] },
    });
    expect(decisionRouter(state)).toBe("report");
    expect(state.stopReason).toBe("budget_exhausted");
  });

  test("returns 'report' when consecutive skips >= 3", () => {
    const state = createState({ consecutiveSkips: 3 });
    expect(decisionRouter(state)).toBe("report");
    expect(state.stopReason).toBe("no_valid_paths");
  });

  test("returns 'report' when decision is report", () => {
    const state = createState({ decision: "report" });
    expect(decisionRouter(state)).toBe("report");
    expect(state.stopReason).toBe("decision_report");
  });

  test("returns 'probe' when no stop conditions met", () => {
    const state = createState({
      hops: 5,
      metrics: { requests: 10, perTool: {}, errors: [] },
      consecutiveSkips: 0,
      decision: "probe",
    });
    expect(decisionRouter(state)).toBe("probe");
  });
});

describe("batch execution state", () => {
  test("nextActions array is initialized empty", () => {
    const state = createInitialState();
    expect(state.nextActions).toEqual([]);
  });

  test("batchStats is initialized with zeros", () => {
    const state = createInitialState();
    expect(state.batchStats).toEqual({
      totalBatches: 0,
      totalActions: 0,
    });
  });
});

describe("confidence calibration constants", () => {
  test("CONFIDENCE_LEVELS has correct structure", () => {
    expect(CONFIDENCE_LEVELS.SPECULATION).toHaveProperty("min");
    expect(CONFIDENCE_LEVELS.SPECULATION).toHaveProperty("max");
    expect(CONFIDENCE_LEVELS.SPECULATION).toHaveProperty("desc");
    expect(CONFIDENCE_LEVELS.INDIRECT).toBeDefined();
    expect(CONFIDENCE_LEVELS.DIRECT).toBeDefined();
  });

  test("confidence ranges are valid", () => {
    expect(CONFIDENCE_LEVELS.SPECULATION.min).toBeLessThan(CONFIDENCE_LEVELS.SPECULATION.max);
    expect(CONFIDENCE_LEVELS.INDIRECT.min).toBeLessThan(CONFIDENCE_LEVELS.INDIRECT.max);
    expect(CONFIDENCE_LEVELS.DIRECT.min).toBeLessThan(CONFIDENCE_LEVELS.DIRECT.max);
  });

  test("MAX_ACTIONS_PER_DECISION is defined", () => {
    expect(MAX_ACTIONS_PER_DECISION).toBeGreaterThan(0);
    expect(MAX_ACTIONS_PER_DECISION).toBeLessThanOrEqual(10);
  });
});
