/**
 * The chat page's thin top toolbar over an open conversation: the Session title and its run state,
 * the panel switcher, the outline's dropdown fallback, and the live statistics that open the
 * details card (the card itself arrives as children).
 */
import type { ReactNode, RefObject } from "react";
import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import {
  ActivityIcon,
  Dropdown,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  StatChip,
} from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import {
  sessionActivity,
  sessionActivityLabel,
  sessionBackgroundTasks,
} from "../../../lib/session-activity";
import { toneInk } from "../../../lib/tone";
import { STAT_ICONS } from "../../../lib/stat-icons";
import { Truncated } from "../../../components/ui/truncated";
import { OutlineMenuButton } from "../conversation-outline";
import type { OutlineEntry } from "../outline-model";
import { DockToggles } from "../dock-toggles";
import type { HeaderStats } from "./session-stats";

export interface ChatToolbarProps {
  selected: SessionInfo;
  taskState: SessionStatus;
  /** A pending approval sits inside a subagent: the agents toggle carries a dot. */
  agentsPending: boolean;
  /** Whether the gutter tick rail shows; when it cannot, the outline moves up here. */
  railShown: boolean;
  outline: OutlineEntry[];
  /** Turns before the loaded window: the outline's visibility gate counts the whole conversation. */
  turnOffset: number;
  streamScrollRef: RefObject<HTMLDivElement | null>;
  infoOpen: boolean;
  setInfoOpen: (open: boolean) => void;
  hs: HeaderStats;
  currency: string;
  /** The details card. */
  children: ReactNode;
}

export function ChatToolbar({
  selected,
  taskState,
  agentsPending,
  railShown,
  outline,
  turnOffset,
  streamScrollRef,
  infoOpen,
  setInfoOpen,
  hs,
  currency,
  children,
}: ChatToolbarProps) {
  /**
   * Header glyph state. Never unread: this is the Session on screen, so its last reply is being
   * read right now — the read/unread split is a sidebar affordance, and passing the live marker
   * here would only flash the unread tone for the frame before the effect above stamps it.
   */
  const headerActivity = sessionActivity(taskState, selected.hasTrace, false);
  /** Background tasks the conversation still owns — the same live count the sidebar row's mark carries. */
  const backgroundCount = sessionBackgroundTasks(selected);
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 md:px-4 dark:border-gray-800">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* The page's h1 on the compact title rung: a toolbar title, not a display title. */}
        <Heading level={5} as="h1" className="flex min-w-0">
          <Truncated text={selected.title ?? S.chat.defaultSessionTitle} />
        </Heading>
        {/* Session-level state: a turning hourglass while the run is active, and nothing at
            all once it settles — the conversation on screen is by definition read, and the
            unread dot is a sidebar affordance for the rows you are NOT looking at. The
            compacting state stays in the stream banner rather than being repeated here.
            Below sm only the glyph remains so the title keeps its room. */}
        {headerActivity === "running" && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <ActivityIcon activity={headerActivity} label={sessionActivityLabel(headerActivity)} />
            <span className="hidden sm:inline">{sessionActivityLabel(headerActivity)}</span>
          </span>
        )}
      </div>

      {/* Panel switcher (icon-only): pinned triggers + the "create" dropdown with
          placement actions and pin toggles. Every entry is a dock tab (features/dock)
          — the toolbar reads and drives the dock store directly; this page only feeds
          the pending-approval dot. */}
      <DockToggles agentsPending={agentsPending} />

      {/* Conversation index fallback: exactly when the gutter tick rail can't show
          (phones without a hover pointer; a desktop window whose gutter a docked panel
          ate) the index moves up here as a dropdown — navigation stays reachable. */}
      {!railShown && (
        <OutlineMenuButton
          entries={outline}
          turnOffset={turnOffset}
          scrollRef={streamScrollRef}
          running={taskState !== "idle"}
        />
      )}

      {/* Details entry, at the toolbar's far right — the stats ARE the trigger: wide
          viewports show the live chips (Token / cost / elapsed, plus the running-services
          count while any process is alive) and clicking them opens the details card; narrow
          viewports collapse the whole thing to the single info icon. There is no separate
          info icon while the chips are visible. */}
      <Dropdown
        open={infoOpen}
        setOpen={setInfoOpen}
        menuClass="right-0 top-full mt-1 w-96 max-w-[calc(100vw-1.5rem)] origin-top-right"
        button={
          <button
            type="button"
            data-tooltip={S.chat.infoPanel}
            aria-label={S.chat.infoPanel}
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen(!infoOpen)}
            className={`flex h-7 shrink-0 items-center rounded-md transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
              infoOpen ? "bg-gray-100 dark:bg-gray-800" : ""
            }`}
          >
            {/* Wide: the chip row (icon + tooltip per chip carries the full meaning). The
                row sets the chips' face and ink, and keeps each on one line. */}
            <span className="hidden items-center gap-3 whitespace-nowrap px-2 font-mono text-xs text-gray-500 sm:flex dark:text-gray-400">
              <StatChip
                glyph={STAT_ICONS.tokens}
                value={hs.tokensText}
                label={`${S.chat.statTokens}（Token）`}
              />
              {/* When there's no cost (the Model has no pricing configured), don't render
                  this stat at all, rather than showing a "—" — that would take up space
                  while saying nothing, only making people think the cost is zero or
                  something's broken. */}
              {hs.costText != null && (
                <StatChip
                  glyph={STAT_ICONS.cost}
                  value={`${hs.costText}${hs.costUncosted ? " *" : ""}`}
                  label={`${S.common.cost}（${currency}）${hs.costUncosted ? ` · ${S.usage.uncostedNote}` : ""}`}
                />
              )}
              <StatChip
                glyph={STAT_ICONS.elapsed}
                value={hs.elapsedNode}
                label={`${S.chat.statElapsed}${hs.elapsedSplit ?? ""}`}
              />
              {/* Right of the time, only while the conversation still owns background
                  work — command processes past their yield window, background subagents
                  mid-round: their count, in the same tone, figure and glyph as the
                  session row's mark and read live off the row. A count is what this
                  reading is, and a glyph beside a number is how every other chip in this
                  row says what its number counts. Bare ink like the chips beside it, not
                  a tinted pill: this is one more reading in the stat row, not a badge
                  that should out-weigh them. In the live-status green (`busy`), the same
                  tone as the session row's mark: background work is work still running
                  behind this conversation, and glyph and number wear that colour together
                  wherever they appear; the title still names the count in words. */}
              {backgroundCount > 0 && (
                <span
                  data-tooltip={S.chat.backgroundTasks(backgroundCount)}
                  className={`flex shrink-0 items-center ${ICON_GAP.tight} font-mono text-xs ${toneInk.busy}`}
                >
                  <GlyphIcon d={ICONS.pulse} />
                  {backgroundCount}
                </span>
              )}
            </span>
            {/* Narrow: the info icon alone (the chips would crowd the title out). */}
            <span className="flex h-7 w-7 items-center justify-center text-gray-500 sm:hidden dark:text-gray-400">
              <GlyphIcon d={ICONS.info} size={ICON_SIZE.navRow} />
            </span>
          </button>
        }
      >
        {children}
      </Dropdown>
    </div>
  );
}
