/**
 * The breakdown of a statistic's total, behind a circled "?" right of the reading.
 *
 * A hover hint opens only on an element with no visible text of its own or with text cut off, so
 * one on a fully visible reading never opens, and a breakdown written into it silently goes
 * missing. The breakdown sits behind a "?" beside the total instead: `StatHint` is that mark, and
 * the rows below are what it opens — a cost's three priced parts, an elapsed time's two measured
 * components. Only totals carry one; a per-round reading shows its total alone.
 */
import { Fragment } from "react";
import type { ReactNode } from "react";
import type { CostParts } from "@prismshadow/penguin-server/api";
import { InfoPopover } from "@prismshadow/penguin-ui";
import { formatMoney, formatPercent, humanizeDuration } from "../../lib/format";
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

/**
 * A breakdown's rows: each part's name, its value, and its share of the total it breaks down —
 * columns, so the values and the shares each line up. A share is omitted when the total is zero.
 */
export function HintRows({
  rows,
  total,
  className = "",
}: {
  rows: ReadonlyArray<readonly [name: string, value: string, amount: number]>;
  /** What the shares are of. */
  total: number;
  className?: string;
}) {
  return (
    <dl className={`grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 ${className}`}>
      {rows.map(([name, value, amount]) => (
        <Fragment key={name}>
          <dt>{name}</dt>
          <dd className="text-right font-mono tabular-nums text-fg">{value}</dd>
          <dd className="text-right font-mono tabular-nums">
            {total > 0 ? `(${formatPercent(amount / total)})` : ""}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * A cost's three priced parts (cached input, uncached input, output), each with its share of
 * their sum — the cost they make up. `uncosted` adds the note that explains the total's `*`:
 * usage on an unpriced model is not in the figure.
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
        total={parts.cacheRead + parts.cacheWrite + parts.output}
        rows={[
          [S.chat.costPartCacheRead, formatMoney(parts.cacheRead, currency), parts.cacheRead],
          [S.chat.costPartCacheWrite, formatMoney(parts.cacheWrite, currency), parts.cacheWrite],
          [S.chat.costPartOutput, formatMoney(parts.output, currency), parts.output],
        ]}
      />
      {uncosted && <p className="mt-2">{S.usage.uncostedNote}</p>}
    </div>
  );
}

/**
 * An elapsed time's model API time and tool wall time, each with its share of `totalMs`. They are
 * two measurements of the same span, not a split of it — a background tool overlaps the model's
 * decoding, and approval waits belong to neither — so the shares need not add up to 100%.
 */
export function ElapsedSplitRows({
  apiMs,
  toolMs,
  totalMs,
  className = "",
}: {
  apiMs: number;
  toolMs: number;
  totalMs: number;
  className?: string;
}) {
  return (
    <HintRows
      className={className}
      total={totalMs}
      rows={[
        [S.chat.statApiTime, humanizeDuration(apiMs), apiMs],
        [S.chat.statToolTime, humanizeDuration(toolMs), toolMs],
      ]}
    />
  );
}
