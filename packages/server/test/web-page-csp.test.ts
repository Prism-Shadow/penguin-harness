/**
 * The Web App's page Content-Security-Policy, as the static host serves it.
 *
 * - Given a served Web App, the shell document arrives with the page policy: at `/`, at any
 *   SPA-fallback path, and on a 304 revalidation, so a shell cached before the policy picks
 *   it up.
 * - The files the shell loads (a script, a stylesheet, a font) arrive without it.
 * - An API answer arrives without it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const csp = (res: Response) => res.headers.get("content-security-policy");

describe("the Web App's page policy", () => {
  let t: TestApp;
  let webDist: string;

  beforeAll(async () => {
    webDist = path.join(await makeTempRoot(), "web");
    await fs.mkdir(path.join(webDist, "assets"), { recursive: true });
    await fs.writeFile(path.join(webDist, "index.html"), "<html>shell</html>");
    await fs.writeFile(path.join(webDist, "assets", "index-abc123.js"), 'console.log("app")');
    await fs.writeFile(path.join(webDist, "assets", "index-abc123.css"), "body{margin:0}");
    await fs.writeFile(path.join(webDist, "assets", "mona-abc123.woff2"), "wOF2");
    t = await createTestApp({ config: { webDist } });
  });
  afterAll(async () => {
    await t.cleanup();
    await fs.rm(path.dirname(webDist), { recursive: true, force: true });
  });

  it("serves the shell with the page policy, at the root, on a fallback path and on a 304", async () => {
    const index = await t.app.request("/");
    expect(index.status).toBe(200);
    expect(csp(index)).toBeTruthy();

    const fallback = await t.app.request("/chat/new");
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain("shell");
    expect(csp(fallback)).toBe(csp(index));

    const revalidated = await t.app.request("/", {
      headers: { "if-none-match": index.headers.get("etag")! },
    });
    expect(revalidated.status).toBe(304);
    expect(csp(revalidated)).toBe(csp(index));
  });

  it("serves the shell's scripts, stylesheets and fonts without it", async () => {
    for (const file of ["index-abc123.js", "index-abc123.css", "mona-abc123.woff2"]) {
      const asset = await t.app.request(`/assets/${file}`);
      expect(asset.status).toBe(200);
      expect(csp(asset)).toBeNull();
    }
  });

  it("answers the API without it", async () => {
    const { cookie } = await loginAdmin(t.app);
    const res = await t.app.request("/api/version", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(csp(res)).toBeNull();
  });
});
