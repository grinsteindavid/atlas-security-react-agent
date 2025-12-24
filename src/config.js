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
 * Max decision hops per run.
 * Default 40 to allow ~2 requests per hop average with 80 request budget.
 */
const MAX_HOPS = Number.parseInt(process.env.MAX_HOPS ?? "40", 10);

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

/**
 * Wait time before agent starts (ms) to let target come up.
 */
const WAIT_FOR_TARGET_MS = Number.parseInt(
  process.env.WAIT_FOR_TARGET_MS ?? "0",
  10
);

/**
 * Interval between availability checks (ms) when waiting for target.
 */
const WAIT_FOR_TARGET_INTERVAL_MS = Number.parseInt(
  process.env.WAIT_FOR_TARGET_INTERVAL_MS ?? "1000",
  10
);

/**
 * Max times to hit the same path per run.
 */
const MAX_HITS_PER_PATH = Number.parseInt(
  process.env.MAX_HITS_PER_PATH ?? "2",
  10
);

export {
  TARGET_URL,
  MAX_REQ_PER_RUN,
  MAX_HOPS,
  REQ_TIMEOUT_MS,
  BODY_SNIPPET_BYTES,
  WAIT_FOR_TARGET_MS,
  WAIT_FOR_TARGET_INTERVAL_MS,
  MAX_HITS_PER_PATH,
};
