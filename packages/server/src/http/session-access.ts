/**
 * Who may read a Session, and what a refusal says — the one rule every Session route resolves
 * its Session by.
 *
 * A Session that does not exist is 404 `session_not_found`. One the caller may not read is 404
 * too, so its existence is not revealed — except to an admin, who is answered 403
 * `session_forbidden`. A hub reads its machines as their admin, and drops its copy of a Session
 * the machine says does not exist: a refusal must not read as a deletion.
 */
import type { SessionRow } from "../db/repos/sessions.js";
import type { Access } from "../mechanisms/projects.js";
import { HttpError } from "./errors.js";

/** `row` (the Session the path names, or null), for a caller who may read it; else the refusal. */
export function readableSession(
  row: SessionRow | null,
  user: { userId: string; isAdmin?: boolean },
  access: Pick<Access, "requireProjectAccess">,
): SessionRow {
  const missing = () =>
    new HttpError(404, "session_not_found", "Session does not exist or you do not have access.");
  if (row === null) throw missing();
  try {
    access.requireProjectAccess(user.userId, row.projectId);
  } catch {
    if (user.isAdmin === true) {
      throw new HttpError(403, "session_forbidden", "This account may not read this Session.");
    }
    throw missing();
  }
  return row;
}
