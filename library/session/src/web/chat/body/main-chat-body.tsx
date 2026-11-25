import { Activity, type ReactNode } from "react";
import { WallpaperSurface, Button, EmptyState, Skeleton } from "@prismshadow/penguin-ui";
import { S } from "@prismshadow/penguin-web/internal";
import { PathCapsulesProvider } from "@prismshadow/penguin-web/internal-hub";
import { MessageStream } from "../message-stream";
import { ChatDropRegion } from "../drop-zone";
import { ConversationOutline } from "../conversation-outline";
import { DraftView } from "./draft-view";
import { GoalStatusBanner } from "../goal-banner";
import { RouteOfflineNotice } from "../route-offline-notice";
import { OfflineSessionHistory } from "../offline-session-history";
import { HistoryLoadFailed } from "../history-load-failed";
import { HistoryLoading } from "../history-loading";
import { RequestFailureDialog } from "../request-failure-dialog";
import { MachineRestartNotice } from "../machine-restart-notice";
import {
  ChatDockArea,
  DockPanel,
  DockLauncher,
  measureComposer,
  measureMergedComposer,
} from "../../dock";
import { ChatDockProvider } from "../session/main-dock-context";
import { ReplyFilesProvider } from "../reply-files-provider";

import { ArchivedSessionStub } from "../archived-session-stub";
import type { MainChatView } from "./main-chat-view";

export function renderMainChatBody(scope: MainChatView, toolbar: ReactNode) {
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
    pageMachineId,
    onDraftWorkspace,
    onDraftAgent,
    setFetchedSession,
    routed,
    selected,
    archivedRow,
    stream,
    allItems,
    failureShown,
    setFailureShown,
    activeModelRef,
    outline,
    streamScrollRef,
    railFit,
    routeSessionOwner,
    routeSessionPending,
    routeSessionOffline,
    offlineHistory,
    routeOutcome,
    composerRef,
    addComposerReference,
    newChat,
    ctx,
    anySubagentPending,
    rightMount,
    bottomMount,
    chatDock,
    emptyChat,
    input,
  } = scope;
  const showDocks = scope.hostsAppPanel || (scope.paneFocused && archivedRow === null);
  const guideSlot = <div data-guide-chat="history" data-find-skip />;
  return (
    <>
      <ChatDockProvider value={chatDock}>
        {/* ReplyFilesProvider: the conversation's reply-files trailer, built once from the
            conversation state the dock provider around it hands down (reply-files-provider.tsx).
            A context provider adds no element, so the row and the docks below keep their layout. */}
        <ReplyFilesProvider>
          <ChatDockArea
            mounts={showDocks ? [rightMount, bottomMount] : null}
            sessionId={scope.draft ? null : scope.routeSessionId}
            toolbar={toolbar}
            right={
              showDocks &&
              rightMount.view && (
                <DockPanel
                  view={rightMount.view}
                  open={rightMount.open}
                  animateEntrance={rightMount.animateEntrance}
                  panelBadges={{ agents: anySubagentPending }}
                />
              )
            }
          >
            <div data-dock-bottom-area className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                    ) : offlineHistory && (selected || routeSessionPending) ? (
                      <OfflineSessionHistory {...offlineHistory} />
                    ) : selected ? (
                      <>
                        {stream.error ? (
                          // History failed to load: say why and offer the way on, instead of staying on
                          // a misleading empty state — for a conversation on a machine out of reach,
                          // the machine's state rather than the transport's error.
                          <HistoryLoadFailed
                            projectId={projectId}
                            sessionId={selected.sessionId}
                            error={stream.error}
                            cause={stream.errorCause}
                            onRetry={stream.retry}
                          />
                        ) : stream.loading ? (
                          // The skeleton, and past a second, for a conversation on a machine, how far
                          // its newest messages have come over and how the link stands.
                          <HistoryLoading
                            projectId={projectId}
                            sessionId={selected.sessionId}
                            progress={stream.transfer.window}
                            onRetryNow={stream.retryNow}
                          />
                        ) : null}
                        {/* A resumed pane reopens its stream. Keep the composer mounted while
                          history loads so its unsent text, files and selection survive. */}
                        <Activity mode={stream.loading || stream.error ? "hidden" : "visible"}>
                          {/* The empty state shares the same structure as the message stream (message
                           area + bottom input area). The first message leaves the composer in place. */}
                          {/* `relative`: the floating dock launcher below anchors to this body —
                            the region between the toolbar and the composer — so clamping to
                            it keeps the launcher off both. On a phone the ball rides over the
                            transcript's right edge, so a Compact work group's head
                            (ActivityGroup) ends its pager short of it through
                            --activity-head-reserve. */}
                          <div className="relative min-h-0 flex-1 max-sm:[--activity-head-reserve:62px]">
                            {emptyChat ? (
                              <div className="flex h-full flex-col overflow-y-auto px-4">
                                <div className="flex flex-1 items-center justify-center">
                                  <p className="text-lg font-medium text-gray-400 dark:text-gray-500">
                                    {S.chat.emptyGreeting}
                                  </p>
                                </div>
                                {guideSlot}
                              </div>
                            ) : (
                              // An organization's conversation cites the organization's files
                              // by path; they read as capsules, as they do in its channels.
                              <PathCapsulesProvider
                                projectId={selected?.orgId !== undefined ? projectId : null}
                              >
                                <MessageStream
                                  items={allItems}
                                  version={stream.version}
                                  ctx={ctx}
                                  scrollElRef={streamScrollRef}
                                  footer={guideSlot}
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
                                    errorCause: stream.older.errorCause,
                                    prependedCount: stream.prefixItems.length,
                                    onLoad: stream.loadOlder,
                                    transfer: stream.transfer,
                                    beyondTail: stream.older.beyondTail,
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
                              </PathCapsulesProvider>
                            )}
                            {/* The right dock's floating launcher: rides this body's right edge
                              while that dock is hidden, and opens its panels in one click. */}
                            {scope.paneFocused && (
                              <DockLauncher agentsPending={anySubagentPending} />
                            )}
                            <RequestFailureDialog
                              failure={failureShown}
                              sessionId={selected?.sessionId ?? null}
                              sessionModel={activeModelRef}
                              workspace={selected?.workspace ?? null}
                              onClose={() => setFailureShown(null)}
                            />
                          </div>
                          <div
                            ref={
                              bottomMount.open && bottomMount.view?.merged
                                ? measureMergedComposer
                                : measureComposer
                            }
                            className="shrink-0"
                          >
                            <WallpaperSurface className="shrink-0 border-t border-gray-200 bg-canvas px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:pb-3 dark:border-gray-800">
                              <div className="mx-auto max-w-3xl">
                                {/* Goal banner docked above the composer: an in-flight goal's progress
                                (restored on load while still active), or the terminal state reached
                                during this page's lifetime. The stop button is the composer's
                                regular stop (one abort ends the whole goal loop). */}
                                {/* A conversation on a machine whose server needs a restart: its live
                                updates stay away until then, and this says so instead of the
                                stream retrying in silence. */}
                                {!draft && pageMachineId !== null && (
                                  <MachineRestartNotice machineId={pageMachineId} />
                                )}
                                {stream.goal && <GoalStatusBanner goal={stream.goal} />}
                                {input}
                              </div>
                            </WallpaperSurface>
                          </div>
                        </Activity>
                      </>
                    ) : routeSessionOffline ? (
                      <RouteOfflineNotice
                        owner={routeSessionOwner}
                        offline={scope.offlineMachineIds}
                        disconnected={scope.disconnectedMachineIds}
                        labels={machineLabels}
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

              {showDocks && bottomMount.view && (
                <DockPanel
                  view={bottomMount.view}
                  open={bottomMount.open}
                  animateEntrance={bottomMount.animateEntrance}
                  panelBadges={{ agents: anySubagentPending }}
                />
              )}
            </div>
          </ChatDockArea>
        </ReplyFilesProvider>
      </ChatDockProvider>
    </>
  );
}
