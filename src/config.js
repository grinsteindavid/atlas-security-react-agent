/**
 * Target root URL (default Juice Shop in Docker).
 */
const TARGET_URL = process.env.TARGET_URL ?? "http://juice-shop:3000";

/**
 * Max HTTP calls allowed per run.
 */
const MAX_REQ_PER_RUN = Number.parseInt(
  process.env.MAX_REQ_PER_RUN ?? "80",
  10
);

/**
 * Per-request timeout in milliseconds.
 */
const REQ_TIMEOUT_MS = Number.parseInt(
  process.env.REQ_TIMEOUT_MS ?? "5000",
  10
);

/**
 * Max bytes of response body to keep in observations.
 */
const BODY_SNIPPET_BYTES = 2000;

export {
  TARGET_URL,
  MAX_REQ_PER_RUN,
  REQ_TIMEOUT_MS,
  BODY_SNIPPET_BYTES,
};
