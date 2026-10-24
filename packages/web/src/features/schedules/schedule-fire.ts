/**
 * Display text for a manual fire's failure. One case is the caller's own: a 404 naming
 * the ROUTE as unknown (the app's generic `not_found` envelope, or no envelope at all
 * through a proxy) means the request never reached a server that knows manual firing —
 * so the reader is told the server is older than this page rather than shown a bare
 * "Not Found". The route's own 404s carry specific codes (schedule_not_found,
 * agent_not_found) and fall through to the usual code → localized text mapping.
 */
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";

export function fireErrorText(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.status === 404 &&
    (err.code === "not_found" || err.code === "http_error")
  ) {
    return S.schedule.fireStaleServer;
  }
  return apiErrorText(err);
}
