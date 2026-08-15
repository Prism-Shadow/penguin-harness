/**
 * Hot-update integration tests (via app.request() injection): pushing a
 * next-build platform bundle and a web dist as inline bytes over HTTP, the
 * migrate/blocked paths, atomic persistence across a runtime restart, auth,
 * the network gate, and request queueing during a swap.
 *
 * The business-platform proof (terminals surviving a swap via resource
 * claiming) lives in hmr-business-platform.test.ts, parked with
 * describe.skip until the business platform is back (feat/workflow-hmr) —
 * this file only exercises the mechanism, which carries no business methods.
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
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

/** A minimal platform exercising the generic dispatch route (/api/hmr/platform/call). */
const DISPATCH_BUNDLE_FILE = fileURLToPath(
  new URL("./fixtures/platform-dispatch.bundle.mjs", import.meta.url),
);

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
    const res = await t.app.request("/api/hmr/platform", { headers: bearer });
    expect(res.status).toBe(200);
    // A wrong token falls through to cookie auth and fails as unauthenticated.
    const bad = await t.app.request("/api/hmr/platform", {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(bad.status).toBe(401);
    // A mutating call works over the token too.
    const upgraded = await t.app.request("/api/hmr/platform/upgrade", {
      method: "POST",
      headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ bundle: nextBundle }),
    });
    expect(upgraded.status).toBe(200);
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
    // The packaged default is a bare mechanism-only stub: no business children.
    expect(Object.keys(body.iface.children)).toEqual([]);
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

  it("gzip web push: THE PRIMARY PATH, one artifact instead of one write per file", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const files = {
      "index.html": b64("<html>gzip-pushed</html>"),
      "assets/app.js": b64("console.log(1)"),
      "assets/app.css": b64("body{color:red}"),
    };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ files })));
    const res = await t.app.request("/api/hmr/web/upgrade", {
      method: "POST",
      headers: {
        authorization: `Bearer ${t.deps.hmr.apiToken}`,
        "content-type": "application/gzip",
      },
      body: gz,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; rev: string };
    expect(body.status).toBe("ok");

    const page = await t.app.request("/");
    expect(await page.text()).toContain("gzip-pushed");
    expect(page.headers.get("content-type")).toContain("text/html");

    const asset = await t.app.request("/assets/app.css");
    expect(await asset.text()).toBe("body{color:red}");
    expect(asset.headers.get("content-type")).toContain("text/css");

    // A JSON push of the identical content lands on the same rev (rev is
    // content-derived, not transport-derived) — and octet-stream is accepted
    // as an alias for the same binary transport.
    const jsonRepush = await api.post("/api/hmr/web/upgrade", { files });
    expect(((await jsonRepush.json()) as { rev: string }).rev).toBe(body.rev);

    const gz2 = zlib.gzipSync(
      Buffer.from(JSON.stringify({ files: { "index.html": b64("<html>octet</html>") } })),
    );
    const octetRes = await t.app.request("/api/hmr/web/upgrade", {
      method: "POST",
      headers: {
        authorization: `Bearer ${t.deps.hmr.apiToken}`,
        "content-type": "application/octet-stream",
      },
      body: gz2,
    });
    expect(octetRes.status).toBe(200);
    expect(await (await t.app.request("/")).text()).toContain("octet");
  });

  it("generic dispatch: the allow-list is the running platform's iface.methods, read live", async () => {
    const dispatchBundle = await fs.readFile(DISPATCH_BUNDLE_FILE, "utf8");
    const upgraded = await api.post("/api/hmr/platform/upgrade", { bundle: dispatchBundle });
    expect(upgraded.status).toBe(200);

    // A normal call: args round-trip, the result is returned as-is.
    const echoed = await api.post("/api/hmr/platform/call", { method: "echo", args: ["hi"] });
    expect(echoed.status).toBe(200);
    expect(await echoed.json()).toEqual({ ok: true, result: { got: "hi" } });

    // No args at all is fine too (defaults to an empty argument list).
    const info = await api.post("/api/hmr/platform/call", { method: "info" });
    expect(info.status).toBe(200);
    expect(((await info.json()) as { result: { impl: string } }).result.impl).toBe(
      "dispatch-fixture",
    );

    // A method not on the current iface (new, or since removed by a push) 404s.
    const missing = await api.post("/api/hmr/platform/call", { method: "nope" });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      "method_not_found",
    );

    // `args` must be an array when present.
    const badArgs = await api.post("/api/hmr/platform/call", { method: "echo", args: "hi" });
    expect(badArgs.status).toBe(400);

    // A thrown error surfaces as a call failure carrying the message, not a crash.
    const threw = await api.post("/api/hmr/platform/call", { method: "boom" });
    expect(threw.status).toBe(500);
    expect(((await threw.json()) as { error: { code: string; message: string } }).error).toEqual({
      code: "call_failed",
      message: "boom",
    });

    // A void method is a successful call with no result: null, not an error
    // (the side effect already happened).
    const voidCall = await api.post("/api/hmr/platform/call", { method: "fireAndForget" });
    expect(voidCall.status).toBe(200);
    expect(await voidCall.json()).toEqual({ ok: true, result: null });

    // A genuinely non-JSON-serializable result (a function) is rejected, not coerced.
    const unserializable = await api.post("/api/hmr/platform/call", { method: "notJson" });
    expect(unserializable.status).toBe(422);
    expect(((await unserializable.json()) as { error: { code: string } }).error.code).toBe(
      "unserializable_result",
    );
  });

  it("requests racing an upgrade are enqueued, never observably rejected", async () => {
    const [first, second, list] = await Promise.all([
      api.post("/api/hmr/platform/upgrade", { bundle: nextBundle }),
      api.post("/api/hmr/platform/upgrade", { bundle: nextBundle }),
      api.get("/api/hmr/platform"),
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
      // committed platform and web, not fall back to the packaged build. The
      // web dist restores straight into memory (one gzip artifact read).
      const h2 = new HmrHost(root);
      const inst = await h2.ensure();
      expect(h2.currentImplId()).toBe("next");
      expect((inst.api.info() as { impl: string }).impl).toBe("next");
      const source = h2.resolveWebSource();
      expect(source?.kind).toBe("mem");
      expect(
        Buffer.from((source as { files: Map<string, Buffer> }).files.get("index.html")!).toString(
          "utf8",
        ),
      ).toContain("persisted-web");
      h2.dispose();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a legacy { dir } web manifest still restores to disk (backward compatibility)", async () => {
    const root = await makeTempRoot();
    try {
      const legacyDir = path.join(root, "hmr", "legacy-web");
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(path.join(legacyDir, "index.html"), "<html>legacy-dir</html>");
      await fs.mkdir(path.join(root, "hmr"), { recursive: true });
      await fs.writeFile(
        path.join(root, "hmr", "harness.json"),
        JSON.stringify({ web: { dir: "legacy-web" } }),
      );
      const h = new HmrHost(root);
      await h.ensure();
      const source = h.resolveWebSource();
      expect(source?.kind).toBe("dir");
      expect((source as { dir: string }).dir).toBe(legacyDir);
      h.dispose();
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
