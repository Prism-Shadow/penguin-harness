/**
 * What both Storage review dialogs share: the review list's words, and the foot — how much is
 * chosen, the count and the size together, and the one danger button, Delete, off while nothing
 * is chosen or a delete runs. The confirm it opens is each dialog's own, since each says what
 * goes.
 */
import { Button } from "@prismshadow/penguin-ui";
import type { ReviewListLabels } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { formatSize } from "./storage-format";

/** The review list's words, read when a dialog renders (the dictionary follows the language). */
export function reviewLabels(): ReviewListLabels {
  return {
    selectAll: S.storage.selectAll,
    deselectAll: S.storage.deselectAll,
    count: S.storage.count,
    select: S.storage.select,
  };
}

export function ReviewFoot({
  count,
  bytes,
  busy,
  onDelete,
}: {
  count: number;
  bytes: number;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <>
      <span className="mr-auto self-center text-sm tabular-nums text-fg-muted">
        {S.storage.selected(count, formatSize(bytes))}
      </span>
      <Button size="sm" variant="danger" disabled={count === 0 || busy} onClick={onDelete}>
        {S.common.delete}
      </Button>
    </>
  );
}
