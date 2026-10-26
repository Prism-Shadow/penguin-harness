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
 * - Given a password, setup or desktop cookie in its renewal window, Remote exchange refuses
 *   it without setting a cookie or changing its expiry; ordinary API access still renews it.
 * - Given an expired cookie, Remote exchange returns 401 without setting a cookie.
 * - Given a valid Bearer beside an aging cookie, Remote exchange issues a new session without
 *   renewing the existing cookie; a wrong Bearer does not fall back to that cookie.
 * - Given a Remote session used before its hour, access succeeds without renewal and fails
 *   at its issued expiry; logging out also makes its cookie unusable.
 * - Given a Remote cookie, neither the assembled endpoint nor a route behind a user gate
 *   accepts it for another exchange; a real Bearer still succeeds.
 * - The next boot's token overwrites the file atomically, owner-only, leaving no temp file.
 * - An absent or empty token file reads as no token.
 * - The comparison is constant-time and length-aware, and only a Bearer header shape parses.
 */
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MeResponse, SessionCreateResponse } from "../src/api/types.js";
import { apiTokenPath, readApiToken, storeApiToken, tokensEqual } from "../src/auth/api-token.js";
import { authMiddleware, bearerToken, SESSION_COOKIE } from "../src/auth/middleware.js";
import { REMOTE_SESSION_TTL_MS } from "../src/auth/service.js";
import { remoteRoutes } from "../src/http/routes/remote.js";
import { handleError } from "../src/http/errors.js";
import { sessionTokenHash } from "../src/db/repos/auth-sessions.js";
import {
  apiClient,
  cookieFrom,
  createDesktopApp,
  createTestApp,
  desktopLoginCookie,
  loginAdmin,
  makeTempRoot,
  remoteSessionCookie,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

interface RemoteSessionResponse {
  cookieName: typeof SESSION_COOKIE;
  sessionToken: string;
  expiresAt: string;
  maxAgeSeconds: number;
}

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

  const bearerFor = (
    app: TestApp["app"],
    value: string,
    init: RequestInit = {},
    apiPath = "/api/me",
  ) =>
    app.request(apiPath, {
      ...init,
      headers: {
        authorization: `Bearer ${value}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

  const bearer = (value: string, init: RequestInit = {}, apiPath = "/api/me") =>
    bearerFor(t.app, value, init, apiPath);

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

  it("remote session exchange is available only to the local API token", async () => {
    const nowMs = Date.now();
    const remote = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const remoteToken = readApiToken(remote.root)!;
      const unauthenticated = await remote.app.request("/api/remote/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(unauthenticated.status).toBe(401);

      const wrong = await bearerFor(
        remote.app,
        "not-the-token",
        { method: "POST", body: "{}" },
        "/api/remote/session",
      );
      expect(wrong.status).toBe(401);
      expect(await wrong.text()).not.toContain("not-the-token");

      const missingContentType = await remote.app.request("/api/remote/session", {
        method: "POST",
        headers: { authorization: `Bearer ${remoteToken}` },
        body: "{}",
      });
      expect(missingContentType.status).toBe(415);

      const admin = await loginAdmin(remote.app);
      const passwordCookie = await apiClient(remote.app, admin.cookie).post(
        "/api/remote/session",
        {},
      );
      expect(passwordCookie.status).toBe(403);

      const setupToken = remote.deps.authService.mintFirstLogin();
      expect(setupToken).not.toBeNull();
      const setupClaim = await remote.app.request(
        `/api/auth/claim?token=${encodeURIComponent(setupToken!)}`,
      );
      expect(setupClaim.status).toBe(302);
      const setupCookie = cookieFrom(setupClaim);
      const setupCookieRes = await apiClient(remote.app, setupCookie).post(
        "/api/remote/session",
        {},
      );
      expect(setupCookieRes.status).toBe(403);

      const desktop = await createDesktopApp({ now: () => new Date(nowMs) });
      try {
        const desktopCookie = await desktopLoginCookie(desktop.app);
        const desktopCookieRes = await apiClient(desktop.app, desktopCookie).post(
          "/api/remote/session",
          {},
        );
        expect(desktopCookieRes.status).toBe(403);
      } finally {
        await desktop.cleanup();
      }
    } finally {
      await remote.cleanup();
    }
  });

  it("exchanges the local API token for a one-hour browser session without setting a cookie", async () => {
    const nowMs = Date.now();
    const remote = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const remoteToken = readApiToken(remote.root)!;
      const res = await bearerFor(
        remote.app,
        remoteToken,
        { method: "POST", body: "{}" },
        "/api/remote/session",
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.has("set-cookie")).toBe(false);
      const text = await res.text();
      expect(text.includes(remoteToken)).toBe(false);
      expect(text.includes("penguinGo")).toBe(false);

      const body = JSON.parse(text) as RemoteSessionResponse;
      expect(Object.keys(body).sort()).toEqual([
        "cookieName",
        "expiresAt",
        "maxAgeSeconds",
        "sessionToken",
      ]);
      expect(body.cookieName).toBe(SESSION_COOKIE);
      expect(typeof body.sessionToken).toBe("string");
      expect(body.sessionToken !== remoteToken).toBe(true);
      expect(body.maxAgeSeconds).toBe(3600);
      expect(Date.parse(body.expiresAt)).toBe(nowMs + REMOTE_SESSION_TTL_MS);

      const hash = sessionTokenHash(body.sessionToken);
      const row = remote.deps.db
        .prepare("SELECT user_id, expires_at, via FROM auth_sessions WHERE token_hash = ?")
        .get(hash) as { user_id: string; expires_at: string; via: string } | undefined;
      expect(row).toEqual({
        user_id: "admin",
        expires_at: body.expiresAt,
        via: "remote",
      });

      const me = await apiClient(remote.app, `${SESSION_COOKIE}=${body.sessionToken}`).get(
        "/api/me",
      );
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as MeResponse;
      expect(meBody.user.userId).toBe("admin");
      expect(meBody.sessionVia).toBe("remote");
    } finally {
      await remote.cleanup();
    }
  });

  it.each(["platform", "user-gate"] as const)(
    "a Remote cookie cannot exchange another session through the %s mount",
    async (mount) => {
      const cookie = await remoteSessionCookie(t.app, token);
      const app =
        mount === "platform"
          ? t.app
          : new Hono()
              .onError(handleError)
              .use("*", authMiddleware(t.deps.authService, false))
              .route("/api/remote", remoteRoutes({ authService: t.deps.authService }));
      const refused = await apiClient(app, cookie).post("/api/remote/session", {});
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "local_api_token_required" } });
      expect(refused.headers.has("set-cookie")).toBe(false);
      const accepted = await bearerFor(
        app,
        token,
        { method: "POST", body: "{}", headers: { cookie } },
        "/api/remote/session",
      );
      expect(accepted.status).toBe(200);
    },
  );

  it.each(["password", "setup", "desktop"] as const)(
    "rejects an aging %s cookie without renewing it, while ordinary API access still renews",
    async (via) => {
      let nowMs = Date.now();
      const options = { now: () => new Date(nowMs) };
      const remote =
        via === "desktop" ? await createDesktopApp(options) : await createTestApp(options);
      try {
        let cookie: string;
        if (via === "desktop") {
          cookie = await desktopLoginCookie(remote.app);
        } else if (via === "setup") {
          const token = remote.deps.authService.mintFirstLogin();
          expect(token !== null).toBe(true);
          const claim = await remote.app.request(
            `/api/auth/claim?token=${encodeURIComponent(token!)}`,
          );
          expect(claim.status).toBe(302);
          cookie = cookieFrom(claim);
        } else {
          cookie = (await loginAdmin(remote.app)).cookie;
        }
        const hash = sessionTokenHash(cookie.slice(SESSION_COOKIE.length + 1));
        const readExpiry = () =>
          (
            remote.deps.db
              .prepare("SELECT expires_at FROM auth_sessions WHERE token_hash = ?")
              .get(hash) as { expires_at: string }
          ).expires_at;
        const expiresAt = readExpiry();
        nowMs += 2 * 24 * 60 * 60_000;

        const refused = await apiClient(remote.app, cookie).post("/api/remote/session", {});
        expect(refused.status).toBe(403);
        expect(refused.headers.has("set-cookie")).toBe(false);
        expect(readExpiry()).toBe(expiresAt);

        const me = await apiClient(remote.app, cookie).get("/api/me");
        expect(me.status).toBe(200);
        expect(me.headers.has("set-cookie")).toBe(true);
        expect(Date.parse(readExpiry())).toBe(nowMs + remote.deps.config.authSessionTtlMs);
      } finally {
        await remote.cleanup();
      }
    },
  );

  it("rejects an expired cookie without setting a cookie", async () => {
    let nowMs = Date.now();
    const remote = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const { cookie } = await loginAdmin(remote.app);
      nowMs += remote.deps.config.authSessionTtlMs;
      const res = await apiClient(remote.app, cookie).post("/api/remote/session", {});
      expect(res.status).toBe(401);
      expect(res.headers.has("set-cookie")).toBe(false);
    } finally {
      await remote.cleanup();
    }
  });

  it("keeps Bearer precedence beside an aging cookie without renewing that cookie", async () => {
    let nowMs = Date.now();
    const remote = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const { cookie } = await loginAdmin(remote.app);
      const hash = sessionTokenHash(cookie.slice(SESSION_COOKIE.length + 1));
      const readExpiry = () =>
        (
          remote.deps.db
            .prepare("SELECT expires_at FROM auth_sessions WHERE token_hash = ?")
            .get(hash) as { expires_at: string }
        ).expires_at;
      const expiresAt = readExpiry();
      nowMs += 2 * 24 * 60 * 60_000;

      const wrong = await bearerFor(
        remote.app,
        "not-the-token",
        { method: "POST", body: "{}", headers: { cookie } },
        "/api/remote/session",
      );
      expect(wrong.status).toBe(401);
      expect(wrong.headers.has("set-cookie")).toBe(false);
      expect(readExpiry()).toBe(expiresAt);

      const res = await bearerFor(
        remote.app,
        readApiToken(remote.root)!,
        { method: "POST", body: "{}", headers: { cookie } },
        "/api/remote/session",
      );
      expect(res.status).toBe(200);
      expect(res.headers.has("set-cookie")).toBe(false);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const session = (await res.json()) as RemoteSessionResponse;
      expect(Date.parse(session.expiresAt)).toBe(nowMs + REMOTE_SESSION_TTL_MS);
      expect(readExpiry()).toBe(expiresAt);
      const me = await apiClient(remote.app, `${SESSION_COOKIE}=${session.sessionToken}`).get(
        "/api/me",
      );
      expect(me.status).toBe(200);
    } finally {
      await remote.cleanup();
    }
  });

  it("a Remote session expires at its issued hour even after it has been used", async () => {
    let nowMs = Date.now();
    const remote = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const res = await bearerFor(
        remote.app,
        readApiToken(remote.root)!,
        { method: "POST", body: "{}" },
        "/api/remote/session",
      );
      expect(res.status).toBe(200);
      const session = (await res.json()) as RemoteSessionResponse;
      const api = apiClient(remote.app, `${SESSION_COOKIE}=${session.sessionToken}`);
      nowMs = Date.parse(session.expiresAt) - 1;
      const beforeExpiry = await api.get("/api/me");
      expect(beforeExpiry.status).toBe(200);
      expect(beforeExpiry.headers.has("set-cookie")).toBe(false);
      nowMs += 1;
      expect((await api.get("/api/me")).status).toBe(401);
    } finally {
      await remote.cleanup();
    }
  });

  it("logging out revokes an exchanged Remote session", async () => {
    const remote = await createTestApp();
    try {
      const res = await bearerFor(
        remote.app,
        readApiToken(remote.root)!,
        { method: "POST", body: "{}" },
        "/api/remote/session",
      );
      expect(res.status).toBe(200);
      const session = (await res.json()) as RemoteSessionResponse;
      const api = apiClient(remote.app, `${SESSION_COOKIE}=${session.sessionToken}`);
      expect((await api.get("/api/me")).status).toBe(200);
      expect((await api.post("/api/auth/logout")).status).toBe(204);
      expect((await api.get("/api/me")).status).toBe(401);
    } finally {
      await remote.cleanup();
    }
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
