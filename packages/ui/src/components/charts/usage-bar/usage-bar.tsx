/**
 * A usage bar: how one total splits into its parts, as one horizontal stack — what a disk holds
 * by kind, a Project by Agent. Each part (`segments`) takes a share of the track proportional to
 * its value, end to end in the caller's order; a part of zero takes no room and has no segment,
 * and a part too small to see is held at a sliver (`USAGE_MIN_SHARE`), the others giving up the
 * room, so a part the legend names is never missing from the bar.
 *
 * The parts are identities (a kind, an Agent), not judgements, so each is painted with a palette
 * slot or the neutral ink the caller picks (`paint`), and every segment is a TimelineBar: the
 * theme draws it as it draws every bar (radius, outline, opacity), the joined ends square and the
 * stack's free ends rounded by the track it sits in. The track is the chart's grid part.
 *
 * Two sizes: `md`, the bar a page leads with, and `sm`, the thin one a list row carries beside
 * its name. A row of a list may set the scale (`max`): the track then stands for that value, so
 * the rows' bars compare at a glance and the rest of each track stays empty.
 *
 * With `legend`, a wrapping row of items sits under the bar, each the part's swatch and name with
 * its size (`display`, the caller's words) under it, and only parts that take room are listed.
 * Pointing at a segment or an item singles that part out: the others fade. A segment's own hover
 * hint names the part and its size, which a row with no legend shows nowhere else.
 *
 * For assistive technology the legend is the bar's text: the bar is then hidden, and the list
 * named by `label`. Without a legend the bar is an image named by `label` and its parts in words.
 */
import { useState } from "react";
import { ChartSwatch } from "../marks/marks";
import type { ChartPaint } from "../marks/marks";
import { TimelineBar } from "../marks/timeline-bar";
import type { TimelineBarJoin } from "../marks/timeline-bar";

/** One part of the total. */
export interface UsageSegment {
  /** Names the part to the highlight; stable across renders. */
  key: string;
  label: string;
  /** Its quantity (bytes, say); zero or less takes no room. */
  value: number;
  paint: ChartPaint;
  /** The value as the caller prints it ("1.6 GB"). */
  display: string;
}

export type UsageBarSize = "md" | "sm";

/** Where a part sits along the track: left edge and width, in percent. */
export interface UsagePlace {
  key: string;
  left: number;
  width: number;
}

/** The smallest share a part that has any value takes, in percent of the track, per size. */
export const USAGE_MIN_SHARE: Readonly<Record<UsageBarSize, number>> = { md: 0.75, sm: 2 };

/** What a part says to a screen reader between its neighbours, in any language. */
const PART_GAP = " · ";

const TRACK: Readonly<Record<UsageBarSize, string>> = { md: "h-2.5", sm: "h-1.5" };

/**
 * The parts' places along the track: proportional to their values, end to end in order, filling
 * `fill` percent of it (all of it by default). A part of zero or less takes no place. A part
 * whose share would fall under `minShare` is held at it, and the rest share what is left in
 * proportion — so a sliver stays visible however large its neighbours.
 */
export function usageBarPlaces(
  segments: readonly Pick<UsageSegment, "key" | "value">[],
  minShare = 0,
  fill = 100,
): UsagePlace[] {
  const shown = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (shown.length === 0 || !(fill > 0)) return [];
  // Never more floor than there is room for: n parts at most split the track evenly.
  const floor = Math.min(Math.max(0, minShare), 100 / shown.length);
  const pinned = new Set<number>();
  let widths: number[] = [];
  for (;;) {
    const free = shown.reduce((n, s, i) => (pinned.has(i) ? n : n + s.value), 0);
    const room = 100 - pinned.size * floor;
    widths = shown.map((s, i) => (pinned.has(i) ? floor : (s.value / free) * room));
    const under = widths.flatMap((w, i) => (!pinned.has(i) && w < floor ? [i] : []));
    if (under.length === 0) break;
    for (const i of under) pinned.add(i);
  }
  const scale = Math.min(100, fill) / 100;
  let left = 0;
  return shown.map((s, i) => {
    const width = widths[i]! * scale;
    const place = { key: s.key, left, width };
    left += width;
    return place;
  });
}

/** Which ends of segment `k` of `n` meet a neighbour. */
const joinOf = (k: number, n: number): TimelineBarJoin | undefined =>
  n < 2 ? undefined : k === 0 ? "end" : k === n - 1 ? "start" : "both";

const percent = ({ left, width }: UsagePlace) => ({ left: `${left}%`, width: `${width}%` });

export function UsageBar({
  segments,
  size = "md",
  max,
  legend = false,
  label,
  className = "",
}: {
  /** The parts, in the order they stack. */
  segments: readonly UsageSegment[];
  size?: UsageBarSize;
  /** The value the whole track stands for, when more than the parts' sum (a list's largest row). */
  max?: number;
  /** List the parts under the bar, each with its size. */
  legend?: boolean;
  /** The bar's accessible name ("Storage used"): the legend's, or the image's before its parts. */
  label: string;
  /** Layout only (a width, a margin). */
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce(
    (n, s) => (Number.isFinite(s.value) && s.value > 0 ? n + s.value : n),
    0,
  );
  const scale = Math.max(total, max ?? 0);
  const places = usageBarPlaces(
    segments,
    USAGE_MIN_SHARE[size],
    scale > 0 ? (total / scale) * 100 : 0,
  );
  const byKey = new Map(segments.map((s) => [s.key, s]));
  const listed = places.map((p) => byKey.get(p.key)!);
  const fade = (key: string) =>
    `transition-opacity duration-150 ${active !== null && active !== key ? "opacity-30" : ""}`;
  const spoken = listed.map((s) => `${s.label} ${s.display}`).join(PART_GAP);

  const bar = (
    <div
      data-chart="usage-bar"
      {...(legend
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": spoken === "" ? label : `${label}${PART_GAP}${spoken}` })}
      // The track's cell: the track clips its segments to its rounded ends, so the hover bands
      // sit beside it, in the cell's full height.
      className={`ui-chart relative flex items-center ${size === "md" ? "py-0.5" : ""}`}
    >
      <span
        data-part="grid"
        className={`relative block w-full overflow-hidden rounded-full bg-tone-neutral-bg ${TRACK[size]}`}
      >
        {places.map((place, k) => (
          <TimelineBar
            key={place.key}
            paint={byKey.get(place.key)!.paint}
            place={percent(place)}
            square={joinOf(k, places.length)}
            className={fade(place.key)}
          />
        ))}
      </span>
      {places.map((place) => {
        const part = byKey.get(place.key)!;
        return (
          <span
            key={place.key}
            data-hit=""
            data-tooltip={`${part.label} ${part.display}`}
            data-tooltip-extra={!legend || undefined}
            className="absolute inset-y-0"
            style={percent(place)}
            onMouseEnter={() => setActive(place.key)}
            onMouseLeave={() => setActive(null)}
          />
        );
      })}
    </div>
  );

  if (!legend) return <div className={`min-w-0 ${className}`}>{bar}</div>;
  return (
    <div className={`flex min-w-0 flex-col gap-3 ${className}`}>
      {bar}
      {listed.length > 0 && (
        <ul aria-label={label} className="flex flex-wrap gap-x-6 gap-y-2">
          {listed.map((part) => (
            <li
              key={part.key}
              onMouseEnter={() => setActive(part.key)}
              onMouseLeave={() => setActive(null)}
              className={`flex min-w-0 flex-col ${fade(part.key)}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                <ChartSwatch paint={part.paint} />
                <span className="min-w-0 truncate">{part.label}</span>
              </span>
              <span className="pl-3.5 text-sm font-medium tabular-nums text-fg">
                {part.display}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
