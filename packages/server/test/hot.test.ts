/**
 * Hot platform integration tests (via app.request() injection): the
 * stop-the-world upgrade protocol end to end — terminals surviving a platform
 * swap via resource claiming, migration chains across platform versions,
 * blocked downgrades, agent code hot swap with portable state, dynamic
 * platform module loading, and the demo UI panel channel.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HotHost } from "../src/hot/host.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot, provisionUser } from "./helpers.js";
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
 * Builds a two-file platform repo (entry + import) from the v3 demo source —
 * the import proves the on-request compile really bundles to a single file.
 * Returns the canonical upgrade descriptor: git specifier + revision.
 */
async function makeDistroRepo(dir: string): Promise<{ repo: string; revision: string }> {
  await fs.mkdir(dir, { recursive: true });
  const source = await fs.readFile(path.join(HOT_ASSETS, "platform-v3.demo.mjs"), "utf8");
  const entry = `import { EDITION } from "./extras.mjs";\n${source.replace('"community-demo"', "EDITION")}`;
  await fs.writeFile(path.join(dir, "hot-platform.mjs"), entry);
  await fs.writeFile(path.join(dir, "extras.mjs"), 'export const EDITION = "community-demo";\n');
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
    expect(Object.keys(body.iface.children).sort()).toEqual(["agents", "terminals"]);
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
    expect(outcome).toEqual({ status: "ok", mode: "migrated", impl: "v2", warnings: [] });

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

  it.skipIf(!hasGit)(
    "upgrades from a git specifier + revision: checkout, compile to one file, swap",
    async () => {
      const created = await api.post("/api/hot/terminals", { command: "cat" });
      const { id } = (await created.json()) as { id: string };
      await api.post("/api/hot/platform/upgrade", { impl: "v2" });

      const { repo, revision } = await makeDistroRepo(path.join(t.root, "distro-repo"));
      const res = await api.post("/api/hot/platform/upgrade", { repo, revision });
      expect(res.status).toBe(200);
      const outcome = (await res.json()) as { status: string; mode: string; impl: string };
      expect(outcome).toEqual({ status: "ok", mode: "migrated", impl: "v3-demo", warnings: [] });

      const info = (await (await api.get("/api/hot/platform")).json()) as {
        info: { impl: string; edition: string };
      };
      expect(info.info.impl).toBe("v3-demo");
      // EDITION arrives through the bundled second file: the compile really is single-file.
      expect(info.info.edition).toBe("community-demo");

      // The independently-authored distro reclaimed the same live process.
      const term = (await (await api.get(`/api/hot/terminals/${id}`)).json()) as {
        alive: boolean;
        title: string | null;
      };
      expect(term.alive).toBe(true);
      expect(term.title).toBe("[demo] cat");
    },
  );

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

  it("serves the demo UI panel with a content rev and hot-activates versions", async () => {
    const m1 = (await (await api.get("/api/hot/ui/manifest")).json()) as {
      version: string;
      rev: string;
    };
    expect(m1.version).toBe("v1");

    const js = await api.get("/api/hot/ui/panel.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toContain("demo-panel");

    const m2 = (await (await api.post("/api/hot/ui/activate", { version: "v2" })).json()) as {
      version: string;
      rev: string;
    };
    expect(m2.version).toBe("v2");
    expect(m2.rev).not.toBe(m1.rev);
  });
});

describe("hot host without git", () => {
  it("falls back to reading a working tree and surfaces a warning", async () => {
    const root = await makeTempRoot();
    const host = new HotHost(root, { gitBin: "penguin-missing-git-binary" });
    try {
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
    } finally {
      host.dispose();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
