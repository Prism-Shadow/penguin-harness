/**
 * The fixture company module (test-fixtures/company-module), built the way a company module is:
 * its manifest generated into ifaces.json by gen-ifaces, its code bundled with the decorators
 * and company-proposals' `deploy` entry inside. Needs this package built (dist/deploy.js).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PLUGIN_DIR } from "./action-harness.js";

export const FIXTURE_DIR = path.join(PLUGIN_DIR, "test-fixtures", "company-module");
const REPO = path.resolve(PLUGIN_DIR, "..", "..");

/** What the built fixture exports, as the test reads it. */
export interface FixtureExports {
  followed: Array<{ key: string; outcome: string | undefined; by: string }>;
  deployCode: unknown;
  approveGuard: unknown;
  approveHook: unknown;
}

/** Builds the fixture (manifest, then bundle) and imports what it built. */
export async function buildFixture(): Promise<FixtureExports> {
  execFileSync(
    process.execPath,
    [
      path.join(REPO, "scripts", "gen-ifaces.mjs"),
      "--project",
      path.join(FIXTURE_DIR, "tsconfig.json"),
      "--out",
      path.join(FIXTURE_DIR, "ifaces.json"),
    ],
    { stdio: "pipe" },
  );
  await build({
    entryPoints: [path.join(FIXTURE_DIR, "src", "index.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    outfile: path.join(FIXTURE_DIR, "dist", "index.js"),
    alias: {
      "@prismshadow/penguin-plugin-company-proposals/deploy": path.join(
        PLUGIN_DIR,
        "dist",
        "deploy.js",
      ),
    },
    logLevel: "silent",
  });
  return (await import(
    pathToFileURL(path.join(FIXTURE_DIR, "dist", "index.js")).href
  )) as FixtureExports;
}
