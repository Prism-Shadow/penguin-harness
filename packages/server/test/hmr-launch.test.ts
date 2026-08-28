/**
 * hmr/launch.ts: choosing which runtime a start actually runs.
 *
 * The packaged entry asks this before anything else exists — no config read, no lock, no
 * database. Which makes its failure mode the sharpest in the system: a throw here is not a
 * degraded server, it is no server. So every way of not having a pushed runtime, and every
 * way of having a broken one, has to come back as "run the packaged one" with a word about
 * why, and never as an exception.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handOverToPushedRuntime } from "../src/hmr/launch.js";

const roots: string[] = [];
const HANDED_OVER = "PENGUIN_RUNTIME_HANDED_OVER";

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  delete process.env[HANDED_OVER];
});

async function rootWithRuntime(source: string | null): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-launch-test-"));
  roots.push(root);
  const hmrDir = path.join(root, "hmr");
  await fs.mkdir(hmrDir, { recursive: true });
  if (source === null) {
    await fs.writeFile(path.join(hmrDir, "harness.json"), JSON.stringify({}));
    return root;
  }
  const file = path.join(hmrDir, "store", "runtime", "boot.mjs");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, source);
  await fs.writeFile(
    path.join(hmrDir, "harness.json"),
    JSON.stringify({ runtime: { bundle: "store/runtime/boot.mjs" } }),
  );
  return root;
}

describe("handing over to a pushed runtime", () => {
  it("runs the pushed bundle and reports that it did", async () => {
    const root = await rootWithRuntime("globalThis.__pushedRuntimeRan = true;\n");
    const warnings: string[] = [];

    expect(await handOverToPushedRuntime(root, (l) => warnings.push(l))).toBe(true);
    expect((globalThis as { __pushedRuntimeRan?: boolean }).__pushedRuntimeRan).toBe(true);
    expect(warnings).toEqual([]);
    delete (globalThis as { __pushedRuntimeRan?: boolean }).__pushedRuntimeRan;
  });

  it("declines when nothing was pushed, which is what a fresh install is", async () => {
    expect(await handOverToPushedRuntime(await rootWithRuntime(null))).toBe(false);
  });

  it("falls back to the packaged runtime when the pushed one throws on import", async () => {
    // The case that decides whether a bad push can take a machine off the air. It must not:
    // the packaged runtime is a working server, and starting it beats starting nothing.
    const root = await rootWithRuntime("throw new Error('bad bundle');\n");
    const warnings: string[] = [];

    expect(await handOverToPushedRuntime(root, (l) => warnings.push(l))).toBe(false);
    expect(warnings.join("\n")).toContain("bad bundle");
    // ...and the guard is released, or the packaged start would think it had already
    // handed over and refuse to look again on the next boot within this process.
    expect(process.env[HANDED_OVER]).toBeUndefined();
  });

  it("does not hand over to itself once it already has", async () => {
    // The pushed bundle contains this same launcher. Without the guard it would resolve
    // itself and import forever.
    const root = await rootWithRuntime("globalThis.__pushedRuntimeRan = true;\n");
    process.env[HANDED_OVER] = "1";

    expect(await handOverToPushedRuntime(root)).toBe(false);
  });
});
