import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { REQ_TIMEOUT_MS, BODY_SNIPPET_BYTES } from "./config.js";

const jar = new CookieJar();

/**
 * Axios client with cookie jar, lax status validation, and timeout.
 */
const client = wrapper(
  axios.create({
    jar,
    timeout: REQ_TIMEOUT_MS,
    validateStatus: () => true,
  })
);

/**
 * Return a truncated, serializable body snippet.
 * @param {unknown} data
 * @returns {string}
 */
function bodySnippet(data) {
  if (data == null) return "";
  if (typeof data === "string") return data.slice(0, BODY_SNIPPET_BYTES);
  try {
    return JSON.stringify(data).slice(0, BODY_SNIPPET_BYTES);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Shape an HTTP response into an observation object.
 * @param {import('axios').AxiosResponse} resp
 * @param {object} meta
 * @returns {object}
 */
function toObservation(resp, meta) {
  const elapsed = meta.startedAt ? Date.now() - meta.startedAt : undefined;
  return {
    id: `${meta.tool}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tool: meta.tool,
    label: meta.label,
    url: meta.url,
    method: meta.method,
    status: resp.status,
    headers: resp.headers,
    bodySnippet: bodySnippet(resp.data),
    latencyMs: elapsed,
    timestamp: new Date().toISOString(),
    note: meta.note,
  };
}

/**
 * Get a summary of current session/cookie state.
 * @returns {Promise<object>}
 */
async function getSessionSummary() {
  try {
    const cookies = await jar.getCookies(process.env.TARGET_URL ?? "http://localhost:3000");
    const cookieNames = cookies.map((c) => c.key);
    const authIndicators = cookieNames.filter((name) =>
      /token|session|auth|jwt|sid|id/i.test(name)
    );
    return {
      hasCookies: cookies.length > 0,
      cookieCount: cookies.length,
      cookieNames: cookieNames.slice(0, 10),
      authIndicators,
      hasAuthCookies: authIndicators.length > 0,
    };
  } catch {
    return {
      hasCookies: false,
      cookieCount: 0,
      cookieNames: [],
      authIndicators: [],
      hasAuthCookies: false,
    };
  }
}

export { client, toObservation, getSessionSummary };
