/**
 * The command shim carries resolution's answer rather than answering for itself: the loader
 * of a pushed CLI when the data root holds one, the installed CLI when it holds none, and
 * the installed CLI with the fault named when resolution faults.
 *
 * This is the "second consumer" the resolution round wires: `penguin-hmr` is the first. The
 * assertions read the shim script the server would write, so a private spelling creeping
 * back into the shim would fail here.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cliShimDir, ensureCliShim, shimFromResolution } from "../src/services/cli-shim.js";
import { loaderDeclarationFor, resolveCli } from "../src/cli-resolution.js";

const made: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
  }
});

/** The CLI product a server offers: its manifest and the loader it declares. */
async function makeProduct(): Promise<{ entry: string; loader: string }> {
  const dir = await tmp("penguin-shim-product-");
  const dist = path.join(dir, "dist");
  await fs.mkdir(dist, { recursive: true });
  const entry = path.join(dist, "penguin.js");
  const loader = path.join(dist, "penguin-hmr.js");
  await fs.writeFile(entry, "export const cli = async () => 0;\n");
  await fs.writeFile(loader, "export const cli = async () => 0;\n");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "fixture-cli",
      version: "0.0.0",
      penguin: { pushedCliLoader: "./dist/penguin-hmr.js" },
    }),
  );
  return { entry, loader };
}

/** A data root, with a pushed CLI record when `pushed`. */
async function makeRoot(options: { pushed?: boolean } = {}): Promise<string> {
  const root = await tmp("penguin-shim-root-");
  if (options.pushed === true) {
    const store = path.join(root, "hmr", "store", "cli");
    await fs.mkdir(store, { recursive: true });
    await fs.writeFile(path.join(store, "abc123.mjs"), "export const cli = async () => 0;\n");
    await fs.writeFile(
      path.join(root, "hmr", "harness.json"),
      JSON.stringify({ cli: { bundle: "store/cli/abc123.mjs" } }),
    );
  }
  return root;
}

async function answerFor(
  product: { entry: string; loader: string },
  root: string,
  execArgs: string[] = [],
): Promise<ReturnType<typeof shimFromResolution>> {
  const resolved = await resolveCli({
    self: product.entry,
    root,
    declaration: await loaderDeclarationFor(product.entry),
  });
  return shimFromResolution({ entry: product.entry, execArgs, unavailable: null }, resolved);
}

describe("the command shim, on resolution's answer", () => {
  it("runs the loader of a pushed root, and the shim script says so", async () => {
    const product = await makeProduct();
    const root = await makeRoot({ pushed: true });
    const answer = await answerFor(product, root);

    expect(answer).toMatchObject({ entry: product.loader, answer: "pushed" });
    const shim = ensureCliShim(root, answer.entry, { execPath: "/usr/bin/node", electron: false });
    expect(shim.kind).toBe("written");
    const script = await fs.readFile(path.join(cliShimDir(root), "penguin"), "utf8");
    expect(script).toContain(product.loader);
    expect(script).not.toContain(product.entry);
  });

  it("keeps the installed CLI, and names the fault, when the declared loader is gone", async () => {
    const product = await makeProduct();
    const root = await makeRoot({ pushed: true });
    await fs.rm(product.loader);

    const answer = await answerFor(product, root);
    expect(answer).toMatchObject({ entry: product.entry, answer: "loader-missing" });

    const shim = ensureCliShim(root, answer.entry, { execPath: "/usr/bin/node", electron: false });
    expect(shim.kind).toBe("written");
    const script = await fs.readFile(path.join(cliShimDir(root), "penguin"), "utf8");
    expect(script).toContain(product.entry);
  });

  it("keeps the installed CLI on a root nothing was pushed to", async () => {
    const product = await makeProduct();
    const root = await makeRoot();
    await expect(answerFor(product, root)).resolves.toMatchObject({
      entry: product.entry,
      answer: "no-record",
    });
  });

  it("keeps a source run's interpreter options only while the installed entry runs", async () => {
    const product = await makeProduct();
    const pushed = await makeRoot({ pushed: true });
    const loader = await answerFor(product, pushed, ["--import", "tsx"]);
    expect(loader).toMatchObject({ entry: product.loader, execArgs: [] });

    const fresh = await makeRoot();
    const installed = await answerFor(product, fresh, ["--import", "tsx"]);
    expect(installed).toMatchObject({ entry: product.entry, execArgs: ["--import", "tsx"] });
  });

  it("asks nothing when this installation offers no CLI at all", async () => {
    const answer = shimFromResolution({ entry: null, execArgs: [], unavailable: null }, null);
    expect(answer).toMatchObject({ entry: null, answer: "no-entry" });
  });
});
