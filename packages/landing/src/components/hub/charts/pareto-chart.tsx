/** The score-against-cost chart (pareto.yaml). Placeholder: replaced by the full chart. */
import type { LeaderboardEntry } from "../../../lib/hub/types";
import type { NameOf } from "./entry-name";

export function ParetoChart({
  entries,
  nameOf,
}: {
  entries: readonly LeaderboardEntry[];
  nameOf: NameOf;
}) {
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.key}>
          {nameOf(entry).method} {entry.value.toFixed(1)} ${entry.cost.toFixed(2)}
        </li>
      ))}
    </ul>
  );
}
