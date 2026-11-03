/**
 * Which approval modes the composer's picker offers for a Session.
 *
 * An organization's Session — a desk, a ticket session, or a sub-session one of them spawned,
 * every one stamped `client: "org"` — runs with nobody watching, so the server denies on the
 * spot any call its approval mode would hand to a person. There, `always-ask` does not ask:
 * it denies every call that needs approval. The picker leaves it out for such a Session, as
 * the organization settings do. The test is the row's `client` stamp alone, because that is
 * the one the server's denial reads.
 *
 * A Session that already stores `always-ask` (written through the API, or before the picker
 * stopped offering it) keeps the entry while it is the current value, so the open menu shows
 * the mode in effect ticked instead of a list with nothing selected. Picking any other mode
 * drops it from the list.
 */
import type { ApprovalMode, SessionInfo } from "@prismshadow/penguin-server/api";

/** Every approval mode, in the picker's order. */
export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "always-ask",
  "read-only",
  "allow-all",
  "deny-all",
];

/** The modes the picker lists for a Session with this `client` stamp whose mode is `current`. */
export function approvalModeChoices(
  client: SessionInfo["client"],
  current: ApprovalMode,
): readonly ApprovalMode[] {
  if (client !== "org") return APPROVAL_MODES;
  return APPROVAL_MODES.filter((mode) => mode !== "always-ask" || mode === current);
}
