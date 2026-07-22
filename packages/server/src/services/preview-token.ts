/**
 * Signed tokens for Workspace HTML preview on a separate origin.
 *
 * The preview origin deliberately differs from the App origin (see
 * design/specs/05-ARCHITECTURE.md § "Workspace 文件预览"), so it never receives the
 * session cookie — cookies are keyed by host and ignore port, which is why the two
 * must differ by hostname and not merely by port. Authorization therefore travels in
 * the URL as a short-lived HMAC token instead.
 *
 * The token binds three things: the Session whose Workspace may be read, the host the
 * preview must be served from, and an expiry. Binding the host is what keeps this from
 * becoming a same-origin XSS hole — the same process also answers on the App origin, so
 * without that check `/preview/<token>/index.html` would happily execute Agent-written
 * HTML with the App's cookies. See previewRoutes for the enforcement.
 *
 * The signing secret is generated per process: tokens are short-lived anyway, so losing
 * them across a restart costs nothing and there is no secret to persist or rotate.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Preview tokens live just long enough to open a page and let it pull its subresources. */
export const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface PreviewTokenPayload {
  /** Session whose Workspace subtree the token grants read access to. */
  sessionId: string;
  /** Host (no port) the preview must be served from; anything else is refused. */
  host: string;
  /** Expiry, epoch milliseconds. */
  expiresAt: number;
}

/** Wire form: `<base64url(json)>.<base64url(hmac)>`. */
type Signer = {
  sign(payload: PreviewTokenPayload): string;
  verify(token: string): PreviewTokenPayload | null;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createPreviewTokenSigner(secret: Buffer = randomBytes(32)): Signer {
  const mac = (body: string): Buffer => createHmac("sha256", secret).update(body).digest();

  return {
    sign(payload) {
      const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
      return `${body}.${b64url(mac(body))}`;
    },

    verify(token) {
      const dot = token.indexOf(".");
      if (dot <= 0 || dot === token.length - 1) return null;
      const body = token.slice(0, dot);
      const provided = Buffer.from(token.slice(dot + 1), "base64url");
      const expected = mac(body);
      // Length check first: timingSafeEqual throws on a length mismatch.
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

      let payload: PreviewTokenPayload;
      try {
        payload = JSON.parse(
          Buffer.from(body, "base64url").toString("utf8"),
        ) as PreviewTokenPayload;
      } catch {
        return null;
      }
      if (
        typeof payload?.sessionId !== "string" ||
        typeof payload?.host !== "string" ||
        typeof payload?.expiresAt !== "number"
      ) {
        return null;
      }
      if (Date.now() >= payload.expiresAt) return null;
      return payload;
    },
  };
}

export type PreviewTokenSigner = ReturnType<typeof createPreviewTokenSigner>;

/** Host header without its port (IPv6 literals keep their brackets). */
export function hostOnly(hostHeader: string): string {
  const trimmed = hostHeader.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * The loopback counterpart of the host the App is being used on: `127.0.0.1` and
 * `localhost` are distinct hosts for cookie purposes, so serving previews from the
 * other one isolates them with no extra port, no DNS, and nothing to configure.
 * Returns null for any other host (LAN IP, real domain) — those need an explicit
 * PENGUIN_PREVIEW_ORIGIN, and the caller degrades to the same-origin sandbox.
 */
export function loopbackCounterpart(host: string): string | null {
  const h = host.toLowerCase();
  if (h === "127.0.0.1") return "localhost";
  if (h === "localhost") return "127.0.0.1";
  // ::1 shares localhost's cookie jar semantics poorly across browsers; send it to the
  // IPv4 literal, which is unambiguous.
  if (h === "[::1]") return "127.0.0.1";
  return null;
}

/**
 * The host:port this request was addressed to. Prefers the Host header (what the browser
 * actually sent, and what decides the origin), falling back to the request URL's
 * authority — some server runtimes and test harnesses build a Request from a full URL
 * without materializing a Host header.
 */
export function requestAuthority(requestUrl: string, hostHeader: string | undefined): string {
  const header = (hostHeader ?? "").trim();
  if (header !== "") return header;
  try {
    return new URL(requestUrl).host;
  } catch {
    return "";
  }
}

/** Bind addresses from which the loopback names are reachable. */
const LOOPBACK_BINDS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0", "::"]);

/**
 * Where previews for this request should be served from: the configured origin when
 * PENGUIN_PREVIEW_ORIGIN is set, otherwise the loopback counterpart of the host the
 * caller is using. Null when neither applies — the caller degrades to the same-origin
 * sandbox rather than silently serving unisolated content.
 *
 * The port comes from **this server's own binding**, never from the request. Those differ
 * in development: the SPA is served by Vite on its own port and only proxies `/api`, so a
 * preview URL built from the browser's current port would point at a port where nothing
 * serves `/preview` — connection refused, or a Vite 404. In production the two are the
 * same and this is a no-op. `serverBind.host` is checked too: if the server is bound to
 * some specific non-loopback address, the loopback counterpart is not reachable and the
 * only correct answer is to fall back.
 */
export function resolvePreviewTarget(
  requestUrl: string,
  hostHeader: string | undefined,
  configuredOrigin: string | null,
  serverBind: { host: string; port: number },
): { origin: string; host: string } | null {
  if (configuredOrigin) {
    const url = new URL(configuredOrigin);
    return { origin: url.origin, host: url.hostname };
  }
  const raw = requestAuthority(requestUrl, hostHeader);
  if (raw === "") return null;
  const counterpart = loopbackCounterpart(hostOnly(raw));
  if (!counterpart) return null;
  if (!LOOPBACK_BINDS.has(serverBind.host.toLowerCase())) return null;

  let protocol: string;
  try {
    protocol = new URL(requestUrl).protocol;
  } catch {
    protocol = "http:";
  }
  const suffix =
    (protocol === "http:" && serverBind.port === 80) ||
    (protocol === "https:" && serverBind.port === 443)
      ? ""
      : `:${serverBind.port}`;
  return { origin: `${protocol}//${counterpart}${suffix}`, host: counterpart };
}
