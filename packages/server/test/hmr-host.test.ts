/**
 * HmrHost mechanism tests that don't fit the seam's own file: the single-flight first
 * boot, "code persists across a restart, state does not" (see host.ts's module doc),
 * a bundle missing `context` being rejected the same way a missing `hotPlatform` is,
 * the durability flag an upgrade's HTTP response carries, and the provenance a push
 * commits alongside the version it describes.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import { HmrHost } from "../src/hmr/host.js";
import { readHarnessInfo } from "../src/hmr/manifest.js";
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

  it("refuses to restore a web version without index.html, and says so", async () => {
    // A push is held to "the web dist has an index.html"; a restart restoring the same
    // artifact was not, so a store file damaged after the push came back as a version
    // that 404s on every page with nothing in the log. The restore now fails the same
    // way a bad push does: a warning naming the file, and the packaged default served.
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    expect(
      (await pushPlatform(t.app, cookie, platformServing(["/api/demo/x"], "webless"))).status,
    ).toBe(200);
    const root = t.root;
    freshRoot = root;
    t.deps.hmr.dispose();
    t.deps.channels.dispose();
    t.deps.db.close();
    t = undefined;

    const webDir = path.join(root, "hmr", "store", "web");
    const [webz] = (await fs.readdir(webDir)).filter((name) => name.endsWith(".webz"));
    if (webz === undefined) throw new Error("push left no .webz in the store");
    await fs.writeFile(
      path.join(webDir, webz),
      zlib.gzipSync(Buffer.from(JSON.stringify({ files: { "app.js": "Lw==" } }))),
    );

    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const fresh = new HmrHost(root);
    try {
      // Restore refused, the host goes on to boot the packaged default — which this bare
      // host cannot (it publishes no runtime resources). That rejection is the fixture's,
      // and it comes after the refusal under test has already been logged.
      await fresh.ensure().catch(() => undefined);
      expect(fresh.resolveWebSource()).toBeNull();
      expect(warnings.join("")).toMatch(/failed to restore.*has no index\.html/s);
    } finally {
      spy.mockRestore();
      fresh.dispose();
    }
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

    // Force persistVersion's mkdir to fail without touching the live-swap path:
    // `hmr/store/web` exists as a plain FILE, so `fsp.mkdir(hmr/store/web,
    // { recursive: true })` throws EEXIST. `hmr/store/platform`, which doUpgradeAll
    // writes the bundle into before booting it, is a sibling and stays usable.
    await fs.mkdir(path.join(t.root, "hmr", "store"), { recursive: true });
    await fs.writeFile(path.join(t.root, "hmr", "store", "web"), "not a directory");

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

/** A bundle whose create() throws — the boot-failure shape a bad push lands in. */
const BOOM_PLATFORM = `
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
  create() {
    throw new Error("boom: create failed");
  },
};
export const hotPlatform = { id: "boom", iface, impl, context: {} };
`;

/**
 * The same failing bundle under the id every REAL push carries: hmr/entry.ts re-exports
 * `packagedPlatform` as `hotPlatform`, so a bundle built by scripts/deploy.mjs is
 * indistinguishable from the compiled-in default by id alone.
 */
const BOOM_PLATFORM_PACKAGED_ID = BOOM_PLATFORM.replace('id: "boom"', 'id: "packaged"');

describe("upgrade assets by manifest: only the blobs the store lacks travel, and nothing kept is collected", () => {
  let t: TestApp | undefined;

  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
  const PKG = Buffer.from('{"name":"demo-native"}');
  const BIN = Buffer.from("\0binary");
  const README = Buffer.from("# demo\n");

  function payload(id: string, assets: unknown) {
    return zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform: platformServing([`/api/demo/${id}`], id),
          cli: MINIMAL_CLI,
          web: { files: MINIMAL_WEB },
          assets,
        }),
      ),
    );
  }
  const push = (app: Hono<AppEnv>, cookie: string, gz: Buffer) =>
    app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { cookie, "content-type": "application/gzip" },
      body: gz,
    });
  const probe = async (app: Hono<AppEnv>, cookie: string, hashes: string[]) =>
    (await (
      await app.request("/api/hmr/assets/probe", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ hashes }),
      })
    ).json()) as { missing: string[] };

  it("a probe names what is missing, a manifest push ships only that, and the set materializes from the blob store", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    // Nothing pushed yet: everything is missing.
    const before = await probe(t.app, cookie, [sha256(PKG), sha256(BIN)]);
    expect(before.missing.sort()).toEqual([sha256(PKG), sha256(BIN)].sort());

    // First push, inline (what a pusher without the probe sends): the blobs land in the store.
    const first = await push(
      t.app,
      cookie,
      payload("v1", {
        files: {
          "node_modules/demo-native/package.json": PKG.toString("base64"),
          "node_modules/demo-native/demo.node": BIN.toString("base64"),
        },
        exec: ["node_modules/demo-native/demo.node"],
      }),
    );
    expect(first.status).toBe(200);
    expect(
      (await probe(t.app, cookie, [sha256(PKG), sha256(BIN), sha256(README)])).missing,
    ).toEqual([sha256(README)]);

    // Second push adds one file and ships ONLY it: the other two are named by hash.
    const second = await push(
      t.app,
      cookie,
      payload("v2", {
        manifest: {
          "node_modules/demo-native/package.json": { sha: sha256(PKG) },
          "node_modules/demo-native/demo.node": { sha: sha256(BIN) },
          "node_modules/demo-native/README.md": { sha: sha256(README) },
        },
        blobs: { [sha256(README)]: README.toString("base64") },
        exec: ["node_modules/demo-native/demo.node"],
      }),
    );
    expect(second.status, await second.clone().text()).toBe(200);
    const assetsRoot = path.join(t.root, "hmr", "store", "assets");
    const sets = await fs.readdir(assetsRoot);
    expect(sets).toHaveLength(2);
    const withReadme = sets.find((s) =>
      fsSync.existsSync(path.join(assetsRoot, s, "node_modules/demo-native/README.md")),
    )!;
    expect(
      await fs.readFile(path.join(assetsRoot, withReadme, "node_modules/demo-native/demo.node")),
    ).toEqual(BIN);
    // The exec bit survives a materialization that read from the blob store — a POSIX
    // contract, guarded like the inline-push case above: Windows has no such bit to restore.
    const mode = (
      await fs.stat(path.join(assetsRoot, withReadme, "node_modules/demo-native/demo.node"))
    ).mode;
    if (process.platform !== "win32") expect(mode & 0o111).not.toBe(0);
  });

  it("refuses a manifest naming a blob the store does not hold, rather than materializing a hole", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const res = await push(
      t.app,
      cookie,
      payload("v1", {
        manifest: { "node_modules/demo-native/package.json": { sha: sha256(PKG) } },
        blobs: {},
      }),
    );
    // A refused push, reported as a bad request (the pusher should send without the probe).
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("does not hold");
  });

  it("collects blobs no kept assets set records, and keeps the rest", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const blobsDir = path.join(t.root, "hmr", "store", "blobs");
    // Four pushes with four distinct files: the store keeps current + one rollback, so the
    // two oldest sets go, and with them the blobs only they referenced.
    const contents = ["a", "b", "c", "d"].map((x) => Buffer.from(`file ${x}`));
    for (const [i, content] of contents.entries()) {
      const res = await push(
        t.app,
        cookie,
        payload(`v${i}`, { files: { "node_modules/x/f": content.toString("base64") } }),
      );
      expect(res.status).toBe(200);
    }
    const kept = (await fs.readdir(blobsDir)).sort();
    expect(kept).toContain(sha256(contents[3]!));
    expect(kept).toContain(sha256(contents[2]!));
    expect(kept).not.toContain(sha256(contents[0]!));
    expect(kept).not.toContain(sha256(contents[1]!));
  });
});

describe("upgrade boot failure: the previous version is re-booted, not left half-dead", () => {
  let t: TestApp | undefined;

  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  it("a failing push errors, and the machine keeps serving on a RE-BOOTED previous version", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const before = await t.deps.hmr.ensure();

    const res = await pushPlatform(t.app, cookie, BOOM_PLATFORM);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/failed to boot.*boom/);

    // Recovery is a fresh boot of the previous version — a NEW instance, not the
    // disposed old one limping on through its closures (whose manager is closed and
    // whose current-App pointer is released).
    const after = await t.deps.hmr.ensure();
    expect(after).not.toBe(before);
    expect(after.api.info()).toMatchObject({ impl: "packaged" });
    // The business surface answers — the half-dead symptom this recovery exists to
    // prevent was "routes answer but the App behind them is stopped".
    const client = apiClient(t.app, cookie);
    const me = await client.get("/api/me");
    expect(me.status).toBe(200);

    // And the channel is not poisoned: the next good push lands normally.
    const good = await pushPlatform(
      t.app,
      cookie,
      platformServing(["/api/demo/after-recovery"], "recovered-push"),
    );
    expect(good.status).toBe(200);
    const served = await t.app.request("/api/demo/after-recovery", {
      headers: { cookie },
    });
    expect(served.status).toBe(200);
    expect((await served.json()) as object).toMatchObject({ servedBy: "recovered-push" });
  });
});

describe("upgrade boot failure: recovery re-boots the PUSHED version, not the packaged default", () => {
  let t: TestApp | undefined;

  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  it("a failed push over an already-pushed version keeps that version's routes serving", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    // A real deploy: the pushed bundle carries the packaged id, because that is the
    // export hmr/entry.ts ships.
    const first = await pushPlatform(t.app, cookie, platformServing(["/api/demo/v1"], "packaged"));
    expect(first.status).toBe(200);
    expect((await t.app.request("/api/demo/v1", { headers: { cookie } })).status).toBe(200);

    const bad = await pushPlatform(t.app, cookie, BOOM_PLATFORM_PACKAGED_ID);
    expect(bad.status).toBe(400);

    // The version that was running before the failed push is running again — recovery
    // must not fall back to the runtime's compiled-in platform, which does not serve
    // this route at all.
    expect((await t.app.request("/api/demo/v1", { headers: { cookie } })).status).toBe(200);
  });

  it("recovers the RUNNING version even when its own push could not be persisted", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    // v1 lands durably; harness.json names it.
    expect(
      (await pushPlatform(t.app, cookie, platformServing(["/api/demo/v1"], "v1"))).status,
    ).toBe(200);

    // v2 boots but cannot be written: `store/web` as a plain FILE makes persistVersion's
    // `mkdir store/web` throw EEXIST after the platform bundle is already stored, so the
    // commit never happens and the manifest still names v1 while v2 serves. v1's own
    // bundle file is deliberately left readable — the point is which version recovery
    // CHOOSES, not whether it can load one at all.
    const webStore = path.join(t.root, "hmr", "store", "web");
    await fs.rm(webStore, { recursive: true, force: true });
    await fs.writeFile(webStore, "not a directory");
    const second = await pushPlatform(t.app, cookie, platformServing(["/api/demo/v2"], "v2"));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { persisted: boolean }).persisted).toBe(false);
    expect((await t.app.request("/api/demo/v2", { headers: { cookie } })).status).toBe(200);

    // A failed push now recovers v2 — what was RUNNING — not v1, what was committed.
    expect((await pushPlatform(t.app, cookie, BOOM_PLATFORM_PACKAGED_ID)).status).toBe(400);
    expect((await t.app.request("/api/demo/v2", { headers: { cookie } })).status).toBe(200);
  });
});

describe("the store is the only place a pushed platform bundle lands", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("keeps the bundle count bounded across many pushes and stages nothing outside the store", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    // A directory left by a pre-store push: it must not survive the next commit.
    const legacyUploads = path.join(t.root, "hmr", "uploads");
    await fs.mkdir(legacyUploads, { recursive: true });
    await fs.writeFile(path.join(legacyUploads, "platform-deadbeefdeadbeef.mjs"), "// stale");

    // Five distinct bundles: distinct content, so five distinct content addresses.
    for (let i = 0; i < 5; i++) {
      const res = await pushPlatform(t.app, cookie, platformServing([`/api/demo/v${i}`], `v${i}`));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { persisted: boolean }).persisted).toBe(true);
    }

    expect(fsSync.existsSync(legacyUploads)).toBe(false);

    // Bounded by the store's own keep rule (current + one rollback), not by the number
    // of pushes.
    const stored = await fs.readdir(path.join(t.root, "hmr", "store", "platform"));
    expect(stored.length).toBeLessThanOrEqual(2);

    // And what the manifest names is one of the survivors.
    const manifest = JSON.parse(
      await fs.readFile(path.join(t.root, "hmr", "harness.json"), "utf8"),
    ) as { platform: { bundle: string } };
    expect(stored).toContain(path.basename(manifest.platform.bundle));

    // The last push is still the one serving.
    expect((await t.app.request("/api/demo/v4", { headers: { cookie } })).status).toBe(200);
  });
});

/**
 * Provenance is the one part of a push that describes where the code came from: the bundles
 * are content-addressed, and a pushed bundle lands outside any checkout, so unless the
 * pusher's revision is committed with the version nothing on the target can name it. These
 * assert the round trip a `penguin version --json` on the target depends on.
 */
describe("upgrade provenance: recorded with the version, or not at all", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  async function pushWithSource(app: Hono<AppEnv>, cookie: string, source: unknown) {
    const gz = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform: platformServing(["/api/demo/ping"], "pushed"),
          cli: MINIMAL_CLI,
          web: { files: MINIMAL_WEB },
          ...(source === undefined ? {} : { source }),
        }),
      ),
    );
    return app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { cookie, "content-type": "application/gzip" },
      body: gz,
    });
  }

  async function manifestOf(root: string): Promise<Record<string, unknown>> {
    return JSON.parse(await fs.readFile(path.join(root, "hmr", "harness.json"), "utf8")) as Record<
      string,
      unknown
    >;
  }

  it("commits a pusher's repo and revision, and stamps when the version landed", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const before = Date.now();
    const push = await pushWithSource(t.app, cookie, {
      repo: "https://example.com/penguin.git",
      revision: "v0.2.3-7-gabc1234-dirty",
    });
    expect(push.status).toBe(200);
    expect(((await push.json()) as { persisted: boolean }).persisted).toBe(true);

    const manifest = await manifestOf(t.root);
    expect(manifest.source).toEqual({
      repo: "https://example.com/penguin.git",
      revision: "v0.2.3-7-gabc1234-dirty",
    });
    expect(Date.parse(manifest.pushedAt as string)).toBeGreaterThanOrEqual(before);

    // And the reader the version report uses sees exactly that.
    await expect(readHarnessInfo(t.root)).resolves.toMatchObject({
      source: { revision: "v0.2.3-7-gabc1234-dirty" },
      bundles: { cli: expect.stringContaining("store/cli/") },
    });
  });

  it("stamps the push time even when the pusher recorded no provenance", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushWithSource(t.app, cookie, undefined)).status).toBe(200);

    const manifest = await manifestOf(t.root);
    expect(manifest.source).toBeUndefined();
    expect(typeof manifest.pushedAt).toBe("string");
  });

  it("drops a malformed source rather than committing it to disk", async () => {
    // A wrong-typed source would otherwise outlive the push that sent it, and every later
    // reader would have to cope with it.
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushWithSource(t.app, cookie, { repo: 42, revision: "" })).status).toBe(200);

    expect((await manifestOf(t.root)).source).toBeUndefined();
    await expect(readHarnessInfo(t.root)).resolves.toMatchObject({ source: null });
  });
});

/**
 * A platform that boots once and throws on every create() after that, counting on a global
 * so the count survives the cache-busted re-import recovery does. Pushing this, then a
 * bundle that cannot boot, produces the DOUBLE fault: the push fails, and re-booting the
 * previous version fails too — the state host.ts's recoverPrevious describes as "the
 * process serves a half-stopped App until a successful push or a restart".
 */
function platformFailingOnReboot(id: string, path: string): string {
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
    globalThis.__doubleFaultBoots = (globalThis.__doubleFaultBoots ?? 0) + 1;
    if (globalThis.__doubleFaultBoots > 1) throw new Error("re-boot refused");
    return {
      park: () => context,
      info: () => ({ impl: ${JSON.stringify(id)} }),
      http(request) {
        const { pathname } = new URL(request.url);
        if (pathname !== ${JSON.stringify(path)}) return null;
        return new Response(JSON.stringify({ servedBy: ${JSON.stringify(id)} }), {
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

const faultGlobals = globalThis as typeof globalThis & { __doubleFaultBoots?: number };

describe("double fault: the upgrade channel survives a failed push whose recovery also fails", () => {
  let t: TestApp | undefined;
  let freshRoot: string | undefined;

  afterEach(async () => {
    if (t) await t.cleanup();
    if (freshRoot) await fs.rm(freshRoot, { recursive: true, force: true });
    t = undefined;
    freshRoot = undefined;
    faultGlobals.__doubleFaultBoots = 0;
  });

  it("warns, keeps /api/hmr reachable, and lands the next good push", async () => {
    faultGlobals.__doubleFaultBoots = 0;
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    expect(
      (await pushPlatform(t.app, cookie, platformFailingOnReboot("brittle", "/api/demo/brittle")))
        .status,
    ).toBe(200);
    expect((await t.app.request("/api/demo/brittle", { headers: { cookie } })).status).toBe(200);

    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    let bad;
    try {
      bad = await pushPlatform(t.app, cookie, BOOM_PLATFORM);
    } finally {
      spy.mockRestore();
    }

    // The push failed for the pushed bundle's own reason, and the second failure — the
    // previous version refusing to come back — is reported on the machine's own log, which
    // is the operator's only signal that the App behind the routes is stopped.
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toMatch(/failed to boot.*boom/);
    expect(warnings.join("")).toMatch(/boot-failure recovery failed too/);

    // The claim under test: /api/hmr is runtime-owned, so it answers out of the runtime's
    // own routes no matter what state the platform tree is in, and a good push repairs the
    // installation without a restart.
    const good = await pushPlatform(
      t.app,
      cookie,
      platformServing(["/api/demo/repaired"], "repaired"),
    );
    expect(good.status).toBe(200);
    const served = await t.app.request("/api/demo/repaired", { headers: { cookie } });
    expect(served.status).toBe(200);
    expect((await served.json()) as object).toMatchObject({ servedBy: "repaired" });
  });

  it("leaves the committed version to be restored by a restart", async () => {
    faultGlobals.__doubleFaultBoots = 0;
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    expect(
      (await pushPlatform(t.app, cookie, platformFailingOnReboot("brittle", "/api/demo/brittle")))
        .status,
    ).toBe(200);
    const before = await t.deps.hmr.ensure();
    expect((await pushPlatform(t.app, cookie, BOOM_PLATFORM)).status).toBe(400);

    // Recovery really did fail: the disposed instance is still the one the host hands out,
    // which is the half-stopped state a restart is the other way out of. (Compare the
    // single-fault case above, where ensure() answers with a freshly booted instance.)
    expect(await t.deps.hmr.ensure()).toBe(before);

    // A failed push persists nothing, so harness.json still names the version that was
    // committed before it.
    const root = t.root;
    freshRoot = root;
    t.deps.hmr.dispose();
    t.deps.channels.dispose();
    t.deps.db.close();
    t = undefined; // torn down by hand; skip cleanup() (it would rm(root))

    // A real restart is a fresh process, so the bundle's module state starts over.
    faultGlobals.__doubleFaultBoots = 0;

    const fresh = new HmrHost(root);
    try {
      const instance = await fresh.ensure();
      expect((instance.api as unknown as { info(): { impl: string } }).info().impl).toBe("brittle");
    } finally {
      fresh.dispose();
    }
  });
});
