/**
 * The folded values of a history window, unfolded on demand. A window carries a bulky value (a
 * tool's output, a long argument, a thinking block) as a preview, and the whole of it is fetched
 * the moment the reader opens its row: the note below sits in the row's body, which is mounted
 * only while the row is open, so mounting it is the fetch's start.
 *
 * While the values come over the note is the transfer row (after a second, so a local fetch never
 * flashes it); a fetch that failed is the shared retry row, stopped, its failure said inline in the
 * sentence (never behind a "?") and a Retry as text. When the values are in place the row shows
 * them instead of the preview, and the note is gone.
 *
 * The loader reaches the rows through a context the message stream provides, so the subagents
 * panel's stream, which renders the same rows, unfolds them the same way.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { RetryStatus, TransferProgress, useElapsedPast } from "@prismshadow/penguin-ui";
import { elidedRecordsOf } from "../../lib/amsp/stream-model";
import type { ThinkingItem, ToolCallItem } from "../../lib/amsp/stream-model";
import { transferAmount } from "../../lib/history/transfer-amount";
import { S } from "../../lib/strings";
import type { ElidedBodies } from "./use-session-stream";

/** How long a fetch may take before its progress shows. */
const QUIET_MS = 1_000;

export const ElidedBodiesContext = createContext<ElidedBodies | null>(null);

/** Whether a row has a note to carry: values still folded, or a fetch of them under way. */
export function hasElidedNote(item: ToolCallItem | ThinkingItem): boolean {
  return item.bodyLoad !== undefined || elidedRecordsOf(item).length > 0;
}

export function ElidedBodyNote({ item }: { item: ToolCallItem | ThinkingItem }) {
  const bodies = useContext(ElidedBodiesContext);
  // Mounted only while the row is open: the reader opened it.
  useEffect(() => {
    bodies?.load(item);
  }, [bodies, item]);
  const [since] = useState(() => Date.now());
  const load = item.bodyLoad;
  const past = useElapsedPast(load !== undefined ? since : undefined, QUIET_MS);
  const words = S.chat.historyTransfer;
  if (load !== undefined && load.error !== null) {
    return (
      // The reason rides in the sentence; once the shared row places a reason inline
      // (`reasonPlacement="inline"`), it moves to `reason` and the sentence is the phrase alone.
      <RetryStatus
        phase="gaveUp"
        label={words.bodyFailed(load.error)}
        retry={{ label: S.common.retry, onClick: () => bodies?.load(item) }}
      />
    );
  }
  if (load === undefined || !past) return null;
  return (
    <TransferProgress
      label={words.body}
      amount={transferAmount(load.doneBytes, load.totalBytes)}
      {...(load.totalBytes > 0 ? { value: load.doneBytes, max: load.totalBytes } : {})}
    />
  );
}
