import { extractPathsFromContent } from "../src/tools.js";
import { isStaticPath } from "../src/pathUtils.js";

describe("isStaticPath", () => {
  test("returns true for CSS files", () => {
    expect(isStaticPath("/styles.css")).toBe(true);
    expect(isStaticPath("/assets/main.CSS")).toBe(true);
  });

  test("returns true for JS files", () => {
    expect(isStaticPath("/main.js")).toBe(true);
    expect(isStaticPath("/vendor.js")).toBe(true);
  });

  test("returns true for image files", () => {
    expect(isStaticPath("/logo.png")).toBe(true);
    expect(isStaticPath("/icon.ico")).toBe(true);
    expect(isStaticPath("/photo.jpg")).toBe(true);
    expect(isStaticPath("/image.jpeg")).toBe(true);
    expect(isStaticPath("/graphic.svg")).toBe(true);
    expect(isStaticPath("/animation.gif")).toBe(true);
    expect(isStaticPath("/image.webp")).toBe(true);
  });

  test("returns true for font files", () => {
    expect(isStaticPath("/fonts/roboto.woff")).toBe(true);
    expect(isStaticPath("/fonts/roboto.woff2")).toBe(true);
    expect(isStaticPath("/fonts/roboto.ttf")).toBe(true);
    expect(isStaticPath("/fonts/roboto.eot")).toBe(true);
  });

  test("returns true for map files", () => {
    expect(isStaticPath("/main.js.map")).toBe(true);
  });

  test("returns false for API paths", () => {
    expect(isStaticPath("/api/users")).toBe(false);
    expect(isStaticPath("/rest/products")).toBe(false);
    expect(isStaticPath("/graphql")).toBe(false);
  });

  test("returns false for HTML paths", () => {
    expect(isStaticPath("/")).toBe(false);
    expect(isStaticPath("/login")).toBe(false);
    expect(isStaticPath("/admin")).toBe(false);
  });

  test("handles query strings correctly", () => {
    expect(isStaticPath("/styles.css?v=123")).toBe(true);
    expect(isStaticPath("/api/users?page=1")).toBe(false);
  });

  test("handles null/undefined/invalid inputs", () => {
    expect(isStaticPath(null)).toBe(false);
    expect(isStaticPath(undefined)).toBe(false);
    expect(isStaticPath("")).toBe(false);
    expect(isStaticPath(123)).toBe(false);
  });
});

describe("extractPathsFromContent", () => {
  test("extracts href attributes", () => {
    const html = '<a href="/login">Login</a><a href="/register">Register</a>';
    const paths = extractPathsFromContent(html);
    expect(paths).toContain("/login");
    expect(paths).toContain("/register");
  });

  test("extracts action attributes", () => {
    const html = '<form action="/api/submit">...</form>';
    const paths = extractPathsFromContent(html);
    expect(paths).toContain("/api/submit");
  });

  test("extracts src attributes", () => {
    const html = '<script src="/main.js"></script><img src="/logo.png">';
    const paths = extractPathsFromContent(html);
    expect(paths).toContain("/main.js");
    expect(paths).toContain("/logo.png");
  });

  test("extracts hash-based SPA routes", () => {
    const content = 'Navigate to /#/dashboard or #/settings';
    const paths = extractPathsFromContent(content);
    expect(paths).toContain("/#/dashboard");
    expect(paths).toContain("/#/settings");
  });

  test("extracts paths from JS strings", () => {
    const js = 'fetch("/api/users"); axios.get("/rest/products");';
    const paths = extractPathsFromContent(js);
    expect(paths).toContain("/api/users");
    expect(paths).toContain("/rest/products");
  });

  test("extracts routerLink patterns", () => {
    const html = '<a routerLink="/dashboard">Dashboard</a>';
    const paths = extractPathsFromContent(html);
    expect(paths).toContain("/dashboard");
  });

  test("extracts HTTP method patterns", () => {
    const content = "GET /api/users POST /api/login DELETE /api/users/{id}";
    const paths = extractPathsFromContent(content);
    expect(paths).toContain("/api/users");
    expect(paths).toContain("/api/login");
    expect(paths).toContain("/api/users/1");
  });

  test("filters out static assets from JS paths", () => {
    const js = '"/api/data" "/styles.css" "/main.js"';
    const paths = extractPathsFromContent(js);
    expect(paths).toContain("/api/data");
    expect(paths).not.toContain("/styles.css");
    expect(paths).not.toContain("/main.js");
  });

  test("handles empty/invalid input", () => {
    expect(extractPathsFromContent("")).toEqual([]);
    expect(extractPathsFromContent(null)).toEqual([]);
    expect(extractPathsFromContent(undefined)).toEqual([]);
    expect(extractPathsFromContent(123)).toEqual([]);
  });

  test("extracts multiple paths from complex HTML", () => {
    const html = `
      <html>
        <head><link href="/styles.css"></head>
        <body>
          <a href="/login">Login</a>
          <a href="/#/dashboard">Dashboard</a>
          <script src="/main.js"></script>
          <script>fetch("/api/users")</script>
        </body>
      </html>
    `;
    const paths = extractPathsFromContent(html);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain("/login");
    expect(paths).toContain("/#/dashboard");
    expect(paths).toContain("/api/users");
  });
});
