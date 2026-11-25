/**
 * A Session created for a first Task that was then refused or failed — goal mode on an Agent
 * without the goal plugin, a model with no credential, an attachment the server turned down, a
 * server error. It never ran, so it is discarded on the spot: removed from this tab's list
 * first, which also marks the id deleted, and only then deleted on the server.
 *
 * The order is the point. The server announces every new conversation to every tab of the
 * Project, the creating tab included, and the list answers with a reload that can read the
 * Session in the moment it existed and land after the delete. A deletion marked first is what
 * that late snapshot cannot get past (state/sessions.tsx, "Deleted stays deleted"); a delete
 * sent on its own, with nothing marked here, let the row come back as one that opens to "no
 * Session".
 *
 * The delete is best effort and never rejects. When it fails the row is still gone from this
 * tab; the server keeps a Session that never ran.
 */
export function discardUnstartedSession(
  sessionId: string,
  deps: {
    /** The list's own removal: drops the row and marks the id deleted. */
    remove: (sessionId: string) => void;
    deleteSession: (sessionId: string) => Promise<unknown>;
  },
): Promise<void> {
  deps.remove(sessionId);
  return deps.deleteSession(sessionId).then(
    () => undefined,
    () => undefined,
  );
}
