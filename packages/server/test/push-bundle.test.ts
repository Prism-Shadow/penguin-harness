/**
 * A pushed build carries its npm dependencies (scripts/push-bundle.mjs, the compile a hot push and
 * a checkout's install image share).
 *
 * A machine installed from a checkout stands on a release whose `node_modules` belongs to another
 * version — release 0.2.13 has `@prismshadow/agenthub` 0.4 and no `@prismshadow/mmsp` — and runs
 * the pushed platform and CLI on top of it. If the bundle left the gateway library to be resolved
 * at run time, a Session there would get the release's client, and a newer client type would be
 * "not supported".
 *
 * - Given an entry that imports @prismshadow/mmsp, compiled with the push's own options, the
 *   bundle imports nothing of it at run time and runs where no node_modules exists at all.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { compilePushBundle, pushBundleOptions } from "../../../scripts/push-bundle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("a pushed bundle", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("carries the gateway library inside it, and runs with no node_modules anywhere", async () => {
    // Outside the checkout, as a data root's store is: nothing up the tree can lend a package.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-push-bundle-"));
    dirs.push(dir);
    const outfile = path.join(dir, "bundle.mjs");
    const options = pushBundleOptions("entry.mjs", outfile);
    delete options.entryPoints;
    await compilePushBundle({
      ...options,
      // Resolved from core, which depends on the gateway library, as the platform's own code is.
      stdin: {
        contents: [
          'import { AutoLLMClient } from "@prismshadow/mmsp";',
          "console.log(typeof AutoLLMClient);",
        ].join("\n"),
        resolveDir: path.join(REPO, "packages", "core"),
        loader: "js",
      },
    });

    const code = fs.readFileSync(outfile, "utf8");
    expect(code).not.toMatch(/(?:\bfrom|\bimport\(|\brequire\()\s*["']@prismshadow\/[^"']+["']/);
    const ran = execFileSync(process.execPath, [outfile], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });
    expect(ran.trim()).toBe("function");
  }, 120_000);
});
