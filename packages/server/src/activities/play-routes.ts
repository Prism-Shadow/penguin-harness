/**
 * Playing an activity, served where its code cannot reach the App.
 *
 * `GET /preview/activity/:token/*` sits outside `/api` and outside the auth middleware, on
 * the preview origin, for the reason workspace previews do (see `http/routes/preview.ts`):
 * a module's code -- Loom's or Penguin's, written by an agent either way -- runs in this
 * page, and on the App's origin it would run with the author's session. So the signed
 * token in the path is the only credential, bound to one activity and one host.
 *
 * Everything the learner runtime asks for hangs off that one path: the page, the player
 * bundle, the module's files, the media, the framework's shared resources, and the few
 * backend calls the framework makes, answered the way the WAF backend would answer them.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono, type Context } from "hono";
import { hostOnly, requestAuthority } from "../services/preview-token.js";
import type { ActivitySandbox, FrameworkResource, PlayTarget } from "./sandbox-service.js";

/** The base every played activity's paths hang off, for one token. */
export function playBase(token: string): string {
  return `/preview/activity/${token}/`;
}

/** What follows `<prefix>` in the request path, still encoded. */
function rest(c: Context, prefix: string): string {
  const at = c.req.path.indexOf(prefix);
  return at < 0 ? "" : c.req.path.slice(at + prefix.length);
}

const COMMON_HEADERS: Record<string, string> = {
  // The URL carries the credential; a request the page makes elsewhere must not leak it.
  "Referrer-Policy": "no-referrer",
  // On the App's own host the page runs sandboxed, with an opaque origin, so its requests
  // back here are cross-origin. The token is in the path and no cookie is involved, so
  // allowing any origin grants nothing the path does not.
  "Access-Control-Allow-Origin": "*",
};

@Component({
  contributes: {
    "HttpModule.routes": [
      // Ahead of the workspace preview's `/preview/:token/*`, which would otherwise take
      // "activity" for a token and answer 404.
      { id: "activities.play", prefix: "/preview/activity", auth: "none", order: 890 },
    ],
  },
})
export class ActivityPlayRoutes {
  @Use() private readonly sandbox!: ActivitySandbox;
  @Bind("activities.play") routes!: Hono;

  setup() {
    const app = new Hono<{ Variables: { target: PlayTarget } }>();

    app.options("/:token/*", () => {
      return new Response(null, {
        status: 204,
        headers: {
          ...COMMON_HEADERS,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "600",
        },
      });
    });

    app.use("/:token/*", async (c, next) => {
      const host = hostOnly(requestAuthority(c.req.url, c.req.header("host")));
      const target = this.sandbox.verifyPlay(c.req.param("token") ?? "", host);
      // A bad, expired or misplaced token answers 404 with no detail: this endpoint is
      // unauthenticated, so it should not confirm what exists.
      if (!target) return c.text("Not found", 404, COMMON_HEADERS);
      c.set("target", target);
      await next();
      for (const [name, value] of Object.entries(COMMON_HEADERS)) c.res.headers.set(name, value);
    });

    const respond = (served: {
      status: number;
      headers: Record<string, string>;
      body?: Uint8Array;
    }) => new Response(served.body ?? null, { status: served.status, headers: served.headers });

    const rangeOf = (c: Context) => ({
      range: c.req.header("range") ?? null,
      ifRange: c.req.header("if-range") ?? null,
      ifNoneMatch: c.req.header("if-none-match") ?? null,
    });

    app.get("/:token/play", async (c) => {
      const target = c.get("target");
      const page = await this.sandbox.playerPage(
        target.projectId,
        target.activityId,
        playBase(c.req.param("token")),
        {
          languageCode: c.req.query("language") ?? null,
          startSceneId: c.req.query("scene") ?? null,
        },
        target.expiresAt,
        target.parentOrigin ?? null,
      );
      return new Response(page.html, {
        status: page.status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          // On the App's own host there is no origin boundary, so the page gets an opaque
          // origin instead: scripts run, but nothing it does is the App's.
          ...(target.shared
            ? { "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-modals" }
            : {}),
        },
      });
    });

    app.get("/:token/player/*", async (c) =>
      respond(await this.sandbox.playerFile(rest(c, "/player/"))),
    );

    app.get("/:token/module/*", async (c) => {
      const target = c.get("target");
      return respond(
        await this.sandbox.moduleFile(target.projectId, target.activityId, rest(c, "/module/")),
      );
    });

    app.get("/:token/navbar/*", async (c) =>
      respond(await this.sandbox.navbarFile(rest(c, "/navbar/"))),
    );

    app.get("/:token/media/*", async (c) => {
      const target = c.get("target");
      return respond(
        await this.sandbox.media(
          target.projectId,
          target.activityId,
          rest(c, "/media/"),
          rangeOf(c),
        ),
      );
    });

    for (const resource of ["layouts", "css", "images", "audio"] as FrameworkResource[]) {
      app.get(`/:token/${resource}/*`, async (c) =>
        respond(await this.sandbox.frameworkFile(resource, rest(c, `/${resource}/`), rangeOf(c))),
      );
    }

    // The framework's configuration request, in both API versions and both shapes: by
    // product mapping and by activity version. Whatever ids it sends, the token names the
    // activity; the language and start scene ride on the query, set by the player.
    const configuration = async (c: Context<{ Variables: { target: PlayTarget } }>) => {
      const target = c.get("target");
      const activity = await this.sandbox.payload(target.projectId, target.activityId, {
        languageCode: c.req.query("languageCode") ?? null,
        startSceneId: c.req.query("startSceneId") ?? null,
        base: playBase(c.req.param("token") ?? ""),
      });
      c.header("Cache-Control", "no-store");
      return c.json({ data: { attributes: { activity } } });
    };
    for (const version of ["v2", "v3"]) {
      app.get(`/:token/activity/${version}/configuration/activities/mapping`, configuration);
      app.get(
        `/:token/activity/${version}/configuration/activities/:id/version/:version`,
        configuration,
      );
    }

    // The assessment service, emulated (see sandbox-assessment.ts): a POST starts a session
    // or continues the one its score id names. Whatever key and student the framework sends,
    // the token names the activity.
    const assess = async (c: Context<{ Variables: { target: PlayTarget } }>) => {
      const target = c.get("target");
      let body: unknown = null;
      try {
        body = await c.req.json();
      } catch {
        // A first request may carry no body at all.
      }
      const data = (body as { data?: unknown } | null)?.data;
      const part = await this.sandbox.assess(
        target.projectId,
        target.activityId,
        playBase(c.req.param("token") ?? ""),
        c.req.param("scoreId") ?? null,
        Array.isArray(data) ? data : [],
      );
      c.header("Cache-Control", "no-store");
      return c.json(part);
    };
    for (const version of ["v2", "v3"]) {
      for (const mode of ["assess", "preview/assess"]) {
        const at = `/:token/assessment/${version}/apps/:app/assessments/:key/versions/:version/orgs/:org/students/:student/${mode}`;
        app.post(at, assess);
        app.post(`${at}/:scoreId`, assess);
      }
    }

    // The app configuration the framework loads at start. A preview has none.
    app.get("/:token/configuration/v3/apps/:app/configurations", (c) =>
      c.json({ data: { attributes: {} } }),
    );

    this.routes = app as unknown as Hono;
  }
}
