/**
 * The server running a speech or sound run's helper itself: the Vault as the helper's only
 * source of provider keys, the helper's own words when it fails, and a cancel that stops it.
 * Stand-in helpers run in place of the real ones, so nothing reaches a provider.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  linkCachedDependencies,
  SCRATCH_STALE_MS,
  runMediaHelper,
  type DependencyInstaller,
} from "../src/activities/media-helper-runner.js";

describe("running a media helper without an agent", () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });

  async function workspace(helper: string, script = "generate-speech.mjs") {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-media-helper-"));
    roots.push(root);
    await fs.writeFile(path.join(root, script), helper);
    return root;
  }

  it("hands the helper the Vault's keys and never the server's own", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "server-key");
    vi.stubEnv("GEMINI_API_KEY", "server-gemini-key");
    const root = await workspace(
      `import fs from "node:fs";
      fs.writeFileSync("env.json", JSON.stringify({
        eleven: process.env.ELEVENLABS_API_KEY ?? null,
        gemini: process.env.GEMINI_API_KEY ?? null,
      }));`,
    );
    const result = await runMediaHelper({
      workspace: root,
      script: "generate-speech.mjs",
      vault: { ELEVENLABS_API_KEY: "vault-key" },
      install: false,
      cacheDir: os.tmpdir(),
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(await fs.readFile(path.join(root, "env.json"), "utf8"))).toEqual({
      eleven: "vault-key",
      gemini: null,
    });
  });

  it("runs the sound helper for a sound run", async () => {
    const root = await workspace(
      `import fs from "node:fs";
      fs.writeFileSync("ran.txt", "sound");`,
      "generate-sound.mjs",
    );
    expect(
      await runMediaHelper({
        workspace: root,
        script: "generate-sound.mjs",
        vault: {},
        install: false,
        cacheDir: os.tmpdir(),
        signal: new AbortController().signal,
      }),
    ).toEqual({ ok: true });
    expect(await fs.readFile(path.join(root, "ran.txt"), "utf8")).toBe("sound");
  });

  it("fails with the helper's last line", async () => {
    const root = await workspace(
      `process.stdout.write("starting\\n");
      process.stderr.write("provider refused: plan or key\\n");
      process.exitCode = 1;`,
    );
    expect(
      await runMediaHelper({
        workspace: root,
        script: "generate-speech.mjs",
        vault: {},
        install: false,
        cacheDir: os.tmpdir(),
        signal: new AbortController().signal,
      }),
    ).toEqual({ ok: false, error: "provider refused: plan or key" });
  });

  it("stops a helper that is cancelled", async () => {
    const root = await workspace(`setTimeout(() => {}, 60_000);`);
    const controller = new AbortController();
    const running = runMediaHelper({
      workspace: root,
      script: "generate-speech.mjs",
      vault: {},
      install: false,
      cacheDir: os.tmpdir(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    await expect(running).rejects.toThrow("cancelled");
  });
});

describe("sharing installed helper dependencies across runs", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });

  async function folder() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-helper-cache-"));
    roots.push(root);
    return root;
  }

  /** A workspace whose package.json names `dependencies`, as a run stages it. */
  async function workspace(dependencies: Record<string, string> = { "fake-hub": "1.0.0" }) {
    const root = await folder();
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true, type: "module", dependencies }),
    );
    return root;
  }

  /** Stands in for npm: writes the one package and counts how often it was asked. */
  function installer(ok = true) {
    const calls: string[] = [];
    const install: DependencyInstaller = async (dir) => {
      calls.push(dir);
      if (!ok) return { ok: false, timedOut: false };
      const pkg = path.join(dir, "node_modules", "fake-hub");
      await fs.mkdir(pkg, { recursive: true });
      await fs.writeFile(
        path.join(pkg, "package.json"),
        JSON.stringify({ name: "fake-hub", type: "module", main: "index.js" }),
      );
      await fs.writeFile(path.join(pkg, "index.js"), `export const hub = "shared";`);
      return { ok: true, timedOut: false };
    };
    return { install, calls };
  }

  const signal = () => new AbortController().signal;

  it("installs once and links the same install into every run, where the helper imports it", async () => {
    const cache = await folder();
    const { install, calls } = installer();
    const first = await workspace();
    const second = await workspace();
    // Two runs starting together share the one install.
    expect(
      await Promise.all([
        linkCachedDependencies(first, cache, process.env, signal(), install),
        linkCachedDependencies(second, cache, process.env, signal(), install),
      ]),
    ).toEqual([{ ok: true }, { ok: true }]);
    const later = await workspace();
    expect(await linkCachedDependencies(later, cache, process.env, signal(), install)).toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(1);
    // Only the finished install is in the cache: no scratch folder is left behind.
    expect(await fs.readdir(cache)).toHaveLength(1);
    await fs.writeFile(
      path.join(later, "check.mjs"),
      `const { hub } = await import("fake-hub"); process.stdout.write(hub);`,
    );
    const imported = spawnSync(process.execPath, ["check.mjs"], { cwd: later, encoding: "utf8" });
    expect(imported.stdout, imported.stderr).toBe("shared");
  });

  it("installs again for another dependency set, and not at all for none", async () => {
    const cache = await folder();
    const { install, calls } = installer();
    await linkCachedDependencies(await workspace(), cache, process.env, signal(), install);
    await linkCachedDependencies(
      await workspace({ "fake-hub": "2.0.0" }),
      cache,
      process.env,
      signal(),
      install,
    );
    const none = await workspace({});
    expect(await linkCachedDependencies(none, cache, process.env, signal(), install)).toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(2);
    await expect(fs.lstat(path.join(none, "node_modules"))).rejects.toThrow();
  });

  it("prunes the versions a new install supersedes and scratch a crash left, and nothing else", async () => {
    const cache = await folder();
    const { install } = installer();
    const link = async (dependencies: Record<string, string>) =>
      linkCachedDependencies(await workspace(dependencies), cache, process.env, signal(), install);
    await link({ "fake-hub": "1.0.0" });
    await link({ "other-tool": "1.0.0" });
    const [oldHub, otherTool] = await fs.readdir(cache).then(async (entries) => {
      const named = await Promise.all(
        entries.map(async (entry) => [
          entry,
          JSON.parse(await fs.readFile(path.join(cache, entry, "package.json"), "utf8")),
        ]),
      );
      return ["fake-hub", "other-tool"].map(
        (name) => named.find(([, pkg]) => name in pkg.dependencies)![0] as string,
      );
    });
    // Scratch from a crash an hour ago, and one another process may still be filling.
    const stale = path.join(cache, "0123456789abcdef.crashed.tmp");
    const fresh = path.join(cache, "fedcba9876543210.filling.tmp");
    await fs.mkdir(stale);
    await fs.mkdir(fresh);
    const hourAgo = new Date(Date.now() - SCRATCH_STALE_MS - 1000);
    await fs.utimes(stale, hourAgo, hourAgo);

    const run = await workspace({ "fake-hub": "2.0.0" });
    expect(await linkCachedDependencies(run, cache, process.env, signal(), install)).toEqual({
      ok: true,
    });
    const left = await fs.readdir(cache);
    expect(left).toHaveLength(3);
    expect(left).toContain(otherTool);
    expect(left).toContain(path.basename(fresh));
    expect(left).not.toContain(oldHub);
    // The new version is the one linked in.
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            path.dirname(await fs.realpath(path.join(run, "node_modules"))),
            "package.json",
          ),
          "utf8",
        ),
      ).dependencies,
    ).toEqual({ "fake-hub": "2.0.0" });
  });

  it("keeps nothing from a failed install, so the next run tries again", async () => {
    const cache = await folder();
    const failing = installer(false);
    expect(
      await linkCachedDependencies(
        await workspace(),
        cache,
        process.env,
        signal(),
        failing.install,
      ),
    ).toEqual({
      ok: false,
      error:
        "Could not install the provider client. Check that npm is installed and can reach the registry.",
    });
    expect(await fs.readdir(cache)).toEqual([]);
    const working = installer();
    const run = await workspace();
    expect(
      await linkCachedDependencies(run, cache, process.env, signal(), working.install),
    ).toEqual({ ok: true });
    expect(working.calls).toHaveLength(1);
  });
});
