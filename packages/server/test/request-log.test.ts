/**
 * One request, one request line.
 *
 * An HTTP request crosses two Hono apps: the runtime's (app.ts's createApp, which ends in the
 * static tail) and, through the seam, the platform's (http/app.ts). Both used to write the
 * line, so the server log showed every request as a pair — the platform's first, since it
 * returns first — and a static file as `404 0ms` (the platform declining a path it does not
 * serve) followed by the static tail's `200`/`304`. These count the lines one request leaves:
 * a second line for the same request, from either app, fails them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER_ID } from "../src/auth/service.js";
import { createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The runtime's app writes its line after the platform's log handle resolves: let it land. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("request log", () => {
  let t: TestApp;
  let webRoot: string;
  let lines: string[];

  /** The request lines about `path`, in the `METHOD path status Nms` shape both apps write. */
  const linesFor = (method: string, target: string): string[] =>
    lines.filter((line) => new RegExp(`^${method} ${target} \\d{3} \\d+ms$`).test(line));

  beforeEach(async () => {
    webRoot = await makeTempRoot();
    const webDist = path.join(webRoot, "web");
    await fs.mkdir(webDist, { recursive: true });
    await fs.writeFile(path.join(webDist, "index.html"), "<html>app</html>");
    await fs.writeFile(path.join(webDist, "penguin-logo.svg"), "<svg></svg>");
    lines = [];
    t = await createTestApp({ config: { webDist }, log: (line) => lines.push(line) });
  });
  afterEach(async () => {
    await t.cleanup();
    await fs.rm(webRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("a static file is one line with the status the client got, never a 404 before it", async () => {
    const res = await t.app.request("/penguin-logo.svg");
    expect(res.status).toBe(200);
    await settled();
    expect(linesFor("GET", "/penguin-logo.svg")).toEqual([
      expect.stringMatching(/^GET \/penguin-logo\.svg 200 \d+ms$/),
    ]);
  });

  it("a revalidated static file is one 304 line", async () => {
    const first = await t.app.request("/penguin-logo.svg");
    const etag = first.headers.get("etag") ?? "";
    lines.length = 0;
    const res = await t.app.request("/penguin-logo.svg", { headers: { "if-none-match": etag } });
    expect(res.status).toBe(304);
    await settled();
    expect(linesFor("GET", "/penguin-logo.svg")).toEqual([
      expect.stringMatching(/^GET \/penguin-logo\.svg 304 \d+ms$/),
    ]);
  });

  it("the SPA entry is one line", async () => {
    expect((await t.app.request("/")).status).toBe(200);
    await settled();
    expect(linesFor("GET", "/")).toHaveLength(1);
  });

  it("a platform route answered with an error is one line", async () => {
    const res = await t.app.request("/api/me");
    expect(res.status).toBe(401);
    await settled();
    expect(linesFor("GET", "/api/me")).toEqual([
      expect.stringMatching(/^GET \/api\/me 401 \d+ms$/),
    ]);
  });

  it("a platform route answered with success is one line", async () => {
    const { cookie } = await loginAdmin(t.app);
    lines.length = 0;
    expect((await t.app.request("/api/me", { headers: { cookie } })).status).toBe(200);
    await settled();
    expect(linesFor("GET", "/api/me")).toEqual([
      expect.stringMatching(/^GET \/api\/me 200 \d+ms$/),
    ]);
  });

  it("a socket call, which never crosses the runtime's app, still writes its one line", async () => {
    const http = t.deps.tree.api<{
      fetchAs(userId: string, request: Request): Promise<Response>;
    }>("HttpModule", "http");
    const res = await http.fetchAs(ADMIN_USER_ID, new Request("http://localhost/api/me"));
    expect(res.status).toBe(200);
    await settled();
    expect(linesFor("GET", "/api/me")).toEqual([
      expect.stringMatching(/^GET \/api\/me 200 \d+ms$/),
    ]);
  });
});
