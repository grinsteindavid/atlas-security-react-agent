import "dotenv/config";
import { runOnce } from "./graph.js";
import { TARGET_URL, WAIT_FOR_TARGET_MS, WAIT_FOR_TARGET_INTERVAL_MS } from "./config.js";

/**
 * Check if target is healthy and reachable.
 * @returns {Promise<{healthy: boolean, status?: number, error?: string}>}
 */
async function checkTargetHealth() {
  try {
    const res = await fetch(TARGET_URL, { method: "GET", redirect: "manual" });
    const healthy = res.ok || res.status === 301 || res.status === 302;
    return { healthy, status: res.status };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

/**
 * Wait for target to become healthy within timeout.
 * @returns {Promise<boolean>} True if target became healthy
 */
async function waitForTarget() {
  const deadline = Date.now() + WAIT_FOR_TARGET_MS;
  let attempts = 0;
  
  while (Date.now() < deadline) {
    attempts += 1;
    const result = await checkTargetHealth();
    if (result.healthy) {
      console.log(`Target healthy (status ${result.status}) after ${attempts} attempt(s).`);
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(WAIT_FOR_TARGET_INTERVAL_MS, remaining))
    );
  }
  return false;
}

/**
 * Entrypoint: run the agent once.
 */
async function main() {
  console.log(`[startup] Checking target health: ${TARGET_URL}`);
  
  const health = await checkTargetHealth();
  
  if (!health.healthy) {
    if (WAIT_FOR_TARGET_MS > 0) {
      console.log(`[startup] Target not healthy, waiting up to ${WAIT_FOR_TARGET_MS}ms...`);
      const becameHealthy = await waitForTarget();
      if (!becameHealthy) {
        throw new Error(`Target ${TARGET_URL} not reachable after ${WAIT_FOR_TARGET_MS}ms`);
      }
    } else {
      const reason = health.error ?? `status ${health.status}`;
      throw new Error(`Target ${TARGET_URL} not healthy (${reason}). Set WAIT_FOR_TARGET_MS to retry.`);
    }
  } else {
    console.log(`[startup] Target healthy (status ${health.status})`);
  }

  await runOnce();
}

main().catch((err) => {
  console.error("Run failed:", err);
  process.exit(1);
});
