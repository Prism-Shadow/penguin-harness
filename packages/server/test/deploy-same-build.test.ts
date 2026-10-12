/**
 * deploy.mjs's "the target already has this build" check (scripts/deploy-same-build.mjs).
 *
 * The check recomputes, on the sending side, the store pointers the runtime commits a push
 * under, and compares them with what GET /api/version reports. Its whole value rests on the
 * two sides naming the same content the same way, so the pointers are checked against a real
 * push through /api/hmr/upgrade — by blob, the way deploy.mjs sends — rather than against
 * literals. The decision itself is then checked on every way a report can fail to match,
 * each of which has to mean "push".
 */
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import { versionReport } from "../src/version-report.js";
import { buildPointers, committedBuildMatches } from "../../../scripts/deploy-same-build.mjs";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A platform that serves only the upgrade channel (see hmr-host.test.ts's platformServing). */
function platform(id: string): string {
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
  create(ctx, context) {
    return {
      park: () => context,
      info: () => ({ impl: ${JSON.stringify(id)} }),
      http(request) {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith("/api/hmr/")) return ctx.resources.claim("platform.hmrControl").endpoint(request);
        return null;
      },
    };
  },
};
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl, context: {} };
`;
}

interface Build {
  platform: Buffer;
  cli: Buffer;
  web: Record<string, Buffer>;
  assets: Record<string, Buffer>;
}

function build(id: string, plugin = "v1"): Build {
  return {
    platform: Buffer.from(platform(id)),
    cli: Buffer.from("export async function cli(argv) { return 0; }\n"),
    web: {
      "index.html": Buffer.from("<html>deploy</html>"),
      "assets/app.js": Buffer.from("console.log('app')"),
    },
    assets: {
      "archives/node-pty.tgz": Buffer.from("\0pty"),
      "archives/plugins.demo.tgz": Buffer.from(`\0plugin ${plugin}`),
    },
  };
}

/** Pushes `b` the way deploy.mjs does: every part PUT as a blob, then a body of names. */
async function push(app: Hono<AppEnv>, cookie: string, b: Build): Promise<number> {
  const name = async (bytes: Buffer) => {
    const sha = createHash("sha256").update(bytes).digest("hex");
    const put = await app.request(`/api/hmr/blobs/${sha}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/octet-stream" },
      body: bytes,
    });
    expect(put.status).toBe(200);
    return { sha };
  };
  const names = async (files: Record<string, Buffer>) =>
    Object.fromEntries(
      await Promise.all(Object.entries(files).map(async ([rel, v]) => [rel, await name(v)])),
    );
  const body = {
    platform: await name(b.platform),
    cli: await name(b.cli),
    web: { files: await names(b.web) },
    assets: { files: await names(b.assets), exec: [] },
  };
  const res = await app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip" },
    body: zlib.gzipSync(Buffer.from(JSON.stringify(body))),
  });
  return res.status;
}

describe("deploy's same-build check against a real push", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  it("names the pushed build exactly as the target's version report does", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const b = build("first");
    expect(await push(t.app, cookie, b)).toBe(200);

    const report = await versionReport(t.root);
    const pointers = buildPointers(b);
    expect(report.harness?.bundles).toEqual({
      platform: pointers.platform,
      cli: pointers.cli,
      web: pointers.web,
    });
    expect(report.harness?.assets).toBe(pointers.assets);
    expect(committedBuildMatches(report, pointers)).toEqual({ same: true });
  });

  it("sees a change to any one part, a plugin archive included", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    expect(await push(t.app, cookie, build("first"))).toBe(200);
    const report = await versionReport(t.root);

    const changed: Array<[string, Build]> = [
      ["platform", build("second")],
      [
        "cli",
        { ...build("first"), cli: Buffer.from("export async function cli() { return 1; }\n") },
      ],
      [
        "web",
        { ...build("first"), web: { ...build("first").web, "index.html": Buffer.from("x") } },
      ],
      ["assets", build("first", "v2")],
    ];
    for (const [part, b] of changed) {
      const verdict = committedBuildMatches(report, buildPointers(b));
      expect(verdict.same, part).toBe(false);
    }
    // Only the plugin archive moved: the three bundles still match, the assets pointer does not.
    expect(committedBuildMatches(report, buildPointers(build("first", "v2")))).toEqual({
      same: false,
      reason: "its committed assets differ",
    });
  });
});

describe("committedBuildMatches: every doubt is a push", () => {
  const b = build("first");
  const pointers = buildPointers(b);
  const report = {
    harness: {
      source: null,
      pushedAt: null,
      bundles: { platform: pointers.platform, cli: pointers.cli, web: pointers.web },
      assets: pointers.assets,
    },
  };

  it("matches only when all four committed pointers are this build's", () => {
    expect(committedBuildMatches(report, pointers)).toEqual({ same: true });
  });

  it("pushes to a target with nothing pushed, or with no readable report", () => {
    expect(committedBuildMatches({ ...report, harness: null }, pointers).same).toBe(false);
    expect(committedBuildMatches(null, pointers).same).toBe(false);
    expect(committedBuildMatches("not a report", pointers).same).toBe(false);
  });

  it("pushes to a platform older than the assets pointer", () => {
    const { source, pushedAt, bundles } = report.harness;
    expect(committedBuildMatches({ harness: { source, pushedAt, bundles } }, pointers)).toEqual({
      same: false,
      reason: "its version report does not name its assets",
    });
  });

  it("names no assets directory for a build that carries none", () => {
    expect(buildPointers({ ...b, assets: {} }).assets).toBeNull();
  });
});
