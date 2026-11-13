import { renderMainSessionDetails } from "./main-session-details";
import {
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
import { Truncated } from "../../../components/ui/truncated";
import { CostPartsRows, StatHint } from "../../../components/ui/stat-hint";
import { OutlineMenuButton } from "../conversation-outline";
import { nameOnMachine } from "../../../lib/workspace-machines";
import { providerInfo } from "@prismshadow/penguin-server/model-catalog";
import { DockToggles } from "../dock-toggles";
import { RunStatus } from "../run-status";
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
            {/* Session-level state: the run indicator (run-status.tsx). */}
            <RunStatus activity={headerActivity} />
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
              info icon while the chips are visible. The card drops over the docks: portaled,
              so a dock lifted to fullscreen or the built-in browser's page, which is laid over
              the Chat window from outside it, never covers it. */}
          {renderMainSessionDetails(scope)}
        </div>
      )}
    </>
  );
}
