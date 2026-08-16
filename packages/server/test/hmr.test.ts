/**
 * Hot-update integration tests (via app.request() injection): pushing a
 * next-build version (platform bundle + cli bundle + web dist, THREE
 * independent artifacts in ONE atomic push), the migrate/blocked paths,
 * atomic persistence across a runtime restart, auth, the network gate, and
 * request queueing during a swap.
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
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppDeps, createApp } from "../src/app.js";
import { HmrHost } from "../src/hmr/host.js";
import type { AppEnv } from "../src/auth/middleware.js";
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

const b64 = (s: string): string => Buffer.from(s).toString("base64");

/** A minimal-but-valid web dist manifest (only index.html is required). */
function minimalWeb(marker: string): Record<string, string> {
  return { "index.html": b64(`<html>${marker}</html>`) };
}

/**
 * A stand-in cli artifact: the server never imports or runs `cli` (see
 * host.ts's persistVersion) — it is only content-addressed into the store — so
 * tests that don't care about its content can reuse this constant.
 */
const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";

/**
 * Pushes ONE atomic version (platform bundle + cli bundle + web) to POST
 * /api/hmr/upgrade — the merged endpoint's only transport is a gzip(JSON) body,
 * so this bypasses apiClient's JSON-only helper.
 */
async function pushVersion(
  app: Hono<AppEnv>,
  cookie: string,
  target: {
    platform: string;
    cli?: string;
    web?: Record<string, string>;
    source?: { repo: string; revision: string };
  },
): Promise<Response> {
  const gz = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({
        platform: target.platform,
        cli: target.cli ?? MINIMAL_CLI,
        web: { files: target.web ?? minimalWeb("web") },
        ...(target.source ? { source: target.source } : {}),
      }),
    ),
  );
  return app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip" },
    body: gz,
  });
}

describe("hot update", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let adminCookie: string;
  let nextBundle: string;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    adminCookie = admin.cookie;
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

  it("a Bearer token is not accepted for hot APIs (admin cookie only)", async () => {
    // The local per-boot Bearer-token credential (formerly published to
    // $PENGUIN_HOME/hmr/api.json) is gone: it was a plaintext admin-equivalent secret
    // readable by anything running as the same OS user, so no authorization header of
    // any shape authenticates here anymore — only the admin cookie session does.
    const bearer = { authorization: "Bearer whatever-looks-like-a-token" };
    const res = await t.app.request("/api/hmr/platform", { headers: bearer });
    expect(res.status).toBe(401);
    // A mutating call is rejected the same way.
    const gz = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({ platform: nextBundle, cli: MINIMAL_CLI, web: { files: minimalWeb("x") } }),
      ),
    );
    const upgraded = await t.app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { ...bearer, "content-type": "application/gzip" },
      body: gz,
    });
    expect(upgraded.status).toBe(401);
    // The admin cookie session still works.
    const ok = await t.app.request("/api/hmr/platform", { headers: { cookie: adminCookie } });
    expect(ok.status).toBe(200);
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

  it("one push moves platform + cli + web together: web reload broadcasts, static hosting flips", async () => {
    const res = await pushVersion(t.app, adminCookie, {
      platform: nextBundle,
      web: minimalWeb("pushed-v1"),
    });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { status: string; impl: string; web: { rev: string } };
    expect(outcome.status).toBe("ok");
    expect(outcome.impl).toBe("next");
    expect(outcome.web.rev).toBeTruthy();

    const info = (await (await api.get("/api/hmr/platform")).json()) as { impl: string };
    expect(info.impl).toBe("next");
    expect(await (await t.app.request("/")).text()).toContain("pushed-v1");
    expect(await (await t.app.request("/deep/spa/route")).text()).toContain("pushed-v1");
  });

  it("a platform bundle not exporting `hotPlatform` is rejected outright", async () => {
    const noHotPlatform = nextBundle.replace(/export const hotPlatform[\s\S]*$/, "");
    const res = await pushVersion(t.app, adminCookie, { platform: noHotPlatform });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "does not export 'hotPlatform'",
    );
    // Untouched: still the packaged default.
    const info = (await (await api.get("/api/hmr/platform")).json()) as { impl: string };
    expect(info.impl).toBe("packaged");
  });

  it("a push with no `cli` field is rejected outright — platform and cli are independent artifacts but both required", async () => {
    const gz = zlib.gzipSync(
      Buffer.from(JSON.stringify({ platform: nextBundle, web: { files: minimalWeb("x") } })),
    );
    const res = await t.app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/gzip" },
      body: gz,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "payload has no `cli`",
    );
    // Untouched: still the packaged default.
    const info = (await (await api.get("/api/hmr/platform")).json()) as { impl: string };
    expect(info.impl).toBe("packaged");
  });

  it("a web manifest with no index.html is rejected outright", async () => {
    const res = await pushVersion(t.app, adminCookie, {
      platform: nextBundle,
      web: { "x.js": b64("1") },
    });
    expect(res.status).toBe(400);
    const info = (await (await api.get("/api/hmr/platform")).json()) as { impl: string };
    expect(info.impl).toBe("packaged");
  });

  it("path traversal in the web manifest is rejected outright", async () => {
    const res = await pushVersion(t.app, adminCookie, {
      platform: nextBundle,
      web: { "index.html": b64("<html>ok</html>"), "../escape.js": b64("1") },
    });
    expect(res.status).toBe(400);
  });

  it("a downgrade without a migration path is blocked and the running version keeps serving", async () => {
    await pushVersion(t.app, adminCookie, { platform: nextBundle, web: minimalWeb("v1") });
    // Derive an OLD build from the fixture: iface v1, no theme, no migrator.
    const oldBundle = nextBundle
      .replace("version: 2,", "version: 1,")
      .replace(
        'objectSchema({ motd: "string", theme: "string" })',
        'objectSchema({ motd: "string" })',
      )
      .replace(/migrations: \{\n    1: [^\n]*\n  \},/, "migrations: {},");
    const res = await pushVersion(t.app, adminCookie, {
      platform: oldBundle,
      web: minimalWeb("v2"),
    });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { status: string; invalid: string[] };
    expect(outcome.status).toBe("blocked");
    expect(outcome.invalid.some((p) => p.includes("newer than iface"))).toBe(true);
    // Untouched: still the pushed next build, AND its web (a blocked platform must
    // never leave web ahead of platform).
    const info = (await (await api.get("/api/hmr/platform")).json()) as { impl: string };
    expect(info.impl).toBe("next");
    expect(await (await t.app.request("/")).text()).toContain("v1");
  });

  it("a re-push swaps web in place with a new rev", async () => {
    const first = await pushVersion(t.app, adminCookie, {
      platform: nextBundle,
      web: minimalWeb("v1"),
    });
    const firstBody = (await first.json()) as { web: { rev: string } };
    const second = await pushVersion(t.app, adminCookie, {
      platform: nextBundle,
      web: minimalWeb("v2"),
    });
    const secondBody = (await second.json()) as { web: { rev: string } };
    expect(secondBody.web.rev).not.toBe(firstBody.web.rev);
    expect(await (await t.app.request("/")).text()).toContain("v2");
  });

  it("requests racing an upgrade are enqueued, never observably rejected", async () => {
    const [first, second, list] = await Promise.all([
      pushVersion(t.app, adminCookie, { platform: nextBundle }),
      pushVersion(t.app, adminCookie, { platform: nextBundle }),
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
  it("a pushed version (platform + cli + web) resumes after a restart (atomic manifest commit)", async () => {
    const root = await makeTempRoot();
    try {
      const nextBundle = await fs.readFile(NEXT_BUNDLE_FILE, "utf8");

      // Runtime #1: push the next build as one atomic version.
      const h1 = new HmrHost(root);
      const up = await h1.upgradeAll({
        platform: nextBundle,
        cli: MINIMAL_CLI,
        web: minimalWeb("persisted-web"),
      });
      expect(up.status).toBe("ok");
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

  it("a corrupt/missing persisted platform falls back to the packaged build entirely (never a platform/web mismatch)", async () => {
    const root = await makeTempRoot();
    try {
      await fs.mkdir(path.join(root, "hmr"), { recursive: true });
      // A platform pointer to a pruned/missing bundle, paired with what LOOKS like a
      // valid web pointer: the restore must not resume web alone — the whole version
      // falls back together (see host.ts's restore()).
      const webDir = path.join(root, "hmr", "store", "web");
      await fs.mkdir(webDir, { recursive: true });
      const gz = zlib.gzipSync(
        Buffer.from(JSON.stringify({ files: minimalWeb("should-not-serve") })),
      );
      await fs.writeFile(path.join(webDir, "aaaa.webz"), gz);
      await fs.writeFile(
        path.join(root, "hmr", "harness.json"),
        JSON.stringify({
          platform: { bundle: "store/platform/gone.mjs", park: "store/platform/gone.park.json" },
          cli: { bundle: "store/cli/gone.mjs" },
          web: { manifest: "store/web/aaaa.webz" },
        }),
      );
      const h = new HmrHost(root);
      await h.ensure();
      expect(h.currentImplId()).toBe("packaged");
      expect(h.resolveWebSource()).toBeNull();
      h.dispose();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("the store keeps at most 2 versions (current + one rollback)", async () => {
    const root = await makeTempRoot();
    try {
      const bundleSrc = await fs.readFile(NEXT_BUNDLE_FILE, "utf8");
      const h = new HmrHost(root);
      // Three distinct pushed versions (platform + cli content each vary via a
      // trailing comment; web content varies too).
      for (let i = 0; i < 3; i++) {
        const up = await h.upgradeAll({
          platform: `${bundleSrc}\n// push ${i}\n`,
          cli: `${MINIMAL_CLI}\n// push ${i}\n`,
          web: minimalWeb(`web-${i}`),
        });
        expect(up.status).toBe("ok");
      }
      const platforms = (await fs.readdir(path.join(root, "hmr", "store", "platform"))).filter(
        (n) => n.endsWith(".mjs"),
      );
      const clis = await fs.readdir(path.join(root, "hmr", "store", "cli"));
      const webs = await fs.readdir(path.join(root, "hmr", "store", "web"));
      expect(platforms.length).toBeLessThanOrEqual(2);
      expect(clis.length).toBeLessThanOrEqual(2);
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
