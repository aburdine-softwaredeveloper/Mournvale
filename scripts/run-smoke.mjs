/**
 * run-smoke.mjs — Discovers and runs every *.smoke.ts under src/ via tsx.
 *
 * These are dependency-free assertion scripts (node:assert) co-located next to
 * the code they exercise. This runner finds them all, runs each in its own
 * process, and exits non-zero if any fail. Invoked by `npm test`.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("../src", import.meta.url).pathname;

/** Recursively collect files ending in `.smoke.ts`. */
function findSmokeTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findSmokeTests(full));
    else if (entry.endsWith(".smoke.ts")) out.push(full);
  }
  return out.sort();
}

const tests = findSmokeTests(ROOT);
if (tests.length === 0) {
  console.log("No *.smoke.ts files found.");
  process.exit(0);
}

console.log(`Running ${tests.length} smoke test file(s)…\n`);

let failed = 0;
for (const file of tests) {
  const rel = file.replace(`${ROOT}/`, "src/");
  console.log(`▶ ${rel}`);
  const result = spawnSync("npx", ["tsx", file], { stdio: "inherit" });
  if (result.status !== 0) {
    failed++;
    console.error(`✗ FAILED: ${rel}\n`);
  } else {
    console.log("");
  }
}

if (failed > 0) {
  console.error(`\n${failed} smoke test file(s) failed.`);
  process.exit(1);
}
console.log("All smoke tests passed.");
