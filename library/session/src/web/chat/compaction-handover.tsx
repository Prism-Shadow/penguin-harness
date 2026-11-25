/**
 * A compaction row's hand-over section: the text the next context opened with in the summary's
 * place (CompactionItem.handover). That is either the hand-off note a compaction writes when it
 * gets no summary, or the Trace hand-over of a model switch that could not summarize. It stands
 * where the result section would, and a row that completed without a full summary never has that
 * section, so the two cannot meet. It is the same disclosure row as its siblings, closed by
 * default under a row that is itself closed once settled.
 *
 * The body gives three things in order:
 * - why there is no summary, in the degraded mark's own words;
 * - the Trace file the note names, when it names one;
 * - the note itself, as the new context opens with it.
 *
 * The note is protocol text in the harness's English, so it keeps the output block's
 * preformatted lines, and its height cap: a hand-off note quotes the conversation it replaces.
 * A path is one unbroken token, so the body wraps anywhere rather than scrolling sideways, and
 * every line stays plain, selectable text.
 */
import {
  DISCLOSURE_OUTPUT_CAP_CLASS,
  DISCLOSURE_OUTPUT_CLASS,
  DisclosureRow,
  StatusIcon,
} from "@prismshadow/penguin-ui";

import { S, handoverNoteText } from "@prismshadow/penguin-web/internal";
import type { CompactionHandover, CompactionItem } from "@prismshadow/penguin-web/internal";
import { compactionDegradedText } from "./compaction-degraded-hint";

/** What the section holds once opened: the reason, the Trace file, and the note. */
export function CompactionHandoverBody({
  item,
  handover,
}: {
  item: CompactionItem;
  handover: CompactionHandover;
}) {
  return (
    <div className={`${DISCLOSURE_OUTPUT_CLASS} wrap-anywhere`}>
      <p>{compactionDegradedText(item)}</p>
      {handover.tracePath !== undefined && (
        <p>{S.chat.compactionHandoverTrace(handover.tracePath)}</p>
      )}
      {/* A `<pre>` takes `white-space: pre` from the user-agent sheet, not the block's wrap. */}
      <pre
        className={`${DISCLOSURE_OUTPUT_CAP_CLASS} mt-2 whitespace-pre-wrap border-t border-line-muted pt-2`}
      >
        {handoverNoteText(handover.text)}
      </pre>
    </div>
  );
}

export function CompactionHandoverSection({
  item,
  handover,
}: {
  item: CompactionItem;
  handover: CompactionHandover;
}) {
  return (
    <DisclosureRow
      sticky
      activity={{ kind: "event", state: "done" }}
      icon={<StatusIcon state="done" label={S.chat.workDone} />}
      label={S.chat.compactionHandover}
    >
      <CompactionHandoverBody item={item} handover={handover} />
    </DisclosureRow>
  );
}
