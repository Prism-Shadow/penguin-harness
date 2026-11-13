/**
 * What a route group's `auth` flag means, wherever the group lands (http/app.ts), and what a
 * web contribution's data may not overwrite (http/routes/contributions.ts). Both modules are
 * wired by hand: the point is the assembly, not the tree around it.
 *
 * - Given a token-only group, missing or wrong Bearer credentials are refused.
 * - Given nested protected groups, one valid Bearer authenticates the request once.
 * - Given a Remote cookie already authenticated by an outer user group, a nested token-only
 *   group still requires the actual Bearer credential.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Contributed } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../src/auth/middleware.js";
import type { UserRow } from "../src/db/repos/users.js";
import { HttpModule } from "../src/http/app.js";
import { WebModule } from "../src/http/routes/contributions.js";
import {
  DEFAULT_ATTACHMENT_MAX_MB,
  DEFAULT_ATTACHMENT_TOTAL_MB,
} from "../src/services/attachment-limits.js";

const TOKEN = "good-token";
const USER = { userId: "u1", isAdmin: false };

interface Group {
  id: string;
  prefix: string;
  auth: "user" | "token" | "none";
  order: number;
  /** The one path this group serves; every path under its prefix when omitted. */
  only?: string;
}

/** A group that answers with the user the gate put on the context, or "anonymous". */
function group({ only, ...g }: Group): Contributed {
  const app = new Hono<AppEnv>();
  app.all(only ?? "*", (c) =>
    c.json({ group: g.id, user: (c.var.user as UserRow | undefined)?.userId ?? "anonymous" }),
  );
  const { id, ...data } = g;
  return { id, from: "test", data, code: app };
}

function assemble(groups: Group[]): {
  fetch(path: string, token?: string, cookie?: string): Promise<Response>;
  authentications(): number;
} {
  let authentications = 0;
  const http = wire(HttpModule, {
    config: { trustProxy: false },
    log: { line: () => {} },
    auth: {
      sessionTtlMs: 1000,
      authenticateApiToken: (token: string) => {
        authentications += 1;
        return token === TOKEN ? { user: USER, via: "token" } : null;
      },
      authenticateWithMeta: (token: string) =>
        token === "remote-cookie" ? { user: USER, via: "remote", renewed: false } : null,
      sessionIsLive: (token: string) => token === "remote-cookie",
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
  http.setup({ contributions: { routes: groups.map(group) } } as unknown as ClassCtx);
  return {
    fetch: (path, token, cookie) =>
      http.http.fetch(
        new Request(`http://localhost${path}`, {
          headers: {
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
            ...(cookie === undefined ? {} : { cookie: `penguin_session=${cookie}` }),
          },
        }),
      ),
    authentications: () => authentications,
  };
}

describe("a route group's auth flag", () => {
  it("leaves a public /api group public when it is ordered after a protected one", async () => {
    const app = assemble([
      { id: "members", prefix: "/api/members", auth: "user", order: 10 },
      { id: "webhook", prefix: "/api/webhook", auth: "none", order: 500 },
    ]);

    const res = await app.fetch("/api/webhook/incoming");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ group: "webhook", user: "anonymous" });
  });

  it("protects a group on its own prefix, the bare prefix included", async () => {
    const app = assemble([{ id: "members", prefix: "/api/members", auth: "user", order: 10 }]);

    expect((await app.fetch("/api/members")).status).toBe(401);
    expect((await app.fetch("/api/members/u2")).status).toBe(401);
    expect((await app.fetch("/api/members/u2", "wrong")).status).toBe(401);
    const res = await app.fetch("/api/members/u2", TOKEN);
    expect(await res.json()).toEqual({ group: "members", user: "u1" });
  });

  it("protects a group outside /api", async () => {
    const app = assemble([{ id: "proxy", prefix: "/server/", auth: "user", order: 51 }]);

    expect((await app.fetch("/server/m1/api/me")).status).toBe(401);
    expect((await app.fetch("/server/m1/api/me", TOKEN)).status).toBe(200);
  });

  it("requires a valid local API token for a token-only group", async () => {
    const app = assemble([{ id: "exchange", prefix: "/api/exchange", auth: "token", order: 55 }]);

    expect((await app.fetch("/api/exchange")).status).toBe(401);
    expect((await app.fetch("/api/exchange/session", "wrong")).status).toBe(401);
    const res = await app.fetch("/api/exchange/session", TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ group: "exchange", user: "u1" });
  });

  it.each(["user", "token"] as const)(
    "authenticates once per request through nested %s groups",
    async (auth) => {
      const app = assemble([
        // The outer group serves its root alone, so the nested path passes its gate and goes on.
        { id: "projects", prefix: "/api/projects", auth, order: 80, only: "/" },
        { id: "members", prefix: "/api/projects/:projectId/members", auth, order: 90 },
      ]);

      const res = await app.fetch("/api/projects/p1/members", TOKEN);
      expect(await res.json()).toEqual({ group: "members", user: "u1" });
      expect(app.authentications()).toBe(1);
    },
  );

  it("refuses a Remote cookie at a token-only group even after an outer user gate", async () => {
    const app = assemble([
      { id: "outer", prefix: "/api/remote", auth: "user", order: 50, only: "/" },
      { id: "exchange", prefix: "/api/remote/session", auth: "token", order: 55 },
    ]);

    expect((await app.fetch("/api/remote", undefined, "remote-cookie")).status).toBe(200);
    const refused = await app.fetch("/api/remote/session", undefined, "remote-cookie");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "local_api_token_required" } });
    expect(refused.headers.has("set-cookie")).toBe(false);
    expect((await app.fetch("/api/remote/session", "wrong", "remote-cookie")).status).toBe(401);
    expect((await app.fetch("/api/remote/session", TOKEN, "remote-cookie")).status).toBe(200);
  });

  it("declines a path no group serves, instead of answering for it", async () => {
    const app = assemble([{ id: "members", prefix: "/api/members", auth: "user", order: 10 }]);

    const res = await app.fetch("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-penguin-platform-decline")).not.toBeNull();
  });
});

describe("a web contribution", () => {
  it("keeps the server's id and from over data fields of the same name", () => {
    const web = wire(WebModule, {});
    web.setup({
      contributions: {
        pages: [
          {
            id: "plugin.page",
            from: "PluginModule",
            data: { id: "forged", from: "HttpModule", key: "p", path: "/p" },
          },
        ],
      },
    } as unknown as ClassCtx);

    expect(web.web.contributions().pages).toEqual([
      { id: "plugin.page", from: "PluginModule", key: "p", path: "/p" },
    ]);
  });
});
