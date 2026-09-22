/**
 * A WebSocket (any Upgrade) on a Browser host: carried, not spoken.
 *
 * The HTTP proxy cannot carry one — a seam handler returns a whole Response, and an upgrade
 * is a socket that stays open — so the runtime offers every upgrade to the platform first
 * (terminal/ws.ts) and this is where the platform claims those whose Host is a Browser host.
 * What happens then is a tunnel: the upstream is reached the way a fetch reaches it
 * (egress.open — through the machine for a Workspace port, vetted for a public one), the
 * client's request line and headers go up as they are but for the two that name the origin
 * (Host, Origin — the site's own, as the HTTP proxy rewrites them), the bytes that arrived
 * with the handshake follow, and from there the two sockets are piped into each other.
 * The upstream's answer — 101 and its subprotocol, or a refusal — is the client's to read.
 *
 * Nothing is parsed past the request line: a WebSocket's frames are the page's and the
 * site's business, and this server sees them as bytes. That is also why a tunnel outlives
 * a hot push on its own: two sockets piped together need nothing from the tree.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { hostOnly, requestAuthority } from "../services/preview-token.js";
import { browserLabelOf, parseBrowserAddress } from "./address.js";
import type { BrowserTarget } from "./address.js";
import type { BrowserEgress } from "./egress.js";
import type { BrowserSitesRepo } from "./sites.js";

export interface BrowserUpgradeDeps {
  sites: BrowserSitesRepo;
  egress: BrowserEgress;
  log?: (line: string) => void;
}

/** Headers that name THIS hop, rewritten or dropped; everything else goes up as it came. */
function upstreamHeaderLines(
  req: IncomingMessage,
  target: BrowserTarget,
  browserOrigin: string,
): string[] {
  const upstreamHost = new URL(target.origin).host;
  const lines: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i] as string;
    const value = req.rawHeaders[i + 1] as string;
    const lower = name.toLowerCase();
    if (lower === "host") {
      lines.push(`Host: ${upstreamHost}`);
    } else if (lower === "origin" || lower === "referer") {
      // The site's own origin, or nothing: the App's is nothing the site should learn.
      if (value === browserOrigin || value.startsWith(`${browserOrigin}/`)) {
        lines.push(`${name}: ${target.origin}${value.slice(browserOrigin.length)}`);
      }
    } else {
      lines.push(`${name}: ${value}`);
    }
  }
  return lines;
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * The platform's answer to an upgrade: true when the Host is a Browser host — the socket is
 * then this tunnel's, whatever becomes of it — and false when it is not ours to claim.
 */
export function browserHostUpgrade(deps: BrowserUpgradeDeps) {
  return async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> => {
    const authority = requestAuthority(req.url ?? "/", req.headers.host);
    const label = browserLabelOf(hostOnly(authority));
    if (label === null) return false;
    const site = deps.sites.byLabel(label);
    const parsed = site === null ? null : parseBrowserAddress(site.origin);
    if (site === null || parsed === null || "refused" in parsed) {
      refuse(socket, 404, "Not Found");
      return true;
    }
    const target = parsed.target;
    // An upgrade request carries no scheme of its own; Browser hosts are served over http.
    const browserOrigin = `http://${authority}`;

    let upstream;
    try {
      upstream = await deps.egress.open(target, site.machineId);
    } catch (err) {
      deps.log?.(
        `[browser] upgrade to ${site.origin} refused: ${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(socket, 502, "Bad Gateway");
      return true;
    }
    if (socket.destroyed) {
      upstream.destroy();
      return true;
    }
    const request =
      `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1\r\n` +
      upstreamHeaderLines(req, target, browserOrigin).join("\r\n") +
      "\r\n\r\n";
    upstream.write(request);
    if (head.length > 0) upstream.write(head);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.pipe(socket);
    socket.pipe(upstream);
    return true;
  };
}
