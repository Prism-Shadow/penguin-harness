/** The per-task chart (waffle.yaml). Placeholder: replaced by the full chart. */
import type { WaffleChart as WaffleData } from "../../../lib/hub/types";
import type { NameOf } from "./entry-name";

export function WaffleChart({
  chart,
  nameOf,
}: {
  chart: WaffleData;
  nameOf: NameOf;
  taskTitles: Record<string, string>;
}) {
  return (
    <ul>
      {chart.entries.map((entry, index) => (
        <li key={entry.key}>
          {nameOf(entry).method} {chart.rows[index]?.scores.flat().length ?? 0}
        </li>
      ))}
    </ul>
  );
}
