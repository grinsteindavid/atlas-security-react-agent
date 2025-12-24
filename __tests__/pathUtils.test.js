import {
  isStaticPath,
  isApiPath,
  isAuthPath,
  isSensitivePath,
  isApiOrAuthPath,
  scorePath,
} from "../src/pathUtils.js";

describe("isApiPath", () => {
  test("returns true for /api paths", () => {
    expect(isApiPath("/api/users")).toBe(true);
    expect(isApiPath("/api/v1/products")).toBe(true);
  });

  test("returns true for /rest paths", () => {
    expect(isApiPath("/rest/products")).toBe(true);
  });

  test("returns true for versioned paths", () => {
    expect(isApiPath("/v1/users")).toBe(true);
    expect(isApiPath("/v2/orders")).toBe(true);
  });

  test("returns true for /graphql", () => {
    expect(isApiPath("/graphql")).toBe(true);
  });

  test("returns false for non-API paths", () => {
    expect(isApiPath("/login")).toBe(false);
    expect(isApiPath("/about")).toBe(false);
  });
});

describe("isAuthPath", () => {
  test("returns true for auth-related paths", () => {
    expect(isAuthPath("/login")).toBe(true);
    expect(isAuthPath("/auth/callback")).toBe(true);
    expect(isAuthPath("/register")).toBe(true);
    expect(isAuthPath("/password/reset")).toBe(true);
    expect(isAuthPath("/token")).toBe(true);
    expect(isAuthPath("/session")).toBe(true);
    expect(isAuthPath("/account")).toBe(true);
    expect(isAuthPath("/admin")).toBe(true);
    expect(isAuthPath("/user/profile")).toBe(true);
  });

  test("returns false for non-auth paths", () => {
    expect(isAuthPath("/about")).toBe(false);
    expect(isAuthPath("/products")).toBe(false);
  });
});

describe("isSensitivePath", () => {
  test("returns true for sensitive paths", () => {
    expect(isSensitivePath("/swagger")).toBe(true);
    expect(isSensitivePath("/openapi")).toBe(true);
    expect(isSensitivePath("/config")).toBe(true);
    expect(isSensitivePath("/debug")).toBe(true);
    expect(isSensitivePath("/backup")).toBe(true);
    expect(isSensitivePath("/.git")).toBe(true);
    expect(isSensitivePath("/.env")).toBe(true);
  });

  test("returns false for non-sensitive paths", () => {
    expect(isSensitivePath("/about")).toBe(false);
    expect(isSensitivePath("/products")).toBe(false);
  });
});

describe("scorePath", () => {
  function createState(overrides = {}) {
    return {
      visitedPaths: [],
      pathHits: {},
      pathStats: {},
      maxHitsPerPath: 2,
      ...overrides,
    };
  }

  test("gives bonus for unvisited paths", () => {
    const state = createState();
    const result = scorePath("/api/users", state);
    expect(result.score).toBeGreaterThan(0);
  });

  test("penalizes visited paths", () => {
    const state = createState({ visitedPaths: ["/api/users"] });
    const unvisitedScore = scorePath("/api/users", createState()).score;
    const visitedScore = scorePath("/api/users", state).score;
    expect(visitedScore).toBeLessThan(unvisitedScore);
  });

  test("penalizes static paths", () => {
    const state = createState();
    const apiScore = scorePath("/api/users", state).score;
    const staticScore = scorePath("/main.js", state).score;
    expect(staticScore).toBeLessThan(apiScore);
  });

  test("gives bonus for API paths", () => {
    const state = createState();
    const apiScore = scorePath("/api/users", state).score;
    const genericScore = scorePath("/about", state).score;
    expect(apiScore).toBeGreaterThan(genericScore);
  });

  test("gives bonus for auth paths", () => {
    const state = createState();
    const authScore = scorePath("/login", state).score;
    const genericScore = scorePath("/about", state).score;
    expect(authScore).toBeGreaterThan(genericScore);
  });

  test("gives bonus for 500 status", () => {
    const state = createState({
      pathStats: { "/api/error": { lastStatus: 500 } },
    });
    const errorScore = scorePath("/api/error", state).score;
    const normalScore = scorePath("/api/normal", state).score;
    expect(errorScore).toBeGreaterThan(normalScore);
  });

  test("handles null/undefined path", () => {
    const state = createState();
    const result = scorePath(null, state);
    expect(result.score).toBe(-10);
  });

  test("returns correct structure", () => {
    const state = createState();
    const result = scorePath("/api/users", state);
    expect(result).toHaveProperty("path", "/api/users");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("hits");
    expect(result).toHaveProperty("lastStatus");
    expect(result).toHaveProperty("lastTool");
  });
});
