/**
 * Hot-update integration tests (via app.request() injection): pushing a
 * next-build platform bundle and a web dist as inline bytes over HTTP,
 * terminals surviving the swap via resource claiming, the migrate/blocked
 * paths, atomic persistence across a runtime restart, auth, the network
 * gate, and request queueing during a swap.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppDeps, createApp } from "../src/app.js";
import { HmrHost } from "../src/hmr/host.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  testConfig,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** "The NEXT deployed build": iface v2 + the 1→2 migrator, as pushed bytes. */
const NEXT_BUNDLE_FILE = fileURLToPath(
  new URL("./fixtures/platform-next.bundle.mjs", import.meta.url),
);

/** Polls until fn() is truthy (live child processes emit output asynchronously). */
async function until(fn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("hot update", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let nextBundle: string;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    api = apiClient(t.app, admin.cookie);
    nextBundle = await fs.readFile(NEXT_BUNDLE_FILE, "utf8");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("hot APIs are admin-only", async () => {
    const user = await provisionUser(t.app, "mallory");
    const res = await apiClient(t.app, user.cookie).get("/api/hmr/platform");
    expect(res.status).toBe(403);
  });

  it("the local Bearer token is admin-equivalent for hot APIs (no cookie needed)", async () => {
    const bearer = { authorization: `Bearer ${t.deps.hmr.apiToken}` };
    // No cookie at all: the file-permission-gated token authenticates by itself.
    const res = await t.app.request("/api/hmr/terminals", { headers: bearer });
    expect(res.status).toBe(200);
    // A wrong token falls through to cookie auth and fails as unauthenticated.
    const bad = await t.app.request("/api/hmr/terminals", {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(bad.status).toBe(401);
    // A mutating call works over the token too.
    const created = await t.app.request("/api/hmr/terminals", {
      method: "POST",
      headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ command: "cat" }),
    });
    expect(created.status).toBe(201);
  });

  it("boots the packaged platform lazily and reports its serialized iface", async () => {
    const res = await api.get("/api/hmr/platform");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      impl: string;
      iface: { name: string; version: number; children: Record<string, unknown> };
      info: { impl: string };
    };
    expect(body.impl).toBe("packaged");
    expect(body.info.impl).toBe("packaged");
    expect(body.iface.name).toBe("platform");
    expect(Object.keys(body.iface.children)).toEqual(["terminals"]);
  });

  it("pushing the next build as inline bytes migrates the platform; terminals survive", async () => {
    // A `cat` terminal echoes stdin: live proof the same process spans the swap.
    const created = await api.post("/api/hmr/terminals", { command: "cat" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await api.post(`/api/hmr/terminals/${id}/input`, { data: "before-upgrade\n" });
    await until(async () => {
      const r = await api.get(`/api/hmr/terminals/${id}`);
      return ((await r.json()) as { output: string }).output.includes("before-upgrade");
    });

    // The bundle bytes travel in the request body — exactly what a remote /
    // HTTP-only runtime receives; the optional git specifier is provenance
    // only (echoed, never executed).
    const source = { repo: "file:///builds/penguin.git", revision: "deadbeef" };
    const upgraded = await api.post("/api/hmr/platform/upgrade", { bundle: nextBundle, source });
    expect(upgraded.status).toBe(200);
    // The packaged doc is v1; the pushed build is v2 with a 1→2 migrator.
    expect(await upgraded.json()).toEqual({ status: "ok", mode: "migrated", impl: "next", source });

    const info = (await (await api.get("/api/hmr/platform")).json()) as {
      impl: string;
      info: { impl: string; theme: string };
    };
    expect(info.info.impl).toBe("next");
    expect(info.info.theme).toBe("classic"); // filled by the migrator

    // Same process, buffer intact, still responsive.
    const after = (await (await api.get(`/api/hmr/terminals/${id}`)).json()) as {
      output: string;
      alive: boolean;
      lost: boolean;
    };
    expect(after.alive).toBe(true);
    expect(after.lost).toBe(false);
    expect(after.output).toContain("before-upgrade");

    await api.post(`/api/hmr/terminals/${id}/input`, { data: "after-upgrade\n" });
    await until(async () => {
      const r = await api.get(`/api/hmr/terminals/${id}`);
      return ((await r.json()) as { output: string }).output.includes("after-upgrade");
    });
  });

  it("a downgrade without a migration path is blocked and the running platform keeps serving", async () => {
    await api.post("/api/hmr/platform/upgrade", { bundle: nextBundle });
    // Derive an OLD build from the fixture: iface v1, no theme, no migrator.
    const oldBundle = nextBundle
      .replace("version: 2,", "version: 1,")
      .replace(
        'objectSchema({ motd: "string", theme: "string" })',
        'objectSchema({ motd: "string" })',
      )
      .replace(/migrations: \{\n    1: [^\n]*\n  \},/, "migrations: {},");
    const res = await api.post("/api/hmr/platform/upgrade", { bundle: oldBundle });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { status: string; invalid: string[] };
    expect(outcome.status).toBe("blocked");
    expect(outcome.invalid.some((p) => p.includes("newer than iface"))).toBe(true);
    // Untouched: still the pushed next build.
    const info = (await (await api.get("/api/hmr/platform")).json()) as { impl: string };
    expect(info.impl).toBe("next");
  });

  it("inline web dist over HTTP: a { relPath: base64 } manifest, traversal-guarded", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const res = await api.post("/api/hmr/web/upgrade", {
      files: {
        "index.html": b64("<html>pushed-v1</html>"),
        "assets/app.js": b64("console.log(1)"),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; rev: string };
    expect(body.status).toBe("ok");

    // Static hosting now serves the pushed dist (SPA fallback included).
    expect(await (await t.app.request("/")).text()).toContain("pushed-v1");
    expect(await (await t.app.request("/deep/spa/route")).text()).toContain("pushed-v1");

    // A re-push swaps in place with a new rev.
    const res2 = await api.post("/api/hmr/web/upgrade", {
      files: { "index.html": b64("<html>pushed-v2</html>") },
    });
    expect(((await res2.json()) as { rev: string }).rev).not.toBe(body.rev);
    expect(await (await t.app.request("/")).text()).toContain("pushed-v2");

    // No index.html → 400; path traversal → 400; serving unchanged.
    expect((await api.post("/api/hmr/web/upgrade", { files: { "x.js": b64("1") } })).status).toBe(
      400,
    );
    expect(
      (
        await api.post("/api/hmr/web/upgrade", {
          files: { "index.html": b64("<html>ok</html>"), "../escape.js": b64("1") },
        })
      ).status,
    ).toBe(400);
    expect(await (await t.app.request("/")).text()).toContain("pushed-v2");
  });

  it("requests racing an upgrade are enqueued, never observably rejected", async () => {
    const [first, second, list] = await Promise.all([
      api.post("/api/hmr/platform/upgrade", { bundle: nextBundle }),
      api.post("/api/hmr/platform/upgrade", { bundle: nextBundle }),
      api.get("/api/hmr/terminals"),
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
      const b64 = (s: string) => Buffer.from(s).toString("base64");

      // Runtime #1: push the next build and an inline web dist.
      const h1 = new HmrHost(root);
      const up = await h1.upgradeTo({ bundlePath: NEXT_BUNDLE_FILE });
      expect(up.status).toBe("ok");
      await h1.installInlineWebDist({ "index.html": b64("<html>persisted-web</html>") });
      h1.dispose();

      // Runtime #2 on the SAME data root: a fresh process. It must resume the
      // committed platform and web, not fall back to the packaged build.
      const h2 = new HmrHost(root);
      const inst = await h2.ensure();
      expect(h2.currentImplId()).toBe("next");
      expect((inst.api.info() as { impl: string }).impl).toBe("next");
      expect(h2.webDistDir).not.toBeNull();
      expect(existsSync(path.join(h2.webDistDir!, "index.html"))).toBe(true);
      h2.dispose();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a corrupt/missing persisted platform falls back to the packaged build (never bricks)", async () => {
    const root = await makeTempRoot();
    try {
      await fs.mkdir(path.join(root, "hmr"), { recursive: true });
      await fs.writeFile(
        path.join(root, "hmr", "harness.json"),
        JSON.stringify({
          platform: { bundle: "store/platform/gone.mjs", park: "store/platform/gone.park.json" },
        }),
      );
      const h = new HmrHost(root);
      await h.ensure();
      expect(h.currentImplId()).toBe("packaged");
      h.dispose();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("the store keeps at most 2 platform bundles / web dists (current + one rollback)", async () => {
    const root = await makeTempRoot();
    try {
      const bundleSrc = await fs.readFile(NEXT_BUNDLE_FILE, "utf8");
      const b64 = (s: string) => Buffer.from(s).toString("base64");
      const h = new HmrHost(root);
      // Three distinct pushed builds (content varies via a trailing comment).
      for (let i = 0; i < 3; i++) {
        const f = path.join(root, `next-${i}.mjs`);
        await fs.writeFile(f, `${bundleSrc}\n// push ${i}\n`);
        const up = await h.upgradeTo({ bundlePath: f });
        expect(up.status).toBe("ok");
      }
      for (let i = 0; i < 3; i++) {
        await h.installInlineWebDist({ "index.html": b64(`<html>web-${i}</html>`) });
      }
      const platforms = (await fs.readdir(path.join(root, "hmr", "store", "platform"))).filter(
        (n) => n.endsWith(".mjs"),
      );
      const webs = await fs.readdir(path.join(root, "hmr", "store", "web"));
      expect(platforms.length).toBeLessThanOrEqual(2);
      expect(webs.length).toBeLessThanOrEqual(2);
      // The committed one survived pruning and still restores.
      h.dispose();
      const h2 = new HmrHost(root);
      await h2.ensure();
      expect(h2.currentImplId()).toBe("next");
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
      const plain = await app.request("/api/hmr/platform", { headers: { cookie: admin.cookie } });
      expect(plain.status).toBe(403);
      expect(((await plain.json()) as { error: { code: string } }).error.code).toBe("hmr_disabled");

      // HTTPS (as seen via the reverse proxy header): allowed.
      const https = await app.request("/api/hmr/platform", {
        headers: { cookie: admin.cookie, "x-forwarded-proto": "https" },
      });
      expect(https.status).toBe(200);

      // Explicit override: allowed even on plain http.
      process.env.PENGUIN_HMR_API_UNSAFE = "1";
      try {
        const forced = await app.request("/api/hmr/platform", {
          headers: { cookie: admin.cookie },
        });
        expect(forced.status).toBe(200);
      } finally {
        delete process.env.PENGUIN_HMR_API_UNSAFE;
      }
    } finally {
      deps.hmr.dispose();
      deps.channels.dispose();
      deps.db.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
