/**
 * The thin loader's own logic (src/index.ts): data-root resolution, hot-loading a
 * platform-pushed `cli` bundle from the HMR store, and falling back to the packaged
 * default when nothing has been pushed or the pushed bundle is unusable.
 *
 * `web` / `server` / `update` (routed to `runLocal`) are NOT exercised end-to-end
 * here: commander's default --help/--version handling calls `process.exit` directly
 * (no `exitOverride`, deliberately unchanged from before this split — see index.ts's
 * module doc), which would kill the test worker, and `server`/`web`/`update`'s own
 * actions open a real port / touch the network. Their internals are already covered
 * by commands/serve.ts / commands/update.ts's own pure-function tests
 * (serve.test.ts, update.test.ts); this file covers `main`'s routing decision only
 * for the safe (hot) side.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, resolveDataRoot, runHot } from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/cli.bundle.mjs", import.meta.url));

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-loader-test-"));
}

/** Writes `<root>/hmr/harness.json` with a `cli` entry pointing at `bundleContent`. */
async function pushCliBundle(root: string, bundleContent: string): Promise<void> {
  const hmrDir = path.join(root, "hmr");
  await fs.mkdir(hmrDir, { recursive: true });
  await fs.writeFile(path.join(hmrDir, "cli.bundle.mjs"), bundleContent, "utf8");
  await fs.writeFile(
    path.join(hmrDir, "harness.json"),
    JSON.stringify({ cli: { bundle: "cli.bundle.mjs" } }),
  );
}

describe("resolveDataRoot", () => {
  const prevHome = process.env.PENGUIN_HOME;
  afterEach(() => {
    if (prevHome === undefined) delete process.env.PENGUIN_HOME;
    else process.env.PENGUIN_HOME = prevHome;
  });

  it("--root <dir> wins, resolved against cwd", () => {
    expect(resolveDataRoot(["config", "model", "list", "--root", "some/dir"])).toBe(
      path.resolve("some/dir"),
    );
  });

  it("--root=<dir> is also recognized", () => {
    expect(resolveDataRoot(["config", "--root=some/dir"])).toBe(path.resolve("some/dir"));
  });

  it("falls back to PENGUIN_HOME when no --root is given", () => {
    process.env.PENGUIN_HOME = "/tmp/penguin-env-root";
    expect(resolveDataRoot(["config", "model", "list"])).toBe("/tmp/penguin-env-root");
  });

  it("falls back to the ~/.penguin/data default when neither is set", () => {
    delete process.env.PENGUIN_HOME;
    expect(resolveDataRoot(["config", "model", "list"])).toBe(
      path.join(os.homedir(), ".penguin", "data"),
    );
  });
});

describe("runHot", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("with a store entry: dynamically imports the pushed bundle and calls ITS cli(argv)", async () => {
    const content = await fs.readFile(FIXTURE, "utf8");
    await pushCliBundle(root, content);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await runHot(["ping"], root);
      expect(code).toBe(0);
      expect(write).toHaveBeenCalledWith("pong-from-hot-bundle\n");
    } finally {
      write.mockRestore();
    }
  });

  it("with a store entry: the hot bundle's return value becomes the exit code", async () => {
    const content = await fs.readFile(FIXTURE, "utf8");
    await pushCliBundle(root, content);
    const code = await runHot(["not-ping"], root);
    expect(code).toBe(42);
  });

  it("no store entry (fresh root): falls back to the packaged default cli()", async () => {
    // A fresh root has no hmr/harness.json at all — resolveCliBundlePath returns
    // null and runHot must fall back rather than throw. --version is a safe probe:
    // the packaged cli() never calls process.exit (see cli.ts's
    // exitOverride), so this can't kill the test worker.
    const code = await runHot(["--version"], root);
    expect(code).toBe(0);
  });

  it("a store entry pointing at a bundle with no `cli` export falls back to the packaged default", async () => {
    await pushCliBundle(root, "export const somethingElse = 1;\n");
    const code = await runHot(["--version"], root);
    expect(code).toBe(0);
  });

  it("a store entry pointing at a bundle that fails to import falls back to the packaged default", async () => {
    await pushCliBundle(root, "this is not valid javascript {{{\n");
    const code = await runHot(["--version"], root);
    expect(code).toBe(0);
  });

  it("a `cli` entry whose file was pruned from the store resolves to null and falls back", async () => {
    const hmrDir = path.join(root, "hmr");
    await fs.mkdir(hmrDir, { recursive: true });
    // References a file that was never written (e.g. pruned by the store's keep-2 GC).
    await fs.writeFile(
      path.join(hmrDir, "harness.json"),
      JSON.stringify({ cli: { bundle: "store/platform/gone.mjs" } }),
    );
    const code = await runHot(["--version"], root);
    expect(code).toBe(0);
  });
});

describe("main (routing)", () => {
  it("a non-boot command (e.g. a hot-loaded custom command) resolves the root and takes the hot path", async () => {
    const root = await makeTempRoot();
    try {
      const content = await fs.readFile(FIXTURE, "utf8");
      await pushCliBundle(root, content);
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        // `--root` after the subcommand, as every real subcommand registers it (see
        // resolveDataRoot's doc) — resolveDataRoot finds it anywhere, but the
        // fixture's own `cli(argv)` (a stand-in for a real commander program) only
        // recognizes `argv[0]`, so realistic ordering matters here.
        const code = await main(["node", "penguin", "ping", "--root", root]);
        expect(code).toBe(0);
        expect(write).toHaveBeenCalledWith("pong-from-hot-bundle\n");
      } finally {
        write.mockRestore();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
