/**
 * Hot platform integration tests (via app.request() injection): the
 * stop-the-world upgrade protocol end to end — terminals surviving a platform
 * swap via resource claiming, migration chains across platform versions,
 * blocked downgrades, agent code hot swap with portable state, dynamic
 * platform module loading, and the demo UI panel channel.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    const res = await t.app.request("/api/hot/terminals", { headers: bearer });
    expect(res.status).toBe(200);
    // A wrong token falls through to cookie auth and fails as unauthenticated.
    const bad = await t.app.request("/api/hot/terminals", {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(bad.status).toBe(401);
    // A mutating call works over the token too.
    const created = await t.app.request("/api/hot/terminals", {
      method: "POST",
      headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ command: "cat" }),
    });
    expect(created.status).toBe(201);
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
    expect(Object.keys(body.iface.children)).toEqual(["terminals"]);
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
    expect(outcome).toEqual({ status: "ok", mode: "migrated", impl: "v2", source: null });

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

  it("the store keeps at most 2 platform bundles / web dists (current + one rollback)", async () => {
    const root = await makeTempRoot();
    try {
      const bundleSrc = await fs.readFile(path.join(HOT_ASSETS, "platform-v4.bundle.mjs"), "utf8");
      const b64 = (s: string) => Buffer.from(s).toString("base64");
      const h = new HotHost(root);
      await h.upgradeTo({ impl: "v2" });
      // Three distinct platform bundles (content varies via a trailing comment).
      for (let i = 0; i < 3; i++) {
        const f = path.join(root, `v4-${i}.mjs`);
        await fs.writeFile(
          f,
          `${bundleSrc}
// push ${i}
`,
        );
        const up = await h.upgradeTo({ bundlePath: f });
        expect(up.status).toBe("ok");
      }
      // Three distinct web dists.
      for (let i = 0; i < 3; i++) {
        await h.installInlineWebDist({ "index.html": b64(`<html>web-${i}</html>`) });
      }
      const platforms = (await fs.readdir(path.join(root, "hot", "store", "platform"))).filter(
        (n) => n.endsWith(".mjs"),
      );
      const webs = await fs.readdir(path.join(root, "hot", "store", "web"));
      expect(platforms.length).toBeLessThanOrEqual(2);
      expect(webs.length).toBeLessThanOrEqual(2);
      // The committed one survived pruning and still restores.
      h.dispose();
      const h2 = new HotHost(root);
      await h2.ensure();
      expect(h2.currentImplId()).toBe("v4-bundle");
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
        path.join(root, "hot", "harness.json"),
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
