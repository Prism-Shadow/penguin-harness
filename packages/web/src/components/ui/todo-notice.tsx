/**
 * The last stop on each of the four DISMISSIBLE trails: one notice directly under the page
 * title saying what is waiting, the control that acts on all of it at once, and the control
 * that puts the dot down.
 *
 * It exists because those trails, unlike the software one, can end in a decision NOT to act — a
 * model table kept off the catalog, an Agent left on the generation it was tuned against, an
 * error read and understood — and a dot with no way down is a dot that stops meaning anything.
 * What the trail was already saying in every tooltip above is repeated here, so arriving
 * confirms rather than re-explains.
 *
 * **One shape on all four pages**, owner-specified: same block, same place, directly below the
 * `<h1>`. The Skills library, the model library and the cost center were three different shapes
 * before, and a reader who had learned one had learned nothing about the next.
 *
 * `toneStrip.attention` is the tone by its own definition — "unfinished: waiting on time, a
 * queue, or the user" is exactly what all four trails are — and by its own shape, since
 * `toneStrip` is the map for a bordered notice that owns a row. Its pale amber ground is the
 * block's requested pale yellow, arrived at through the token rather than around it. Not
 * `danger`, which means failed, destructive or over a limit: a Skill with a newer copy in the
 * library is none of those, and repainting a failure strip this colour to match would lose the
 * one distinction the tones exist to carry.
 *
 * The 6px red dot stays INSIDE the block, in the same fill it carried down the trail
 * (`update-dot.tsx`), so the notice reads as "this is that dot": red is the trail's identity
 * and amber is the notice's shape. It is decorative — the sentence beside it is the carrier,
 * and each button folds that sentence into its own accessible name, keeping its visible label
 * as the prefix.
 *
 * **The bulk action is optional, and its absence is meaningful.** Three pages can act on
 * everything the notice counts, and pass `actionLabel`; the cost center cannot — there is no
 * "update" for an error that has already happened — so it passes none and the block renders the
 * single button it always had. A page that offers the action must confirm before it runs
 * (`onAction` is expected to open a dialog, not to write): the point of the button is that it
 * overwrites many objects in one press, and every one of these pages already warns before
 * overwriting a single one.
 *
 * The top margin is built in rather than left to the caller: four pages place this and all four
 * want the same gap under their title. A page whose container spaces its children (the cost
 * center's `space-y-4`) overrides it, which is the right answer there too.
 */
import { Button } from "./button";
import { UPDATE_DOT_INLINE } from "./update-dot";
import { ICON_GAP } from "../../lib/icon-scale";
import { toneStrip } from "../../lib/tone";

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
  /**
   * The bulk action's wording, on the pages that have one. Omitted on the cost center, where
   * nothing is being updated; the block then shows the dismiss control alone.
   */
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
    <div
      className={`mt-3 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${toneStrip.attention}`}
    >
      <p className={`flex min-w-0 items-center text-xs ${ICON_GAP.menu}`}>
        <span aria-hidden className={`shrink-0 ${UPDATE_DOT_INLINE}`} />
        <span className="min-w-0">{text}</span>
      </p>
      {/* The update sits to the RIGHT of the dismiss, which is where every ConfirmModal in the
          app puts its confirm and where the dialog this button opens will put it a moment later.
          Ordering the pair the other way would place the affirmative action in the slot the
          whole app uses for Cancel. */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          aria-label={`${dismissLabel} · ${text}`}
          onClick={onDismiss}
        >
          {dismissLabel}
        </Button>
        {offersAction && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            aria-label={`${actionLabel} · ${text}`}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
