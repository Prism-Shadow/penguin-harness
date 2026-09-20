/**
 * The Browser's two surfaces.
 *
 * ON THE APP (`/api/browser`, signed in): `POST /sites` turns an address typed into the
 * panel into the host it is shown on — `{machineId, url}` in, `{origin, url, address}` out.
 * This is the only place a site comes into being, and it needs the session cookie a Browser
 * page never has: a page can ask its own host for anything, and its host will only ever ask
 * the one upstream it was minted for.
 *
 * ON A BROWSER HOST (`<label>.localhost`, no credential but the label): every request is the
 * site's — forwarded upstream, answered with the upstream's answer. The App is not there:
 * no App route, no App cookie, no static shell. HttpModule sends a request here by its Host
 * before any App middleware sees it.
 */
import { Hono } from "hono";
import type { BrowserSiteRequest, BrowserSiteResponse } from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { badRequest, readJson, requireString } from "../http/validate.js";
import { hostOnly, requestAuthority } from "../services/preview-token.js";
import type { AddressRefusal, BrowserTarget } from "./address.js";
import { browserHostOf, browserLabelOf, parseBrowserAddress } from "./address.js";
import { BOOTSTRAP_SOURCE } from "./bootstrap.js";
import { EgressRefused } from "./egress.js";
import type { BrowserEgress } from "./egress.js";
import {
  BOOTSTRAP_PATH,
  MAX_INJECT_BYTES,
  browserResponseHeaders,
  injectBootstrap,
  isHtml,
  scriptNonce,
  upstreamRequestHeaders,
} from "./rewrite.js";
import type { BrowserSitesRepo } from "./sites.js";

const REFUSALS: Record<AddressRefusal, string> = {
  invalid_url: "That is not an address.",
  unsupported_scheme: "The Browser opens http and https addresses.",
  credentials_in_url: "An address with a user name or password in it is not opened.",
  workspace_https: "A Workspace port is opened over http (localhost:<port>).",
};

/** The host the App must be reached on for `<label>.localhost` to be the same server. */
const APP_HOST = "localhost";

export interface BrowserApiDeps {
  sites: BrowserSitesRepo;
  knowsMachine(machineId: string): boolean;
  /** The port this server is bound to — where a Browser host is reached too. */
  port(): number;
}

export function browserApiRoutes(deps: BrowserApiDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/sites", async (c) => {
    const body = (await readJson(c)) as unknown as Partial<BrowserSiteRequest>;
    const typed = requireString(body as Record<string, unknown>, "url", {
      minLen: 1,
      maxLen: 8192,
    });
    const machineId = body.machineId ?? null;
    if (machineId !== null && typeof machineId !== "string") {
      throw badRequest("machineId must be a string or null.");
    }

    const parsed = parseBrowserAddress(typed);
    if ("refused" in parsed) throw new HttpError(400, parsed.refused, REFUSALS[parsed.refused]);

    // A Browser host is a sibling name of `localhost`: the browser resolves it to the
    // loopback by itself, and it only lands on THIS server when the App did too.
    const authority = requestAuthority(c.req.url, c.req.header("host"));
    if (hostOnly(authority).toLowerCase() !== APP_HOST) {
      throw new HttpError(
        409,
        "browser_unavailable",
        "The Browser needs the app to be opened on localhost: each site is served on a <label>.localhost host of its own.",
      );
    }

    // Only a Workspace port is reached THROUGH a machine; a public address is fetched by
    // this server whichever machine the conversation is on, so its site names none.
    const viaMachine = parsed.target.kind === "workspace" ? machineId : null;
    if (viaMachine !== null) {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can reach a machine's ports.");
      }
      if (!deps.knowsMachine(viaMachine)) {
        throw new HttpError(404, "unknown_machine", "No machine by that id.");
      }
    }

    const site = deps.sites.obtain(c.var.user.userId, viaMachine, parsed.target.origin);
    const protocol = new URL(c.req.url).protocol;
    const origin = `${protocol}//${browserHostOf(site.label)}:${deps.port()}`;
    const { pathname, search, hash } = parsed.url;
    const answer: BrowserSiteResponse = {
      origin,
      url: origin + pathname + search + hash,
      address: parsed.target.origin + pathname + search + hash,
    };
    return c.json(answer);
  });

  return app;
}

function refusalPage(status: number, title: string, detail: string): Response {
  const escape = (text: string) =>
    text.replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!,
    );
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>` +
    `<script src="${BOOTSTRAP_PATH}"></script>` +
    `<style>body{font:14px/1.5 var(--penguin-font-sans,system-ui,sans-serif);margin:0;padding:32px;` +
    `background:var(--penguin-bg,Canvas);color:var(--penguin-muted,GrayText)}` +
    `h1{font-size:15px;margin:0 0 8px;color:var(--penguin-fg,CanvasText)}</style></head>` +
    `<body><h1>${escape(title)}</h1><p>${escape(detail)}</p></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export interface BrowserHostDeps {
  sites: BrowserSitesRepo;
  egress: BrowserEgress;
}

/** Everything a `<label>.localhost` host answers. */
export function browserHostApp(deps: BrowserHostDeps): Hono {
  const app = new Hono();

  app.get(BOOTSTRAP_PATH, () => {
    return new Response(BOOTSTRAP_SOURCE, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
    });
  });

  app.all("*", async (c) => {
    const authority = requestAuthority(c.req.url, c.req.header("host"));
    const label = browserLabelOf(hostOnly(authority));
    const site = label === null ? null : deps.sites.byLabel(label);
    // An unknown label answers like nothing is there: this host is unauthenticated, and it
    // should not confirm what exists.
    if (site === null) return c.text("Not found", 404);

    const parsed = parseBrowserAddress(site.origin);
    if ("refused" in parsed) return c.text("Not found", 404);
    const target: BrowserTarget = parsed.target;
    const url = new URL(c.req.url);
    const browserOrigin = `${url.protocol}//${authority}`;
    const method = c.req.method;

    let upstream: Response;
    try {
      upstream = await deps.egress.fetch(target, site.machineId, {
        method,
        path: url.pathname + url.search,
        headers: upstreamRequestHeaders(c.req.raw.headers, target, browserOrigin),
        body: method === "GET" || method === "HEAD" ? null : c.req.raw.body,
        signal: c.req.raw.signal,
      });
    } catch (err) {
      if (err instanceof EgressRefused)
        return refusalPage(502, "This address is not opened", err.message);
      // A refused connection arrives as an AggregateError with an empty message and a code.
      const detail =
        err instanceof Error
          ? err.message || ((err as NodeJS.ErrnoException).code ?? err.name)
          : String(err);
      return refusalPage(502, `${site.origin} did not answer`, detail);
    }

    if (!isHtml(upstream.headers) || upstream.body === null || method === "HEAD") {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: browserResponseHeaders(upstream.headers, target, browserOrigin, false),
      });
    }

    // HTML gets the bootstrap. A document past the cap goes through untouched rather than
    // being held in memory for a theme.
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (declared > MAX_INJECT_BYTES) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: browserResponseHeaders(upstream.headers, target, browserOrigin, false),
      });
    }
    const html = await upstream.text();
    const nonce = scriptNonce(upstream.headers.get("content-security-policy"));
    return new Response(injectBootstrap(html, nonce), {
      status: upstream.status,
      headers: browserResponseHeaders(upstream.headers, target, browserOrigin, true),
    });
  });

  return app;
}
