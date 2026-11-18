/**
 * The transcript's activity card: one card for everything that streams through the transcript as
 * work rather than as words. The agent's work is a run of consecutive steps (thinking rows, tool
 * calls) folded under one head between two pieces of its reply, the head's title doubling as the
 * state ("Running", "Done"); a harness event is something the harness did or injected rather
 * than the agent — an MCP connection, a compaction, a background task settling, a message the
 * harness wrote — under the same head (title, one-line detail, duration). Both are one card, so
 * running, success and failure are one row in every theme, with only the mark, the title's ink
 * and the detail changing, and a theme has one anatomy to dress. Its rows are `DisclosureRow`s.
 *
 * The body is one of two shapes, or none. `rows` are the activity's own steps (the agent's steps,
 * a compaction's sections, an MCP connection's servers), hung off the head one tree level down;
 * `children` is one piece the caller styles (a report in the output block). With neither the head
 * is a static line: no button, no chevron, no hover.
 *
 * Work groups can list collapsed or expanded rows, or page through them behind one compact
 * header. A completed turn can provide a terminal page. The host supplies the actual turn
 * outcome separately from a group settling between messages. A search temporarily exposes
 * all loaded rows without changing the reader's page or disclosures.
 *
 * The head is a title bar of its own (the muted ground, a short title that doubles as the state),
 * a different layer from the rows on the surface below it, so the parent and its children read
 * apart. It is sticky against the transcript's scrollport, so a long open card can be collapsed
 * from anywhere inside it; this is the first of two stacked sticky levels, the row being read
 * pinning right below it. Collapsing while the head is stuck lands the view back on the card.
 *
 * The duration follows the count and the detail: a live clock while a step is in flight
 * (`stepRunning`), the settled span once nothing is. A work group's span runs from its earliest
 * step's start to its latest's end, so a group that merely stays open between steps does not
 * tick, or the number would climb past the span and snap back when the group settles.
 *
 * The settle is one movement in three parts, each on the theme's motion: the head's label, mark
 * and details ease into their settled ink (`theme.css`), the settled glyph and the settled title
 * arrive under `data-reveal` (only for a change the reader watched — a card that loads settled
 * reveals nothing), and the body folds away through `Fold` rather than vanishing, the reply
 * below rising with it. Rows appended to an open body arrive under `data-reveal` too; the rows a
 * body opens with do not, so reopening a finished card replays nothing.
 *
 * Three hooks: the card is a frame (its head the head, its body the body), the head is an
 * activity row of the caller's kind with the state folded onto the hook's three (a failure is
 * an error, anything settled is done), and the rows hang off the head one level down as a tree,
 * so a theme may join them to it with connector rules instead of the box. Each row is wrapped
 * rather than marked on its own root, because a step also renders outside a card. The title is
 * a fixed phrase in sentence case on the small rung, uppercased only by a theme's recipe; names
 * go in the detail, which no recipe recases.
 */
import { createContext, useRef, useState } from "react";
import type { Key, ReactNode } from "react";
import { useArrived } from "../../../motion/use-arrived";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import type { RunState } from "../../icons/status-icon/status-icon";
import { DurationSlot } from "../../feedback/duration-slot/duration-slot";
import {
  ACTIVITY_HEAD_CLASS,
  ActivityMarkSlot,
  ActivityProgress,
  ActivityToggle,
  DISCLOSURE_CARD_CLASS,
  DISCLOSURE_HEADER_ROW_CLASS,
  DISCLOSURE_HEADER_STICKY_CLASS,
  DISCLOSURE_HEADER_TITLE_CLASS,
  activityState,
} from "../../layout/disclosure-row/disclosure-row";
import type { ActivityKind, ActivityMark } from "../../layout/disclosure-row/disclosure-row";
import { Fold } from "../../layout/fold/fold";
import { CompactStepHeader } from "./compact-step-header";
import { StepDisclosure } from "./step-disclosure";
import { WallpaperBackdrop } from "../../shell/app-shell/wallpaper";

/**
 * The title's ink says the state with the mark: live work in the success ink, a failure in the
 * danger ink, so a failed activity never rests on its icon alone, anything settled receding.
 */
const TITLE_INK: Readonly<Record<ActivityMark["state"], string>> = {
  running: "text-tone-success-fg",
  done: "text-fg-muted",
  error: "text-tone-danger-fg",
};

/** A search temporarily mounted these pages. Search previews should use their already loaded content. */
export const ActivitySearchPreview = createContext(false);

export type ActivityDisplayMode = "standard" | "expanded" | "compact";

export interface ActivityStepSummary {
  kind?: ActivityKind;
  label: string;
  state: RunState;
  stateLabel?: string;
  startMs?: number;
  durationMs?: number;
  offsetMs?: number;
}

/** One of the activity's steps under the head, keyed for React. */
export interface ActivityGroupRow {
  key: Key;
  content: ReactNode;
  summary?: ActivityStepSummary;
  /** An approval or a retry is waiting on this step. */
  needsAction?: boolean;
}

export interface ActivityStepNavigation {
  previous: string;
  next: string;
  latest: string;
  waiting: string;
  position: (step: number, total: number) => string;
  /** Expose every step to a search of this transcript, preserving the reading position. */
  revealAll: boolean;
}

/**
 * The rows under an open head. The rows present when the body opens are its content; a row
 * appended while it is open arrives under `data-reveal`. Decided per mount of the body, so the
 * attribute stays put on a row for as long as it is mounted (removing it mid-way would cut the
 * reveal short), and a body reopened later mounts every row settled.
 */
function ActivityRows({
  rows,
  revealNew = true,
}: {
  rows: readonly ActivityGroupRow[];
  revealNew?: boolean;
}) {
  const [present] = useState(() => new Set(rows.map((row) => row.key)));
  return (
    <>
      {rows.map((row, index) => (
        <div
          key={row.key}
          data-depth="1"
          data-last={index === rows.length - 1 ? "true" : undefined}
          data-reveal={revealNew && !present.has(row.key) ? true : undefined}
        >
          {row.content}
        </div>
      ))}
    </>
  );
}

export interface ActivityGroupProps {
  /** What the head's activity mark names: the agent's thinking only, its tool work, or a harness event. */
  kind: ActivityKind;
  /**
   * The activity's run state: running while it may still change (the caller decides — a trailing
   * work group of a running task counts), then done, failed or stopped. The body follows it until
   * the reader toggles the card.
   */
  state: RunState;
  /**
   * A step is in flight right now: the duration ticks and the progress slot shows. By default
   * whenever the state is running; a work group passes it, since it stays running between steps.
   */
  stepRunning?: boolean;
  /** The head's title, a fixed phrase that doubles as the state ("Running", "Compacted"); never a name, since a theme may recase it. */
  title: string;
  /** The status icon's accessible name and tooltip, when the title does not already say the state. */
  stateLabel?: string;
  /** A mark naming the activity in place of the status icon (an injected message's hook); a registry glyph's path or a node. */
  mark?: ReactNode;
  /** A count as words ("3 steps"), mono after the title. Hidden below `sm`: the head must stay one uncut line on a phone. */
  count?: string;
  /** One line of status or result, where names go (servers, a failure's reason); mono, truncating, with the full text as its tooltip. */
  detail?: string;
  /** When the activity started: the live clock's origin while a step is in flight. */
  startMs?: number;
  /** The settled span, shown once nothing is in flight. */
  durationMs?: number;
  /**
   * The body is forced open, the reader's own open state kept for later: a step waits on an
   * approval, or the caller needs the rows on screen (a search of the transcript).
   */
  pending?: boolean;
  /**
   * The activity's steps, one tree level under the head. Present (even empty, before the first
   * step lands) it adds the chevron.
   */
  rows?: readonly ActivityGroupRow[];
  /** Presentation of reasoning and tool groups. Other activities keep their normal disclosure. */
  displayMode?: ActivityDisplayMode;
  /** Actual end of the turn, reported once on its last work group. */
  terminal?: { state: "done" | "failed" | "stopped"; label: string; durationMs?: number };
  /** Pager and action labels for a work group and its transcript-search state. */
  stepNavigation?: ActivityStepNavigation;
  /** A body of one piece the caller styles, in place of rows; its presence adds the chevron too. */
  children?: ReactNode;
}

interface ReadingState {
  mode: ActivityDisplayMode;
  open: boolean | null;
  pageKey: Key | null;
  disclosures: ReadonlyMap<Key, boolean>;
}

function initialReadingState(mode: ActivityDisplayMode): ReadingState {
  return { mode, open: null, pageKey: null, disclosures: new Map() };
}

export function ActivityGroup({
  kind,
  state,
  stepRunning,
  title,
  stateLabel,
  mark,
  count,
  detail,
  startMs,
  durationMs,
  pending = false,
  rows,
  stepNavigation,
  displayMode: preference = "standard",
  terminal,
  children,
}: ActivityGroupProps) {
  const hookState = activityState(state);
  const running = hookState === "running";
  const inFlight = stepRunning ?? state === "running";
  const displayMode = stepNavigation ? preference : "standard";
  const [view, setView] = useState(() => initialReadingState(displayMode));
  // A preference change applies the new defaults before React commits the next frame.
  if (view.mode !== displayMode) setView(initialReadingState(displayMode));
  /** The reader closed the card: land the view on it once the fold has finished. */
  const landOnClose = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // The state changed while on screen: the title swapped in for it and the settled glyph arrive.
  const settledHere = useArrived(hookState);
  const hasChildren = children !== undefined && children !== null;
  const expandable = rows !== undefined || hasChildren;

  const compact = displayMode === "compact";
  const finding = !!stepNavigation?.revealAll;
  const stepCount = rows?.length ?? 0;
  const total = stepCount + (terminal ? 1 : 0);
  const selected =
    view.pageKey === null ? -1 : (rows?.findIndex((row) => row.key === view.pageKey) ?? -1);
  const page = selected >= 0 ? selected : total - 1;
  const pageRow = rows?.[page];
  const terminalPage = !!terminal && page === stepCount;
  const summary: ActivityStepSummary = (terminalPage ? terminal : pageRow?.summary) ?? {
    label: title,
    state,
    startMs,
    durationMs,
  };
  const shown =
    expandable &&
    (finding ||
      (compact
        ? !terminalPage && (view.open ?? false)
        : pending || (view.open ?? (displayMode === "expanded" || running))));
  function toggle() {
    landOnClose.current = shown && !finding && (compact || !pending);
    setView((prior) => ({ ...prior, open: !shown }));
  }
  function goTo(index: number) {
    // The newest page has no pinned id, so it continues to follow new arrivals.
    const pageKey = index === total - 1 ? null : (rows?.[index]?.key ?? null);
    setView((prior) => ({ ...prior, pageKey }));
  }
  // Cycle through simultaneous approvals, including the selected one when the group is shut.
  const nextWaiting = rows?.findIndex((row, index) => row.needsAction && index > page) ?? -1;
  const waiting =
    nextWaiting >= 0
      ? nextWaiting
      : (rows?.findIndex((row, index) => row.needsAction && (index !== page || !shown)) ?? -1);
  const visibleRows = compact && !finding ? (pageRow ? [pageRow] : []) : rows;
  function renderRows() {
    if (!stepNavigation) return rows ?? [];
    return (visibleRows ?? []).map((row) => {
      const expanded = view.disclosures.get(row.key) ?? displayMode === "expanded";
      return {
        ...row,
        content: (
          <StepDisclosure.Provider
            value={{
              open: finding || expanded,
              bounded: compact && !finding,
              follow: running && selected < 0,
              toggle: () => {
                if (!finding)
                  setView((prior) => ({
                    ...prior,
                    disclosures: new Map(prior.disclosures).set(row.key, !expanded),
                  }));
              },
            }}
          >
            {row.content}
          </StepDisclosure.Provider>
        ),
      };
    });
  }
  const showDuration = inFlight
    ? startMs !== undefined
    : durationMs !== undefined && durationMs > 0;

  const parts = (
    <>
      <ActivityMarkSlot mark={mark ?? <StatusIcon state={state} label={stateLabel} />} />
      {/* Keyed by the state, so the running title (and Frost's sweep across it) leaves with
          its element and the settled one arrives as a new one. */}
      <span
        key={hookState}
        data-slot="label"
        data-reveal={settledHere || undefined}
        className={`${DISCLOSURE_HEADER_TITLE_CLASS} ${TITLE_INK[hookState]}`}
      >
        {title}
      </span>
      {count !== undefined && (
        <span
          data-slot="detail"
          className="hidden shrink-0 font-mono text-xs text-fg-subtle sm:inline"
        >
          {count}
        </span>
      )}
      {/* min-w-0 (not flex-1) lets a long detail truncate while a short one keeps the duration
          snug against it; the trailing spacer pins the chevron to the far edge. */}
      {detail !== undefined && (
        <span
          data-slot="detail"
          data-tooltip={detail}
          data-tooltip-content="code"
          className="min-w-0 truncate font-mono text-xs text-fg-subtle"
        >
          {detail}
        </span>
      )}
      {showDuration && (
        <DurationSlot
          data-slot="detail"
          running={inFlight}
          sinceMs={startMs}
          durationMs={durationMs}
        />
      )}
      <ActivityProgress running={inFlight} />
      {expandable && <ActivityToggle open={shown} />}
      <span className="min-w-0 flex-1" />
    </>
  );

  return (
    <div
      ref={rootRef}
      className={`ui-frame ${DISCLOSURE_CARD_CLASS}`}
      data-step-view={stepNavigation ? (finding ? "find" : displayMode) : undefined}
    >
      {compact && stepNavigation && !finding && total > 0 ? (
        <div
          data-slot="head"
          data-step-head=""
          data-kind={summary.kind ?? kind}
          data-state={activityState(summary.state)}
          data-step-terminal={terminalPage || undefined}
          className={`ui-activity ${DISCLOSURE_HEADER_STICKY_CLASS} flex min-w-0 items-center bg-surface-muted py-0.5 pe-12 sm:pe-1`}
        >
          <WallpaperBackdrop />
          <CompactStepHeader
            summary={summary}
            navigation={stepNavigation}
            page={page}
            total={total}
            terminal={terminalPage}
            open={shown}
            toggle={toggle}
            goTo={goTo}
            showAction={
              waiting < 0
                ? undefined
                : () => {
                    goTo(waiting);
                    setView((prior) => ({ ...prior, open: true }));
                  }
            }
          />
        </div>
      ) : expandable ? (
        <button
          type="button"
          data-group-header
          aria-expanded={shown}
          onClick={toggle}
          className={`ui-activity ${DISCLOSURE_HEADER_STICKY_CLASS} ${DISCLOSURE_HEADER_ROW_CLASS}`}
          data-slot="head"
          data-kind={kind}
          data-state={hookState}
        >
          <WallpaperBackdrop />
          {parts}
        </button>
      ) : (
        <div
          className={`ui-activity ${ACTIVITY_HEAD_CLASS} w-full bg-surface-muted`}
          data-slot="head"
          data-kind={kind}
          data-state={hookState}
        >
          {parts}
        </div>
      )}
      {expandable && (
        <Fold
          open={shown}
          data-slot="body"
          bodyClassName={
            rows !== undefined ? "ui-tree divide-y divide-line-muted border-t border-line" : ""
          }
          onClosed={() => {
            if (!landOnClose.current) return;
            landOnClose.current = false;
            rootRef.current?.scrollIntoView({ block: "nearest" });
          }}
        >
          {() =>
            rows !== undefined ? (
              <ActivitySearchPreview.Provider value={finding}>
                <ActivityRows rows={renderRows()} revealNew={!compact} />
              </ActivitySearchPreview.Provider>
            ) : (
              children
            )
          }
        </Fold>
      )}
    </div>
  );
}
