/**
 * A list loading: `rows` row-height placeholder blocks — the fork-line ui package's
 * `SkeletonList`, kept beside these pages so the file panel's wait draws the shape its rows
 * will take; the blocks share the ui package's `Skeleton` (its `data-skeleton` marks them to
 * the theme sheet).
 */
import { Skeleton } from "@prismshadow/penguin-ui";

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
