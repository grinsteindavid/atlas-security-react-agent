/**
 * File extensions considered static assets (skipped for deep probing).
 * @type {string[]}
 */
export const STATIC_EXTENSIONS = [
  ".css",
  ".js",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".map",
  ".eot",
];

/**
 * Tools the Cortex may invoke.
 * @type {string[]}
 */
export const ALLOWED_TOOLS = [
  "http_get",
  "http_post",
  "inspect_headers",
  "provoke_error",
  "measure_timing",
  "captcha_fetch",
];

/**
 * Regex patterns matching API-like paths.
 * @type {RegExp[]}
 */
export const API_PATH_PATTERNS = [
  /^\/(api|rest|v[0-9]+|graphql)/i,
];

/**
 * Regex patterns matching authentication-related paths.
 * @type {RegExp[]}
 */
export const AUTH_PATH_PATTERNS = [
  /(login|auth|admin|signin|account|user|profile|register|password|token|session)/i,
];

/**
 * Regex patterns matching sensitive or config paths.
 * @type {RegExp[]}
 */
export const SENSITIVE_PATH_PATTERNS = [
  /(swagger|openapi|config|debug|backup|ftp|\.git|\.env|docs)/i,
];

/**
 * Number of hops between forced tool diversity checks.
 * @type {number}
 */
export const DIVERSITY_INTERVAL = 5;

/**
 * Tools that must be used periodically for coverage.
 * @type {string[]}
 */
export const REQUIRED_DIVERSITY_TOOLS = ["inspect_headers", "provoke_error"];

/**
 * Confidence calibration guidelines for hypothesis scoring.
 * @type {object}
 */
export const CONFIDENCE_LEVELS = {
  SPECULATION: { min: 0.1, max: 0.3, desc: "Pattern-based guess, no direct evidence" },
  INDIRECT: { min: 0.4, max: 0.6, desc: "Circumstantial evidence (e.g., 401 response)" },
  DIRECT: { min: 0.7, max: 0.9, desc: "Clear evidence (e.g., stack trace, data leak)" },
};

/**
 * Maximum actions per LLM decision for batch execution.
 * @type {number}
 */
export const MAX_ACTIONS_PER_DECISION = 5;
