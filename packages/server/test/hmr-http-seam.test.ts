/**
 * The platform's HTTP seam: routes ship by push, not by rebuild.
 *
 * Until this existed, the route table was a runtime asset — every new or changed endpoint cost
 * a rebuild and a redeploy of every installation, which is the thing the hot channel exists to
 * avoid. These tests push a platform that serves HTTP and check the properties that make the
 * seam usable and safe: a new route appears, an existing one can be replaced, the upgrade
 * channel cannot be claimed, and a platform that throws does not silently fall through to a
 * different implementation. The last block walks a whole lifecycle — the set of reachable
 * endpoints following the pushes that add and remove them.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const HTTP_BUNDLE_FILE = fileURLToPath(
  new URL("./fixtures/platform-http.bundle.mjs", import.meta.url),
);

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";
const MINIMAL_WEB = { "index.html": Buffer.from("<html>seam</html>").toString("base64") };

async function pushPlatform(app: Hono<AppEnv>, cookie: string, platform: string) {
  const gz = zlib.gzipSync(
    Buffer.from(JSON.stringify({ platform, cli: MINIMAL_CLI, web: { files: MINIMAL_WEB } })),
  );
  return app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip" },
    body: gz,
  });
}

describe("platform HTTP seam", () => {
  let t: TestApp;
  let cookie: string;
  let api: ReturnType<typeof apiClient>;
  let bundle: string;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    cookie = admin.cookie;
    api = apiClient(t.app, cookie);
    bundle = await fs.readFile(HTTP_BUNDLE_FILE, "utf8");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("a pushed platform adds a route the runtime has never heard of", async () => {
    // Before: nothing serves it, and no rebuild is going to happen in between.
    expect((await api.get("/api/demo/ping")).status).toBe(404);

    expect((await pushPlatform(t.app, cookie, bundle)).status).toBe(200);

    const res = await api.get("/api/demo/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true, from: "pushed-platform" });
  });

  it("…and can replace one the runtime already serves", async () => {
    const before = (await (await api.get("/api/version")).json()) as { version: string };
    expect(before.version).not.toBe("from-platform");

    await pushPlatform(t.app, cookie, bundle);

    expect(await (await api.get("/api/version")).json()).toEqual({ version: "from-platform" });
  });

  it("routes the platform declines still reach the runtime's own", async () => {
    await pushPlatform(t.app, cookie, bundle);
    // The runtime's own routes are the mechanism surface (auth, hmr, desktop, static):
    // login still works with a fixture platform in place, because the fixture declines
    // /api/auth and the runtime serves it. Business routes are NOT runtime fallbacks —
    // /api/me travels with the business platform, which this push replaced.
    const login = await loginAdmin(t.app);
    expect(login.user.userId).toBe("admin");
    expect((await api.get("/api/me")).status).toBe(404);
  });

  it("cannot claim the upgrade channel — one bad push must not lock the box out", async () => {
    await pushPlatform(t.app, cookie, bundle);
    // The fixture answers 418 for anything under /api/hmr; the runtime never offers
    // it, so an unrouted path there is the runtime's own 404 rather than the
    // platform's 418 — proof the claim was refused, not merely unmatched.
    const probe = await api.get("/api/hmr/upgrade");
    expect(probe.status).not.toBe(418);
    expect(probe.status).toBe(404);
    // …and the channel still accepts the next push, which is the property that matters.
    expect((await pushPlatform(t.app, cookie, bundle)).status).toBe(200);
  });

  it("a platform that throws answers 500 instead of quietly falling through", async () => {
    await pushPlatform(t.app, cookie, bundle);
    const res = await api.get("/api/demo/boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("platform_error");
    expect(body.error.message).toContain("deliberate platform failure");
  });

  it("the packaged platform serves the business surface out of the box", async () => {
    // This is the state every installation starts in: no push has happened, and the
    // packaged platform's business routes answer through the seam.
    expect((await api.get("/api/me")).status).toBe(200);
    expect((await api.get("/api/demo/ping")).status).toBe(404);
  });
});

/**
 * A platform bundle that serves exactly `paths` and declines everything else. Built inline
 * rather than read from a fixture file so the ONLY difference between the versions pushed
 * below is the route list — which is the thing under test.
 */
function platformServing(paths: string[], id = "route-set"): string {
  return `
const anySchema = {
  strictParse: (doc) => ({ ok: true, value: doc === undefined ? {} : doc }),
  describe: () => ({ kind: "any" }),
};
const iface = {
  kind: "iface",
  name: "platform",
  version: 1,
  context: anySchema,
  methods: ["park", "info", "http", "terminals", "attachStream", "business", "shutdown"],
  children: {},
  migrations: {},
};
const SERVED = ${JSON.stringify(paths)};
const impl = {
  create(_ctx, context) {
    return {
      park: () => context,
      // The host ABI a real platform provides; a bundle that omits any of it is
      // refused at load (see capabilities.ts's HOST_PLATFORM_METHODS).
      terminals: () => ({ handleIds: () => [] }),
      attachStream: () => {},
      business: () => null,
      shutdown: async () => {},
      info: () => ({ impl: ${JSON.stringify(id)} }),
      http(request) {
        const { pathname } = new URL(request.url);
        if (!SERVED.includes(pathname)) return null;
        return new Response(JSON.stringify({ servedBy: ${JSON.stringify(id)}, pathname }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
  },
};
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl, context: {} };
`;
}

describe("platform HTTP seam: the reachable API changes with each push", () => {
  let t: TestApp;
  let cookie: string;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    cookie = admin.cookie;
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** Which of the probed endpoints answer, and who answered them. */
  const reachable = async (paths: string[]): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const path of paths) {
      const res = await api.get(path);
      out[path] =
        res.status === 404
          ? "404"
          : `${res.status} ${((await res.json()) as { servedBy?: string }).servedBy ?? "runtime"}`;
    }
    return out;
  };

  const PROBED = ["/api/demo/ping", "/api/demo/pong", "/api/me"];

  it("adding, swapping and removing routes changes what the server answers", async () => {
    // Baseline: the packaged business platform serves /api/me; nothing serves the demo
    // endpoints. ("runtime" below just means "no servedBy field in the body".)
    expect(await reachable(PROBED)).toEqual({
      "/api/demo/ping": "404",
      "/api/demo/pong": "404",
      "/api/me": "200 runtime",
    });

    // Push #1 ADDS one endpoint — and, because the business surface travels WITH the
    // platform, replaces the packaged business wholesale: /api/me is gone with it.
    expect(
      (await pushPlatform(t.app, cookie, platformServing(["/api/demo/ping"], "v1"))).status,
    ).toBe(200);
    expect(await reachable(PROBED)).toEqual({
      "/api/demo/ping": "200 v1",
      "/api/demo/pong": "404",
      "/api/me": "404",
    });

    // Push #2 SWAPS the route set: the first endpoint is gone, a different one appears.
    expect(
      (await pushPlatform(t.app, cookie, platformServing(["/api/demo/pong"], "v2"))).status,
    ).toBe(200);
    expect(await reachable(PROBED)).toEqual({
      "/api/demo/ping": "404",
      "/api/demo/pong": "200 v2",
      "/api/me": "404",
    });

    // Push #3 REMOVES both: only the runtime's mechanism surface remains reachable.
    expect((await pushPlatform(t.app, cookie, platformServing([], "v3"))).status).toBe(200);
    expect(await reachable(PROBED)).toEqual({
      "/api/demo/ping": "404",
      "/api/demo/pong": "404",
      "/api/me": "404",
    });
  });

  it("a route the platform stops serving vanishes with it — the runtime holds no business fallback", async () => {
    // The packaged business platform serves /api/version…
    expect((await api.get("/api/version")).status).toBe(200);

    // …a pushed platform can take the path over…
    await pushPlatform(t.app, cookie, platformServing(["/api/version"], "takeover"));
    expect(await (await api.get("/api/version")).json()).toMatchObject({ servedBy: "takeover" });

    // …and a push that drops it leaves the path unserved: business routes live and die
    // with the platform version, never as a runtime copy that could answer with stale
    // semantics.
    await pushPlatform(t.app, cookie, platformServing([], "released"));
    expect((await api.get("/api/version")).status).toBe(404);
  });
});

/**
 * Same shape as `platformServing`, except `create()` awaits `delayMs` before returning —
 * so the window between the kernel disposing the OLD instance and this NEW one finishing
 * boot (see kernel/upgrade.ts: dispose-then-await-boot) is wide enough to race a request
 * against on purpose.
 */
function platformSlow(delayMs: number, id: string): string {
  return `
const anySchema = {
  strictParse: (doc) => ({ ok: true, value: doc === undefined ? {} : doc }),
  describe: () => ({ kind: "any" }),
};
const iface = {
  kind: "iface",
  name: "platform",
  version: 1,
  context: anySchema,
  methods: ["park", "info", "http", "terminals", "attachStream", "business", "shutdown"],
  children: {},
  migrations: {},
};
const impl = {
  async create(_ctx, context) {
    await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
    return {
      park: () => context,
      // The host ABI a real platform provides; a bundle that omits any of it is
      // refused at load (see capabilities.ts's HOST_PLATFORM_METHODS).
      terminals: () => ({ handleIds: () => [] }),
      attachStream: () => {},
      business: () => null,
      shutdown: async () => {},
      info: () => ({ impl: ${JSON.stringify(id)} }),
      http(request) {
        const { pathname } = new URL(request.url);
        if (pathname !== "/api/demo/version") return null;
        return new Response(JSON.stringify({ impl: ${JSON.stringify(id)} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
  },
};
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl, context: {} };
`;
}

describe("platform HTTP seam: a request racing an in-flight swap", () => {
  let t: TestApp;
  let cookie: string;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    cookie = admin.cookie;
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("waits for the new instance instead of landing on the disposed old one", async () => {
    // Boot v1 first (instant), so there IS an old instance for upgrade() to dispose.
    expect((await pushPlatform(t.app, cookie, platformSlow(0, "v1"))).status).toBe(200);
    expect(await (await api.get("/api/demo/version")).json()).toEqual({ impl: "v1" });

    // Push v2 with a slow boot (kernel's upgrade() disposes v1 synchronously, then awaits
    // v2's boot — see upgrade.ts) and race a seam request against it while it's in flight.
    const pushed = pushPlatform(t.app, cookie, platformSlow(150, "v2"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const raced = await api.get("/api/demo/version");
    expect((await pushed).status).toBe(200);

    // Must observe latency (the seam awaited the swap), never the disposed v1 nor an error.
    expect(raced.status).toBe(200);
    expect(await raced.json()).toEqual({ impl: "v2" });
  });
});
