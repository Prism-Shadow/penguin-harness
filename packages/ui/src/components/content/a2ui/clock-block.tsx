/**
 * A clock widget: the time now in one to four zones, as digits, as a dial, or both, with the
 * weekday and the date under it. One zone gets the large figure; several sit side by side as
 * tiles, each saying how far its zone runs from the reader's own.
 *
 * Live, from the reader's clock: it ticks with the page's one second (`useNow`) while its surface
 * is near the viewport and stops when it is scrolled away. The dial's hands jump to each second
 * the way a quartz movement does — no easing between them — and the seconds hand is left off
 * when the reader asked for less motion; the digits keep counting, since text is not motion.
 * Nothing is announced as it changes: a reading every second would be noise.
 */
import type { A2uiClock, A2uiClockZone, A2uiLang } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { offsetLabel, timeParts, zoneCity } from "./time-format";
import type { HourCycle, TimeParts } from "./time-format";
import { useMotionReduced, useNow } from "./use-now";
import { useWidgetInView, WidgetSurface } from "./widget";

/** A zone's name: the model's label, the reader's own "Local time", or the IANA name's city. */
function zoneName(zone: A2uiClockZone, strings: A2uiStrings): string {
  return zone.label ?? (zone.zone === "local" ? strings.localTime : zoneCity(zone.zone));
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The twelve hour marks, the four quarters longer, as one path on the 64-unit dial. */
const TICKS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6;
  const at = (r: number) => `${round(32 + r * Math.sin(a))} ${round(32 - r * Math.cos(a))}`;
  return `M${at(i % 3 === 0 ? 22.5 : 25.5)}L${at(28)}`;
}).join("");

/**
 * An analog dial: the face in the emphasis line, the hour marks in the muted ink, the hour and
 * minute hands in the surrounding ink and, when `second` is given, a seconds hand in the accent.
 * The hands are set by rotation alone, per render: a clock steps, it does not glide.
 */
export function ClockFace({
  hour,
  minute,
  second,
  label,
  size = 72,
}: {
  hour: number;
  minute: number;
  /** Draws the seconds hand; omitted, the dial has none. */
  second?: number;
  /** The accessible name: the time the dial shows. */
  label: string;
  /** Width and height, px. */
  size?: number;
}) {
  const s = second ?? 0;
  const hourTurn = (hour % 12) * 30 + minute * 0.5;
  const minuteTurn = minute * 6 + s * 0.1;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      className="block shrink-0"
    >
      <circle cx={32} cy={32} r={30} strokeWidth={1.5} className="stroke-line-emphasis" />
      <path d={TICKS} strokeWidth={1.5} className="stroke-fg-muted" />
      <line
        data-hand="hour"
        x1={32}
        y1={32}
        x2={32}
        y2={17}
        strokeWidth={3.5}
        transform={`rotate(${hourTurn} 32 32)`}
      />
      <line
        data-hand="minute"
        x1={32}
        y1={32}
        x2={32}
        y2={9}
        strokeWidth={2.5}
        transform={`rotate(${minuteTurn} 32 32)`}
      />
      <circle cx={32} cy={32} r={2.5} fill="currentColor" stroke="none" />
      {second !== undefined && (
        <g data-hand="second" className="text-accent" transform={`rotate(${second * 6} 32 32)`}>
          <line x1={32} y1={38} x2={32} y2={7} strokeWidth={1.25} />
          <circle cx={32} cy={32} r={1.5} fill="currentColor" stroke="none" />
        </g>
      )}
    </svg>
  );
}

/**
 * The digits, with the day period where the language writes it: after them in English, before
 * them in Chinese.
 */
function Digits({
  parts,
  lang,
  figure,
}: {
  parts: TimeParts;
  lang: A2uiLang;
  /** The figure's rung: the lone clock's, or a tile's. */
  figure: "text-4xl" | "text-2xl";
}) {
  const period =
    parts.dayPeriod === undefined ? null : (
      <span className="text-sm text-fg-muted">{parts.dayPeriod}</span>
    );
  return (
    <div className="flex items-baseline gap-1.5">
      {lang === "zh" && period}
      <time
        dateTime={parts.iso}
        data-figure
        className={`${figure} leading-none font-medium tabular-nums`}
      >
        {parts.time}
      </time>
      {lang !== "zh" && period}
    </div>
  );
}

/** What a dial and the screen reader call the time: the digits and the day period. */
const spoken = (parts: TimeParts, lang: A2uiLang) =>
  parts.dayPeriod === undefined
    ? parts.time
    : lang === "zh"
      ? `${parts.dayPeriod} ${parts.time}`
      : `${parts.time} ${parts.dayPeriod}`;

function ClockBody({ spec, zones }: { spec: A2uiClock; zones: readonly A2uiClockZone[] }) {
  const strings = useUiStrings().a2ui;
  const lang = strings.lang;
  const inView = useWidgetInView();
  const now = useNow(inView);
  const still = useMotionReduced();
  const style = spec.style ?? "digital";
  const analog = style !== "digital";
  const digital = style !== "analog";
  const cycle: HourCycle = spec.hourCycle ?? "auto";
  const withDate = spec.date !== false;
  // The seconds hand rests under reduced motion, and off-screen nobody is watching it.
  const sweep = !still && inView;
  const read = (zone: A2uiClockZone) =>
    timeParts(now, zone.zone, cycle, lang, spec.seconds === true);

  const face = (parts: TimeParts, size: number) => (
    <ClockFace
      hour={parts.hour}
      minute={parts.minute}
      {...(sweep ? { second: parts.second } : {})}
      label={spoken(parts, lang)}
      size={size}
    />
  );

  if (zones.length === 1) {
    const parts = read(zones[0]!);
    return (
      <div className="flex flex-wrap items-center gap-3">
        {analog && face(parts, 72)}
        <div className="flex flex-col gap-1">
          {digital && <Digits parts={parts} lang={lang} figure="text-4xl" />}
          {withDate && (
            <div className="text-xs text-fg-muted">{`${parts.weekday} · ${parts.date}`}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
      {zones.map((zone) => {
        const parts = read(zone);
        const offset = offsetLabel(parts.offsetHours);
        const meta = [withDate ? parts.weekday : "", offset].filter((s) => s !== "").join(" · ");
        return (
          <div
            key={zone.zone}
            data-tile
            className="flex min-w-0 flex-col gap-1 rounded-sm bg-surface-muted p-2"
          >
            <span className="truncate text-xs text-fg-muted">{zoneName(zone, strings)}</span>
            <div className="flex items-center gap-2">
              {analog && face(parts, 48)}
              {digital && <Digits parts={parts} lang={lang} figure="text-2xl" />}
            </div>
            {meta !== "" && <span className="text-xs text-fg-muted tabular-nums">{meta}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function ClockBlock({ spec }: { spec: A2uiClock }) {
  const strings = useUiStrings().a2ui;
  const zones = spec.zones ?? [{ zone: "local" }];
  // A lone zone names the clock when the model did not.
  const lone = zones.length === 1 ? zoneName(zones[0]!, strings) : undefined;
  const title = spec.title ?? lone;
  const label = spec.title ?? (lone !== undefined ? `${strings.clock}, ${lone}` : strings.clock);
  return (
    <WidgetSurface
      kind="clock"
      label={label}
      fit={zones.length === 1}
      {...(title !== undefined ? { title } : {})}
    >
      <ClockBody spec={spec} zones={zones} />
    </WidgetSurface>
  );
}
