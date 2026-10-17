import { WallpaperSurface, Button, EmptyState, Skeleton } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { MessageStream } from "../message-stream";
import { ChatDropRegion } from "../drop-zone";
import { ConversationOutline } from "../conversation-outline";
import { DraftView } from "./draft-view";
import { GoalStatusBanner } from "../goal-banner";
import { DockPanel, DockLauncher } from "../../dock";
import { ChatDockProvider } from "../chat-dock-context";
import { ArchivedSessionStub } from "../archived-session-stub";
import type { MainChatView } from "./main-chat-view";

export function renderMainChatBody(scope: MainChatView) {
  const {
    navigate,
    location,
    company,
    projectId,
    sessionsLoading,
    machineLabels,
    removeSession,
    replace,
    models,
    parkedDraftId,
    draft,
    onDraftWorkspace,
    onDraftAgent,
    setFetchedSession,
    routed,
    selected,
    archivedRow,
    stream,
    allItems,
    outline,
    streamScrollRef,
    railFit,
    routeSessionOwner,
    routeSessionPending,
    routeSessionOffline,
    routeOutcome,
    composerRef,
    addComposerReference,
    newChat,
    ctx,
    anySubagentPending,
    rightMount,
    bottomMount,
    terminalSupported,
    chatDock,
    emptyChat,
    input,
  } = scope;
  return (
    <>
      <ChatDockProvider value={chatDock}>
        {/* data-dock-area: the row and the bottom dock together — what a fullscreen bottom dock
            (or the narrow merged view) grows to cover, up to the toolbar; a fullscreen right
            dock covers the row alone. Layout-neutral: it takes the column's remaining height
            exactly as the row and the dock did when they sat in the column themselves. */}
        <div data-dock-area className="flex min-h-0 flex-1 flex-col">
          {/* Body: chat column + the right dock on this row (below the toolbar — a dock
              beside the whole page would squeeze the header), with the bottom dock after the
              row spanning the full page width. data-dock-row is what the drag preview
              measures for a right landing. */}
          <div data-dock-row className="flex min-h-0 flex-1">
            {/* The chat area, and the only region a dragged file may be dropped on (#311): it
                covers the conversation and the composer in both branches below, and nothing else
                — the sidebar, the mobile top bar, the toolbar above and the docked panels beside
                it (terminal panes included) are all outside, where a file drop is inert (see
                drop-zone.tsx). `relative` bounds the drop overlay to this column. */}
            <ChatDropRegion className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {draft ? (
                // Draft state: DraftView's vertically centered input card + Agent / Workspace
                // selection panel; the Session is only created once the first message is sent. Keyed
                // by Project (switching Project remounts onto that Project's draft cache) and by the
                // parked-draft id — falling back to location.key for `/chat/new`, so clicking "New
                // chat" while already on the draft page (which just parked the typed text) remounts
                // onto the freshly cleared cache. (Agent selection happens inside the draft itself,
                // so it's not part of the key.)
                <DraftView
                  key={`draft:${projectId}:${parkedDraftId ?? location.key}`}
                  projectId={projectId}
                  models={models}
                  {...(parkedDraftId !== null ? { draftId: parkedDraftId } : {})}
                  composerRef={composerRef}
                  onWorkspaceChange={onDraftWorkspace}
                  onAgentChange={onDraftAgent}
                />
              ) : (
                // Keyed by Session: the whole block does a light fade-in when switching sessions.
                <div
                  key={routed?.sessionId ?? "empty"}
                  className="anim-fade flex min-h-0 flex-1 flex-col"
                >
                  {archivedRow ? (
                    <ArchivedSessionStub
                      session={archivedRow}
                      onUnarchived={(row) => {
                        // Back among the conversations: the list takes the row (and counts it),
                        // and this page loads the conversation in its place.
                        setFetchedSession(row);
                        replace(row);
                      }}
                      onDeleted={(row) => {
                        removeSession(row.sessionId);
                        navigate("/chat");
                      }}
                    />
                  ) : selected ? (
                    stream.error ? (
                      // History failed to load: show a clear error and a retry entry point, instead of staying on a misleading empty state.
                      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
                        <p className="text-sm text-red-600 dark:text-red-400">
                          {S.chat.historyLoadFailed}：{stream.error}
                        </p>
                        <Button onClick={stream.retry}>{S.common.retry}</Button>
                      </div>
                    ) : stream.loading ? (
                      <div className="space-y-3 p-6">
                        <Skeleton className="h-5 w-1/3" />
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-5 w-1/2" />
                      </div>
                    ) : (
                      // The empty state shares the same structure as the message stream (message
                      // area + bottom input area): only the message area's content differs, and
                      // ChatInput always mounts in the same JSX slot, so it isn't unmounted and
                      // recreated when the first message arrives (preserving draft/focus).
                      <>
                        {/* `relative`: the floating dock launcher below anchors to this body —
                            the region between the toolbar and the composer — so clamping to
                            it keeps the launcher off both. */}
                        <div className="relative min-h-0 flex-1">
                          {emptyChat ? (
                            <div className="flex h-full items-center justify-center px-4">
                              <p className="text-lg font-medium text-gray-400 dark:text-gray-500">
                                {S.chat.emptyGreeting}
                              </p>
                            </div>
                          ) : (
                            <MessageStream
                              items={allItems}
                              version={stream.version}
                              ctx={ctx}
                              scrollElRef={streamScrollRef}
                              // The selection menu's "Add to conversation": the excerpt is staged
                              // in this composer as a chip, the same way the Files panel stages a
                              // quoted range.
                              onAddExcerpt={addComposerReference}
                              // Scroll-up backfill of older history windows (tail-first
                              // loading): near-top scrolling prepends the previous window,
                              // scroll position anchored (see MessageStream).
                              older={{
                                hasMore: stream.older.hasMore,
                                loading: stream.older.loading,
                                error: stream.older.error,
                                prependedCount: stream.prefixItems.length,
                                onLoad: stream.loadOlder,
                              }}
                              // Tick-rail minimap over the stream's left gutter (zero layout
                              // width; hides itself when the gutter is too narrow or the
                              // pointer can't hover).
                              outline={
                                <ConversationOutline
                                  entries={outline}
                                  turnOffset={stream.outlineOffset}
                                  version={stream.version}
                                  scrollRef={streamScrollRef}
                                  running={stream.taskState !== "idle"}
                                  fit={railFit}
                                />
                              }
                            />
                          )}
                          {/* The right dock's floating launcher: rides this body's right edge
                              while that dock is hidden, and opens its panels in one click. */}
                          <DockLauncher agentsPending={anySubagentPending} />
                        </div>
                        <WallpaperSurface className="shrink-0 border-t border-gray-200 bg-canvas px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:pb-3 dark:border-gray-800">
                          <div className="mx-auto max-w-3xl">
                            {/* Goal banner docked above the composer: an in-flight goal's progress
                                (restored on load while still active), or the terminal state reached
                                during this page's lifetime. The stop button is the composer's
                                regular stop (one abort ends the whole goal loop). */}
                            {stream.goal && <GoalStatusBanner goal={stream.goal} />}
                            {input}
                          </div>
                        </WallpaperSurface>
                      </>
                    )
                  ) : routeSessionOffline ? (
                    <EmptyState
                      title={
                        routeSessionOwner === null
                          ? S.chat.sessionOnOfflineMachineUnknown
                          : S.chat.sessionOnOfflineMachine(
                              machineLabels.get(routeSessionOwner) ?? routeSessionOwner,
                            )
                      }
                      description={S.chat.sessionOfflineHint}
                    />
                  ) : !sessionsLoading && routeOutcome === "notFound" ? (
                    // A dead link: said in place, with the one way on that fits the mode —
                    // a new conversation, or back to the organization in company mode.
                    <EmptyState
                      title={S.chat.sessionNotFound}
                      description={S.chat.sessionNotFoundHint}
                      action={
                        company.workMode === "company" ? (
                          <Button onClick={() => navigate("/org")}>
                            {S.company.backToOverview}
                          </Button>
                        ) : (
                          <Button onClick={newChat}>{S.nav.newChat}</Button>
                        )
                      }
                    />
                  ) : sessionsLoading || routeSessionPending ? (
                    <div className="space-y-3 p-6">
                      <Skeleton className="h-5 w-1/2" />
                    </div>
                  ) : (
                    <EmptyState
                      title={S.chat.noSessions}
                      action={<Button onClick={newChat}>{S.nav.newChat}</Button>}
                    />
                  )}
                </div>
              )}
            </ChatDropRegion>

            {archivedRow === null && rightMount.view && (
              <DockPanel
                view={rightMount.view}
                open={rightMount.open}
                animateEntrance={rightMount.animateEntrance}
                panelBadges={{ agents: anySubagentPending }}
                terminalSupported={terminalSupported}
              />
            )}
          </div>

          {archivedRow === null && bottomMount.view && (
            <DockPanel
              view={bottomMount.view}
              open={bottomMount.open}
              animateEntrance={bottomMount.animateEntrance}
              panelBadges={{ agents: anySubagentPending }}
              terminalSupported={terminalSupported}
            />
          )}
        </div>
      </ChatDockProvider>
    </>
  );
}
