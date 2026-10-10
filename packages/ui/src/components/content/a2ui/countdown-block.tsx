/**
 * A countdown widget: how long until one moment — days, hours and minutes while it is days away,
 * hours, minutes and seconds on the last day — with the moment itself under the figure, and, once
 * it has passed, the model's words for it (or "Time's up") in the done tone.
 *
 * Live, from the reader's clock: it counts with the page's one second while its surface is near
 * the viewport. Nothing is announced as it counts; the figure is text, so reduced motion leaves
 * it counting.
 */
import { useEffect, useMemo, useState } from "react";
import { countdownParts, parseA2uiInstant } from "@prismshadow/penguin-core/a2ui";
import type { A2uiCountdown } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import { localMinute } from "./time-format";
import { useNow } from "./use-now";
import { useWidgetInView, WidgetSurface } from "./widget";

const pad = (n: number) => String(n).padStart(2, "0");

/** The longest delay a timer takes; a longer wait is armed again in steps. */
const LONGEST_TIMER = 2 ** 31 - 1;

/**
 * Whether the instant `at` (ms) has passed: one re-render at that moment, wherever the widget
 * is, so its name says the moment came even while its figure is not ticking.
 */
function usePassed(at: number): boolean {
  const [passed, setPassed] = useState(() => Date.now() >= at);
  useEffect(() => {
    if (!Number.isFinite(at)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const left = at - Date.now();
      setPassed(left <= 0);
      if (left > 0) timer = setTimeout(arm, Math.min(left + 5, LONGEST_TIMER));
    };
    arm();
    return () => clearTimeout(timer);
  }, [at]);
  return passed;
}

function CountdownBody({ spec, target }: { spec: A2uiCountdown; target: Date }) {
  const strings = useUiStrings().a2ui;
  const now = useNow(useWidgetInView());
  const left = countdownParts(target, new Date(now));
  const segments: { value: string; unit: string }[] =
    left.days > 0
      ? [
          { value: String(left.days), unit: strings.unitDays },
          { value: pad(left.hours), unit: strings.unitHours },
          { value: pad(left.minutes), unit: strings.unitMinutes },
        ]
      : [
          { value: pad(left.hours), unit: strings.unitHours },
          { value: pad(left.minutes), unit: strings.unitMinutes },
          { value: pad(left.seconds), unit: strings.unitSeconds },
        ];
  return (
    <div className="flex flex-col gap-2">
      {left.reached ? (
        <div className="text-xl font-medium text-tone-done-fg">
          {spec.doneLabel ?? strings.countdownDone}
        </div>
      ) : (
        <div className="flex gap-3">
          {segments.map((segment) => (
            <div key={segment.unit} className="flex flex-col items-center gap-1">
              <span data-figure className="text-3xl leading-none font-medium tabular-nums">
                {segment.value}
              </span>
              <span className="text-xs text-fg-muted">{segment.unit}</span>
            </div>
          ))}
        </div>
      )}
      {spec.showTarget !== false && (
        <time dateTime={target.toISOString()} className="text-xs text-fg-muted tabular-nums">
          {localMinute(target.getTime())}
        </time>
      )}
    </div>
  );
}

export function CountdownBlock({ spec }: { spec: A2uiCountdown }) {
  const strings = useUiStrings().a2ui;
  const target = useMemo(() => parseA2uiInstant(spec.to), [spec.to]);
  const reached = usePassed(target?.getTime() ?? Number.NaN);
  // The grammar admits only a `to` that parses; a renderer handed anything else says so, and the
  // block shows its source.
  if (target === null) throw new Error(`countdown: "${spec.to}" is not a date-time`);
  const done = spec.doneLabel ?? strings.countdownDone;
  return (
    <WidgetSurface
      kind="countdown"
      fit
      label={reached ? `${spec.label}, ${done}` : spec.label}
      title={spec.label}
    >
      <CountdownBody spec={spec} target={target} />
    </WidgetSurface>
  );
}
