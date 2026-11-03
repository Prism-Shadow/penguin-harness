import { renderMainSessionDetails } from "./main-session-details";
import {
  ActivityIcon,
  Dot,
  Dropdown,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  StatChip,
} from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { formatDateTime } from "../../../lib/format";
import { sessionActivityLabel } from "../../../lib/session-activity";
import { Truncated } from "../../../components/ui/truncated";
import { CostPartsRows, StatHint } from "../../../components/ui/stat-hint";
import { OutlineMenuButton } from "../conversation-outline";
import { nameOnMachine } from "../../../lib/workspace-machines";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { DockToggles } from "../dock-toggles";
import { toneInk } from "../../../lib/tone";
import { STAT_ICONS } from "../../../lib/stat-icons";
import { SessionIdRow } from "../session/main-chat-helpers";
import type { MainChatView } from "../body/main-chat-view";

export function renderMainChatToolbar(scope: MainChatView) {
  const {
    currency,
    infoOpen,
    setInfoOpen,
    processes,
    procBusy,
    setProcToKill,
    usageCostParts,
    selected,
    archivedRow,
    stream,
    outline,
    streamScrollRef,
    railFit,
    machineNameOf,
    onRemoveProcess,
    exitedIds,
    onClearExitedProcesses,
    anySubagentPending,
    hs,
    cacheHitRate,
    sessionAgentName,
    headerActivity,
    backgroundCount,
  } = scope;
  return (
    <>
      {archivedRow && (
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 md:px-4 dark:border-gray-800">
          <Heading level={5} as="h1" className="flex min-w-0">
            <Truncated text={archivedRow.title ?? S.chat.defaultSessionTitle} />
          </Heading>
        </div>
      )}
      {selected && (
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
                <ActivityIcon
                  activity={headerActivity}
                  label={sessionActivityLabel(headerActivity)}
                />
                <span className="hidden sm:inline">{sessionActivityLabel(headerActivity)}</span>
              </span>
            )}
          </div>

          {/* Panel switcher (icon-only): pinned triggers + the "create" dropdown with
              placement actions and pin toggles. Every entry is a dock tab (features/dock)
              — the toolbar reads and drives the dock store directly; this page only feeds
              the pending-approval dot. */}
          <DockToggles agentsPending={anySubagentPending} />

          {/* Conversation index fallback: exactly when the gutter tick rail can't show
              (phones without a hover pointer; a desktop window whose gutter a docked panel
              ate) the index moves up here as a dropdown — navigation stays reachable. */}
          {!railFit.shown && (
            <OutlineMenuButton
              entries={outline}
              turnOffset={stream.outlineOffset}
              scrollRef={streamScrollRef}
              running={stream.taskState !== "idle"}
            />
          )}

          {/* Details entry, at the toolbar's far right — the stats ARE the trigger: wide
              viewports show the live chips (Token / cost / elapsed, plus the running-services
              count while any process is alive) and clicking them opens the details card; narrow
              viewports collapse the whole thing to the single info icon. There is no separate
              info icon while the chips are visible. */}
          {renderMainSessionDetails(scope)}
        </div>
      )}
    </>
  );
}
