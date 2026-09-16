/**
 * What a desk-renewal confirm has to send, decided on its own so it can be unit tested
 * without the dialog around it.
 *
 * The dialog merges two writes into one action: the workspace field is prefilled with the
 * employee's current spec, and a renewal that leaves it alone must not rewrite the chart file
 * — a PATCH would re-validate and re-create the directory for no change the reader asked for.
 * The comparison is on the trimmed text, so re-typing the same spec with a stray space is
 * still "unchanged". An empty field is refused here rather than sent as `.`, because clearing
 * a workspace is a different intent from renewing a desk and the field is required.
 */

export interface DeskRenewPlan {
  /** False when the field is empty: the dialog refuses and sends nothing at all. */
  valid: boolean;
  /** The workspace to PATCH before renewing, or null when the spec is unchanged. */
  workspace: string | null;
}

export function deskRenewPlan(current: string, typed: string): DeskRenewPlan {
  const next = typed.trim();
  if (next === "") return { valid: false, workspace: null };
  return { valid: true, workspace: next === current.trim() ? null : next };
}
