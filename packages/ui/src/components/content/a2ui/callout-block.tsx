/**
 * A callout: a short passage set apart in its tone — a note, a tip, a caution, a warning — drawn as
 * the blocks' tone note: one row, the tone's mark beside the text, the model's title (if any)
 * leading it in the same line.
 */
import type { A2uiCallout } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import { A2uiNote } from "./parts";

export function CalloutBlock({ spec }: { spec: A2uiCallout }) {
  const strings = useUiStrings().a2ui;
  return (
    <div className="a2ui-block my-3" data-a2ui="callout">
      <A2uiNote
        tone={spec.tone}
        {...(spec.title !== undefined ? { title: spec.title } : {})}
        text={spec.text}
        strings={strings}
      />
    </div>
  );
}
