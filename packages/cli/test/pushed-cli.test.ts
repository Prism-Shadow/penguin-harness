/**
 * Which CLI a `penguin` invocation runs (src/pushed-cli.ts): the pushed one when the HMR
 * store has one, the built-in one otherwise — and, critically, the built-in one rather than
 * nothing when a pushed bundle is unusable. A hot channel that can brick the command it
 * updates is worse than no hot channel.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPushedCli, resolveCli } from "../src/pushed-cli.js";

const BUILT_IN = async () => 0;
const PUSHED = async () => 7;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

/** A data root whose HMR store carries `source` as the pushed CLI (or nothing at all). */
async function rootWithPushedCli(source: string | null): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-pushed-cli-"));
  roots.push(root);
  const hmr = path.join(root, "hmr");
  await fs.mkdir(path.join(hmr, "store"), { recursive: true });
  if (source === null) return root;
  await fs.writeFile(path.join(hmr, "store", "cli.mjs"), source);
  await fs.writeFile(
    path.join(hmr, "harness.json"),
    JSON.stringify({ version: 1, cli: { bundle: "store/cli.mjs" } }),
  );
  return root;
}

describe("loadPushedCli", () => {
  it("returns null when nothing has been pushed", async () => {
    expect(await loadPushedCli(await rootWithPushedCli(null))).toBeNull();
  });

  it("returns the pushed implementation", async () => {
    const root = await rootWithPushedCli("export const cli = async () => 7;\n");
    const cli = await loadPushedCli(root);
    expect(cli).not.toBeNull();
    expect(await cli!([])).toBe(7);
  });

  it("throws when a recorded bundle does not export cli — that is broken, not absent", async () => {
    const root = await rootWithPushedCli("export const notCli = 1;\n");
    await expect(loadPushedCli(root)).rejects.toThrow(/does not export 'cli'/);
  });
});

describe("resolveCli", () => {
  it("prefers the pushed CLI, which is what makes a push arrive at all", async () => {
    const run = await resolveCli({ root: "/unused", builtIn: BUILT_IN, load: async () => PUSHED });
    expect(await run([])).toBe(7);
  });

  it("falls back to the built-in one when nothing is pushed", async () => {
    const run = await resolveCli({ root: "/unused", builtIn: BUILT_IN, load: async () => null });
    expect(await run([])).toBe(0);
  });

  it("warns and keeps working when the pushed bundle is unusable", async () => {
    const warnings: string[] = [];
    const run = await resolveCli({
      root: "/unused",
      builtIn: BUILT_IN,
      load: async () => {
        throw new Error("boom");
      },
      warn: (line) => warnings.push(line),
    });
    expect(await run([])).toBe(0); // the built-in one, not a crash
    expect(warnings.join("\n")).toContain("boom");
    expect(warnings.join("\n")).toContain("PENGUIN_NO_HMR=1");
  });

  it("PENGUIN_NO_HMR=1 skips the store entirely — the way back from a bad push", async () => {
    const run = await resolveCli({
      root: "/unused",
      builtIn: BUILT_IN,
      env: { PENGUIN_NO_HMR: "1" },
      load: async () => {
        throw new Error("must not be consulted");
      },
    });
    expect(await run([])).toBe(0);
  });
});
