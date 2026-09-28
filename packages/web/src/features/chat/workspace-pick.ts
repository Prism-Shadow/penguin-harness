/**
 * dirToCommit: which directory the workspace picker's "Use this dir" button commits.
 *
 * The picker holds two paths at once: the directory it has LISTED (the last listDirs response)
 * and the path box's draft. Typing only changes the draft; the box commits it on Enter or blur,
 * and that commit is a request. Clicking the button blurs the box first, so the commit is always
 * still in flight when the click lands — a button that read the listed directory committed the
 * one shown BEFORE the edit (the server's home directory on a fresh picker), with nothing on
 * screen saying so. What the box says is what the person means, so a draft that differs from
 * the listing wins and has to be resolved before it is used.
 */
export type DirToCommit =
  /** The listed directory: already resolved by the server, use it as is. */
  | { kind: "listed"; path: string }
  /** A typed path the server has not confirmed yet: resolve it, then use what comes back. */
  | { kind: "typed"; path: string };

/** `null` = nothing to commit (no listing yet and an empty box): the button is disabled. */
export function dirToCommit(draft: string, listedPath: string | undefined): DirToCommit | null {
  const typed = draft.trim();
  if (typed && typed !== listedPath) return { kind: "typed", path: typed };
  return listedPath === undefined ? null : { kind: "listed", path: listedPath };
}
