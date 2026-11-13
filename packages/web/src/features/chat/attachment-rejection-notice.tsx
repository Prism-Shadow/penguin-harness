/**
 * The composer's refusal notice: the picks the upload limits rejected, kept on screen.
 *
 * A refused pick used to raise a toast, and the toast is exactly what made the refusal silent:
 * it leaves on its own after a few seconds, and it lives in a region with no `role` at all, so
 * anyone who looks late — or asks the page what it just announced — finds nothing, as if the
 * file had simply vanished. The Files panel keeps its oversize wording on screen for the same
 * reason; the composer now does too, one sentence per refused file, each naming the file and
 * the ceiling that refused it.
 *
 * The lines are the caller's: the composer's two intakes build them from
 * `S.chat.attachmentTooLarge`, so the words — file name, ceiling, both interface languages —
 * stay with the rest of the chat copy and this component stays layout-only. The notice is
 * `alert` rather than `status`: the file the user just picked is not going anywhere, and that
 * must be heard the moment it happens, not the next time the reader idles. It stays until the
 * next pick, a successful send, or the cross — the three moments the refusal stops being news.
 */
import { Notice } from "@prismshadow/penguin-ui";

export function AttachmentRejectionNotice({
  lines,
  onClear,
}: {
  /** One sentence per refused file, in pick order; never empty (the caller mounts on that). */
  lines: readonly string[];
  /** The cross: the composer drops its refusal state. */
  onClear: () => void;
}) {
  return (
    <Notice tone="danger" role="alert" className="anim-fade mb-1" dismiss={{ onClick: onClear }}>
      {lines.join(" ")}
    </Notice>
  );
}
