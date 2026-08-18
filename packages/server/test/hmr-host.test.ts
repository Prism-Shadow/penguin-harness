/**
 * HmrHost mechanism tests that don't fit the seam's own file: the single-flight first
 * boot, the park file's crash-safety under a code+state collision, and the durability
 * flag an upgrade's HTTP response carries.
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import { HmrHost } from "../src/hmr/host.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Minimal but content-distinguishable platform bundle, inline (see hmr-http-seam.test.ts). */
function platformServing(paths: string[], id: string): string {
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
  methods: ["park", "info"],
  children: {},
  migrations: {},
};
const SERVED = ${JSON.stringify(paths)};
const impl = {
  create(_ctx, context) {
    return {
      park: () => context,
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
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl };
`;
}

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";
const MINIMAL_WEB = { "index.html": Buffer.from("<html>host</html>").toString("base64") };

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

describe("HmrHost.ensure(): single-flight first boot", () => {
  let t: TestApp | undefined;
  let freshRoot: string | undefined;

  afterEach(async () => {
    if (t) await t.cleanup();
    if (freshRoot) await fs.rm(freshRoot, { recursive: true, force: true });
    t = undefined;
    freshRoot = undefined;
  });

  it("concurrent ensure() calls on a fresh host share one init and all resolve to the restored (pushed) instance", async () => {
    // Push a version and let it persist, then tear down that host WITHOUT touching the
    // root directory — simulating a restart of the same data root.
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const push = await pushPlatform(t.app, cookie, platformServing(["/api/demo/ping"], "pushed"));
    expect(push.status).toBe(200);
    expect(((await push.json()) as { persisted: boolean }).persisted).toBe(true);

    const root = t.root;
    freshRoot = root;
    t.deps.hmr.dispose();
    t.deps.channels.dispose();
    t.deps.db.close();
    t = undefined; // already torn down by hand; skip the normal cleanup() (it would rm(root))

    // A brand-new HmrHost over the SAME root: nothing has called ensure() yet.
    const fresh = new HmrHost(root);
    try {
      const [a, b, c] = await Promise.all([fresh.ensure(), fresh.ensure(), fresh.ensure()]);
      // Same object: only one restore()/boot ever ran.
      expect(a).toBe(b);
      expect(b).toBe(c);
      const info = (a.api as unknown as { info(): { impl: string } }).info();
      expect(info.impl).toBe("pushed");
    } finally {
      fresh.dispose();
    }
  });
});

describe("HmrHost.persistVersion(): park file crash-safety", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("never overwrites a park file already referenced by a committed manifest", async () => {
    root = await makeTempRoot();
    const host = new HmrHost(root) as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persistVersion(
        platform: string,
        cli: string,
        doc: any,
        webGz: Buffer,
        webSha: string,
      ): Promise<boolean>;
    };
    const platformContent = "export const hotPlatform = { id: 'x' };\n";
    const cliContent = MINIMAL_CLI;
    const webGz = zlib.gzipSync(Buffer.from(JSON.stringify({ files: {} })));

    const doc1 = { v: 1, self: { n: 1 }, children: {} };
    const ok1 = await host.persistVersion(platformContent, cliContent, doc1, webGz, "web1");
    expect(ok1).toBe(true);
    const manifest1 = JSON.parse(
      await fs.readFile(path.join(root, "hmr", "harness.json"), "utf8"),
    ) as { platform: { park: string } };
    const parkPath1 = path.join(root, "hmr", manifest1.platform.park);
    const parkContent1 = await fs.readFile(parkPath1, "utf8");
    expect(JSON.parse(parkContent1)).toEqual(doc1);

    // SAME platform code, DIFFERENT parked state — this is the collision case: the old
    // naming (`${platformSha}.park.json`) would land on the exact same file as above.
    const doc2 = { v: 1, self: { n: 2 }, children: {} };
    const ok2 = await host.persistVersion(platformContent, cliContent, doc2, webGz, "web2");
    expect(ok2).toBe(true);
    const manifest2 = JSON.parse(
      await fs.readFile(path.join(root, "hmr", "harness.json"), "utf8"),
    ) as { platform: { park: string } };
    const parkPath2 = path.join(root, "hmr", manifest2.platform.park);

    expect(parkPath2).not.toBe(parkPath1);
    // The FIRST commit's park file is untouched — never overwritten in place.
    expect(await fs.readFile(parkPath1, "utf8")).toBe(parkContent1);
    expect(JSON.parse(parkContent1)).toEqual(doc1);
    expect(JSON.parse(await fs.readFile(parkPath2, "utf8"))).toEqual(doc2);
  });
});

describe("upgrade outcome: persisted flag", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("a persistVersion failure still applies the live swap but marks persisted: false", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const api = apiClient(t.app, cookie);

    // Force persistVersion's mkdir to fail without touching the live-swap path: `hmr/store`
    // exists as a plain FILE, so `fsp.mkdir(hmr/store/platform, { recursive: true })` throws
    // ENOTDIR. `hmr/uploads` (used earlier in doUpgradeAll, for the platform boot itself) is
    // unaffected since it's a sibling of `store`, not nested under it.
    await fs.mkdir(path.join(t.root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(t.root, "hmr", "store"), "not a directory");

    const res = await pushPlatform(
      t.app,
      cookie,
      platformServing(["/api/demo/ping"], "unpersisted"),
    );
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { status: string; persisted: boolean };
    expect(outcome.status).toBe("ok");
    expect(outcome.persisted).toBe(false);

    // The live swap took effect regardless — "never brick" holds even when disk fails.
    const ping = await api.get("/api/demo/ping");
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ servedBy: "unpersisted", pathname: "/api/demo/ping" });
  });
});
