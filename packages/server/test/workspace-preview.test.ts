/**
 * Workspace HTML preview on the separate preview origin: token signing/verification,
 * the mint endpoint's origin derivation, and the preview route.
 *
 * The load-bearing case is "same token, App origin's Host": the preview route answers on
 * the same process as the App, so if it served Agent-written HTML there, it would be a
 * same-origin XSS with the session cookie attached. See design § "Workspace 文件预览".
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPreviewTokenSigner,
  hostOnly,
  loopbackCounterpart,
  resolvePreviewTarget,
} from "../src/services/preview-token.js";
import type { ProjectCreateResponse, SessionCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("preview token signer", () => {
  const signer = createPreviewTokenSigner();
  const payload = { sessionId: "s-1", host: "127.0.0.1", expiresAt: Date.now() + 60_000 };

  it("round-trips a valid token", () => {
    expect(signer.verify(signer.sign(payload))).toEqual(payload);
  });

  it("rejects a tampered payload, a foreign signature and malformed input", () => {
    const token = signer.sign(payload);
    const [body, sig] = token.split(".");
    // Re-encode a payload pointing at another Session, keeping the original signature.
    const forged = Buffer.from(JSON.stringify({ ...payload, sessionId: "s-2" }), "utf8").toString(
      "base64url",
    );
    expect(signer.verify(`${forged}.${sig}`)).toBeNull();
    // A different secret must not validate.
    expect(createPreviewTokenSigner().verify(token)).toBeNull();
    for (const bad of ["", ".", "abc", `${body}.`, `.${sig}`, `${body}.zzzz`]) {
      expect(signer.verify(bad)).toBeNull();
    }
  });

  it("rejects an expired token", () => {
    expect(signer.verify(signer.sign({ ...payload, expiresAt: Date.now() - 1 }))).toBeNull();
  });
});

describe("preview origin derivation", () => {
  it("strips the port, keeping IPv6 brackets", () => {
    expect(hostOnly("127.0.0.1:7364")).toBe("127.0.0.1");
    expect(hostOnly("localhost")).toBe("localhost");
    expect(hostOnly("[::1]:7364")).toBe("[::1]");
  });

  it("maps loopback names to their counterpart and nothing else", () => {
    expect(loopbackCounterpart("127.0.0.1")).toBe("localhost");
    expect(loopbackCounterpart("localhost")).toBe("127.0.0.1");
    expect(loopbackCounterpart("[::1]")).toBe("127.0.0.1");
    // A LAN IP or a real domain has no safe counterpart — those need explicit config.
    expect(loopbackCounterpart("192.168.1.5")).toBeNull();
    expect(loopbackCounterpart("penguin.example.com")).toBeNull();
  });

  const bind = { host: "127.0.0.1", port: 7364 };

  it("derives the counterpart origin on the server's own port", () => {
    expect(resolvePreviewTarget("http://127.0.0.1:7364/x", "127.0.0.1:7364", null, bind)).toEqual({
      origin: "http://localhost:7364",
      host: "localhost",
    });
    expect(
      resolvePreviewTarget("http://localhost:80/x", "localhost", null, { ...bind, port: 80 }),
    ).toEqual({ origin: "http://127.0.0.1", host: "127.0.0.1" });
  });

  it("uses the server port, not the browser's — dev serves the SPA on a different port", () => {
    // `pnpm dev`: the SPA is on Vite:7365 and only /api is proxied, so a preview URL on
    // :7365 would hit a port that does not serve /preview at all.
    expect(resolvePreviewTarget("http://localhost:7365/x", "localhost:7365", null, bind)).toEqual({
      origin: "http://127.0.0.1:7364",
      host: "127.0.0.1",
    });
  });

  it("gives up when the loopback counterpart is not reachable from the bind address", () => {
    expect(
      resolvePreviewTarget("http://localhost:7364/x", "localhost:7364", null, {
        host: "192.168.1.5",
        port: 7364,
      }),
    ).toBeNull();
    // Wildcard binds do serve the loopback names.
    expect(
      resolvePreviewTarget("http://localhost:7364/x", "localhost:7364", null, {
        host: "0.0.0.0",
        port: 7364,
      }),
    ).toEqual({ origin: "http://127.0.0.1:7364", host: "127.0.0.1" });
  });

  it("prefers a configured origin, and gives up on hosts with no counterpart", () => {
    expect(
      resolvePreviewTarget(
        "https://app.example.com/x",
        "app.example.com",
        "https://p.example.com",
        bind,
      ),
    ).toEqual({ origin: "https://p.example.com", host: "p.example.com" });
    expect(
      resolvePreviewTarget("http://192.168.1.5:7364/x", "192.168.1.5:7364", null, bind),
    ).toBeNull();
  });
});

describe("preview route", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let sessionId: string;
  let workspace: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-preview", name: "project" })
    ).json()) as ProjectCreateResponse;
    const projectId = created.project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    const sess = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as SessionCreateResponse;
    sessionId = sess.session.sessionId;
    workspace = sess.session.workspace;
    await fs.mkdir(path.join(workspace, "assets"));
    await fs.writeFile(path.join(workspace, "index.html"), "<!doctype html><script src=app.js>");
    await fs.writeFile(path.join(workspace, "assets", "app.js"), "console.log(1)");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /**
   * Follow the "open in a new tab" link the way a browser would; app.request() addresses
   * the App on localhost, so the counterpart origin is 127.0.0.1.
   */
  const mint = async (rel: string): Promise<{ url: string | null; status: number }> => {
    const res = await owner.get(
      `/api/sessions/${sessionId}/files/preview-redirect?path=${encodeURIComponent(rel)}`,
    );
    return { url: res.headers.get("location"), status: res.status };
  };

  it("redirects to the loopback counterpart of the App host", async () => {
    const { url, status } = await mint("index.html");
    expect(status).toBe(302);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:7364\/preview\/[^/]+\/index\.html$/);
  });

  it("serves the file with a real content type, no sandbox, and no referrer", async () => {
    const { url } = await mint("index.html");
    const res = await t.app.request(url!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    // The origin is the boundary now, so the sandbox that broke storage is gone.
    expect(res.headers.get("content-security-policy")).toBeNull();
    // Without this the token-bearing URL leaks to every third-party the page embeds.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("resolves relative subresources under the same token", async () => {
    const { url } = await mint("index.html");
    const token = url!.split("/preview/")[1]!.split("/")[0]!;
    const res = await t.app.request(`http://127.0.0.1/preview/${token}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
  });

  it("refuses to serve on the App origin's host", async () => {
    const { url } = await mint("index.html");
    const token = url!.split("/preview/")[1]!.split("/")[0]!;
    // Same token, same path, but Host is the App origin: serving here would run
    // Agent-written HTML same-origin with the session cookie.
    const res = await t.app.request(`http://localhost/preview/${token}/index.html`);
    expect(res.status).toBe(404);
  });

  it("rejects a garbage token and keeps path confinement", async () => {
    expect((await t.app.request("http://127.0.0.1/preview/nope/index.html")).status).toBe(404);
    const { url } = await mint("index.html");
    const token = url!.split("/preview/")[1]!.split("/")[0]!;
    const escape = await t.app.request(`http://127.0.0.1/preview/${token}/../../etc/passwd`);
    expect(escape.status).toBe(404);
  });

  it("requires authentication to mint, and validates the path", async () => {
    const anon = await t.app.request(
      `/api/sessions/${sessionId}/files/preview-redirect?path=index.html`,
    );
    expect(anon.status).toBe(401);
    const { status } = await mint("nope.html");
    expect(status).toBe(404);
  });

  it("reports isolation on /api/me so the UI can warn before opening", async () => {
    const me = (await (await owner.get("/api/me")).json()) as { previewIsolated: boolean };
    expect(me.previewIsolated).toBe(true);
  });
});
