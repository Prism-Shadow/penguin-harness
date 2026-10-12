/**
 * Whether code runs from a source checkout of this repository — what picks the default data
 * root when PENGUIN_HOME is unset.
 *
 * - Given this repository's workspace, a module anywhere below it is in the checkout: a bundle
 *   in `packages/cli/dist`, and the copy of core pnpm injects under `node_modules/.pnpm/`.
 * - Given an installation, nothing is found: the installer's `~/.penguin/lib/dist`, and the SDK
 *   installed from npm into another pnpm workspace, whose `pnpm-workspace.yaml` is not this
 *   repository's.
 * - The checkout these tests run from is found, so the marker is the one this repository has.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceCheckoutRoot } from "../src/internal/source-checkout.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-checkout-"));
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

/** A directory tree with the given files (contents as given), all under `tmp`. */
async function tree(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(tmp, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content);
  }
}

const workspace = "packages:\n  - packages/*\n";
const corePackage = JSON.stringify({ name: "@prismshadow/penguin-core" });

describe("sourceCheckoutRoot", () => {
  it("finds this repository's checkout from a bundle in it and from a pnpm-injected copy", async () => {
    const repo = path.join(tmp, "penguin-harness");
    const injected = "node_modules/.pnpm/@prismshadow+penguin-core@file+packages+core/node_modules";
    await tree({
      "penguin-harness/pnpm-workspace.yaml": workspace,
      "penguin-harness/packages/core/package.json": corePackage,
      "penguin-harness/packages/cli/dist/penguin.js": "",
      [`penguin-harness/${injected}/@prismshadow/penguin-core/dist/index.js`]: "",
    });

    expect(sourceCheckoutRoot(path.join(repo, "packages", "cli", "dist"))).toBe(repo);
    const copy = path.join(repo, injected, "@prismshadow", "penguin-core", "dist");
    expect(sourceCheckoutRoot(copy)).toBe(repo);
  });

  it("finds nothing for the installer's layout", async () => {
    await tree({ "home/.penguin/lib/dist/penguin.js": "", "home/.penguin/data/server.lock": "" });

    expect(sourceCheckoutRoot(path.join(tmp, "home", ".penguin", "lib", "dist"))).toBeNull();
  });

  it("finds nothing for the SDK installed into another pnpm workspace", async () => {
    await tree({
      "app/pnpm-workspace.yaml": workspace,
      "app/packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
      "app/node_modules/@prismshadow/penguin-core/package.json": corePackage,
      "app/node_modules/@prismshadow/penguin-core/dist/index.js": "",
    });

    const sdk = path.join(tmp, "app", "node_modules", "@prismshadow", "penguin-core", "dist");
    expect(sourceCheckoutRoot(sdk)).toBeNull();
  });

  it("finds the checkout these tests run from", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    expect(sourceCheckoutRoot(here)).toBe(path.resolve(here, "..", "..", ".."));
  });
});
