/**
 * What the JSON compression middleware does and does not catch (http/compress.ts), wired the
 * way http-route-groups.test.ts wires the assembly: by hand, because the point is the rule,
 * not the tree around it.
 *
 * - A GET answer of JSON that the caller says it accepts packed comes back packed — zstd
 *   when the caller takes it and this Node has it, gzip otherwise — with the length of the
 *   packed bytes and a `Vary` that says the answer depends on the asking.
 * - The same answer without the asking — and the same asking without the JSON, or without
 *   the GET, or below the worth-it size, or on the machine proxy's prefix — comes back as it
 *   was.
 */
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Contributed } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../src/auth/middleware.js";
import { HttpModule } from "../src/http/app.js";
import {
  DEFAULT_ATTACHMENT_MAX_MB,
  DEFAULT_ATTACHMENT_TOTAL_MB,
} from "../src/services/attachment-limits.js";

/** Node's zstd is young: its typings are not in every @types/node, so probe before using. */
const zstdDecompress = (zlib as unknown as { zstdDecompressSync?: (b: Uint8Array) => Buffer })
  .zstdDecompressSync;

/** A payload comfortably past the worth-it size: rows of JSON, the shape every list answers in. */
const rows = Array.from({ length: 400 }, (_, i) => ({
  id: String(i),
  text: "row of json ".repeat(12),
}));
const rowsJson = JSON.stringify({ rows });
if (rowsJson.length < 4096) throw new Error("the fixture must be past the compression threshold");

/** One public group that answers every shape the rule has to tell apart. */
function shapes(): Contributed {
  const app = new Hono<AppEnv>();
  app.get("/big", (c) => c.json({ rows }));
  app.post("/big", (c) => c.json({ rows }));
  app.get("/small", (c) => c.json({ ok: true }));
  app.get("/stream", (c) =>
    c.body("event: ping\ndata: {}\n\n", 200, { "content-type": "text/event-stream" }),
  );
  app.get("/bytes", (c) =>
    c.body(new Uint8Array(64 * 1024).fill(7), 200, { "content-type": "application/octet-stream" }),
  );
  return {
    id: "shapes",
    from: "test",
    data: { prefix: "/api/things", auth: "none", order: 1 },
    code: app,
  };
}

/** The machine proxy's group: same answers, different prefix — the relay must not re-encode. */
function proxied(): Contributed {
  const app = new Hono<AppEnv>();
  app.get("/m1/api/things/big", (c) => c.json({ rows }));
  return {
    id: "proxied",
    from: "test",
    data: { prefix: "/server", auth: "none", order: 2 },
    code: app,
  };
}

function assemble() {
  const http = wire(HttpModule, {
    config: { trustProxy: false },
    log: { line: () => {} },
    auth: {
      sessionTtlMs: 1000,
      authenticateApiToken: () => null,
      authenticateWithMeta: () => null,
      sessionIsLive: () => false,
    },
    errors: { record: () => {} },
    settings: {
      getAttachmentLimitsMb: () => ({
        attachmentMaxMb: DEFAULT_ATTACHMENT_MAX_MB,
        attachmentTotalMb: DEFAULT_ATTACHMENT_TOTAL_MB,
      }),
    },
    access: {},
  });
  http.setup({ contributions: { routes: [shapes(), proxied()] } } as unknown as ClassCtx);
  return {
    fetch: (path: string, init: RequestInit = {}) =>
      http.http.fetch(new Request(`http://localhost${path}`, init)),
  };
}

describe("the JSON compression rule", () => {
  it("packs a big JSON GET answer for a caller that accepts gzip", async () => {
    const { fetch } = assemble();
    const res = await fetch("/api/things/big", { headers: { "accept-encoding": "gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect((res.headers.get("vary") ?? "").toLowerCase()).toContain("accept-encoding");
    const packed = new Uint8Array(await res.arrayBuffer());
    expect(packed.byteLength).toBe(Number(res.headers.get("content-length")));
    expect(packed.byteLength).toBeLessThan(rowsJson.length / 2);
    expect(JSON.parse(zlib.gunzipSync(packed).toString("utf8"))).toEqual({ rows });
  });

  it("prefers zstd for a caller that accepts both, and falls back to gzip where Node has none", async () => {
    const { fetch } = assemble();
    const res = await fetch("/api/things/big", { headers: { "accept-encoding": "gzip, zstd" } });
    const encoding = res.headers.get("content-encoding");
    const packed = new Uint8Array(await res.arrayBuffer());
    expect(packed.byteLength).toBe(Number(res.headers.get("content-length")));
    expect((res.headers.get("vary") ?? "").toLowerCase()).toContain("accept-encoding");
    if (zstdDecompress !== undefined) {
      expect(encoding).toBe("zstd");
      expect(JSON.parse(zstdDecompress(packed).toString("utf8"))).toEqual({ rows });
    } else {
      expect(encoding).toBe("gzip");
      expect(JSON.parse(zlib.gunzipSync(packed).toString("utf8"))).toEqual({ rows });
    }
  });

  it("answers the same route uncompressed to a caller that does not ask", async () => {
    const { fetch } = assemble();
    const res = await fetch("/api/things/big");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.json()) as unknown).toEqual({ rows });
  });

  it("leaves alone what is not a big JSON GET: small answers, streams, bytes, writes, relays", async () => {
    const { fetch } = assemble();
    const gzip = { headers: { "accept-encoding": "gzip" } };
    const small = await fetch("/api/things/small", gzip);
    expect(small.headers.get("content-encoding")).toBeNull();
    // The rule read this body to learn it was too small to pack; reading it back is the
    // regression guard for the adapter, which cannot re-read the consumed original.
    expect((await small.json()) as unknown).toEqual({ ok: true });
    const smallBoth = await fetch("/api/things/small", {
      headers: { "accept-encoding": "gzip, zstd" },
    });
    expect((await smallBoth.json()) as unknown).toEqual({ ok: true });
    const stream = await fetch("/api/things/stream", gzip);
    expect(stream.headers.get("content-encoding")).toBeNull();
    const bytes = await fetch("/api/things/bytes", gzip);
    expect(bytes.headers.get("content-encoding")).toBeNull();
    const write = await fetch("/api/things/big", { method: "POST", ...gzip });
    expect(write.headers.get("content-encoding")).toBeNull();
    // The machine proxy relays the machine's own answer; it decides nothing here.
    const relay = await fetch("/server/m1/api/things/big", gzip);
    expect(relay.headers.get("content-encoding")).toBeNull();
    expect(((await relay.json()) as { rows: unknown[] }).rows).toHaveLength(rows.length);
  });
});
