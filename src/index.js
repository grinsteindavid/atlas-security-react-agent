import { runOnce } from "./graph.js";
import { TARGET_URL, WAIT_FOR_TARGET_MS, WAIT_FOR_TARGET_INTERVAL_MS } from "./config.js";

/**
 * Entrypoint: run the agent once.
 */
async function main() {
  if (WAIT_FOR_TARGET_MS > 0) {
    const deadline = Date.now() + WAIT_FOR_TARGET_MS;
    let attempts = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      try {
        const res = await fetch(TARGET_URL, { method: "GET", redirect: "manual" });
        if (res.ok || res.status === 301 || res.status === 302) {
          console.log(`Target reachable (status ${res.status}) after ${attempts} attempt(s).`);
          break;
        }
      } catch (_err) {
        // ignore and retry
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(WAIT_FOR_TARGET_INTERVAL_MS, remaining))
      );
    }
  }
  await runOnce();
}

main().catch((err) => {
  console.error("Run failed:", err);
  process.exit(1);
});
