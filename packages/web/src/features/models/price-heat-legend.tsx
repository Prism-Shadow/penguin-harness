/**
 * The price dot's legend, behind the models page title's "?": what the dot encodes, and the ramp
 * itself as a stepped strip — twelve swatches sampled from the same mix the cards paint — with
 * the level words over the stretches they name, and the two bounds and the midpoint in the
 * display currency. Swatches, not a gradient bar: a component paints no gradient, and a strip of
 * the very colours the cards wear is the more honest key anyway.
 */
import { heatColor } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { Currency } from "../../state/theme";
import { displayPrice, roughPrice } from "./price-format";
import {
  PRICE_HEAT_BOUNDS_USD,
  PRICE_LEVELS,
  PRICE_LEVEL_BREAKPOINTS_USD,
  heatPosition,
} from "./price-heat";

/** Enough steps to read as a ramp, few enough that each swatch is still a swatch (~20 px). */
const SWATCHES = 12;

export function PriceHeatLegend({ currency }: { currency: Currency }) {
  const { cool, hot } = PRICE_HEAT_BOUNDS_USD;
  // Each level word sits over the stretch of the ramp its prices occupy.
  const edges = [0, ...PRICE_LEVEL_BREAKPOINTS_USD.map(heatPosition), 1];
  const levelColumns = PRICE_LEVELS.map((_, i) => `${edges[i + 1]! - edges[i]!}fr`).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-fg">{S.models.priceHeatLegendTitle}</span>
        <span className="text-fg-subtle">{S.models.priceUnitShort}</span>
      </div>
      <p>{S.models.priceHeatLegendBody}</p>
      <div className="flex flex-col gap-1">
        <div className="grid text-center" style={{ gridTemplateColumns: levelColumns }}>
          {PRICE_LEVELS.map((level) => (
            <span key={level}>{S.models.priceHeatLevel[level]}</span>
          ))}
        </div>
        <div aria-hidden className="flex h-2 gap-px overflow-hidden rounded-xs">
          {Array.from({ length: SWATCHES }, (_, i) => (
            <span
              key={i}
              className="flex-1"
              style={{ backgroundColor: heatColor((i + 0.5) / SWATCHES) }}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 tabular-nums">
          <span>≤ {displayPrice(String(cool), currency)}</span>
          <span className="text-center">{roughPrice(Math.sqrt(cool * hot), currency)}</span>
          <span className="text-right">≥ {displayPrice(String(hot), currency)}</span>
        </div>
      </div>
    </div>
  );
}
