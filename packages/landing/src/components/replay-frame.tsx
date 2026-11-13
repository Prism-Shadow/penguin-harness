/**
 * The frame a scripted replay plays in, shared by the AMSP player and the company inbox player:
 * tabs that pick the run, a pause control, and the panel of the chosen run after its first `shown`
 * steps.
 *
 * Paced by the host's `delayOf`, one timer at a time, only while the frame is on screen and not
 * paused; after the last step it rests, then plays again. Until it is first seen it shows the run
 * finished. Under reduced motion it shows each run finished and never plays.
 *
 * Nothing below it moves during a replay or on a tab change: every run is also rendered finished
 * and invisible in the panel's one grid cell, so the panel holds the height of the tallest.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { usePrefersReducedMotion } from "../lib/reduced-motion";

/** The finished run stays on screen this long before it plays again. */
const REST_MS = 3000;

export interface ReplayRun {
  id: string;
  /** The tab's words. */
  label: string;
  /** How many steps the run has. */
  total: number;
}

export function ReplayFrame({
  label,
  runs,
  delayOf,
  labels,
  children,
}: {
  /** The tab list's accessible name. */
  label: string;
  runs: readonly ReplayRun[];
  /** Milliseconds to wait before showing step `shown` of a run. */
  delayOf: (run: number, shown: number) => number;
  labels: { pause: string; play: string };
  /** A run after its first `shown` steps; `live` is false for the invisible copies that size the panel. */
  children: (run: number, shown: number, live: boolean) => ReactNode;
}) {
  const still = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const total = runs[index]!.total;
  // The finished run until the frame first comes on screen.
  const [count, setCount] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsId = useId();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const seen = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.4 },
    );
    seen.observe(root);
    return () => seen.disconnect();
  }, []);

  // The first time it is seen, the run starts from its first step.
  useEffect(() => {
    if (visible && !playing && !still) {
      setPlaying(true);
      setCount(0);
    }
  }, [visible, playing, still]);

  // One step at a time; after the last, a rest, then from the start again.
  useEffect(() => {
    if (!playing || still || paused || !visible) return;
    const timer = window.setTimeout(
      () => setCount((shown) => (shown < total ? shown + 1 : 0)),
      count < total ? delayOf(index, count) : REST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, still, paused, visible, count, total, index, delayOf]);

  const choose = (next: number) => {
    setIndex(next);
    // Paused or still, a new tab shows its run finished; otherwise it plays from the start.
    setCount(still || paused ? runs[next]!.total : 0);
    setPlaying(!still);
  };

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + runs.length) % runs.length;
    choose(next);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  return (
    <div ref={rootRef}>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 pt-1.5 dark:border-gray-800">
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={label}
            className="flex flex-wrap gap-1"
            onKeyDown={onTabKey}
          >
            {runs.map((candidate, i) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${candidate.id}`}
                aria-controls={`${tabsId}-panel`}
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => choose(i)}
                className="rounded-t-md border-b-2 border-transparent px-2.5 py-1 text-sm whitespace-nowrap text-gray-500 transition-colors hover:text-gray-900 aria-selected:border-brand-600 aria-selected:font-medium aria-selected:text-brand-700 dark:text-gray-400 dark:hover:text-gray-100 dark:aria-selected:border-brand-400 dark:aria-selected:text-brand-300"
              >
                {candidate.label}
              </button>
            ))}
          </div>
          {!still && (
            <SitePlaybackButton
              paused={paused}
              onPausedChange={setPaused}
              labels={labels}
              className="mb-1 ml-auto"
            />
          )}
        </div>

        <div
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-tab-${runs[index]!.id}`}
          className="grid"
        >
          {/* Every run, finished and invisible, in the cell: it takes the tallest one's height. */}
          {runs.map((run, i) => (
            <div key={run.id} aria-hidden="true" className="invisible col-start-1 row-start-1">
              {children(i, run.total, false)}
            </div>
          ))}
          <div className="col-start-1 row-start-1">{children(index, count, true)}</div>
        </div>
      </div>
    </div>
  );
}
