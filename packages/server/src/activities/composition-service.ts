/**
 * Showing a scene composition (see composition.ts), served where its code cannot reach the App.
 *
 * A composition is agent-written HTML, so it is never served on the App's origin: an author is
 * handed a signed, short-lived link (`GET .../runs/:runId/composition-link` redirects to it),
 * and `GET /preview/composition/:token/*` on the preview origin answers only to that link, the
 * way a played activity does (see play-routes.ts). The token names one run and one host; on
 * the App's own host, with no separate preview origin, the page is sandboxed off its origin.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import { Hono, type Context } from "hono";
import { HttpError } from "../http/errors.js";
import type { ActivityGeneration } from "../mechanisms/activities.js";
import { hostOnly, requestAuthority } from "../services/preview-token.js";
import { COMPOSITION_CSP, COMPOSITION_FILE } from "./composition.js";

/** Long enough to watch and replay a composition while writing about it. */
export const COMPOSITION_TOKEN_TTL_MS = 60 * 60 * 1000;

/** What a composition link grants: one run's files, on one host, until it expires. */
export interface CompositionGrant {
  projectId: string;
  activityId: string;
  runId: string;
  host: string;
  /** True when that host is the App's own, so the page must be sandboxed off its origin. */
  shared: boolean;
  expiresAt: number;
}

/** The base a composition's files hang off, for one token. */
export function compositionBase(token: string): string {
  return `/preview/composition/${token}/`;
}

export abstract class ActivityCompositions extends Interface<{
  /**
   * Signs a link to a kept composition on `host`, for a caller already authorised. 403
   * `experiment_off` while the experiment is off; 404 when the run kept no composition.
   */
  link(
    projectId: string,
    activityId: string,
    runId: string,
    host: string,
    shared: boolean,
  ): Promise<{ token: string; expiresAt: number }>;
  /** What a link grants, or null when it is forged, expired or for another host. */
  verify(token: string, host: string): CompositionGrant | null;
}>() {}

@Component()
export class ActivityCompositionService implements ActivityCompositions {
  @Use() private readonly generation!: ActivityGeneration;
  /** Per process: links are short-lived, so a restart costs a reload and nothing else. */
  private readonly secret = randomBytes(32);

  private mac(body: string): Buffer {
    return createHmac("sha256", this.secret).update(body).digest();
  }

  async link(
    projectId: string,
    activityId: string,
    runId: string,
    host: string,
    shared: boolean,
  ): Promise<{ token: string; expiresAt: number }> {
    if (!this.generation.videoExperiment())
      throw new HttpError(
        403,
        "experiment_off",
        "Scene videos are an experiment an admin has not turned on.",
      );
    // Refuses a link to a run that kept no composition while the caller can still be told.
    await this.generation.compositionFile(projectId, activityId, runId, COMPOSITION_FILE);
    const grant: CompositionGrant = {
      projectId,
      activityId,
      runId,
      host: host.toLowerCase(),
      shared,
      expiresAt: Date.now() + COMPOSITION_TOKEN_TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(grant), "utf8").toString("base64url");
    return {
      token: `${body}.${this.mac(body).toString("base64url")}`,
      expiresAt: grant.expiresAt,
    };
  }

  verify(token: string, host: string): CompositionGrant | null {
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = this.mac(body);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    let grant: CompositionGrant;
    try {
      grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CompositionGrant;
    } catch {
      return null;
    }
    if (
      typeof grant?.projectId !== "string" ||
      typeof grant.activityId !== "string" ||
      typeof grant.runId !== "string" ||
      typeof grant.host !== "string" ||
      typeof grant.expiresAt !== "number"
    )
      return null;
    if (Date.now() >= grant.expiresAt) return null;
    // The host binding is what keeps the page on the origin it was issued for.
    if (grant.host !== host.toLowerCase()) return null;
    return grant;
  }
}

const COMMON_HEADERS: Record<string, string> = {
  // The URL carries the credential; a request the page makes elsewhere must not leak it.
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

@Component({
  contributes: {
    "HttpModule.routes": [
      // Ahead of the workspace preview's `/preview/:token/*`, which would otherwise take
      // "composition" for a token and answer 404.
      { id: "activities.composition", prefix: "/preview/composition", auth: "none", order: 889 },
    ],
  },
})
export class ActivityCompositionRoutes {
  @Use() private readonly compositions!: ActivityCompositions;
  @Use() private readonly generation!: ActivityGeneration;
  @Bind("activities.composition") routes!: Hono;

  setup() {
    const app = new Hono();
    const notFound = () => new Response("Not found", { status: 404, headers: COMMON_HEADERS });
    app.get("/:token/*", async (c: Context) => {
      const host = hostOnly(requestAuthority(c.req.url, c.req.header("host")));
      const grant = this.compositions.verify(c.req.param("token") ?? "", host);
      // A bad, expired or misplaced link answers 404 with no detail: this endpoint is
      // unauthenticated, so it should not confirm what exists. So does a switched-off experiment.
      if (!grant || !this.generation.videoExperiment()) return notFound();
      const prefix = compositionBase(c.req.param("token") ?? "");
      const at = c.req.path.indexOf(prefix);
      const rest = at < 0 ? "" : c.req.path.slice(at + prefix.length);
      try {
        const file = await this.generation.compositionFile(
          grant.projectId,
          grant.activityId,
          grant.runId,
          rest,
        );
        return new Response(new Uint8Array(file.body), {
          status: 200,
          headers: {
            ...COMMON_HEADERS,
            "Content-Type": file.contentType,
            "Content-Length": String(file.body.byteLength),
            // The template's own policy, enforced by the server too; on the App's host the page
            // also gets an opaque origin, so nothing it does is the App's.
            "Content-Security-Policy": `${COMPOSITION_CSP}${grant.shared ? "; sandbox allow-scripts" : ""}`,
          },
        });
      } catch (error) {
        if (error instanceof HttpError) return notFound();
        throw error;
      }
    });
    this.routes = app;
  }
}
