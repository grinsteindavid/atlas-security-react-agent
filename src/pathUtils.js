import {
  STATIC_EXTENSIONS,
  API_PATH_PATTERNS,
  AUTH_PATH_PATTERNS,
  SENSITIVE_PATH_PATTERNS,
} from "./constants.js";

/**
 * Check if a path points to a static asset.
 * @param {string} path
 * @returns {boolean}
 */
export function isStaticPath(path) {
  if (!path || typeof path !== "string") return false;
  const lower = path.toLowerCase().split("?")[0];
  return STATIC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Check if a path matches API endpoint patterns.
 * @param {string} path
 * @returns {boolean}
 */
export function isApiPath(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  return API_PATH_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Check if a path matches authentication-related patterns.
 * @param {string} path
 * @returns {boolean}
 */
export function isAuthPath(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  return AUTH_PATH_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Check if a path matches sensitive/config patterns.
 * @param {string} path
 * @returns {boolean}
 */
export function isSensitivePath(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Check if a path is API, auth, or sensitive.
 * @param {string} path
 * @returns {boolean}
 */
export function isApiOrAuthPath(path) {
  if (!path) return false;
  return isApiPath(path) || isAuthPath(path) || isSensitivePath(path);
}

/**
 * Score a path for exploration priority.
 * @param {string} path
 * @param {object} state
 * @returns {{path: string, score: number, hits: number, lastStatus: number|null, lastTool: string|null}}
 */
export function scorePath(path, state) {
  if (!path) return { path, score: -10, hits: 0, lastStatus: null, lastTool: null };

  const lower = path.toLowerCase();
  const hits = state.pathHits?.[path] ?? 0;
  const stat = state.pathStats?.[path] ?? {};
  const maxHitsPerPath = state.maxHitsPerPath ?? 2;

  let score = 0;

  // Unvisited bonus
  const unvisited = !state.visitedPaths?.includes(path);
  if (unvisited) score += 2;

  // Hit penalty
  if (hits >= maxHitsPerPath) score -= 3;
  else score -= hits;

  // Static penalty
  if (isStaticPath(path)) score -= 2;

  // API/auth bonus
  if (isApiPath(path)) score += 3;
  if (isAuthPath(path)) score += 3;
  if (isSensitivePath(path)) score += 2;

  // Status-based scoring
  if (stat.lastStatus >= 500) score += 2;
  else if (stat.lastStatus >= 400) score += 1;

  return {
    path,
    score,
    hits,
    lastStatus: stat.lastStatus ?? null,
    lastTool: stat.lastTool ?? null,
  };
}
