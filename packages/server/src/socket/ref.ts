/**
 * The API socket's reference on the runtime's websocket seam.
 *
 * The runtime owns the handshake: `GET /api/socket` (Upgrade, api/types.ts's
 * `API_SOCKET_PATH`) authenticates the session cookie, checks the Origin, and hands the live
 * socket to the platform's `attachStream`. What it hands over is one of two references: a
 * pty's `TerminalSession`, or this one — the API socket's, naming the user the cookie proved
 * and saying that is what it is. It carries no terminal id and stands for no terminal, so
 * nothing downstream can mistake it for one.
 */
import type { TerminalSession } from "../terminal/session.js";

export { apiSocketPath } from "../api/types.js";

/** The API socket's reference: the user the handshake authenticated, and that this is that socket. */
export interface ApiSocketRef {
  apiSocket: true;
  ownerUserId: string;
}

/** What the platform's websocket seam is handed: a pty's session, or the API socket's user. */
export type AttachedStream = TerminalSession | ApiSocketRef;

/** The reference for a handshake authenticated as `userId`. */
export function apiSocketRef(userId: string): ApiSocketRef {
  return { apiSocket: true, ownerUserId: userId };
}

export const isApiSocketRef = (attached: object): attached is ApiSocketRef =>
  "apiSocket" in attached && (attached as { apiSocket: unknown }).apiSocket === true;
