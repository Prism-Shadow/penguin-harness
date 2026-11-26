/**
 * A compaction row's hand-over section: the Trace hand-over an in-session model switch opened the
 * next context with in the summary's place (CompactionItem.handover). It stands where the result
 * section would, and a row that completed without a full summary never has that section, so the
 * two cannot meet. It is the same disclosure row as its siblings, closed by default under a
 * row that is itself closed once settled.
 *
 * The body says why there is no summary in the degraded mark's own words, which Trace file the new
 * model reads the earlier history from, and then the note itself, as the new context opens with
 * it. The note is protocol text in the harness's English, so it keeps the output block's
 * preformatted lines. A path is one unbroken token, so the body wraps anywhere rather than
 * scrolling sideways, and every line stays plain, selectable text.
 */
import { DISCLOSURE_OUTPUT_CLASS, DisclosureRow, StatusIcon } from "@prismshadow/penguin-ui";

import { S } from "../../lib/strings";
import { compactionHandoverNote } from "../../lib/amsp/compaction-summary";
import type { CompactionHandover, CompactionItem } from "../../lib/amsp/stream-model";
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
      <pre className="mt-2 whitespace-pre-wrap border-t border-line-muted pt-2">
        {compactionHandoverNote(handover)}
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
