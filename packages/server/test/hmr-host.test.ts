/**
 * HmrHost mechanism tests that don't fit the seam's own file: the single-flight first
 * boot, "code persists across a restart, state does not" (see host.ts's module doc),
 * a bundle missing `context` being rejected the same way a missing `hotPlatform` is,
 * and the durability flag an upgrade's HTTP response carries.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import { HmrHost } from "../src/hmr/host.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
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
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl, context: {} };
`;
}

/**
 * A platform whose context carries one number, mutable at runtime through
 * `POST /api/demo/bump` (in memory only — nothing here ever touches disk itself). Used
 * to tell "the swap's live (migrated-forward) state" apart from "the bundle's own
 * initial context": a live push carries the PRIOR instance's doc forward through
 * migration (kernel/upgrade.ts) — it never resets to this bundle's `context` — so the
 * schema below marks any doc that didn't already look like this shape with a sentinel
 * (-1), distinguishable from both the bundle's declared initial value and anything a
 * live mutation could produce. A restart, never a live push, is what boots fresh
 * against `context`.
 */
function platformWithState(id: string, initialN: number): string {
  return `
const anySchema = {
  strictParse: (doc) => ({
    ok: true,
    value: doc && typeof doc.n === "number" ? doc : { n: -1 },
  }),
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
const impl = {
  create(_ctx, context) {
    return {
      park: () => context,
      info: () => ({ impl: ${JSON.stringify(id)}, n: context.n }),
      http(request) {
        const { pathname } = new URL(request.url);
        if (pathname !== "/api/demo/bump") return null;
        context.n += 1;
        return new Response(JSON.stringify({ n: context.n }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
  },
};
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl, context: { n: ${initialN} } };
`;
}

/** Same shape as platformServing, except its export has no `context` at all. */
function platformMissingContext(id: string): string {
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
const impl = {
  create(_ctx, context) {
    return { park: () => context, info: () => ({ impl: ${JSON.stringify(id)} }) };
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

describe("HmrHost: code persists across a restart, state does not", () => {
  let t: TestApp | undefined;
  let freshRoot: string | undefined;

  afterEach(async () => {
    if (t) await t.cleanup();
    if (freshRoot) await fs.rm(freshRoot, { recursive: true, force: true });
    t = undefined;
    freshRoot = undefined;
  });

  it("a pushed version's harness.json platform entry carries no `park`, and the store writes no .park.json", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const push = await pushPlatform(t.app, cookie, platformWithState("stateful", 5));
    expect(push.status).toBe(200);
    expect(((await push.json()) as { persisted: boolean }).persisted).toBe(true);

    const manifest = JSON.parse(
      await fs.readFile(path.join(t.root, "hmr", "harness.json"), "utf8"),
    ) as { platform: Record<string, unknown> };
    expect(Object.keys(manifest.platform)).toEqual(["bundle"]);

    const storeFiles = await fs.readdir(path.join(t.root, "hmr", "store", "platform"));
    expect(storeFiles.some((name) => name.endsWith(".park.json"))).toBe(false);
  });

  it("a restart resumes the pushed CODE against a FRESH initial context, not the live-mutated state", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const api = apiClient(t.app, cookie);
    const push = await pushPlatform(t.app, cookie, platformWithState("stateful", 5));
    expect(push.status).toBe(200);

    // The live push migrated FORWARD from whatever was already running (the packaged
    // default, which has no `n`) — never reset to the pushed bundle's `context` — so it
    // starts at the schema's sentinel (-1), not 5. Bumping it twice makes doubly sure a
    // restore couldn't accidentally land on either the sentinel or the bumped value.
    const live = await t.deps.hmr.ensure();
    expect((live.api as unknown as { info(): { n: number } }).info().n).toBe(-1);
    expect((await api.post("/api/demo/bump")).status).toBe(200);
    expect((await api.post("/api/demo/bump")).status).toBe(200);
    expect((live.api as unknown as { info(): { n: number } }).info().n).toBe(1);

    const root = t.root;
    freshRoot = root;
    t.deps.hmr.dispose();
    t.deps.channels.dispose();
    t.deps.db.close();
    t = undefined; // torn down by hand; skip cleanup() (it would rm(root))

    const fresh = new HmrHost(root);
    try {
      const instance = await fresh.ensure();
      const restored = (instance.api as unknown as { info(): { impl: string; n: number } }).info();
      // CODE resumed (the pushed impl id)...
      expect(restored.impl).toBe("stateful");
      // ...but state did not: it's the bundle's fresh initial context (5), never the
      // migrated-forward-then-bumped live value (1) that was running when the process
      // "exited".
      expect(restored.n).toBe(5);
    } finally {
      fresh.dispose();
    }
  });
});

describe("upgrade: a bundle missing `context` is rejected", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("400s with a message naming `context`, the same rejection path as a missing `hotPlatform`", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const res = await pushPlatform(t.app, cookie, platformMissingContext("no-context"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("context");
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

describe("upgrade assets: an unchanged set is not copied again", () => {
  let t: TestApp | undefined;

  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  /** One push carrying a native-module-shaped asset tree. */
  async function pushWithAssets(app: Hono<AppEnv>, cookie: string, id: string) {
    const gz = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform: platformServing([`/api/demo/${id}`], id),
          cli: MINIMAL_CLI,
          web: { files: MINIMAL_WEB },
          assets: {
            files: {
              "node_modules/demo-native/package.json":
                Buffer.from('{"name":"demo-native"}').toString("base64"),
              "node_modules/demo-native/build/Release/demo.node":
                Buffer.from("\0binary").toString("base64"),
            },
            exec: ["node_modules/demo-native/build/Release/demo.node"],
          },
        }),
      ),
    );
    return app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { cookie, "content-type": "application/gzip" },
      body: gz,
    });
  }

  /** The single assets directory the pushes above content-address to. */
  async function assetsDirOf(root: string): Promise<string> {
    const base = path.join(root, "hmr", "store", "assets");
    const entries = await fs.readdir(base);
    expect(entries).toHaveLength(1); // identical content, so one directory serves both pushes
    return path.join(base, entries[0]!);
  }

  it("leaves the files untouched on a re-push, so a mapped native module cannot EBUSY", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushWithAssets(t.app, cookie, "first")).status).toBe(200);

    const binary = path.join(
      await assetsDirOf(t.root),
      "node_modules/demo-native/build/Release/demo.node",
    );
    const before = await fs.stat(binary);
    // Windows has no POSIX permission bits at all — stat() reports none and chmod() only
    // toggles the read-only attribute — so the exec list is a POSIX-only claim.
    if (process.platform !== "win32") expect(before.mode & 0o111).not.toBe(0);

    // Windows keeps an open handle on a loaded .node, so a second write to it fails with
    // EBUSY and takes the whole upgrade down. Read-only stands in for that lock here (on
    // Windows that IS the read-only attribute, and it refuses writes just the same).
    await fs.chmod(binary, 0o444);
    try {
      expect((await pushWithAssets(t.app, cookie, "second")).status).toBe(200);

      const after = await fs.stat(binary);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    } finally {
      // Windows refuses to delete a read-only file, which would fail the temp-root cleanup.
      await fs.chmod(binary, 0o644);
    }
  });

  it("repairs a directory whose materialization was interrupted", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushWithAssets(t.app, cookie, "first")).status).toBe(200);

    // A push killed before it finished leaves files but no completion marker — and here,
    // one truncated file.
    const dir = await assetsDirOf(t.root);
    const manifest = path.join(dir, "node_modules/demo-native/package.json");
    await fs.rm(path.join(dir, ".materialized"));
    await fs.writeFile(manifest, "trunc");

    expect((await pushWithAssets(t.app, cookie, "second")).status).toBe(200);
    expect(await fs.readFile(manifest, "utf8")).toBe('{"name":"demo-native"}');
    expect(fsSync.existsSync(path.join(dir, ".materialized"))).toBe(true);
  });
});
