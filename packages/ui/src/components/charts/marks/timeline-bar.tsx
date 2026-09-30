/**
 * A Trace timeline bar: the HTML twin of ChartBar, for the lanes the Trace view lays out with
 * absolutely positioned spans. The chart places it (`place`: left and width along the lane)
 * and says what it is (`paint`); the theme decides how it looks — its colour, corner radius,
 * outline (drawn inside the box, so it never changes the bar's size or position) and fill
 * opacity (applied to the fill alone, so a dimmed bar's own opacity class still works).
 *
 * Everything else a lane needs from a bar — the pointer handlers, the jump on click, the
 * accessible name of a data mark, a ring for a failure, a fade while another mark is singled
 * out — passes through. The bar itself holds still: a bar that is still open is marked by the
 * chart with a live state dot at its end, not by moving the bar.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { useChartStyle } from "../chart-style";
import { resolvePaint } from "./marks";
import type { ChartPaint } from "./marks";

export function TimelineBar({
  paint,
  place,
  className = "",
  ...rest
}: {
  paint: ChartPaint;
  /** Where the bar sits along its lane (left / width / margin), from the chart's time scale. */
  place: CSSProperties;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "style" | "color">) {
  const chart = useChartStyle();
  const { color, className: ink } = resolvePaint(chart, paint);
  // A paint with an ink class carries its colour as a background class (`swatch`); the mark
  // itself only ever sets the fill here.
  const fillClass = "ink" in paint ? (paint.swatch ?? "") : "";
  const fill =
    color === undefined
      ? undefined
      : chart.barOpacity < 1
        ? `color-mix(in srgb, ${color} ${Math.round(chart.barOpacity * 100)}%, transparent)`
        : color;
  const outlineColor =
    chart.barStrokeColor === "series" ? (color ?? "currentColor") : chart.barStrokeColor;
  const style: CSSProperties = {
    ...place,
    ...(fill !== undefined ? { backgroundColor: fill } : {}),
    ...(chart.barRadius > 0 ? { borderRadius: chart.barRadius } : {}),
    ...(chart.barStroke > 0
      ? { boxShadow: `inset 0 0 0 ${chart.barStroke}px ${outlineColor}` }
      : {}),
  };
  return (
    <span
      data-part="bar"
      {...("series" in paint ? { "data-series": paint.series + 1 } : {})}
      {...rest}
      // The ink class (text-*) makes currentColor the bar's colour, for an outline in it.
      className={`absolute inset-y-0 min-w-[2px] ${fillClass} ${ink} ${className}`.trim()}
      style={style}
    />
  );
}
