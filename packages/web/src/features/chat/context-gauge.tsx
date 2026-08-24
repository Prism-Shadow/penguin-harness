/**
 * Context usage gauge in the composer toolbar, and the composition panel behind it.
 *
 * The resting state is the ring alone: a **single-colour** indicator of total occupancy (no
 * bucketing), turning amber past 80% and red past 95%. The exact `used/window` figures are not
 * printed beside it — the panel a click away leads with them, and hovering the ring names them
 * too. When the model has no `context_window` configured, resolveContextWindow falls back to
 * 128000 and the ring is drawn as usual, so the ratio always has a reference point.
 *
 * `unknown` (a compaction succeeded and the next regular Request has not reported usage yet)
 * draws an empty ring. **Never a full-looking 0**: that would claim the context had been cleared
 * while the summary itself occupies tokens. Nothing has been measured yet, which is not the same
 * as having measured zero — and the panel says exactly that rather than describing the context
 * that was just compacted away.
 *
 * Given a `sessionId` the ring becomes a button that discloses the panel, which answers what the
 * ring cannot: what the context is full of. The server splits the Session's newest Trace shard —
 * one shard is one complete model context — into six parts and ranks the tools whose traffic
 * occupies the most of it. Those figures come from a character heuristic, not a tokenizer (this
 * project bundles none), so only their **shares** are used: each part is drawn as its share of
 * `now`, the measured occupancy the ring itself shows. The parts therefore always add up to the
 * figure in the panel header, and the estimate's absolute error never reaches the display; the
 * `~` on every derived value marks what is still an approximation.
 *
 * The bar runs the full **context window**, so its filled run is the occupancy the ring shows and
 * a dashed mark says where compaction will fire — how much room is left before the context is
 * summarized away is the thing that decides what to do next. The parts subdivide that filled run;
 * their exact shares are the legend's job, since at low occupancy the run is only a few pixels
 * wide. Hovering a segment or its legend row links the two: the row lights up and the other
 * segments fade.
 *
 * The panel is portaled to document.body and positioned against viewport coordinates by
 * usePortalPanel, so the composer's own overflow cannot clip it, and it closes on outside click /
 * Esc / scroll / resize. It opens upward on its own: the composer sits at the bottom of the page,
 * so there is never room below.
 */
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionContextResponse } from "@prismshadow/penguin-server/api";
import { getSessionContext } from "../../api/endpoints";
import { usePortalPanel } from "../../components/ui/use-portal-panel";
import { resolveContextWindow } from "../../lib/context";
import { formatPercent, humanizeTokens } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { contextComposition } from "./context-parts";
import type { ContextPartKey } from "./context-parts";

/**
 * Panel geometry. The width is applied inline rather than as a `w-*` class because the same
 * number has to reach usePortalPanel, which clamps the left edge with it — a rem-based class
 * would resolve against the app's root font size and drift from the pixel the clamp assumed,
 * letting the panel hang off the right edge on a narrow viewport. The max-width matches the
 * hook's own 16px viewport margin on both sides. The height only decides up or down.
 */
const PANEL_WIDTH = 300;
const PANEL_MAX_WIDTH = "calc(100vw - 32px)";
const PANEL_HEIGHT = 264;

/** Smallest painted width (px) of the filled run, so a context with a few hundred tokens in it still shows a mark rather than nothing. */
const MIN_FILL_PX = 2;

/** How far (px) the compaction mark runs past the bar top and bottom: a 9px dash inside the bar reads as a dot, an 18px one reads as dashed. */
const MARK_OVERHANG_PX = 4;

type PanelState =
  { status: "loading" } | { status: "failed" } | { status: "ready"; data: SessionContextResponse };

export function ContextGauge({
  now,
  window: win,
  unknown = false,
  sessionId,
}: {
  now: number;
  window?: number;
  unknown?: boolean;
  /** Enables the composition panel. Omitted where no Session-level endpoint can serve it (the subagent composer), leaving the ring a plain readout. */
  sessionId?: string;
}) {
  const max = resolveContextWindow(win);
  const pct = unknown ? 0 : Math.min(1, now / max);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => setOpen(false),
    estimatedHeight: PANEL_HEIGHT,
    panelWidth: PANEL_WIDTH,
  });

  const color =
    unknown || pct <= 0.8
      ? "text-gray-400 dark:text-gray-500"
      : pct > 0.95
        ? toneInk.danger
        : toneInk.attention;
  // The ring draws no numbers, so its accessible name carries them: the ratio AND the figures it
  // was computed from, which is all the subagent composer's panel-less ring can offer.
  const usageText = unknown
    ? S.chat.contextUnknown
    : `${S.chat.contextUsage} ${Math.round(pct * 100)}% · ${humanizeTokens(now)}/${humanizeTokens(max)}`;
  const R = 5;
  const C = 2 * Math.PI * R;
  const gauge = (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="block shrink-0">
      <circle
        cx="7"
        cy="7"
        r={R}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <circle
        cx="7"
        cy="7"
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${C * pct} ${C}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
  const shell = `flex shrink-0 items-center ${color}`;

  if (sessionId === undefined) {
    return (
      <span title={usageText} aria-label={usageText} role="img" className={shell}>
        {gauge}
      </span>
    );
  }
  return (
    <>
      {/* Hover paints a background rather than a colour: the ring's own colour is the warning
          ladder, and a hover tone would overwrite the very thing it reports. The negative margin
          keeps the padded hit area from moving the toolbar's other controls. */}
      <button
        ref={triggerRef}
        type="button"
        title={usageText}
        aria-label={usageText}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`${shell} -mx-1 cursor-pointer rounded p-1 transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`}
      >
        {gauge}
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label={S.chat.contextComposition}
            style={{
              position: "fixed",
              top: position.topPx,
              bottom: position.bottomPx,
              left: position.left,
              width: PANEL_WIDTH,
              maxWidth: PANEL_MAX_WIDTH,
            }}
            className="anim-pop z-[60] rounded-md border border-gray-200 bg-white p-2.5 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            <ContextPanel sessionId={sessionId} now={now} max={max} pct={pct} unknown={unknown} />
          </div>,
          document.body,
        )}
    </>
  );
}

function ContextPanel({
  sessionId,
  now,
  max,
  pct,
  unknown,
}: {
  sessionId: string;
  now: number;
  max: number;
  pct: number;
  unknown: boolean;
}) {
  // A snapshot taken when the panel opens (it only mounts while open), not a live counter: the
  // endpoint re-reads a whole Trace shard, and the panel closes on any scroll anyway.
  const [state, setState] = useState<PanelState>({ status: "loading" });
  // Row id under the pointer — a part key, or `tool:<name>` for the ranking below. One piece of
  // state for both lists, so a hovered tool row cannot also dim the bar it has no segment in.
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getSessionContext(sessionId).then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data });
      },
      () => {
        if (!cancelled) setState({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const data = state.status === "ready" ? state.data : null;
  // `contextClosed` is the server seeing what `unknown` reports from the stream: a completed
  // compaction, and no measurement of the new context yet. Both say the occupancy is unknown
  // rather than zero, so both render `—` instead of describing a context that no longer exists.
  const unmeasured = unknown || data?.contextClosed === true;
  const composition = data === null ? null : contextComposition(data, now);
  const hoveredPart = composition?.parts.some((p) => p.key === hovered) ? hovered : null;
  // Only drawn when it falls inside the bar's scale; the server already returns null for a
  // Session whose compaction is off or whose threshold sits past the window.
  const compactAt =
    data !== null && data.compactionThreshold !== null && data.compactionThreshold < max
      ? data.compactionThreshold
      : null;

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-1.5">
          <span className="text-gray-500 dark:text-gray-400">{S.chat.contextUsage}</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {unmeasured ? "—" : formatPercent(pct)}
          </span>
        </span>
        <span className="font-mono text-gray-500 dark:text-gray-400">
          {unmeasured ? "—" : humanizeTokens(now)} / {humanizeTokens(max)}
        </span>
      </div>

      {unmeasured ? (
        <p className="mt-2 leading-relaxed text-gray-400 dark:text-gray-500">
          {S.chat.contextUnknownHint}
        </p>
      ) : state.status === "loading" ? (
        <p className="mt-2 text-gray-400 dark:text-gray-500">{S.common.loading}</p>
      ) : state.status === "failed" ? (
        <p className="mt-2 text-gray-400 dark:text-gray-500">{S.chat.contextBreakdownFailed}</p>
      ) : composition === null ? (
        <p className="mt-2 text-gray-400 dark:text-gray-500">{S.chat.contextBreakdownEmpty}</p>
      ) : (
        <>
          {/* The bar's scale is the whole window: the filled run is the occupancy, the rest is
              headroom, and the dashed mark is where compaction fires. Squared off, and with no
              gaps between the fills — once the bar carries an absolute position scale, a surface
              gap would push every fill after it off the coordinate the mark is drawn on. What
              keeps neighbouring hues apart is the palette's own adjacent-pair separation.
              Decorative: the legend below carries every figure, which is why the bar is hidden
              from assistive tech and offers hover rather than focus. */}
          <div
            aria-hidden
            className="relative mt-2 h-2 bg-gray-200 dark:bg-gray-800"
            style={{ marginBottom: MARK_OVERHANG_PX }}
          >
            <div
              className="absolute inset-y-0 left-0 flex overflow-hidden"
              style={{ width: `${(now / max) * 100}%`, minWidth: now > 0 ? MIN_FILL_PX : 0 }}
            >
              {composition.parts.map((p) =>
                p.tokens > 0 ? (
                  <span
                    key={p.key}
                    title={`${PART_LABELS[p.key]()} ~${humanizeTokens(p.tokens)} · ${p.percent}%`}
                    onMouseEnter={() => setHovered(p.key)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ flexGrow: p.tokens, flexBasis: 0 }}
                    className={`h-full transition-opacity duration-150 ${p.color} ${
                      hoveredPart !== null && hoveredPart !== p.key ? "opacity-25" : ""
                    }`}
                  />
                ) : null,
              )}
            </div>
            {compactAt !== null && (
              <span
                title={S.chat.contextCompactAt(humanizeTokens(compactAt))}
                style={{
                  left: `${(compactAt / max) * 100}%`,
                  top: -MARK_OVERHANG_PX,
                  bottom: -MARK_OVERHANG_PX,
                }}
                className="absolute border-l border-dashed border-gray-500 dark:border-gray-400"
              />
            )}
          </div>

          <ul className="mt-2 space-y-0.5">
            {composition.parts.map((p) => (
              <ShareRow
                key={p.key}
                label={PART_LABELS[p.key]()}
                swatch={p.color}
                tokens={p.tokens}
                percent={p.percent}
                highlighted={hovered === p.key}
                onHover={(on) => setHovered(on ? p.key : null)}
              />
            ))}
          </ul>

          {composition.tools.length > 0 && (
            <>
              <p
                title={S.chat.contextTopToolsHint}
                className="mt-2 border-t border-gray-100 pt-1.5 text-gray-400 dark:border-gray-800 dark:text-gray-500"
              >
                {S.chat.contextTopTools}
              </p>
              <ul className="mt-1 space-y-0.5">
                {composition.tools.map((t) => (
                  <ShareRow
                    key={t.name}
                    label={t.name}
                    mono
                    tokens={t.tokens}
                    percent={t.percent}
                    highlighted={hovered === `tool:${t.name}`}
                    onHover={(on) => setHovered(on ? `tool:${t.name}` : null)}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Part label lookups, read at render time: `S` is a live binding swapped on locale change. */
const PART_LABELS: Record<ContextPartKey, () => string> = {
  systemPrompt: () => S.chat.contextPartSystemPrompt,
  toolDefs: () => S.chat.contextPartToolDefs,
  userMessages: () => S.chat.contextPartUserMessages,
  assistantMessages: () => S.chat.contextPartAssistantMessages,
  toolRequests: () => S.chat.contextPartToolRequests,
  toolResults: () => S.chat.contextPartToolResults,
};

/** One `swatch · label · ~tokens · percent` line, shared by the six parts and the tool ranking. */
function ShareRow({
  label,
  swatch,
  tokens,
  percent,
  mono = false,
  highlighted = false,
  onHover,
}: {
  label: string;
  /** Legend colour of the matching bar segment; absent for the tool ranking, which has no segment. */
  swatch?: string;
  tokens: number;
  /** Already a whole percent (apportioned for the parts, rounded for the tools) — not re-rounded here. */
  percent: number;
  mono?: boolean;
  highlighted?: boolean;
  onHover?: (on: boolean) => void;
}) {
  return (
    <li
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={`-mx-1 flex items-center gap-1.5 rounded px-1 py-px transition-colors duration-150 ${
        highlighted ? "bg-gray-100 dark:bg-gray-800" : ""
      }`}
    >
      {swatch !== undefined && (
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-[2px] ${swatch}`} />
      )}
      <span
        title={label}
        className={`min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300 ${mono ? "font-mono" : ""}`}
      >
        {label}
      </span>
      <span className="shrink-0 font-mono font-medium text-gray-900 dark:text-gray-100">
        ~{humanizeTokens(tokens)}
      </span>
      <span className="w-8 shrink-0 text-right font-mono text-gray-400 dark:text-gray-500">
        {percent}%
      </span>
    </li>
  );
}
