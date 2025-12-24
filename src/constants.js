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

export const ALLOWED_TOOLS = [
  "http_get",
  "http_post",
  "inspect_headers",
  "provoke_error",
  "measure_timing",
  "captcha_fetch",
];

export const API_PATH_PATTERNS = [
  /^\/(api|rest|v[0-9]+|graphql)/i,
];

export const AUTH_PATH_PATTERNS = [
  /(login|auth|admin|signin|account|user|profile|register|password|token|session)/i,
];

export const SENSITIVE_PATH_PATTERNS = [
  /(swagger|openapi|config|debug|backup|ftp|\.git|\.env|docs)/i,
];

export const DIVERSITY_INTERVAL = 5;

export const REQUIRED_DIVERSITY_TOOLS = ["inspect_headers", "provoke_error"];
