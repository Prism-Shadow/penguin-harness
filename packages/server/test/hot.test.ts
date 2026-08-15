/**
 * Hot platform integration tests (via app.request() injection): the
 * stop-the-world upgrade protocol end to end — terminals surviving a platform
 * swap via resource claiming, migration chains across platform versions,
 * blocked downgrades, agent code hot swap with portable state, dynamic
 * platform module loading, and the demo UI panel channel.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppDeps, createApp } from "../src/app.js";
import { HotHost } from "../src/hot/host.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  testConfig,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

const HOT_ASSETS = fileURLToPath(new URL("../hot-assets/", import.meta.url));

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Builds a two-file TYPESCRIPT platform repo (entry + typed import) from the
 * v3 demo source — TS proves the compile capability is real (types must be
 * stripped), and the second file proves the output really is a single bundle.
 * Returns the canonical source descriptor: git specifier + revision.
 */
async function makeDistroRepo(dir: string): Promise<{ repo: string; revision: string }> {
  await fs.mkdir(dir, { recursive: true });
  const source = await fs.readFile(path.join(HOT_ASSETS, "platform-v3.demo.mjs"), "utf8");
  const entry = `import { EDITION } from "./extras";\n${source.replace('"community-demo"', "EDITION")}`;
  await fs.writeFile(path.join(dir, "hot-platform.ts"), entry);
  await fs.writeFile(
    path.join(dir, "extras.ts"),
    'export const EDITION: string = "community-demo";\n',
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "--quiet");
  git("add", "-A");
  git("-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "--quiet", "-m", "v3");
  return { repo: pathToFileURL(dir).href, revision: git("rev-parse", "HEAD").trim() };
}

/** Polls until fn() is truthy (live child processes emit output asynchronously). */
async function until(fn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("hot platform", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    api = apiClient(t.app, admin.cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("hot APIs are admin-only", async () => {
    const user = await provisionUser(t.app, "mallory");
    const res = await apiClient(t.app, user.cookie).get("/api/hot/platform");
    expect(res.status).toBe(403);
  });

  it("the local-agent Bearer token is admin-equivalent for hot APIs (no cookie needed)", async () => {
    const bearer = { authorization: `Bearer ${t.deps.hot.apiToken}` };
    // No cookie at all: the file-permission-gated token authenticates by itself.
    const res = await t.app.request("/api/hot/tools", { headers: bearer });
    expect(res.status).toBe(200);
    // A wrong token falls through to cookie auth and fails as unauthenticated.
    const bad = await t.app.request("/api/hot/tools", {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(bad.status).toBe(401);
    // The full skill loop works over the token (what the SKILL.md teaches).
    const install = await t.app.request("/api/hot/skills", {
      method: "POST",
      headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({
        id: "via-token",
        script:
          'return { name: "t", version: 1, setup(ctx) { ctx.registerTool({ name: "ping", description: "pong", run: () => ({ pong: true }) }); } };',
      }),
    });
    expect(install.status).toBe(201);
    const run = await t.app.request("/api/hot/tools/ping/invoke", {
      method: "POST",
      headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ input: null }),
    });
    expect(((await run.json()) as { result: { pong: boolean } }).result.pong).toBe(true);
  });

  it("boots platform v1 lazily and reports its serialized iface", async () => {
    const res = await api.get("/api/hot/platform");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      impl: string;
      iface: { name: string; version: number; children: Record<string, unknown> };
      info: { impl: string };
    };
    expect(body.impl).toBe("v1");
    expect(body.info.impl).toBe("platform-v1");
    expect(body.iface.name).toBe("platform");
    expect(Object.keys(body.iface.children).sort()).toEqual(["agents", "skills", "terminals"]);
  });

  it("surfaces the optional system capabilities (git, compiler)", async () => {
    const body = (await (await api.get("/api/hot/platform")).json()) as {
      capabilities: { git: boolean; compiler: boolean };
    };
    // The dev/CI environment has both: git on PATH, esbuild as a devDep.
    expect(body.capabilities).toEqual({ git: true, compiler: true });
  });

  it("terminal survives a v1→v2 platform swap: process claimed, output kept, migration ran", async () => {
    // A `cat` terminal echoes stdin: live proof the same process spans the swap.
    const created = await api.post("/api/hot/terminals", { command: "cat" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await api.post(`/api/hot/terminals/${id}/input`, { data: "before-upgrade\n" });
    await until(async () => {
      const r = await api.get(`/api/hot/terminals/${id}`);
      return ((await r.json()) as { output: string }).output.includes("before-upgrade");
    });

    const upgraded = await api.post("/api/hot/platform/upgrade", { impl: "v2" });
    expect(upgraded.status).toBe(200);
    const outcome = (await upgraded.json()) as { status: string; mode: string; impl: string };
    // Both the platform ctx (1→2 adds theme) and each terminal (1→2 adds title) migrated.
    expect(outcome).toEqual({
      status: "ok",
      mode: "migrated",
      impl: "v2",
      warnings: [],
      compile: "none",
      source: null,
    });

    const info = (await (await api.get("/api/hot/platform")).json()) as {
      impl: string;
      info: { impl: string; theme: string };
    };
    expect(info.info.impl).toBe("platform-v2");
    expect(info.info.theme).toBe("classic");

    // Same process, buffer intact, still responsive; title derived by the migrator.
    const after = (await (await api.get(`/api/hot/terminals/${id}`)).json()) as {
      output: string;
      alive: boolean;
      lost: boolean;
      title: string | null;
    };
    expect(after.alive).toBe(true);
    expect(after.lost).toBe(false);
    expect(after.title).toBe("cat");
    expect(after.output).toContain("before-upgrade");

    await api.post(`/api/hot/terminals/${id}/input`, { data: "after-upgrade\n" });
    await until(async () => {
      const r = await api.get(`/api/hot/terminals/${id}`);
      return ((await r.json()) as { output: string }).output.includes("after-upgrade");
    });
  });

  it("a downgrade without a migration path is blocked and the old platform keeps serving", async () => {
    await api.post("/api/hot/platform/upgrade", { impl: "v2" });
    const res = await api.post("/api/hot/platform/upgrade", { impl: "v1" });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { status: string; invalid: string[] };
    expect(outcome.status).toBe("blocked");
    expect(outcome.invalid.some((p) => p.includes("newer than iface"))).toBe(true);
    // Untouched: still v2.
    const info = (await (await api.get("/api/hot/platform")).json()) as { impl: string };
    expect(info.impl).toBe("v2");
  });

  it("agent code hot-swaps with its state document riding across", async () => {
    const installed = await api.post("/api/hot/agents", { id: "echo", module: "echo-agent.v1" });
    expect(installed.status).toBe(201);
    expect(((await installed.json()) as { agent: { version: number } }).agent.version).toBe(1);

    await api.post("/api/hot/agents/echo/run", { input: "one" });
    const second = (await (
      await api.post("/api/hot/agents/echo/run", { input: "two" })
    ).json()) as {
      result: { reply: string; calls: number };
    };
    expect(second.result.calls).toBe(2);
    expect(second.result.reply).toBe('echo: "two"');

    // Swap the code, keep the state: calls continues from 2.
    const reloaded = await api.post("/api/hot/agents/echo/reload", { module: "echo-agent.v2" });
    expect(((await reloaded.json()) as { agent: { version: number } }).agent.version).toBe(2);
    const third = (await (
      await api.post("/api/hot/agents/echo/run", { input: "three" })
    ).json()) as {
      result: { reply: string; calls: number };
    };
    expect(third.result.calls).toBe(3);
    expect(third.result.reply).toBe('ECHO!! "three"');
  });

  it("agent state also survives a platform swap", async () => {
    await api.post("/api/hot/agents", { id: "echo", module: "echo-agent.v1" });
    await api.post("/api/hot/agents/echo/run", { input: 1 });
    await api.post("/api/hot/platform/upgrade", { impl: "v2" });
    const run = (await (await api.post("/api/hot/agents/echo/run", { input: 2 })).json()) as {
      result: { calls: number };
    };
    expect(run.result.calls).toBe(2);
  });

  it("inline platform bundle over HTTP: no shared filesystem, no path (remote push)", async () => {
    // The bundle bytes travel in the request body — exactly what a remote /
    // HTTP-only runtime receives. Server writes them and loads by path.
    const bundle = await fs.readFile(path.join(HOT_ASSETS, "platform-v4.bundle.mjs"), "utf8");
    await api.post("/api/hot/platform/upgrade", { impl: "v2" }); // v4 migration starts at 2
    const res = await api.post("/api/hot/platform/upgrade", { bundle });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { status: string; impl: string };
    expect(outcome.status).toBe("ok");
    expect(outcome.impl).toBe("v4-bundle");
    const info = (await (await api.get("/api/hot/platform")).json()) as {
      info: { impl: string };
    };
    expect(info.info.impl).toBe("v4-bundle");
  });

  it("inline web dist over HTTP: a { relPath: base64 } manifest, traversal-guarded", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const res = await api.post("/api/hot/web/upgrade", {
      files: {
        "index.html": b64("<html>inline-v1</html>"),
        "assets/app.js": b64("console.log(1)"),
      },
    });
    expect(res.status).toBe(200);
    // Static hosting now serves the inline dist (SPA fallback included).
    expect(await (await t.app.request("/")).text()).toContain("inline-v1");
    expect(await (await t.app.request("/deep/spa/route")).text()).toContain("inline-v1");

    // A manifest with no index.html is rejected.
    expect((await api.post("/api/hot/web/upgrade", { files: { "x.js": b64("1") } })).status).toBe(
      400,
    );
    // Path traversal is rejected, nothing written.
    expect(
      (
        await api.post("/api/hot/web/upgrade", {
          files: { "index.html": b64("<html>ok</html>"), "../escape.js": b64("1") },
        })
      ).status,
    ).toBe(400);
  });

  it.skipIf(!hasGit)(
    "layer (b): TS source via git — checkout, subprocess compile to one file, then load",
    async () => {
      const created = await api.post("/api/hot/terminals", { command: "cat" });
      const { id } = (await created.json()) as { id: string };
      await api.post("/api/hot/platform/upgrade", { impl: "v2" });

      const { repo, revision } = await makeDistroRepo(path.join(t.root, "distro-repo"));
      const res = await api.post("/api/hot/platform/upgrade", { repo, revision });
      expect(res.status).toBe(200);
      const outcome = (await res.json()) as { status: string; mode: string; impl: string };
      expect(outcome).toEqual({
        status: "ok",
        mode: "migrated",
        impl: "v3-demo",
        warnings: [],
        compile: "fresh",
        source: { repo, revision },
      });

      const info = (await (await api.get("/api/hot/platform")).json()) as {
        info: { impl: string; edition: string };
      };
      expect(info.info.impl).toBe("v3-demo");
      // EDITION arrives through the bundled second TS file: types were
      // stripped and the compile really produced a single file.
      expect(info.info.edition).toBe("community-demo");

      // The independently-authored distro reclaimed the same live process.
      const term = (await (await api.get(`/api/hot/terminals/${id}`)).json()) as {
        alive: boolean;
        title: string | null;
      };
      expect(term.alive).toBe(true);
      expect(term.title).toBe("[demo] cat");

      // Incremental: re-upgrading to the same revision skips the compiler
      // (output cached by exact commit sha) and reconciles silently.
      const again = (await (
        await api.post("/api/hot/platform/upgrade", { repo, revision })
      ).json()) as { status: string; mode: string; compile: string };
      expect(again.status).toBe("ok");
      expect(again.mode).toBe("silent");
      expect(again.compile).toBe("cached");
    },
  );

  it("layer (a): a prebuilt single-file bundle loads with no git and no compiler involved", async () => {
    // The artifact is copied to a temp dir where NO bare import could
    // resolve — it loads anyway because it has zero imports.
    const artifact = path.join(t.root, "artifact.mjs");
    await fs.copyFile(path.join(HOT_ASSETS, "platform-v4.bundle.mjs"), artifact);
    await api.post("/api/hot/platform/upgrade", { impl: "v2" }); // v4's migration chain starts at 2

    const source = { repo: "file:///home/abc/x.git", revision: "deadbeef" };
    const res = await api.post("/api/hot/platform/upgrade", { bundlePath: artifact, source });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { status: string };
    // The optional git specifier is provenance only: echoed, never executed.
    expect(outcome).toEqual({
      status: "ok",
      mode: "migrated",
      impl: "v4-bundle",
      warnings: [],
      compile: "none",
      source,
    });

    const info = (await (await api.get("/api/hot/platform")).json()) as {
      info: { impl: string; channel: string };
    };
    expect(info.info.impl).toBe("v4-bundle");
    expect(info.info.channel).toBe("stable"); // filled by the 2→3 migrator
  });

  it("web dist hot-swap: static hosting retargets and clients are told to reload", async () => {
    const bearer = {
      authorization: `Bearer ${t.deps.hot.apiToken}`,
      "content-type": "application/json",
    };
    // No dist configured: non-API paths 404.
    expect((await t.app.request("/")).status).toBe(404);

    const dist = path.join(t.root, "web-dist-v1");
    await fs.mkdir(dist, { recursive: true });
    await fs.writeFile(path.join(dist, "index.html"), "<html>pushed-v1</html>");

    const res = await t.app.request("/api/hot/web/upgrade", {
      method: "POST",
      headers: bearer,
      body: JSON.stringify({ distPath: dist }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; rev: string };
    expect(body.status).toBe("ok");

    // Static hosting now serves the pushed dist (SPA fallback included).
    expect(await (await t.app.request("/")).text()).toContain("pushed-v1");
    expect(await (await t.app.request("/some/spa/route")).text()).toContain("pushed-v1");

    // A rebuilt dist pushes a new rev; contents swap in place.
    await fs.writeFile(path.join(dist, "index.html"), "<html>pushed-v2</html>");
    const res2 = await t.app.request("/api/hot/web/upgrade", {
      method: "POST",
      headers: bearer,
      body: JSON.stringify({ distPath: dist }),
    });
    const body2 = (await res2.json()) as { rev: string };
    expect(body2.rev).not.toBe(body.rev);
    expect(await (await t.app.request("/")).text()).toContain("pushed-v2");

    // Not a dist → 400, serving unchanged.
    const bad = await t.app.request("/api/hot/web/upgrade", {
      method: "POST",
      headers: bearer,
      body: JSON.stringify({ distPath: path.join(t.root, "nowhere") }),
    });
    expect(bad.status).toBe(400);
    expect(await (await t.app.request("/")).text()).toContain("pushed-v2");
  });

  it("requests racing an upgrade are enqueued, never observably rejected", async () => {
    const [first, second, list] = await Promise.all([
      api.post("/api/hot/platform/upgrade", { impl: "v2" }),
      api.post("/api/hot/platform/upgrade", { impl: "v2" }),
      api.get("/api/hot/terminals"),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(list.status).toBe(200);
    const outcomes = [
      (await first.json()) as { status: string; mode: string },
      (await second.json()) as { status: string; mode: string },
    ];
    expect(outcomes.every((o) => o.status === "ok")).toBe(true);
    // Serialized on the queue: one is the real migration, the other a silent re-boot.
    expect(outcomes.map((o) => o.mode).sort()).toEqual(["migrated", "silent"]);
  });

  it("rejects unknown platform targets, malformed git upgrades, and unknown agent modules", async () => {
    expect((await api.post("/api/hot/platform/upgrade", { impl: "nope" })).status).toBe(400);
    expect(
      (await api.post("/api/hot/platform/upgrade", { repo: "file:///nowhere.git" })).status,
    ).toBe(400);
    expect((await api.post("/api/hot/agents", { id: "x", module: "../etc/passwd" })).status).toBe(
      400,
    );
  });
});

describe("hot persistence across a runtime restart", () => {
  it("a pushed platform + web resume after a restart (atomic manifest commit)", async () => {
    const root = await makeTempRoot();
    try {
      const bundleSrc = await fs.readFile(path.join(HOT_ASSETS, "platform-v4.bundle.mjs"), "utf8");
      const bundleFile = path.join(root, "v4.mjs");
      await fs.writeFile(bundleFile, bundleSrc);
      const b64 = (s: string) => Buffer.from(s).toString("base64");

      // Runtime #1: push a platform bundle (v1→v2→v4) and an inline web dist.
      const h1 = new HotHost(root);
      await h1.upgradeTo({ impl: "v2" }); // v4's migration chain starts at 2
      const up = await h1.upgradeTo({ bundlePath: bundleFile });
      expect(up.status).toBe("ok");
      await h1.installInlineWebDist({ "index.html": b64("<html>persisted-web</html>") });
      h1.dispose();

      // Runtime #2 on the SAME data root: a fresh process. It must resume the
      // committed platform and web, not fall back to the packaged v1.
      const h2 = new HotHost(root);
      const inst = await h2.ensure();
      expect(h2.currentImplId()).toBe("v4-bundle");
      expect((inst.api.info() as { impl: string }).impl).toBe("v4-bundle");
      expect(h2.webDistDir).not.toBeNull();
      expect(existsSync(path.join(h2.webDistDir!, "index.html"))).toBe(true);
      h2.dispose();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a corrupt/missing persisted platform falls back to the packaged default (never bricks)", async () => {
    const root = await makeTempRoot();
    try {
      await fs.mkdir(path.join(root, "hot"), { recursive: true });
      await fs.writeFile(
        path.join(root, "hot", "current.json"),
        JSON.stringify({
          platform: { bundle: "store/platform/gone.mjs", park: "store/platform/gone.park.json" },
        }),
      );
      const h = new HotHost(root);
      await h.ensure();
      expect(h.currentImplId()).toBe("v1"); // resumed nothing; packaged default
      h.dispose();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("built-in impl upgrades are not persisted (only real bundles are)", async () => {
    const root = await makeTempRoot();
    try {
      const h1 = new HotHost(root);
      await h1.upgradeTo({ impl: "v2" });
      h1.dispose();
      // No bundle was committed, so a restart boots the packaged v1.
      const h2 = new HotHost(root);
      await h2.ensure();
      expect(h2.currentImplId()).toBe("v1");
      h2.dispose();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe("hot host capability degradation", () => {
  it("without git: source upgrades fall back to a working tree with a warning", async () => {
    const root = await makeTempRoot();
    const host = new HotHost(root, { gitBin: "penguin-missing-git-binary" });
    try {
      expect(host.capabilities().git).toBe(false);
      // A plain working tree (no git metadata needed for the fallback).
      const tree = path.join(root, "tree");
      await fs.mkdir(tree, { recursive: true });
      const source = await fs.readFile(path.join(HOT_ASSETS, "platform-v3.demo.mjs"), "utf8");
      await fs.writeFile(path.join(tree, "hot-platform.mjs"), source);

      await host.ensure();
      await host.upgradeTo({ impl: "v2" }); // v3's migration chain starts at 2
      const outcome = await host.upgradeTo({ repo: tree, revision: "deadbeef" });
      expect(outcome.status).toBe("ok");
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings[0]).toMatch(/git is not installed/);
      expect(outcome.warnings[0]).toMatch(/NOT verified/);
      // Unverified revision: no incremental cache, every request recompiles.
      if (outcome.status === "ok") expect(outcome.compile).toBe("fresh");
    } finally {
      host.dispose();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("without a compiler: source upgrades fail with a pointer to layer (a), which still works", async () => {
    const root = await makeTempRoot();
    const host = new HotHost(root, { compilerBin: null });
    try {
      expect(host.capabilities().compiler).toBe(false);
      await host.ensure();
      await host.upgradeTo({ impl: "v2" });

      // (b) is unavailable: the error names the escape hatch.
      await expect(
        host.upgradeTo({ repo: "file:///somewhere.git", revision: "deadbeef" }),
      ).rejects.toThrow(/no JS\/TS compiler.*bundlePath/s);

      // (a) is independent of both capabilities: the zero-import artifact
      // loads and the platform still ends up swapped.
      const outcome = await host.upgradeTo({
        bundlePath: path.join(HOT_ASSETS, "platform-v4.bundle.mjs"),
      });
      expect(outcome.status).toBe("ok");
      if (outcome.status === "ok") {
        expect(outcome.impl).toBe("v4-bundle");
        expect(outcome.compile).toBe("none");
        expect(outcome.source).toBeNull();
      }
    } finally {
      host.dispose();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe("hot skills and tools", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  const COUNTER_SKILL = `
    let count = context.state && typeof context.state.count === "number" ? context.state.count : 0;
    return {
      name: "counter-skill",
      version: 1,
      setup(ctx) {
        ctx.registerTool({
          name: "count",
          description: "Increments and returns the running count.",
          run: () => ({ count: ++count }),
        });
      },
      park: () => ({ count }),
    };
  `;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    api = apiClient(t.app, admin.cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("installs a skill (eval + context → arktype-validated object) and its tool is invocable", async () => {
    const res = await api.post("/api/hot/skills", { id: "counter", script: COUNTER_SKILL });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      skill: { name: string; version: number };
      tools: { name: string; owner: string }[];
    };
    expect(body.skill).toEqual({ name: "counter-skill", version: 1 });
    expect(body.tools).toEqual([
      { name: "count", description: "Increments and returns the running count.", owner: "counter" },
    ]);

    const run = await api.post("/api/hot/tools/count/invoke", {});
    expect(run.status).toBe(200);
    expect((await run.json()) as { result: { count: number } }).toEqual({ result: { count: 1 } });
  });

  it("rejects scripts that fail eval or the arktype contract with 400", async () => {
    // Does not parse as a function body.
    expect((await api.post("/api/hot/skills", { id: "bad1", script: "return {" })).status).toBe(
      400,
    );
    // Parses, but violates the contract (no setup function).
    const noSetup = await api.post("/api/hot/skills", {
      id: "bad2",
      script: 'return { name: "x", version: 1 };',
    });
    expect(noSetup.status).toBe(400);
    const body = (await noSetup.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toContain("setup");
    // Nothing half-installed.
    const list = (await (await api.get("/api/hot/skills")).json()) as { skills: unknown[] };
    expect(list.skills).toEqual([]);
  });

  it("duplicate tool registration is loud and the half-installed skill is rolled back", async () => {
    await api.post("/api/hot/skills", { id: "counter", script: COUNTER_SKILL });
    const dup = await api.post("/api/hot/skills", { id: "copycat", script: COUNTER_SKILL });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: { message: string } }).error.message).toContain(
      "already registered",
    );
    const skills = (await (await api.get("/api/hot/skills")).json()) as {
      skills: { id: string }[];
    };
    expect(skills.skills.map((s) => s.id)).toEqual(["counter"]);
    // The original registration is untouched.
    expect((await api.post("/api/hot/tools/count/invoke", {})).status).toBe(200);
  });

  it("reload swaps skill code while the parked state rides across", async () => {
    await api.post("/api/hot/skills", { id: "counter", script: COUNTER_SKILL });
    await api.post("/api/hot/tools/count/invoke", {});
    await api.post("/api/hot/tools/count/invoke", {});

    const v2 = COUNTER_SKILL.replace("version: 1", "version: 2").replace(
      "run: () => ({ count: ++count })",
      'run: () => ({ count: ++count, tag: "v2" })',
    );
    const reloaded = await api.post("/api/hot/skills/counter/reload", { script: v2 });
    expect(reloaded.status).toBe(200);
    expect(((await reloaded.json()) as { skill: { version: number } }).skill.version).toBe(2);

    // New code, carried state: the count continues from 2.
    const run = (await (await api.post("/api/hot/tools/count/invoke", {})).json()) as {
      result: { count: number; tag: string };
    };
    expect(run.result).toEqual({ count: 3, tag: "v2" });
  });

  it("a bad reload leaves the running skill untouched (validated before removal)", async () => {
    await api.post("/api/hot/skills", { id: "counter", script: COUNTER_SKILL });
    const bad = await api.post("/api/hot/skills/counter/reload", { script: "return 42;" });
    expect(bad.status).toBe(400);
    expect((await api.post("/api/hot/tools/count/invoke", {})).status).toBe(200);
  });

  it("unloading a skill deregisters exactly its tools (self-cleaning effects)", async () => {
    await api.post("/api/hot/skills", { id: "counter", script: COUNTER_SKILL });
    expect((await api.delete("/api/hot/skills/counter")).status).toBe(200);
    expect((await api.post("/api/hot/tools/count/invoke", {})).status).toBe(404);
    const tools = (await (await api.get("/api/hot/tools")).json()) as { tools: unknown[] };
    expect(tools.tools).toEqual([]);
  });

  it("skills and their tools survive a platform swap (registry reseeded from parked scripts)", async () => {
    await api.post("/api/hot/skills", { id: "counter", script: COUNTER_SKILL });
    await api.post("/api/hot/tools/count/invoke", {});
    await api.post("/api/hot/platform/upgrade", { impl: "v2" });
    // New platform instance, new registry, same skill: state carried, tool back.
    const run = (await (await api.post("/api/hot/tools/count/invoke", {})).json()) as {
      result: { count: number };
    };
    expect(run.result.count).toBe(2);
  });

  it("upgrading to a distro without a skills subtree is blocked while skills hold data", async () => {
    await api.post("/api/hot/skills", { id: "counter", script: COUNTER_SKILL });
    await api.post("/api/hot/platform/upgrade", { impl: "v2" });
    // The v4 bundle declares no skills child: with a skill installed this is
    // discarded data → blocked; the linear-state rule, observed end to end.
    const res = await api.post("/api/hot/platform/upgrade", {
      bundlePath: path.join(HOT_ASSETS, "platform-v4.bundle.mjs"),
    });
    const outcome = (await res.json()) as { status: string; dropped: string[] };
    expect(outcome.status).toBe("blocked");
    expect(outcome.dropped).toContain("$.children.skills");
  });
});

describe("hot API network safety", () => {
  it("defaults off on a non-loopback bind without HTTPS; https or the env override enable it", async () => {
    const root = await makeTempRoot();
    const config = { ...testConfig(root), host: "0.0.0.0" };
    const deps = buildAppDeps(config, { log: () => undefined });
    const app = createApp(deps);
    try {
      await deps.authService.seedAdmin();
      const admin = await loginAdmin(app);

      // Dangerous network (0.0.0.0 + plain http): 403 before anything runs.
      const plain = await app.request("/api/hot/platform", { headers: { cookie: admin.cookie } });
      expect(plain.status).toBe(403);
      expect(((await plain.json()) as { error: { code: string } }).error.code).toBe(
        "hot_api_disabled",
      );

      // HTTPS (as seen via the reverse proxy header): allowed.
      const https = await app.request("/api/hot/platform", {
        headers: { cookie: admin.cookie, "x-forwarded-proto": "https" },
      });
      expect(https.status).toBe(200);

      // Explicit override: allowed even on plain http.
      process.env.PENGUIN_HOT_API_UNSAFE = "1";
      try {
        const forced = await app.request("/api/hot/platform", {
          headers: { cookie: admin.cookie },
        });
        expect(forced.status).toBe(200);
      } finally {
        delete process.env.PENGUIN_HOT_API_UNSAFE;
      }
    } finally {
      deps.hot.dispose();
      deps.channels.dispose();
      deps.db.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
