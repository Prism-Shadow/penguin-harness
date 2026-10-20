/**
 * The archive list's own row facts — pure, so they can be read (and tested) without the
 * component around them.
 */

/**
 * The time a conversation was filed away, when the server says it. The field is read
 * defensively: until the server carries it, the row falls back to the conversation's last
 * activity, and the moment the server does carry it, the archive list says when each
 * conversation was archived without another change there.
 */
export function archivedAtOf(s: { archivedAt?: string | null }): string | null {
  const value = s.archivedAt;
  return typeof value === "string" && value !== "" ? value : null;
}
