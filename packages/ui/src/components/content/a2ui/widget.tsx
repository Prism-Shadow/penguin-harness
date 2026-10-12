/**
 * The surface every A2UI widget sits on — a weather card, a clock, a countdown, a dashboard of
 * readings: one rounded box set apart from the prose, its head naming it on the left and saying
 * when its data was read on the right, its body the widget, and an optional quiet foot (where the
 * data came from).
 *
 * It carries the `ui-widget` hook, so a theme can set the box its own way (Frost a soft filled
 * tile with white tiles inside, Console a hairline box with mono figures); inside it the markup
 * names its parts for those recipes: `data-figure` on every big numeral, `data-tile` on a tile,
 * `data-art` on an illustration's svg.
 *
 * The surface watches whether it is near the viewport. Scrolled away it carries `data-offscreen`,
 * which pauses its animations, and tells the widget inside (`useWidgetInView`), so a clock stops
 * ticking for a reader who cannot see it.
 */
import { createContext, useContext, useRef } from "react";
import type { ReactNode } from "react";
import { formatAsOf } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import { useInView, useNow } from "./use-now";

export type WidgetKind = "weather" | "clock" | "countdown" | "metrics";

const InView = createContext(true);

/** Whether the widget's surface is near the viewport: a live widget ticks only while it is. */
export function useWidgetInView(): boolean {
  return useContext(InView);
}

export function WidgetSurface({
  kind,
  label,
  title,
  asOf,
  foot,
  fit = false,
  children,
}: {
  kind: WidgetKind;
  /** The accessible name of the group. */
  label: string;
  /** The head's name, on the left. */
  title?: string;
  /** When the data was read (an ISO date-time), on the head's right. */
  asOf?: string;
  /** A quiet line under the body (the source). */
  foot?: ReactNode;
  /**
   * Sized to its content rather than the reply's width: a widget holding one short reading (a
   * countdown, one zone's time) would otherwise sit at the left of a wide, empty tile.
   */
  fit?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const strings = useUiStrings().a2ui;
  const lang = strings.lang;
  const now = useNow(false);
  const stamp =
    asOf === undefined ? undefined : strings.asOf(formatAsOf(asOf, lang, new Date(now)));
  return (
    <div className="a2ui-block my-3" data-a2ui={kind}>
      <div
        ref={ref}
        role="group"
        aria-label={label}
        data-widget={kind}
        data-offscreen={inView ? undefined : ""}
        className={`ui-widget rounded-md border border-line bg-surface p-3 text-fg ${fit ? "w-fit min-w-64 max-w-full" : ""}`}
      >
        {(title !== undefined || stamp !== undefined) && (
          <div
            data-slot="head"
            className="mb-2 flex items-baseline justify-between gap-2 text-xs text-fg-muted"
          >
            {title !== undefined && <span className="truncate font-medium text-fg">{title}</span>}
            {stamp !== undefined && <span className="ml-auto shrink-0 tabular-nums">{stamp}</span>}
          </div>
        )}
        <div data-slot="body">
          <InView.Provider value={inView}>{children}</InView.Provider>
        </div>
        {foot !== undefined && (
          <div data-slot="foot" className="mt-2 text-xs text-fg-subtle">
            {foot}
          </div>
        )}
      </div>
    </div>
  );
}
