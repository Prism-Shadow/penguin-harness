/**
 * The AMSP player: a scripted run replayed step by step, the way mmsp.penguin.ooo replays a model
 * call, in its panel's chrome and words. Tabs pick the run (a Session's first request, a follow-up
 * that continues it, a follow-up the caller interrupts); the code panel holds the import and the
 * call that starts it; the left pane lists the stream as it arrives — the opening `ping`, the
 * records, the caller's abort beside the stream, `[DONE]`; the right pane is the run assembled from
 * the records, under the agent the client names, and once `[DONE]` arrives the outcome read from
 * them.
 *
 * Colour says the family (lib/amsp-tones.ts, with a legend in the pane's header): `model_msg` in
 * blue, `event_msg` in amber, `session_meta` and the frames in gray; a record the Trace stores sits
 * on its family's light tint, a `partial_*` fragment, live only, has none.
 *
 * Paced by the run's own timestamps (lib/amsp-replay.ts `stepDelays`: records sent together arrive
 * a readable beat apart, long waits are capped), one timer at a time, only while the player is on
 * screen and not paused; after the last event it rests, then plays again. Under reduced motion it
 * shows each run finished and never plays.
 *
 * Nothing scrolls: the stream pane lists every step of the run, one 20-pixel line each (a preview
 * is shortened to its column), and the tab panel holds the height of the tallest finished run
 * (every one is rendered invisibly in the same grid cell, its code and both panes), so nothing
 * below moves during a replay or on a tab change. At 1440 × 900 the whole player, every row of
 * every run, fits one screen beside the hero's copy.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { highlightSiteCode, SiteCodeBlock, SitePill } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { SCENARIOS } from "../lib/amsp-demo";
import { AMSP_DEMO_AGENT, playerCode } from "../lib/amsp-quickstart";
import { foldRun, stepDelays, stepLine } from "../lib/amsp-replay";
import type { ReplayItem, ReplayState, StepLine } from "../lib/amsp-replay";
import type { TokenCounts } from "../lib/amsp-protocol";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { lineFamily, TONES } from "../lib/amsp-tones";

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
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 pt-1.5 dark:border-gray-800">
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
                className="rounded-t-md border-b-2 border-transparent px-2.5 py-1 text-[13px] text-gray-500 transition-colors hover:text-gray-900 aria-selected:border-brand-600 aria-selected:font-medium aria-selected:text-brand-700 dark:text-gray-400 dark:hover:text-gray-100 dark:aria-selected:border-brand-400 dark:aria-selected:text-brand-300"
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
              className="mb-1 ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:text-gray-950 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
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
          className="grid"
        >
          {/* Every run, finished and invisible, in the cell: it takes the tallest one's height. */}
          {SCENARIOS.map((_, i) => (
            <div key={i} aria-hidden="true" className="invisible col-start-1 row-start-1">
              <Panel index={i} lines={LINES[i]!} state={FINISHED[i]!} />
            </div>
          ))}
          <div className="col-start-1 row-start-1">
            <Panel index={index} lines={lines} state={state} live />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The call that starts a run, then its stream as it arrives beside the run assembled. */
function Panel({
  index,
  lines,
  state,
  live = false,
}: {
  index: number;
  lines: readonly StepLine[];
  state: ReplayState;
  live?: boolean;
}) {
  const P = S.amsp.player;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 px-3 pt-2 dark:border-gray-800">
        <h3 className={PANE_LABEL}>{P.input}</h3>
        <div className="amsp-code amsp-code-panel -mx-3">
          <SiteCodeBlock code={CODE[index]!} language="typescript" highlight={highlightSiteCode} />
        </div>
      </div>
      <div className="grid flex-1 gap-px bg-gray-200 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] dark:bg-gray-800">
        <section className="min-w-0 bg-gray-50 px-3 pt-2 pb-1.5 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className={PANE_LABEL}>{P.events}</h3>
            <StreamLegend />
          </div>
          <ol aria-live="off" className="mt-1 font-mono text-[12px]">
            {lines.map((line, i) => (
              <StreamRow key={live ? i : `${index}-${i}`} line={line} />
            ))}
          </ol>
        </section>
        <section className="min-w-0 bg-gray-50 px-3 pt-2 pb-1.5 dark:bg-gray-900">
          <h3 className={PANE_LABEL}>{P.assembled}</h3>
          <div className="mt-1">
            <Assembled state={state} />
          </div>
        </section>
      </div>
    </div>
  );
}

/** What the stream's colours say: the two envelopes, and the ground of a stored record. */
function StreamLegend() {
  const P = S.amsp.player;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px]">
      <span className={TONES.model.soft}>model_msg</span>
      <span className={TONES.event.soft}>event_msg</span>
      <span className="inline-flex items-center gap-1.5 font-sans text-gray-500 dark:text-gray-400">
        <span aria-hidden="true" className="inline-flex">
          <span className={`h-2.5 w-2 rounded-l-sm ${TONES.model.ground}`} />
          <span className={`h-2.5 w-2 rounded-r-sm ${TONES.event.ground}`} />
        </span>
        {P.stored}
      </span>
    </span>
  );
}

/**
 * The columns of a stream row: the envelope, the kind, and the preview. The kind column fits
 * every kind but the longest (`partial_tool_call_output`, and the caller's abort path), which run
 * on into the preview's column with their preview after them.
 */
const KIND_CH = "partial_tool_call".length;
/** What the preview column holds at the width the player has beside the hero's copy. */
const PREVIEW_CH = 24;

/** A preview shortened to fit its column, ending in an ellipsis when it had more. */
function fit(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text;
}

/**
 * One row of the stream, 20 pixels tall: a record, its envelope and kind in its family's colour and,
 * when the Trace stores it, on its family's light ground (inset a pixel, so neighbours stay
 * apart); a control frame, the caller's request beside the stream, or the closing `[DONE]`.
 */
function StreamRow({ line }: { line: StepLine }) {
  const P = S.amsp.player;
  const tone = TONES[lineFamily(line)];
  const fragment = line.phase !== null;
  const long = line.name.length > KIND_CH;
  // A long kind takes some of the preview's column: the preview gets what is left of it.
  const room = long ? PREVIEW_CH - (line.name.length - KIND_CH) - 1 : PREVIEW_CH;
  const kindTone =
    line.kind !== "record" ? "text-gray-500 dark:text-gray-400" : fragment ? tone.soft : tone.ink;
  return (
    <li
      style={{ "--kind": `${KIND_CH}ch` } as CSSProperties}
      className={`py-px ${line.kind === "done" ? "border-t border-gray-200 dark:border-gray-800" : ""}`}
    >
      <div
        className={`grid grid-cols-[var(--kind)_minmax(0,1fr)] gap-x-1.5 rounded-sm px-1.5 leading-[18px] sm:grid-cols-[9ch_var(--kind)_minmax(0,1fr)] ${
          line.stored ? tone.ground : ""
        }`}
      >
        {/* A record with no payload type (session_meta) lets its envelope run into the kind's column. */}
        <span
          className={`hidden text-[11px] sm:block ${line.kind === "record" ? tone.soft : "text-gray-400 dark:text-gray-500"} ${
            line.name ? "" : "sm:col-span-2"
          }`}
        >
          {line.head}
        </span>
        {line.name ? (
          !long && <span className={kindTone}>{line.name}</span>
        ) : (
          <span className={`sm:hidden ${tone.ink}`}>{line.head}</span>
        )}
        <span
          className={`[overflow-wrap:anywhere] ${long ? "col-span-2" : ""} ${
            line.stored ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {long && <span className={kindTone}>{line.name} </span>}
          {line.kind === "request" ? (
            <span className="font-sans">{P.besideStream}</span>
          ) : (
            fit(line.preview, room)
          )}
        </span>
      </div>
    </li>
  );
}

/**
 * The run assembled: the agent and (on a first message) the model, the items by Request, then,
 * once `[DONE]` has arrived, the outcome.
 */
function Assembled({ state }: { state: ReplayState }) {
  const P = S.amsp.player;
  const groups = [0, ...state.requests.map((request) => request.index)];
  return (
    <div className="font-mono text-[12px] leading-4">
      <p className="mb-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        {AMSP_DEMO_AGENT}
        {state.model !== null && <> · {state.model}</>}
      </p>
      {groups.map((request) => {
        const items = state.items.filter((item) => item.request === request);
        const header = state.requests.find((candidate) => candidate.index === request);
        if (header === undefined && items.length === 0) return null;
        return (
          <div key={request} className={header ? "mt-1.5" : ""}>
            {header && (
              <p
                className={`mb-0.5 border-t border-gray-200 pt-1 text-[11px] dark:border-gray-800 ${TONES.event.soft}`}
              >
                {P.request(header.index)}
                {header.thinkingLevel && <> · {P.thinking(header.thinkingLevel)}</>}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <AssembledItem key={item.key} item={item} />
              ))}
            </ul>
          </div>
        );
      })}
      {state.done && <Outcome state={state} />}
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
      <div className={`text-[11px] ${TONES.model.soft}`}>
        {item.kind}
        {item.kind === "text" && ` · ${item.role}`}
        {item.open && ` · ${P.streaming}`}
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
 * the Request count, the time taken and the tokens, then the usage as bars.
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
    <div className="mt-2 border-t border-gray-200 pt-1.5 font-sans dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="text-gray-500 dark:text-gray-400">{P.result}</span>
        <SitePill tone="neutral">{outcome.status}</SitePill>
        <span className="text-gray-600 tabular-nums dark:text-gray-300">{facts.join(" · ")}</span>
      </div>
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
    <div className="mt-1.5 space-y-0.5 font-mono text-[11px] leading-4">
      {BARS.map((bar) => {
        const value = usage[bar.field];
        // A count too small for its share of the bar still shows.
        const width = value === 0 ? 0 : Math.max(1.5, (100 * value) / largest);
        return (
          <div
            key={bar.field}
            className="grid grid-cols-[11ch_minmax(0,1fr)_6ch] items-center gap-x-2"
          >
            <span className="text-gray-500 dark:text-gray-400">{bar.field}</span>
            <span className="h-1.5 overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-800">
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
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <rect x="6" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <path d="M6 3l14 9-14 9V3Z" />
    </svg>
  );
}
