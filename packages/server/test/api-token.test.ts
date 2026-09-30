/**
 * The local API token: minted per boot, persisted at <root>/api-token (owner-only), and
 * accepted by authMiddleware as `Authorization: Bearer` — authenticating as the built-in admin
 * on every protected route, SSE endpoints included (the CLI consumes SSE via fetch with
 * headers, so header auth must reach them).
 *
 * - A boot persists the token at <root>/api-token with owner-only permissions.
 * - A valid Bearer authenticates as the admin (sessionVia "token") with no cookie at all.
 * - A wrong Bearer is 401, even beside a valid cookie: no silent fallback to the cookie.
 * - A Bearer works on writes (the JSON-only CSRF guard still applies) and on SSE streams.
 * - The hot-update APIs take the Bearer as the admin credential.
 * - The next boot's token overwrites the file atomically, owner-only, leaving no temp file.
 * - An absent or empty token file reads as no token.
 * - The comparison is constant-time and length-aware, and only a Bearer header shape parses.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MeResponse, SessionCreateResponse } from "../src/api/types.js";
import { apiTokenPath, readApiToken, storeApiToken, tokensEqual } from "../src/auth/api-token.js";
import { bearerToken } from "../src/auth/middleware.js";
import { createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("local API token", () => {
  let t: TestApp;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
    const stored = readApiToken(t.root);
    expect(stored).not.toBeNull();
    token = stored!;
  });
  afterAll(async () => {
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
    // Pin a model whose client constructs without a credential (the anthropic protocol);
    // the seeded preset default may need an env key this machine does not have. The PUT
    // itself is a Bearer-authenticated write too.
    const models = await bearer(
      token,
      {
        method: "PUT",
        body: JSON.stringify({
          defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
          models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
        }),
      },
      "/api/projects/default_project/models",
    );
    expect(models.status).toBe(200);
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

  it("overwrites the previous boot's file on the next boot, atomically", async () => {
    const root = await makeTempRoot();
    try {
      storeApiToken(root, "first-boot-token");
      storeApiToken(root, "next-boot-token");
      expect(readApiToken(root)).toBe("next-boot-token");
      if (process.platform !== "win32") {
        expect(fs.statSync(apiTokenPath(root)).mode & 0o777).toBe(0o600);
      }
      // No tmp file left behind by the atomic write.
      expect(fs.readdirSync(root).filter((f) => f.startsWith("api-token."))).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  it("reads an absent or empty token file as no token", async () => {
    expect(readApiToken(path.join(t.root, "no-such-subdir"))).toBeNull();
    const root = await makeTempRoot();
    try {
      fs.writeFileSync(apiTokenPath(root), "\n");
      expect(readApiToken(root)).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
