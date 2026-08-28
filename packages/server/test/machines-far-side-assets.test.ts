/**
 * The scripts that run on the FAR side, and the two places that have to ship them.
 *
 * `install-server.ts`, `upgrade.ts` and `signin.ts` each resolve their far-side script beside
 * the module that spawns it — `opts.assets?.() ?? path.dirname(import.meta.url)`. That is one
 * directory for a packaged install (dist/) and another for a hot-pushed bundle (the assets
 * published with that version), so the same four files have to be produced by two different
 * builds: `packages/server/tsup.config.ts`'s onSuccess, and `scripts/deploy.mjs`'s asset list.
 *
 * They drifted. deploy.mjs shipped the two installers and not the two `.cjs` appliers, so a
 * hot-pushed server could not upgrade a machine or sign in to one: both died on an ENOENT
 * naming a path inside its own store, and the sign-in failure surfaced as a bare 500. Nothing
 * failed at build time, because each list is valid on its own — only together are they wrong.
 *
 * Asserted as text against both producers: the invariant is "these two lists agree", and the
 * cheapest honest way to hold two hand-written lists together is to read them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");

/** Every file the machines code reads out of the assets directory at runtime. */
const FAR_SIDE = ["install.sh", "install.ps1", "remote-upgrade.cjs", "remote-signin.cjs"];

describe("the far-side scripts reach both kinds of installation", () => {
  it("the packaged build copies every one of them into dist/", () => {
    const tsup = fs.readFileSync(path.join(REPO, "packages", "server", "tsup.config.ts"), "utf8");
    for (const name of FAR_SIDE) expect(tsup).toContain(`"${name}"`);
  });

  it("a hot push ships every one of them as an asset", () => {
    // The half that was missing: a pushed bundle carries its own copy or it has none at all,
    // there being no packaged dist/ beneath it to fall back to.
    const deploy = fs.readFileSync(path.join(REPO, "scripts", "deploy.mjs"), "utf8");
    for (const name of FAR_SIDE) expect(deploy).toContain(`"${name}"`);
  });

  it("each of them exists in the tree to be shipped", () => {
    // A name in both lists and a file in neither would satisfy the two tests above while
    // failing at exactly the same place.
    for (const name of FAR_SIDE) {
      const source = name.endsWith(".cjs")
        ? path.join(REPO, "packages", "server", "src", "machines", name)
        : path.join(REPO, name);
      expect(fs.existsSync(source), `${name} is listed but not in the tree`).toBe(true);
    }
  });
});
