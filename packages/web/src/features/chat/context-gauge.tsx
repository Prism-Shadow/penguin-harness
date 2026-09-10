/**
 * Context usage gauge in the composer toolbar, and the composition panel behind it.
 *
 * The resting state is the ring alone: a **single-colour** indicator of total occupancy (no
 * bucketing), turning amber past 80% and red past 95%. The exact `used/basis` figures are not
 * printed beside it — the panel a click away leads with them, and hovering the ring names them
 * too.
 *
 * What it fills against is the **effective compaction threshold**, not the model window: the
 * question a reader brings to this ring is how much room is left before the context is
 * summarized away, and against a window that dwarfs the threshold every answer looks like
 * "plenty" (64k used at a 128k threshold on a 1M window would draw 6% instead of 50%). The
 * basis therefore comes from contextFillBasis, which caps the Agent's configured threshold by
 * what the window leaves room for — exactly the derivation the Agent itself compacts at. Where
 * no threshold applies it falls back to the window: compaction switched off, and a caller with
 * no Agent config to give (the subagent composer).
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
 * occupies the most of it, and the files the file tools named; a switch above the ranking picks
 * which of the two it lists. Those figures come from a character heuristic, not a tokenizer (this
 * project bundles none), so only their **shares** are used: each part is drawn as its share of
 * `now`, the measured occupancy the ring itself shows. The parts therefore always add up to the
 * figure in the panel header, and the estimate's absolute error never reaches the display; the
 * `~` on every derived value marks what is still an approximation.
 *
 * The bar runs to the **model window**, not to the threshold the ring uses. The two answer
 * different questions and each keeps its own scale: the ring says how close compaction is, the
 * bar says how much model there is and where inside it the trigger sits — drawn as a dashed
 * cutter at the effective threshold. Making both read the threshold cost the bar its only
 * answer, since a bar that ends on the trigger point can no longer show the room past it. The
 * header carries the ring's figures (`used / threshold`, with the window named beside them when
 * it is larger), so nothing is lost by the bar keeping the other scale. While the panel is open
 * the server's own reading of the threshold wins over the client's: both come from the same
 * derivation, so they differ only when the Agent's config changed after this page loaded. The
 * parts subdivide the filled run; their exact shares are the legend's job, since at low
 * occupancy the run is only a few pixels wide. Hovering a segment or its legend row links the
 * two: the row lights up and the other segments fade.
 *
 * The cutter is also the control that moves the threshold. Dragging it (or focusing it and
 * using the arrow keys) proposes a value on a 1,000-token lattice, and the release opens a
 * confirmation carrying an editable number — a gesture this coarse must not write a
 * configuration value on its own, and the dialog is also where a threshold above the window can
 * be typed deliberately. Confirming writes the Agent's `compaction.max_context_length` and it
 * applies to this conversation at once, without waiting for a compaction to rotate the context.
 * While a proposal is in flight the panel's own dismissal stands down (see `gesture` below):
 * Esc has to cancel the adjustment and then the dialog, and the dialog's overlay would
 * otherwise read as a click outside the panel.
 *
 * The panel is portaled to document.body and positioned against viewport coordinates by
 * usePortalPanel, so the composer's own overflow cannot clip it, and it closes on outside click /
 * Esc / a scroll that moves the ring itself / resize — the message list scrolling under a
 * streaming reply leaves it open. It opens upward on its own: the composer sits at the bottom of
 * the page, so there is never room below.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import type { SessionContextResponse } from "@prismshadow/penguin-server/api";
import { getSessionContext } from "../../api/endpoints";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FILE_EDIT_ICON, FILE_ICON, FILE_WRITE_ICON } from "../../components/ui/icons";
import { Input } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import { usePortalPanel } from "../../components/ui/use-portal-panel";
import {
  MIN_COMPACTION_THRESHOLD,
  THRESHOLD_STEP,
  contextFillBasis,
  resolveContextWindow,
  snapThreshold,
  thresholdCappedByWindow,
  thresholdFraction,
  thresholdFromPointer,
} from "../../lib/context";
import { formatPercent, humanizeTokens } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { usePointerDrag } from "../dock/use-pointer-drag";
import { contextComposition } from "./context-parts";
import type { ContextFileShare, ContextPartKey } from "./context-parts";

/**
 * Panel geometry. The width is applied inline rather than as a `w-*` class because the same
 * number has to reach usePortalPanel, which clamps the left edge with it — a rem-based class
 * would resolve against the app's root font size and drift from the pixel the clamp assumed,
 * letting the panel hang off the right edge on a narrow viewport. The max-width matches the
 * hook's own 16px viewport margin on both sides. The height only decides up or down.
 */
const PANEL_WIDTH = 300;
const PANEL_MAX_WIDTH = "calc(100vw - 32px)";
const PANEL_HEIGHT = 370;
/**
 * The cap usePortalPanel already assumes when it chooses a direction, made real: without it a
 * panel taller than the space it was flipped into is simply cut off by the viewport, and its
 * own scroll is exempt from the hook's close-on-scroll.
 */
const PANEL_MAX_HEIGHT = "70vh";

/** Smallest painted width (px) of the filled run, so a context with a few hundred tokens in it still shows a mark rather than nothing. */
const MIN_FILL_PX = 2;

/** How far (px) the compaction cutter runs past the bar top and bottom: a 9px dash inside the bar reads as a dot, an 18px one reads as dashed. */
const MARK_OVERHANG_PX = 4;

/** Width (px) of the cutter's pointer target, centred on its 1px line: a line is not something a pointer can be asked to hit. */
const CUTTER_HIT_PX = 14;

/** What Shift multiplies the arrow-key step by, so a 1M window is crossable without holding a key down. */
const ARROW_MULTIPLIER = 10;

type PanelState =
  { status: "loading" } | { status: "failed" } | { status: "ready"; data: SessionContextResponse };

/** Which Top 5 the panel's ranking lists. */
type RankingView = "tools" | "files";

/**
 * The ranking view picked last, kept for the tab session: the panel unmounts on every close, and
 * a reader comparing contexts should not have to flip back to Files each time it opens.
 */
let lastRankingView: RankingView = "tools";

export function ContextGauge({
  now,
  window: win,
  compactionLimit,
  unknown = false,
  sessionId,
  agentName,
  onChangeCompactionLimit,
}: {
  now: number;
  window?: number;
  /**
   * The Agent's configured `compaction.max_context_length` (its seeded default when the config
   * carries none). Omitting it makes the ring fill against the model window instead — which is
   * what the subagent composer does: it has no Session-level Agent config at hand, and a ring
   * measured against a threshold nobody supplied would be a made-up number.
   */
  compactionLimit?: number;
  unknown?: boolean;
  /** Enables the composition panel. Omitted where no Session-level endpoint can serve it (the subagent composer), leaving the ring a plain readout. */
  sessionId?: string;
  /** Names the Agent whose threshold the confirmation is about to change; only needed alongside `onChangeCompactionLimit`. */
  agentName?: string;
  /**
   * Writes a new `compaction.max_context_length` to the Agent and re-reads the config this
   * gauge was given, rejecting when the write failed (the caller reports it). Its absence
   * leaves the cutter a readout: a composer with no Agent config to write back to must not
   * offer to change one.
   */
  onChangeCompactionLimit?: (maxContextLength: number) => Promise<void>;
}) {
  const basis = contextFillBasis(compactionLimit, win);
  const windowTokens = resolveContextWindow(win);
  const pct = unknown ? 0 : Math.min(1, now / basis);
  const [open, setOpen] = useState(false);
  // The threshold gesture, held here rather than inside the panel because the panel's own
  // dismissal has to stand down while one is in flight: `usePortalPanel` takes Esc on the
  // capture phase, so an Esc meant for the adjustment (or for the dialog above it) would
  // otherwise close the panel first, and the dialog's overlay is an outside click as far as
  // the panel is concerned.
  const [pendingThreshold, setPendingThreshold] = useState<number | null>(null);
  const [proposal, setProposal] = useState<number | null>(null);
  const [savingThreshold, setSavingThreshold] = useState(false);
  // Bumped after a successful write: the panel's data is a snapshot from when it opened, and
  // its `compactionThreshold` would otherwise keep overriding the fresher value the config
  // refetch just produced.
  const [reloadTick, setReloadTick] = useState(0);
  const gesture = pendingThreshold !== null || proposal !== null;
  const panelId = useId();
  // A gesture must not outlive the panel it was made in: an adjustment left pending would keep
  // the panel's own dismissal suspended for as long as this composer is mounted. The cutter's
  // blur cannot do this — closing the panel unmounts it rather than blurring it.
  const closePanel = (): void => {
    setOpen(false);
    setPendingThreshold(null);
  };
  const { triggerRef, panelRef, position } = usePortalPanel({
    open: open && !gesture,
    onClose: closePanel,
    estimatedHeight: PANEL_HEIGHT,
    panelWidth: PANEL_WIDTH,
  });
  // What the cutter stands on: the effective threshold, and nothing at all when compaction is
  // off (no trigger point to draw) or no Agent config reached this composer. A threshold the
  // window cannot reach still draws — pinned to the right edge by `thresholdFraction` — because
  // the cutter is how such a threshold gets lowered.
  const cutAt = compactionLimit !== undefined && compactionLimit > 0 ? basis : null;
  const confirmThreshold = async (tokens: number): Promise<void> => {
    if (!onChangeCompactionLimit) return;
    setSavingThreshold(true);
    try {
      await onChangeCompactionLimit(tokens);
      setProposal(null);
      setReloadTick((n) => n + 1);
    } catch {
      // Reported by the caller; the dialog stays open on its edited value.
    } finally {
      setSavingThreshold(false);
    }
  };

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
    : `${S.chat.contextUsage} ${Math.round(pct * 100)}% · ${humanizeTokens(now)}/${humanizeTokens(basis)}`;
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
  // Same box as every other icon control on this toolbar (h-8 w-8, matching the model selector
  // and the send button): a 14px ring in a 23px hit area sat visibly short of its neighbours.
  const shell = `flex h-8 w-8 shrink-0 items-center justify-center ${color}`;

  if (sessionId === undefined) {
    return (
      <span title={usageText} aria-label={usageText} role="img" className={shell}>
        {gauge}
      </span>
    );
  }
  return (
    <>
      {/* Hover paints only a background, not the ink its neighbours also change: the ring's colour
          is the warning ladder, and a hover tone would overwrite the very thing it reports. */}
      <button
        ref={triggerRef}
        type="button"
        title={usageText}
        aria-label={usageText}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? closePanel() : setOpen(true))}
        className={`${shell} rounded-md transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`}
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
              maxHeight: PANEL_MAX_HEIGHT,
            }}
            className="anim-pop z-[60] overflow-y-auto rounded-md border border-gray-200 bg-white p-2.5 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            <ContextPanel
              sessionId={sessionId}
              now={now}
              fallbackBasis={basis}
              windowTokens={windowTokens}
              unknown={unknown}
              cutAt={cutAt}
              reloadTick={reloadTick}
              editable={onChangeCompactionLimit !== undefined}
              pendingThreshold={pendingThreshold}
              onPendingThreshold={setPendingThreshold}
              onProposeThreshold={(tokens) => setProposal(tokens)}
            />
          </div>,
          document.body,
        )}
      {proposal !== null && (
        <ThresholdDialog
          agentName={agentName ?? ""}
          current={cutAt ?? basis}
          proposed={proposal}
          contextWindow={win}
          busy={savingThreshold}
          onClose={() => setProposal(null)}
          onConfirm={confirmThreshold}
        />
      )}
    </>
  );
}

function ContextPanel({
  sessionId,
  now,
  fallbackBasis,
  windowTokens,
  unknown,
  cutAt,
  reloadTick,
  editable,
  pendingThreshold,
  onPendingThreshold,
  onProposeThreshold,
}: {
  sessionId: string;
  now: number;
  /** The ring's own basis, shown until the server's reading of the threshold arrives. */
  fallbackBasis: number;
  /** The model's resolved context window: the bar's scale, and named beside the ratio when it is larger than the basis. */
  windowTokens: number;
  unknown: boolean;
  /** The client's reading of the effective compaction threshold, or null when there is no cutter to draw. */
  cutAt: number | null;
  /** Changes when a threshold write lands, re-running the fetch so the snapshot below stops being older than the config. */
  reloadTick: number;
  /** Whether the cutter accepts a gesture at all. */
  editable: boolean;
  /** The value the cutter is being dragged (or arrowed) to, held by the gauge above. */
  pendingThreshold: number | null;
  onPendingThreshold: (tokens: number | null) => void;
  onProposeThreshold: (tokens: number) => void;
}) {
  // A snapshot taken when the panel opens (it only mounts while open), not a live counter: the
  // endpoint re-reads a whole Trace shard, so polling it through a streaming run is not free.
  // The figures in the header above stay live — they come from the ring's own props — so what
  // holds still is the composition breakdown, for as long as the panel is left open.
  const [state, setState] = useState<PanelState>({ status: "loading" });
  // Row id under the pointer — a part key, or `tool:<name>` / `file:<path>` for the ranking
  // below. One piece of state for both lists, so a hovered ranking row cannot also dim the bar
  // it has no segment in.
  const [hovered, setHovered] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankingView>(lastRankingView);
  const pickRanking = (view: RankingView) => {
    lastRankingView = view;
    setRanking(view);
  };
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
  }, [sessionId, reloadTick]);

  const data = state.status === "ready" ? state.data : null;
  // The server re-reads the Agent's config from disk when the panel opens, so its threshold is
  // the fresher of the two; the client's is the same derivation over the config this page
  // loaded with. Null means no threshold is in force (compaction off), and then the ring's own
  // fallback — the window — is what both the header and the bar are drawn against.
  const basis = data?.compactionThreshold ?? fallbackBasis;
  const pct = Math.min(1, now / basis);
  // The bar's own scale is the window, so its filled run is a different ratio from the header's.
  const fill = Math.min(1, now / windowTokens);
  // The server re-read the config when the panel opened, so its threshold is the fresher of the
  // two — but it reports null both for "compaction off" and for "at or past the window", and the
  // second of those still needs a cutter (pinned to the right edge) to lower it with. The
  // client's value settles that case, and a write bumps `reloadTick` so this can never be the
  // stale one.
  const threshold = data?.compactionThreshold ?? cutAt;
  const barRef = useRef<HTMLDivElement>(null);
  // `contextClosed` is the server seeing what `unknown` reports from the stream: a completed
  // compaction, and no measurement of the new context yet. Both say the occupancy is unknown
  // rather than zero, so both render `—` instead of describing a context that no longer exists.
  const unmeasured = unknown || data?.contextClosed === true;
  const composition = data === null ? null : contextComposition(data, now);
  const hoveredPart = composition?.parts.some((p) => p.key === hovered) ? hovered : null;

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
          {unmeasured ? "—" : humanizeTokens(now)} / {humanizeTokens(basis)}
        </span>
      </div>
      {/* The window, when the threshold does not reach it: the ratio above answers "how close to
          compaction", and this answers "and how much model there is behind it" — a distinction
          the header used to collapse by measuring against the window itself. */}
      {windowTokens > basis && (
        <p className="mt-0.5 text-right font-mono text-gray-400 dark:text-gray-500">
          {S.chat.contextWindowIs(humanizeTokens(windowTokens))}
        </p>
      )}

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
          {/* The bar's scale is the model window: the filled run is the occupancy, the rest is
              the room the model still has, and the dashed cutter is where compaction fires.
              Squared off, and with no gaps between the fills — the bar carries an absolute
              position scale, so a surface gap would push every fill after it off the coordinate
              the cutter is drawn on. What keeps neighbouring hues apart is the palette's own
              adjacent-pair separation. The track is decorative (the legend below carries every
              figure, which is why it is hidden from assistive tech and offers hover rather than
              focus); the cutter beside it is not, and it is a focusable control, which is why
              `aria-hidden` sits on the track alone and never on the box that holds both. */}
          <div
            ref={barRef}
            className="relative mt-2 h-2"
            style={{ marginBottom: MARK_OVERHANG_PX }}
          >
            <div aria-hidden className="absolute inset-0 bg-gray-200 dark:bg-gray-800">
              <div
                className="absolute inset-y-0 left-0 flex overflow-hidden"
                style={{ width: `${fill * 100}%`, minWidth: now > 0 ? MIN_FILL_PX : 0 }}
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
            </div>
            {threshold !== null && (
              <ThresholdCutter
                barRef={barRef}
                threshold={threshold}
                windowTokens={windowTokens}
                editable={editable}
                pending={pendingThreshold}
                onPending={onPendingThreshold}
                onPropose={onProposeThreshold}
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
              {/* The heading names the ranking on show and its tooltip says what it is ordered
                  by; the switch beside it swaps both. A context with tool traffic but no file
                  traffic keeps the switch, so the Files view can say so itself. */}
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-1.5 dark:border-gray-800">
                <p
                  title={
                    ranking === "tools" ? S.chat.contextTopToolsHint : S.chat.contextTopFilesHint
                  }
                  className="min-w-0 truncate text-gray-400 dark:text-gray-500"
                >
                  {ranking === "tools" ? S.chat.contextTopTools : S.chat.contextTopFiles}
                </p>
                <div className="w-24 shrink-0">
                  <Segmented
                    cols={2}
                    value={ranking}
                    onChange={pickRanking}
                    options={[
                      { value: "tools", label: S.chat.contextRankTools },
                      { value: "files", label: S.chat.contextRankFiles },
                    ]}
                  />
                </div>
              </div>
              {ranking === "tools" ? (
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
              ) : composition.files.length === 0 ? (
                <p className="mt-1 text-gray-400 dark:text-gray-500">
                  {S.chat.contextNoFileTraffic}
                </p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {composition.files.map((f) => (
                    <ShareRow
                      key={f.path}
                      title={f.path}
                      label={
                        <>
                          <span className="font-medium text-gray-700 dark:text-gray-200">
                            {f.name}
                          </span>
                          {f.dir !== "" && (
                            <span className="ml-1 text-gray-400 dark:text-gray-500">{f.dir}</span>
                          )}
                        </>
                      }
                      mono
                      meta={<FileOps ops={f.ops} />}
                      tokens={f.tokens}
                      percent={f.percent}
                      highlighted={hovered === `file:${f.path}`}
                      onHover={(on) => setHovered(on ? `file:${f.path}` : null)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * The dashed mark on the bar at the effective compaction threshold — and the control that moves
 * it. Two absolutely positioned children of the bar box: the line itself inside a comfortable
 * pointer target, and the value being proposed while a gesture is running.
 *
 * The gesture is deliberately coarse and deliberately does not commit. It snaps to
 * `THRESHOLD_STEP` because nobody means 127,431 tokens, it stops at the bar's own ends, and its
 * release hands the value to a confirmation rather than writing it: a stray drag across a panel
 * must not silently re-configure an Agent, and the dialog is where a threshold above the window
 * can still be typed on purpose.
 *
 * Keyboard reaches the same place: `role="slider"` with the arrow keys on the same lattice
 * (Shift takes ten steps), Enter for the release and Escape to abandon the adjustment. Escape
 * gets to stop here rather than closing the panel because the gauge suspends the panel's own
 * key handling while a proposal is pending. The pending value also lives up there, so the
 * suspension and the mark can never disagree about whether a gesture is running.
 */
function ThresholdCutter({
  barRef,
  threshold,
  windowTokens,
  editable,
  pending,
  onPending,
  onPropose,
}: {
  barRef: RefObject<HTMLDivElement | null>;
  threshold: number;
  windowTokens: number;
  editable: boolean;
  pending: number | null;
  onPending: (tokens: number | null) => void;
  onPropose: (tokens: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const shown = pending ?? threshold;
  // `usePointerDrag`'s onEnd fires in the same tick as the last onMove, before React has
  // re-rendered with the new pending value, so the release reads it from a ref rather than from
  // a closure that is one value behind.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const drag = usePointerDrag<DOMRect>({
    threshold: 3,
    begin: (event) => {
      const rect = barRef.current?.getBoundingClientRect() ?? null;
      // Take focus on the press, so the arrow keys continue where the pointer left off.
      if (rect) event.currentTarget.focus();
      return rect;
    },
    onMove: (event, rect) => {
      onPending(thresholdFromPointer(event.clientX, rect.left, rect.width, windowTokens));
    },
    onEnd: (_rect, dragged) => {
      const proposed = pendingRef.current;
      if (!dragged || proposed === null) return;
      onPending(null);
      onPropose(proposed);
    },
    onCancel: () => onPending(null),
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = THRESHOLD_STEP * (event.shiftKey ? ARROW_MULTIPLIER : 1);
      const from = pendingRef.current ?? threshold;
      onPending(snapThreshold(from + (event.key === "ArrowRight" ? step : -step), windowTokens));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const proposed = pendingRef.current;
      if (proposed === null) return;
      onPending(null);
      onPropose(proposed);
    } else if (event.key === "Escape" && pendingRef.current !== null) {
      event.preventDefault();
      onPending(null);
    }
  };

  const fraction = thresholdFraction(shown, windowTokens);
  const active = pending !== null;
  const lineColor =
    active || focused
      ? "border-gray-900 dark:border-gray-100"
      : "border-gray-500 dark:border-gray-400";
  const box = {
    left: `${fraction * 100}%`,
    marginLeft: -CUTTER_HIT_PX / 2,
    width: CUTTER_HIT_PX,
    top: -MARK_OVERHANG_PX,
    bottom: -MARK_OVERHANG_PX,
  };
  const line = <span aria-hidden className={`h-full border-l border-dashed ${lineColor}`} />;
  return (
    <>
      {editable ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={S.chat.contextThresholdCutter}
          aria-valuemin={MIN_COMPACTION_THRESHOLD}
          // A bogus `context_window` — small enough that core reads it as unconfigured and
          // derives the threshold from the assumed default instead — can leave the threshold
          // above the bar's own scale. The mark pins to the right edge; the announced range has
          // to hold the announced value all the same.
          aria-valuemax={Math.max(windowTokens, shown)}
          aria-valuenow={shown}
          aria-valuetext={humanizeTokens(shown)}
          title={S.chat.contextThresholdHover(humanizeTokens(shown))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onPending(null);
          }}
          {...drag}
          onKeyDown={onKeyDown}
          style={box}
          className="absolute flex cursor-ew-resize touch-none justify-center outline-none"
        >
          {line}
        </div>
      ) : (
        // No config to write back to (the subagent composer): the mark is what it always was —
        // decorative, naming the threshold on hover, and nothing to focus.
        <div
          aria-hidden
          title={S.chat.contextThresholdHover(humanizeTokens(shown))}
          style={box}
          className="absolute flex justify-center"
        >
          {line}
        </div>
      )}
      {/* The proposed value, anchored to whichever side keeps it inside the bar's box: a chip
          centred on the cutter would hang past the panel's edge at either end, and the panel's
          vertical scroll forces the horizontal axis to `auto`, so hanging past it means a
          scrollbar under the whole panel rather than a chip that merely overlaps. */}
      {active && (
        <span
          style={
            fraction > 0.5 ? { right: `${(1 - fraction) * 100}%` } : { left: `${fraction * 100}%` }
          }
          className="absolute -bottom-5 rounded bg-gray-900 px-1 py-px font-mono text-[10px] whitespace-nowrap text-white dark:bg-gray-100 dark:text-gray-900"
        >
          {humanizeTokens(shown)}
        </span>
      )}
    </>
  );
}

/**
 * The confirmation a released cutter opens: what the threshold is now, what it would become,
 * and an editable number in case the drag landed near the intended value rather than on it.
 *
 * The field validates only what a threshold has to be — a whole number above zero. A value
 * above the model window is accepted on purpose (the Agent may move to a roomier model later),
 * and the hint says what the window will do to it in the meantime, naming the number rather
 * than only warning that one exists.
 */
function ThresholdDialog({
  agentName,
  current,
  proposed,
  contextWindow,
  busy,
  onClose,
  onConfirm,
}: {
  agentName: string;
  /** The threshold being replaced, as it stands right now. */
  current: number;
  /** What the gesture proposed; the field opens on it and stays editable. */
  proposed: number;
  contextWindow: number | undefined;
  busy: boolean;
  onClose: () => void;
  onConfirm: (tokens: number) => void;
}) {
  const [text, setText] = useState(String(proposed));
  const trimmed = text.trim();
  const valid = /^\d+$/.test(trimmed) && Number(trimmed) > 0;
  const tokens = valid ? Number(trimmed) : 0;
  const capped = valid ? thresholdCappedByWindow(tokens, contextWindow) : null;
  return (
    <ConfirmModal
      open
      title={S.chat.contextThresholdTitle}
      tone="primary"
      confirmLabel={S.common.save}
      confirmDisabled={!valid}
      busy={busy}
      onClose={onClose}
      onConfirm={() => {
        if (valid) onConfirm(tokens);
      }}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {S.chat.contextThresholdBody(agentName, humanizeTokens(current))}
      </p>
      <div className="mt-3">
        <Input
          label={S.chat.contextThresholdField}
          type="text"
          inputMode="numeric"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          {...(valid
            ? capped !== null
              ? { hint: S.chat.contextThresholdCapped(humanizeTokens(capped)) }
              : {}
            : { error: S.chat.contextThresholdInvalid })}
        />
      </div>
    </ConfirmModal>
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

/** One `swatch · label · meta · ~tokens · percent` line, shared by the six parts and both rankings. */
function ShareRow({
  label,
  title,
  swatch,
  meta,
  tokens,
  percent,
  mono = false,
  highlighted = false,
  onHover,
}: {
  label: ReactNode;
  /** Tooltip of the label; a string label is its own. */
  title?: string;
  /** Legend colour of the matching bar segment; absent for the rankings, which have no segment. */
  swatch?: string;
  /** A slot between the label and the figures: the file ranking's op counts. */
  meta?: ReactNode;
  tokens: number;
  /** Already a whole percent (apportioned for the parts, rounded for the rankings) — not re-rounded here. */
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
        title={title ?? (typeof label === "string" ? label : undefined)}
        className={`min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300 ${mono ? "font-mono" : ""}`}
      >
        {label}
      </span>
      {meta}
      <span className="shrink-0 font-mono font-medium text-gray-900 dark:text-gray-100">
        ~{humanizeTokens(tokens)}
      </span>
      <span className="w-8 shrink-0 text-right font-mono text-gray-400 dark:text-gray-500">
        {percent}%
      </span>
    </li>
  );
}

/**
 * The op counts beside a file row: a glyph and a count per file tool that named the file, zero
 * counts left out. The glyphs are the ones the file summary card and the memory-changes card
 * draw, so a read, an edit and a write look the same here as there.
 */
function FileOps({ ops }: { ops: ContextFileShare["ops"] }) {
  const counts = [
    { key: "read", d: FILE_ICON, n: ops.read, title: S.chat.contextFileReads(ops.read) },
    { key: "edit", d: FILE_EDIT_ICON, n: ops.edit, title: S.chat.contextFileEdits(ops.edit) },
    { key: "write", d: FILE_WRITE_ICON, n: ops.write, title: S.chat.contextFileWrites(ops.write) },
  ].filter((c) => c.n > 0);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-gray-400 dark:text-gray-500">
      {counts.map((c) => (
        <span key={c.key} title={c.title} className={`flex items-center ${ICON_GAP.tight}`}>
          <GlyphIcon d={c.d} size={ICON_SIZE.inlineGlyph} />
          <span aria-hidden className="font-mono">
            {c.n}
          </span>
          <span className="sr-only">{c.title}</span>
        </span>
      ))}
    </span>
  );
}
