/**
 * The last stop on each of the dismissible update trails: one notice directly under the page
 * title saying what is waiting, the control that acts on all of it at once, and the control that
 * puts the dot down.
 *
 * It exists because those trails can end in a decision not to act — a model table kept off the
 * catalog, an agent left on the generation it was tuned against, an error read and understood —
 * and a dot with no way down is a dot that stops meaning anything. What the trail already said in
 * every tooltip above is repeated here, so arriving confirms rather than re-explains.
 *
 * One shape on every page that has one: the same block in the same place, directly below the
 * `<h1>`, a {@link Notice} callout in the `attention` tone — "unfinished: waiting on time, a queue
 * or the user" is exactly what every trail is. Not `danger`, which means failed, destructive or
 * over a limit; a copy with a newer version in the library is none of those.
 *
 * The update dot stays inside the block, in the fill it carried down the trail, so the notice
 * reads as "this is that dot": the dot is the trail's identity and the tone is the notice's
 * shape. It is decorative — the sentence beside it is the carrier, and each button folds that
 * sentence into its own accessible name, keeping its visible label as the prefix.
 *
 * The bulk action is optional, and its absence is meaningful: a page that can act on everything
 * the notice counts passes `actionLabel`, one where there is nothing to update (an error that
 * has already happened) passes none and shows the dismiss control alone. `onAction` opens the
 * page's confirmation rather than writing: a bulk overwrite is consented to before it runs.
 *
 * The top margin is built in: every page wants the same gap under its title. A page whose
 * container spaces its children overrides it, which is the right answer there too.
 */
import { UPDATE_DOT_INLINE } from "../../icons/update-dot/update-dot";
import { Notice } from "../notice/notice";

export function TodoNotice({
  text,
  actionLabel,
  onAction,
  busy = false,
  dismissLabel,
  onDismiss,
}: {
  /** What is waiting — the trail's own sentence, unchanged from the dot's tooltip. */
  text: string;
  /** The bulk action's wording, on the pages that have one. */
  actionLabel?: string;
  /**
   * Opens the page's confirmation for updating everything the notice counts. Not the write
   * itself: a bulk overwrite is consented to before it runs, never after.
   */
  onAction?: () => void;
  /** Disables both controls while the confirmed batch is in flight. */
  busy?: boolean;
  /** The clearing action's wording; "mark as read" where nothing is being updated. */
  dismissLabel: string;
  onDismiss: () => void;
}) {
  const offersAction = actionLabel !== undefined && onAction !== undefined;
  return (
    <Notice
      tone="attention"
      variant="callout"
      className="mt-3"
      glyph={<span className={`block shrink-0 ${UPDATE_DOT_INLINE}`} />}
      dismiss={{
        label: dismissLabel,
        ariaLabel: `${dismissLabel} · ${text}`,
        onClick: onDismiss,
        disabled: busy,
      }}
      {...(offersAction
        ? {
            action: {
              label: actionLabel,
              ariaLabel: `${actionLabel} · ${text}`,
              onClick: onAction,
              disabled: busy,
            },
          }
        : {})}
    >
      {text}
    </Notice>
  );
}
