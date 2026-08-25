/**
 * Local API token: minted per boot, persisted at <root>/api-token (0600), and accepted
 * by authMiddleware as `Authorization: Bearer` — authenticating as the built-in admin on
 * every protected route, SSE endpoints included (the CLI consumes SSE via fetch with
 * headers, so header auth must reach them).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, SessionCreateResponse } from "../src/api/types.js";
import { apiTokenPath, readApiToken, storeApiToken, tokensEqual } from "../src/auth/api-token.js";
import { bearerToken } from "../src/auth/middleware.js";
import { createTestApp } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("local API token", () => {
  let t: TestApp;
  let token: string;

  beforeEach(async () => {
    t = await createTestApp();
    const stored = readApiToken(t.root);
    expect(stored).not.toBeNull();
    token = stored!;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const bearer = (value: string, init: RequestInit = {}, apiPath = "/api/me") =>
    t.app.request(apiPath, {
      ...init,
      headers: {
        authorization: `Bearer ${value}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

  it("boot persists the token at <root>/api-token with owner-only permissions", () => {
    expect(t.deps.authService.localApiToken()).toBe(token);
    if (process.platform !== "win32") {
      const mode = fs.statSync(apiTokenPath(t.root)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("a valid Bearer authenticates as the admin (sessionVia 'token'), with no cookie at all", async () => {
    const res = await bearer(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.user.userId).toBe("admin");
    expect(body.user.isAdmin).toBe(true);
    expect(body.sessionVia).toBe("token");
  });

  it("a wrong Bearer is 401 — even alongside a valid cookie (no silent fallback)", async () => {
    expect((await bearer("not-the-token")).status).toBe(401);
    const { loginAdmin } = await import("./helpers.js");
    const { cookie } = await loginAdmin(t.app);
    const res = await t.app.request("/api/me", {
      headers: { authorization: "Bearer not-the-token", cookie },
    });
    expect(res.status).toBe(401);
    // Without the header the same cookie works (the cookie path is untouched).
    const cookieOnly = await t.app.request("/api/me", { headers: { cookie } });
    expect(cookieOnly.status).toBe(200);
  });

  it("Bearer works on writes (the JSON-only CSRF guard still applies) and on SSE endpoints", async () => {
    // Write path: create a Session in default_project as the admin, Bearer-only.
    const create = await bearer(
      token,
      { method: "POST", body: JSON.stringify({ client: "cli" }) },
      "/api/projects/default_project/agents/default_agent/sessions",
    );
    expect(create.status).toBe(201);
    const { session } = (await create.json()) as SessionCreateResponse;
    expect(t.deps.sessionsRepo.findById(session.sessionId)!.client).toBe("cli");

    // A write with a form Content-Type is still refused (the CSRF guard is not bypassed).
    const form = await t.app.request(
      "/api/projects/default_project/agents/default_agent/sessions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "client=cli",
      },
    );
    expect(form.status).toBe(415);

    // SSE: the session stream answers a Bearer-authenticated subscribe.
    const sse = await bearer(token, {}, `/api/sessions/${session.sessionId}/stream`);
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    await sse.body?.cancel();
  });

  it("hot-update APIs accept the Bearer token as the admin credential", async () => {
    // /api/hmr/status goes through the same middleware plus the admin check; the local
    // token IS admin authority, so it must pass the gate (the malformed body then 404s
    // or answers, but never 401/403).
    const res = await bearer(token, {}, "/api/hmr/status");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("storeApiToken overwrites the previous boot's file (per-boot rotation)", () => {
    storeApiToken(t.root, "next-boot-token");
    expect(readApiToken(t.root)).toBe("next-boot-token");
    if (process.platform !== "win32") {
      const mode = fs.statSync(apiTokenPath(t.root)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    // No tmp file left behind by the atomic write.
    const leftovers = fs.readdirSync(t.root).filter((f) => f.startsWith("api-token."));
    expect(leftovers).toEqual([]);
  });

  it("tokensEqual: constant-time compare semantics (equal / different / different length)", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "abcd")).toBe(false);
    expect(tokensEqual("", "")).toBe(true);
  });

  it("bearerToken parses the header shape and nothing else", () => {
    expect(bearerToken("Bearer tok")).toBe("tok");
    expect(bearerToken("bearer tok")).toBe("tok");
    expect(bearerToken("  Bearer   tok  ")).toBe("tok");
    expect(bearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
  });

  it("readApiToken: absent or empty file reads as null", () => {
    expect(readApiToken(path.join(t.root, "no-such-subdir"))).toBeNull();
    fs.writeFileSync(apiTokenPath(t.root), "\n");
    expect(readApiToken(t.root)).toBeNull();
  });
});
