/**
 * The API socket's address on the terminal-stream upgrade seam (PRFC-0011).
 *
 * The runtime's WebSocket seam is `GET /api/terminals/<id>/stream`: it authenticates the
 * cookie, asks the platform's terminal manager for `<id>`, checks the owner is the signed-in
 * user, and hands the socket to the platform's `attachStream`. The API socket is one more
 * kind of id that lookup answers — `api-socket@<userId>` — the way a machine's pty already
 * is: the manager's `beyond` hook returns a reference carrying that owner, the runtime's
 * owner check holds it to the signed-in user, and `attachStream` serves the API socket
 * protocol for it instead of a pty. No terminal is created, listed or touched.
 */
import type { TerminalSession } from "../terminal/session.js";
import { API_SOCKET_ID_PREFIX as PREFIX } from "../api/types.js";

export { apiSocketPath } from "../api/types.js";

/** The reference `attachStream` receives for a socket handshake, in the shape the runtime's owner check reads. */
export interface ApiSocketRef {
  id: string;
  ownerUserId: string;
  apiSocket: true;
}

/** `api-socket@<userId>` → the reference; null for any other id. */
export function parseApiSocketRef(id: string): ApiSocketRef | null {
  let text = id;
  try {
    text = decodeURIComponent(id);
  } catch {
    return null;
  }
  if (!text.startsWith(PREFIX)) return null;
  const ownerUserId = text.slice(PREFIX.length);
  if (ownerUserId === "" || ownerUserId.includes("@")) return null;
  return { id: text, ownerUserId, apiSocket: true };
}

export const isApiSocketRef = (session: object): session is ApiSocketRef =>
  "apiSocket" in session && (session as { apiSocket: unknown }).apiSocket === true;

/** The reference typed as what the terminal manager's `beyond` hook returns. */
export function apiSocketSession(id: string): TerminalSession | undefined {
  const ref = parseApiSocketRef(id);
  return ref === null ? undefined : (ref as unknown as TerminalSession);
}
