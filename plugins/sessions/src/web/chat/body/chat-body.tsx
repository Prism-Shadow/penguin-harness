/**
 * The chat page's body: the draft page, or the open conversation — its message stream with the
 * goal banner and the composer below — and the loading, error, offline and empty states between
 * them. The only region a dragged file may be dropped on (#311).
 */
import type { RefObject } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { Button, EmptyState, Skeleton } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import type { ComposerReference } from "../../../lib/workspace-tree";
import type { ChatItem } from "../../../lib/omni/stream-model";
import { DockLauncher } from "../../dock";
import { MessageStream, type StreamRenderContext } from "../message-stream";

import { ChatDropRegion } from "../drop-zone";
import { ConversationOutline, type OutlineRailFit } from "../conversation-outline";

import type { OutlineEntry } from "../outline-model";
import { GoalStatusBanner } from "../goal-banner";
import { DraftView } from "./draft-view";
import { SessionComposer, type SessionComposerSession } from "./session-composer";

/** What the body reads off the conversation's controller. */
export interface ChatBodySession extends SessionComposerSession {
  location: { key: string };
  draft: boolean;
  parkedDraftId: string | null;
  onDraftWorkspace: (path: string, machineId: string | null) => void;
  selected: SessionInfo | null;
  allItems: ChatItem[];
  ctx: StreamRenderContext;
  streamScrollRef: RefObject<HTMLDivElement | null>;
  addComposerReference: (reference: ComposerReference) => void;
  outline: OutlineEntry[];
  railFit: OutlineRailFit;
  anySubagentPending: boolean;
  routeSessionOffline: boolean;
  routeSessionOwner: string | null;
  machineLabels: ReadonlyMap<string, string>;
  sessionsLoading: boolean;
  routeSessionPending: boolean;
  routeNotFound: boolean;
  inCompany: boolean;
  newChat: () => void;
}

export function ChatBody({ session, projectId }: { session: ChatBodySession; projectId: string }) {
  const {
    location,
    draft,
    parkedDraftId,
    models,
    composerRef,
    onDraftWorkspace,
    selected,
    stream,
    allItems,
    ctx,
    streamScrollRef,
    addComposerReference,
    outline,
    railFit,
    anySubagentPending,
    routeSessionOffline,
    routeSessionOwner,
    machineLabels,
    sessionsLoading,
    routeSessionPending,
    routeNotFound,
    inCompany,
    navigate,
    newChat,
  } = session;
  const emptyChat =
    selected !== null && !stream.loading && !stream.error && stream.model.items.length === 0;
  return (
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
        />
      ) : (
        // Keyed by Session: the whole block does a light fade-in when switching sessions.
        <div
          key={selected?.sessionId ?? "empty"}
          className="anim-fade flex min-h-0 flex-1 flex-col"
        >
          {selected ? (
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
                <div className="shrink-0 border-t border-gray-200 bg-canvas px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:pb-3 dark:border-gray-800">
                  <div className="mx-auto max-w-3xl">
                    {/* Goal banner docked above the composer: an in-flight goal's progress
                        (restored on load while still active), or the terminal state reached
                        during this page's lifetime. The stop button is the composer's
                        regular stop (one abort ends the whole goal loop). */}
                    {stream.goal && <GoalStatusBanner goal={stream.goal} />}
                    <SessionComposer session={session} selected={selected} />
                  </div>
                </div>
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
          ) : !sessionsLoading && routeNotFound ? (
            <EmptyState
              title={S.chat.sessionNotFound}
              description={S.chat.sessionNotFoundHint}
              action={
                inCompany ? (
                  <Button onClick={() => navigate("/org")}>{S.company.backToOverview}</Button>
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
  );
}
