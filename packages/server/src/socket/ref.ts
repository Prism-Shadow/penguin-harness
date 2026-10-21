/**
 * The API socket's reference on the runtime's websocket seam.
 *
 * The runtime owns the handshake: `GET /api/socket` (Upgrade, api/types.ts's
 * `API_SOCKET_PATH`) authenticates the session cookie, checks the Origin, and hands the live
 * socket to the platform's `attachStream` with a reference naming the signed-in user — the
 * shape a pty's reference already has, so one `attachStream` serves both. The API socket
 * protocol (socket/serve.ts) is served for that reference; no terminal is created, listed or
 * touched, and no terminal id is involved.
 */
import type { TerminalSession } from "../terminal/session.js";

export { apiSocketPath } from "../api/types.js";

/** The reference `attachStream` receives for a socket handshake. */
export interface ApiSocketRef {
  id: string;
  ownerUserId: string;
  apiSocket: true;
}

/** The reference for a handshake authenticated as `userId`. */
export function apiSocketSession(userId: string): TerminalSession {
  const ref: ApiSocketRef = { id: `api-socket@${userId}`, ownerUserId: userId, apiSocket: true };
  return ref as unknown as TerminalSession;
}

export const isApiSocketRef = (session: object): session is ApiSocketRef =>
  "apiSocket" in session && (session as { apiSocket: unknown }).apiSocket === true;
