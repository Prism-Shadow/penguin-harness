/**
 * The last stop on each of the three DISMISSIBLE trails: a notice directly under the page
 * title saying what is waiting, plus the control that puts the dot down.
 *
 * It exists because those trails, unlike the software and kernel ones, can end in a decision
 * NOT to act — a model table kept off the catalog, an error read and understood — and a dot
 * with no way down is a dot that stops meaning anything. What the trail was already saying in
 * every tooltip above is repeated here verbatim, so arriving confirms rather than re-explains.
 *
 * **One shape on all three pages**, owner-specified: same block, same place, directly below the
 * `<h1>`. The Skills library, the model library and the cost center were three different
 * shapes before, and a reader who had learned one had learned nothing about the next.
 *
 * `toneStrip.attention` is the tone by its own definition — "unfinished: waiting on time, a
 * queue, or the user" is exactly what all three trails are — and by its own shape, since
 * `toneStrip` is the map for a bordered notice that owns a row. Not `danger`, which means
 * failed, destructive or over a limit: a Skill with a newer copy in the library is none of
 * those. The class string is the one the other attention strips already use
 * (`prompt-injection-controls.tsx`, `memory-tab.tsx`).
 *
 * The 6px red dot stays INSIDE the block, in the same fill it carried down the trail
 * (`update-dot.tsx`), so the notice reads as "this is that dot": red is the trail's identity
 * and amber is the notice's shape. It is decorative — the sentence beside it is the carrier,
 * and the button folds that sentence into its own accessible name, keeping its visible label as
 * the prefix.
 *
 * The top margin is built in rather than left to the caller: three pages place this and all
 * three want the same gap under their title. A page whose container spaces its children (the
 * cost center's `space-y-4`) overrides it, which is the right answer there too.
 */
import { Button } from "./button";
import { UPDATE_DOT_INLINE } from "./update-dot";
import { ICON_GAP } from "../../lib/icon-scale";
import { toneStrip } from "../../lib/tone";

export function TodoNotice({
  text,
  dismissLabel,
  onDismiss,
}: {
  /** What is waiting — the trail's own sentence, unchanged from the dot's tooltip. */
  text: string;
  /** The clearing action's wording; "mark as read" where nothing is being updated. */
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`mt-3 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${toneStrip.attention}`}
    >
      <p className={`flex min-w-0 items-center text-xs ${ICON_GAP.menu}`}>
        <span aria-hidden className={`shrink-0 ${UPDATE_DOT_INLINE}`} />
        <span className="min-w-0">{text}</span>
      </p>
      <Button
        size="sm"
        className="shrink-0"
        aria-label={`${dismissLabel} · ${text}`}
        onClick={onDismiss}
      >
        {dismissLabel}
      </Button>
    </div>
  );
}
