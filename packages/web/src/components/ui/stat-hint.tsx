/**
 * The breakdown of a statistic's total, behind a circled "?" right of the reading.
 *
 * A hover hint opens only on an element with no visible text of its own or with text cut off, so
 * one on a fully visible reading never opens, and a breakdown written into it silently goes
 * missing. The breakdown sits behind a "?" beside the total instead: `StatHint` is that mark, and
 * the rows below are what it opens — a cost's three priced parts, an elapsed time's two measured
 * components. Only totals carry one; a per-round reading shows its total alone.
 */
import type { ReactNode } from "react";
import type { CostParts } from "@prismshadow/penguin-server/api";
import { InfoPopover } from "@prismshadow/penguin-ui";
import { formatMoney, humanizeDuration } from "../../lib/format";
import { S } from "../../lib/strings";
import type { Currency } from "../../state/theme";

/** The "?" right of a total that `label` names: hovering opens the breakdown, a click pins it. */
export function StatHint({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <InfoPopover label={label} className={`shrink-0 ${className}`}>
      {children}
    </InfoPopover>
  );
}

/** A breakdown's rows: each part's name on the left, its value on the right in tabular figures. */
export function HintRows({
  rows,
  className = "",
}: {
  rows: ReadonlyArray<readonly [string, string]>;
  className?: string;
}) {
  return (
    <dl className={className}>
      {rows.map(([name, value]) => (
        <div key={name} className="flex items-baseline justify-between gap-3">
          <dt>{name}</dt>
          <dd className="font-mono tabular-nums text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A cost's three priced parts (cached input, uncached input, output), which sum to it. `uncosted`
 * adds the note that usage on an unpriced model is not in the figure.
 */
export function CostPartsRows({
  parts,
  currency,
  uncosted = false,
  className = "",
}: {
  parts: CostParts;
  currency: Currency;
  uncosted?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <HintRows
        rows={[
          [S.chat.costPartCacheRead, formatMoney(parts.cacheRead, currency)],
          [S.chat.costPartCacheWrite, formatMoney(parts.cacheWrite, currency)],
          [S.chat.costPartOutput, formatMoney(parts.output, currency)],
        ]}
      />
      {uncosted && <p className="mt-2">{S.usage.uncostedNote}</p>}
    </div>
  );
}

/**
 * An elapsed time's model API time and tool wall time. They are two measurements of the same span,
 * not a split of it — a background tool overlaps the model's decoding, and approval waits belong
 * to neither — so the note under them says not to add them up.
 */
export function ElapsedSplitRows({
  apiMs,
  toolMs,
  className = "",
}: {
  apiMs: number;
  toolMs: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <HintRows
        rows={[
          [S.chat.statApiTime, humanizeDuration(apiMs)],
          [S.chat.statToolTime, humanizeDuration(toolMs)],
        ]}
      />
      <p className="mt-2">{S.chat.statElapsedSplitNote}</p>
    </div>
  );
}
