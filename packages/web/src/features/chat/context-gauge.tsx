/**
 * Context usage gauge in the composer toolbar, and the composition panel behind it.
 *
 * The resting state is the ring this toolbar has always shown: a **single-colour** indicator of
 * total occupancy (no bucketing) next to `used/window`, turning amber past 80% and red past 95%.
 * When the model has no `context_window` configured, resolveContextWindow falls back to 128000
 * and the ring is drawn as usual — the ratio always has a reference point instead of degrading
 * into a lone number.
 *
 * `unknown` (a compaction succeeded and the next regular Request has not reported usage yet)
 * draws an empty ring with `—` for the value. **Never 0**: that would claim the context had been
 * cleared while the summary itself occupies tokens. Nothing has been measured yet, which is not
 * the same as having measured zero — and the panel says exactly that rather than describing the
 * context that was just compacted away.
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
const PANEL_WIDTH = 360;
const PANEL_MAX_WIDTH = "calc(100vw - 32px)";
const PANEL_HEIGHT = 360;

/** Smallest painted width (px) of a composition segment, so every colour in the legend also appears in the bar. Below ~1% of the bar the floor distorts the proportion it stands for, which is the trade for not dropping the part entirely. */
const MIN_SEGMENT_PX = 2;

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
  const usageText = unknown
    ? S.chat.contextUnknown
    : `${S.chat.contextUsage} ${Math.round(pct * 100)}%`;
  const R = 5;
  const C = 2 * Math.PI * R;
  const gauge = (
    <>
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
      {/* The ring alone carries the meaning on phones: the numbers hide below @md (the title
          still shows the exact usage), keeping the right-hand control group inside a 320px
          viewport in the running state. */}
      <span className="hidden @md:inline">
        {unknown ? "—" : humanizeTokens(now)}/{humanizeTokens(max)}
      </span>
    </>
  );
  const shell = `flex shrink-0 items-center gap-1 font-mono ${color}`;

  if (sessionId === undefined) {
    return (
      <span title={usageText} className={shell}>
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
        className={`${shell} -mx-1 cursor-pointer rounded px-1 py-0.5 transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`}
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
            className="anim-pop z-[60] rounded-md border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900"
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
          {/* Composition strip: full width is the context in use, so the parts stay readable at
              any occupancy — how full the window is has already been said by the ring and by the
              header. A 2px gap of the panel's own surface separates the fills, so no two hues
              ever touch. */}
          <div aria-hidden className="mt-2.5 flex h-1.5 gap-[2px]">
            {composition.parts.map((p) =>
              p.tokens > 0 ? (
                <span
                  key={p.key}
                  style={{ flexGrow: p.tokens, flexBasis: 0, minWidth: MIN_SEGMENT_PX }}
                  className={`h-full rounded-full ${p.color}`}
                />
              ) : null,
            )}
          </div>

          <ul className="mt-2.5 space-y-1">
            {composition.parts.map((p) => (
              <ShareRow
                key={p.key}
                label={PART_LABELS[p.key]()}
                swatch={p.color}
                tokens={p.tokens}
                percent={p.percent}
              />
            ))}
          </ul>

          {composition.tools.length > 0 && (
            <>
              <p
                title={S.chat.contextTopToolsHint}
                className="mt-3 border-t border-gray-100 pt-2 text-gray-400 dark:border-gray-800 dark:text-gray-500"
              >
                {S.chat.contextTopTools}
              </p>
              <ul className="mt-1.5 space-y-1">
                {composition.tools.map((t) => (
                  <ShareRow
                    key={t.name}
                    label={t.name}
                    mono
                    tokens={t.tokens}
                    percent={t.percent}
                  />
                ))}
              </ul>
            </>
          )}

          <p className="mt-2.5 border-t border-gray-100 pt-2 text-[11px] leading-snug text-gray-400 dark:border-gray-800 dark:text-gray-500">
            {S.chat.contextEstimated}
          </p>
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
}: {
  label: string;
  /** Legend colour of the matching bar segment; absent for the tool ranking, which has no segment. */
  swatch?: string;
  tokens: number;
  /** Already a whole percent (apportioned for the parts, rounded for the tools) — not re-rounded here. */
  percent: number;
  mono?: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
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
