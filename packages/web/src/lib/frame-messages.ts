/**
 * The messages a contributed page's frame and the Web App exchange, as the host reads and writes
 * them. Two kinds, each a small record posted with `postMessage`:
 *
 * - `{ type: "penguin:location", at }`, both ways: `at` is the path and query inside the app
 *   (starting with "/"). The frame posts it whenever it moves inside itself, and the host keeps it
 *   in the window's address (replacing the entry, never adding one); the host posts it when its
 *   address moved on its own (Back, Forward, a pasted address), and the frame goes there without
 *   reloading.
 * - `{ type: "penguin:navigate", to }`, from the frame: take the viewer to `to`, a path of this
 *   app (same origin, starting with "/", never under `/api/`), e.g. a conversation.
 *
 * A message counts only when it comes from the frame the host is reading for (`source`) and from
 * this origin; anything else, an unknown type, or a field of the wrong shape is ignored, so a
 * page that posts other things for its own reasons is never misread.
 */

export const LOCATION_MESSAGE = "penguin:location";
export const NAVIGATE_MESSAGE = "penguin:navigate";

/** A location inside an app longer than this is not one an address should carry. */
const MAX_AT = 2048;

export type FrameMessage = { type: "location"; at: string } | { type: "navigate"; to: string };

/** A location inside the app: a path starting with "/", and short enough for an address. */
export function innerLocationOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length > MAX_AT) return null;
  return raw;
}

/**
 * Where `to` takes the viewer inside this app (path, query and hash), or null when it is no path
 * of this app: another origin (`//host`, a scheme, a backslash a browser would read as one), or
 * the server's API.
 */
export function appPathOf(to: unknown, origin: string): string | null {
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//") || to.includes("\\"))
    return null;
  let url: URL;
  try {
    url = new URL(to, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The message `event` carries, when it is one of the two and comes from `frame` on `origin`;
 * null otherwise.
 */
export function frameMessageOf(
  event: Pick<MessageEvent, "data" | "origin" | "source">,
  frame: Window | null | undefined,
  origin: string,
): FrameMessage | null {
  if (frame === null || frame === undefined || event.source !== frame) return null;
  if (event.origin !== origin) return null;
  const data = event.data as { type?: unknown; at?: unknown; to?: unknown } | null;
  if (data === null || typeof data !== "object") return null;
  if (data.type === LOCATION_MESSAGE) {
    const at = innerLocationOf(data.at);
    return at === null ? null : { type: "location", at };
  }
  if (data.type === NAVIGATE_MESSAGE) {
    const to = appPathOf(data.to, origin);
    return to === null ? null : { type: "navigate", to };
  }
  return null;
}

/** Tells the frame to go to `at` inside itself. */
export function postLocation(frame: Window | null | undefined, at: string, origin: string): void {
  try {
    frame?.postMessage({ type: LOCATION_MESSAGE, at }, origin);
  } catch {
    // The frame is gone or navigated elsewhere; nothing to tell.
  }
}
