/**
 * A callout: a short passage set apart in its tone — a note, a tip, a caution, a warning — drawn
 * as the package's callout notice, so every theme draws it the way it draws its other notices.
 * Its title is the model's, or the tone's name when it gave none; with a title of its own, the
 * tone's name is still read out before the text, since the tint and the mark are not.
 */
import type { A2uiCallout } from "@prismshadow/penguin-core/a2ui";
import { Notice } from "../../feedback/notice/notice";
import { useUiStrings } from "../../../strings";
import { A2UI_TONE, InlineText, toneName } from "./parts";

export function CalloutBlock({ spec }: { spec: A2uiCallout }) {
  const strings = useUiStrings().a2ui;
  const look = A2UI_TONE[spec.tone];
  const name = toneName(strings, spec.tone);
  return (
    <div className="a2ui-block my-3" data-a2ui="callout">
      <Notice
        tone={look.tone}
        variant="callout"
        glyph={look.glyph}
        title={spec.title !== undefined ? <InlineText text={spec.title} /> : name}
      >
        {spec.title !== undefined && <span className="sr-only">{`${name}: `}</span>}
        <InlineText text={spec.text} />
      </Notice>
    </div>
  );
}
