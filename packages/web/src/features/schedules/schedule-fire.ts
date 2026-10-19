/**
 * Manual fire (fireSchedule) display helpers: session-id shortening and fire-error text.
 *
 * NOTE (received 2026-10-19): first written as a build-unblocking stand-in for the
 * fire session's missing module (same two signatures its three call sites use), then
 * adopted as the real one when that work was taken over — semantics verified against
 * ApiError's envelope codes and the fire button end-to-end.
 */
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";

/**
 * Short session-id suffix for fire toasts (ids end in a hex run — the tail is the
 * distinctive part). Same rule as shortSessionId in chat/agent-topology.ts, kept local so
 * this module stands alone; the owner may unify them.
 */
export function shortSession(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(-8) : sessionId;
}

/**
 * Fire error → display text: a 404 without the server's error envelope means this page is
 * newer than the deployed server (no /fire route yet — restart to take effect); anything
 * else goes through the standard code → localized-text mapping.
 */
export function fireErrorText(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.status === 404 &&
    (err.code === "http_error" || err.code === "not_the_server")
  ) {
    return S.schedule.fireStaleServer;
  }
  return apiErrorText(err);
}
