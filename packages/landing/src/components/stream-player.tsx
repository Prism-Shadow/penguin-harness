/**
 * The AMSP player: a scripted run replayed step by step, the way mmsp.penguin.ooo replays a model
 * call. Tabs pick the run (a Session's first request, a follow-up that continues it, a follow-up the
 * caller interrupts); the input block shows the call that starts it; the left pane lists the stream
 * as it arrives — the records (the ones the Trace stores on a faint ground), the caller's abort
 * beside the stream, `[DONE]`; the right pane is the run assembled from the records, under the
 * agent the client names; the strip under both reads the run's outcome from them once `[DONE]`
 * arrives.
 *
 * Paced by the run's own timestamps (lib/amsp-replay.ts `stepDelays`), one timer at a time, only
 * while the player is on screen and not paused; after the last event it rests, then plays again.
 * Under reduced motion it shows each run finished and never plays. The events pane has a fixed
 * height and follows its newest row, a long preview wrapping in its column rather than running
 * past it; the assembled pane and the outcome strip each hold the height of the tallest finished
 * run (every one is rendered invisibly in the same grid cell), so nothing below moves during a
 * replay. Sized so the whole player fits one screen beside the hero's copy at 1280 × 800.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { highlightSiteCode, SiteCodeBlock, SitePill } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { SCENARIOS } from "../lib/amsp-demo";
import { AMSP_DEMO_AGENT, playerCode } from "../lib/amsp-quickstart";
import { foldRun, stepDelays, stepLine } from "../lib/amsp-replay";
import type { ReplayItem, ReplayState, StepLine } from "../lib/amsp-replay";
import type { TokenCounts } from "../lib/amsp-protocol";
import { usePrefersReducedMotion } from "../lib/reduced-motion";

/** The finished run stays on screen this long before it plays again. */
const REST_MS = 3000;

const LINES = SCENARIOS.map((scenario) => scenario.steps.map(stepLine));
const FINISHED = SCENARIOS.map((scenario) => foldRun(scenario.steps, scenario.steps.length));
const DELAYS = SCENARIOS.map((scenario) => stepDelays(scenario.steps));
const CODE = SCENARIOS.map(playerCode);

const PANE_LABEL = "text-xs font-semibold text-gray-500 dark:text-gray-400";

export function StreamPlayer() {
  const still = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const scenario = SCENARIOS[index]!;
  const total = scenario.steps.length;
  // The finished run until the player first comes on screen.
  const [count, setCount] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLOListElement>(null);
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

  // The first time it is seen, the run starts from its first event.
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
      count < total ? DELAYS[index]![count]! : REST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, still, paused, visible, count, total, index]);

  // The events pane keeps its newest row in view, its top edge fading once rows scroll past it.
  useLayoutEffect(() => {
    const pane = eventsRef.current;
    if (!pane) return;
    pane.scrollTop = pane.scrollHeight;
    pane.toggleAttribute("data-cut", pane.scrollTop > 0);
  }, [count, index]);

  const choose = (next: number) => {
    setIndex(next);
    // Paused or still, a new tab shows its run finished; otherwise it plays from the start.
    setCount(still || paused ? SCENARIOS[next]!.steps.length : 0);
    setPlaying(!still);
  };

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + SCENARIOS.length) % SCENARIOS.length;
    choose(next);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  const lines = LINES[index]!.slice(0, count);
  const state = useMemo(() => foldRun(scenario.steps, count), [scenario, count]);
  const P = S.amsp.player;

  return (
    <div ref={rootRef}>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 pt-2 dark:border-gray-800">
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={P.label}
            className="flex flex-wrap gap-1"
            onKeyDown={onTabKey}
          >
            {SCENARIOS.map((candidate, i) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${candidate.id}`}
                aria-controls={`${tabsId}-panel`}
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => choose(i)}
                className="rounded-t-md border-b-2 border-transparent px-2.5 py-1.5 text-[13px] text-gray-500 transition-colors hover:text-gray-900 aria-selected:border-brand-600 aria-selected:font-medium aria-selected:text-brand-700 dark:text-gray-400 dark:hover:text-gray-100 dark:aria-selected:border-brand-400 dark:aria-selected:text-brand-300"
              >
                {P.scenarios[candidate.id]}
              </button>
            ))}
          </div>
          {!still && (
            <button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused((was) => !was)}
              className="mb-1.5 ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:text-gray-950 dark:text-gray-400 dark:hover:text-gray-100"
            >
              {paused ? <PlayGlyph /> : <PauseGlyph />}
              <span>{paused ? P.play : P.pause}</span>
            </button>
          )}
        </div>

        <div
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-tab-${scenario.id}`}
        >
          <div className="border-b border-gray-200 px-3 pt-2.5 dark:border-gray-800">
            <h3 className={PANE_LABEL}>{P.input}</h3>
            <div className="amsp-code -mx-3">
              <SiteCodeBlock
                code={CODE[index]!}
                language="typescript"
                highlight={highlightSiteCode}
              />
            </div>
          </div>

          <div className="grid gap-px bg-gray-200 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] dark:bg-gray-800">
            <section className="flex h-72 min-w-0 flex-col bg-gray-50 p-3 xl:h-auto dark:bg-gray-900">
              <div className="flex items-center justify-between gap-3">
                <h3 className={PANE_LABEL}>{P.events}</h3>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-3.5 rounded-sm border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950"
                  />
                  {P.stored}
                </span>
              </div>
              <div className="relative mt-2 min-h-0 flex-1">
                <ol
                  ref={eventsRef}
                  aria-live="off"
                  className="amsp-follow absolute inset-0 space-y-px overflow-hidden font-mono text-[12px] leading-5"
                >
                  {lines.map((line, i) => (
                    <StreamRow key={i} line={line} />
                  ))}
                </ol>
              </div>
            </section>

            <section className="min-w-0 bg-gray-50 p-3 dark:bg-gray-900">
              <h3 className={PANE_LABEL}>{P.assembled}</h3>
              <div className="mt-2 grid">
                {FINISHED.map((finished, i) => (
                  <div key={i} aria-hidden="true" className="invisible col-start-1 row-start-1">
                    <Assembled state={finished} />
                  </div>
                ))}
                <div className="col-start-1 row-start-1">
                  <Assembled state={state} />
                </div>
              </div>
            </section>
          </div>

          <div className="grid border-t border-gray-200 px-3 py-2.5 dark:border-gray-800">
            {FINISHED.map((finished, i) => (
              <div key={i} aria-hidden="true" className="invisible col-start-1 row-start-1">
                <Outcome state={finished} />
              </div>
            ))}
            <div className="col-start-1 row-start-1">
              {state.done ? (
                <Outcome state={state} />
              ) : (
                <p className="text-[13px] leading-6 text-gray-500 dark:text-gray-400">
                  {P.running}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One row of the stream: a record (on a faint ground when the Trace stores it), a control frame, the
 * caller's request beside the stream, or the closing `[DONE]` under a rule.
 */
function StreamRow({ line }: { line: StepLine }) {
  const P = S.amsp.player;
  const tone =
    line.kind === "done"
      ? "mt-1 border-t border-gray-300 pt-1 text-gray-500 dark:border-gray-700 dark:text-gray-400"
      : line.stored
        ? "bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100"
        : "text-gray-500 dark:text-gray-400";
  return (
    <li
      className={`grid grid-cols-[24ch_minmax(0,1fr)] gap-x-2 rounded-sm px-2 sm:grid-cols-[10ch_24ch_minmax(0,1fr)] ${tone}`}
    >
      {/* A record with no payload type (session_meta) lets its envelope run into the name's column. */}
      <span
        className={`hidden text-[11px] text-gray-400 sm:block dark:text-gray-500 ${
          line.name ? "" : "sm:col-span-2"
        }`}
      >
        {line.head}
      </span>
      {line.name ? <span>{line.name}</span> : <span className="sm:hidden">{line.head}</span>}
      <span className="[overflow-wrap:anywhere]">
        {line.kind === "request" ? (
          <span className="font-sans">{P.besideStream}</span>
        ) : (
          line.preview
        )}
      </span>
    </li>
  );
}

/** The run assembled: the agent and (on a first message) the model, then the items by Request. */
function Assembled({ state }: { state: ReplayState }) {
  const P = S.amsp.player;
  const groups = [0, ...state.requests.map((request) => request.index)];
  return (
    <div className="font-mono text-[12px] leading-5">
      <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
        {AMSP_DEMO_AGENT}
        {state.model !== null && <> · {state.model}</>}
      </p>
      {groups.map((request) => {
        const items = state.items.filter((item) => item.request === request);
        const header = state.requests.find((candidate) => candidate.index === request);
        if (header === undefined && items.length === 0) return null;
        return (
          <div key={request} className={header ? "mt-2" : ""}>
            {header && (
              <p className="mb-1 border-t border-gray-200 pt-1 text-[11px] leading-4 text-gray-500 dark:border-gray-800 dark:text-gray-400">
                {P.request(header.index)}
                {header.thinkingLevel && <> · {P.thinking(header.thinkingLevel)}</>}
              </p>
            )}
            <ul className="space-y-1">
              {items.map((item) => (
                <AssembledItem key={item.key} item={item} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AssembledItem({ item }: { item: ReplayItem }) {
  const P = S.amsp.player;
  const body =
    item.kind === "tool_call"
      ? `${item.name ?? ""} ${item.body}`
      : item.kind === "tool_call_output"
        ? item.body.trimEnd()
        : item.body;
  return (
    <li>
      <div className="flex items-center gap-2 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
        <span>
          {item.kind}
          {item.kind === "text" && ` · ${item.role}`}
          {item.open && ` · ${P.streaming}`}
        </span>
      </div>
      <p
        className={`line-clamp-2 break-words ${
          item.open ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {body}
      </p>
    </li>
  );
}

/**
 * The run's outcome as a client reads it at `[DONE]` (`task_end` carries no status): the status,
 * the Request count, the time taken and the tokens, the facts in the records it was read from,
 * then the usage as bars, side by side from `sm` up.
 */
function Outcome({ state }: { state: ReplayState }) {
  const P = S.amsp.player;
  const { outcome, usage } = state;
  if (outcome === null) return null;
  const facts = [
    P.requests(state.requests.length),
    ...(state.elapsedMs !== null ? [`${(state.elapsedMs / 1000).toFixed(1)} s`] : []),
    ...(usage ? [P.tokens(usage.total.toLocaleString("en-US"))] : []),
  ];
  return (
    <div className="text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-gray-500 dark:text-gray-400">{P.result}</span>
        <SitePill tone="neutral">{outcome.status}</SitePill>
        <span className="ml-auto text-gray-600 tabular-nums dark:text-gray-300">
          {facts.join(" · ")}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
        {P.readFrom(outcome)}
      </p>
      {usage && <UsageBars usage={usage} />}
    </div>
  );
}

/** The input-side counts in gray, the output in the one accent, each scaled to the largest. */
const BARS: { field: keyof Omit<TokenCounts, "total">; tone: string }[] = [
  { field: "cache_read", tone: "bg-gray-400 dark:bg-gray-500" },
  { field: "cache_write", tone: "bg-gray-400 dark:bg-gray-500" },
  { field: "output", tone: "bg-brand-500" },
];

function UsageBars({ usage }: { usage: TokenCounts }) {
  const largest = Math.max(1, ...BARS.map((bar) => usage[bar.field]));
  return (
    <div className="mt-2 grid gap-x-5 gap-y-1 font-mono text-[12px] leading-5 sm:grid-cols-3">
      {BARS.map((bar) => {
        const value = usage[bar.field];
        // A count too small for its share of the bar still shows.
        const width = value === 0 ? 0 : Math.max(1.5, (100 * value) / largest);
        return (
          <div
            key={bar.field}
            className="grid grid-cols-[11ch_minmax(0,1fr)_6ch] items-center gap-x-2"
          >
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{bar.field}</span>
            <span className="h-2 overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-800">
              <span
                className={`amsp-bar block h-full rounded-sm ${bar.tone}`}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="text-right text-gray-700 tabular-nums dark:text-gray-300">
              {value.toLocaleString("en-US")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PauseGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <rect x="6" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M6 3l14 9-14 9V3Z" />
    </svg>
  );
}
