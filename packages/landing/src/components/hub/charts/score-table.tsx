/** The ranking chart (table.yaml). Placeholder: replaced by the full chart. */
import type { LeaderboardEntry } from "../../../lib/hub/types";
import type { NameOf } from "./entry-name";

export function ScoreTable({
  entries,
  nameOf,
}: {
  entries: readonly LeaderboardEntry[];
  nameOf: NameOf;
}) {
  return (
    <ol>
      {[...entries]
        .sort((a, b) => b.value - a.value)
        .map((entry) => (
          <li key={entry.key}>
            {nameOf(entry).method} {entry.value.toFixed(1)}
          </li>
        ))}
    </ol>
  );
}
