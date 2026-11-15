// probe: run inside vitest (the exact test process env) — print npm_config_*
// and what execFile("npm") resolves to. Dropped as a temp test file, run, removed.
import { it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

it("probe env", async () => {
  const run = promisify(execFile);
  const ks = Object.keys(process.env).filter((k) => k.startsWith("npm_config_"));
  console.log("P263PROBE npm_config keys:", JSON.stringify(ks));
  for (const k of ks) console.log("P263PROBE", k, "=", process.env[k]);
  const which = await run("which", ["npm"], { env: process.env });
  console.log("P263PROBE npm at:", which.stdout.trim());
  const ver = await run("npm", ["--version"], { env: process.env });
  console.log("P263PROBE npm version:", ver.stdout.trim());
});
