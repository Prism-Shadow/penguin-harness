/**
 * The release installers staged into this app's dist/ by scripts/build-assets.mjs.
 *
 * The Machines page scp's one of them to an SSH host and runs it there; install-server.ts
 * resolves it beside its own module, which in a packaged app is dist/server.js. The server
 * package ships them in its own dist/, but this app re-bundles the server into one file and
 * a bundle carries no sibling files — so nothing in the module graph would notice them going
 * missing, and a remote install would fail at "prepare the installer" instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

describe("staged release installers", () => {
  it.each(["install.sh", "install.ps1"])("%s is copied into dist at build time", (name) => {
    const built = path.join(pkgDir, "dist", name);
    if (!fs.existsSync(built)) return; // Not built in this run; `pnpm build` covers it in CI.
    expect(fs.readFileSync(built, "utf8")).toBe(fs.readFileSync(path.join(repoRoot, name), "utf8"));
  });
});
