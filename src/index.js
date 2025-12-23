import { runOnce } from "./graph.js";

/**
 * Entrypoint: execute a single Reason -> Act -> Observe run.
 */
async function main() {
  await runOnce();
}

main().catch((err) => {
  console.error("Run failed:", err);
  process.exit(1);
});
