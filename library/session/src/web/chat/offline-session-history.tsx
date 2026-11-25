/**
 * A conversation on a machine that cannot be reached: the hub's cached copy of its latest
 * messages (or the transcript already on screen), read-only, and the machine's state on a cover
 * over the input box (machine-cover.tsx) rather than over the transcript.
 *
 * It shows when the machine is known to be down — the machines account reads it as away (the
 * conversation's reads are then held and never open: use-session-stream's `hold`), or the hub's
 * read says it holds no connection — and when the read gave up on it, its retries spent with
 * nothing moving (`machine_unreachable`), with a Retry at the end of the line. It goes back to
 * the live transcript on its own, on what the machines account pushes and never on a timer: the
 * account reading the machine as connected again, or, after a read gave up while the connection
 * was held, the machine's API socket coming up again.
 */
import { useEffect, useRef, useState } from "react";
import { ComposerCard, EmptyState, Skeleton, WallpaperSurface } from "@prismshadow/penguin-ui";
import { ApiError, S, createStreamModel, machineForSession, openHistoryStream, pushMessages, readHistory, seedHistoryWindow, useMachines } from "@prismshadow/penguin-web/internal";
import type { ChatItem } from "@prismshadow/penguin-web/internal";
import { listedAway, machineAway, stoppedWaiting, type StoppedReason } from "./machine-away";
import { MachineCover, type MachineCoverReading } from "./machine-cover";
import { MessageStream, type StreamRenderContext } from "./message-stream";
import type { SessionStreamState } from "./use-session-stream";

type Copy = { items: ChatItem[] } | "miss" | "failed";
interface Reading {
  key: string;
  copy: Copy;
}

/**
 * Whether a conversation's reads wait for its machine (use-session-stream's `hold`): the machines
 * account lists the machine it is on and reads it as away, which is also what shows the offline
 * view below — the two read one account, so a held conversation always has the view in its
 * place. `owner`: the machine a deep link was routed to before the sidebar knows the Session.
 */
export function useMachineHold(
  projectId: string | null,
  userId: string | null,
  sessionId: string | null,
  owner: string | null,
): boolean {
  const machines = useMachines();
  const machineId =
    sessionId && projectId && userId ? (machineForSession(sessionId) ?? owner) : null;
  return machineId !== null && listedAway(machines.state, machines.settled, machineId);
}

export function useOfflineSessionHistory(
  projectId: string | null,
  userId: string | null,
  sessionId: string | null,
  stream: Pick<
    SessionStreamState,
    | "sessionId"
    | "historyMachineId"
    | "reconnect"
    | "retry"
    | "held"
    | "loading"
    | "error"
    | "errorCause"
    | "transfer"
  >,
  items: ChatItem[],
  owner?: { machineId: string; alias: string } | null,
) {
  const machines = useMachines();
  const ownStream = sessionId !== null && stream.sessionId === sessionId;
  const machineId = sessionId
    ? (machineForSession(sessionId) ??
      (ownStream ? stream.historyMachineId : null) ??
      owner?.machineId ??
      null)
    : null;
  const machine = machineId
    ? machines.state?.machines.find((m) => !m.local && m.machineId === machineId)
    : null;
  const machineStatus = machineId ? machineAway(machines.state, machines.settled, machineId) : null;
  const directoryAway = !!machine && machineStatus !== null;
  const connected = !!machine?.connection && !directoryAway;
  const key = JSON.stringify([projectId, userId, machineId, sessionId]);
  // The read gave up on the machine: its retries ran out with nothing moving.
  const stopped: StoppedReason | null = ownStream ? stoppedWaiting(stream.errorCause) : null;
  // A slow or unknown machine is not evidence of a broken connection. A hub waiting on
  // SSH can also confirm a disconnect before the machine list next updates.
  const away =
    directoryAway ||
    (!!owner && !machine) ||
    (!!machineId && ownStream && stream.transfer.window?.waiting?.reason === "not_connected") ||
    (!!machineId && stopped !== null);
  const ready = ownStream && !stream.loading && !stream.error;
  const heldItems = ready ? items : null;
  const [reading, setReading] = useState<Reading | null>(null);
  const lastAway = useRef<string | null>(null);
  const reconnect = stream.reconnect;
  const held = ownStream && stream.held;

  useEffect(() => {
    if (directoryAway) {
      // Reads the hold never let open need nothing reopened: the hold lifting opens them.
      lastAway.current = held ? null : key;
    } else if (connected && lastAway.current === key) {
      lastAway.current = null;
      // Reopen both history and the live subscription. The remote may have changed its
      // messages, running task or outstanding approvals while it was unreachable.
      reconnect();
    } else if (lastAway.current !== key) {
      lastAway.current = null;
    }
  }, [key, directoryAway, connected, reconnect, held]);

  // A read that gave up while the machines account still reads the machine as connected (the
  // connection held, its server out of reach) has no reconnect to wait for: what it waits for is
  // the machine's API socket coming up again, which the account pushes. Read again once per time
  // it comes up after the give-up — a socket already up when the read gave up is not news.
  const socket = machine?.socket ?? null;
  const socketUp = socket?.state === "connected" ? socket.since : null;
  const stoppedAt = useRef<{ key: string; socketUp: string | null } | null>(null);
  const retry = stream.retry;
  useEffect(() => {
    if (stopped === null) {
      stoppedAt.current = null;
      return;
    }
    const seen = stoppedAt.current;
    if (seen === null || seen.key !== key) {
      stoppedAt.current = { key, socketUp };
      return;
    }
    // Away in the account: its reconnect, above, reopens everything.
    if (directoryAway || socketUp === null || socketUp === seen.socketUp) return;
    stoppedAt.current = { key, socketUp };
    retry();
  }, [key, stopped, socketUp, directoryAway, retry]);

  useEffect(() => {
    if (!away || !sessionId || !machineId || !userId || !projectId) return;
    if (heldItems) {
      setReading({ key, copy: { items: heldItems } });
      return;
    }
    let current = true;
    const read = readHistory(
      (query, handlers) =>
        openHistoryStream(
          sessionId,
          query,
          handlers,
          machine ? machineId : machineForSession(sessionId),
        ),
      { kind: "cached" },
      {
        onWindow(window) {
          if (!current) return;
          const model = createStreamModel();
          if (window.page) seedHistoryWindow(model, window.page, sessionId);
          pushMessages(model, window.messages, Date.now(), window.serverNowMs);
          setReading({ key, copy: { items: model.items } });
        },
        onError(_message, error) {
          if (current)
            setReading({
              key,
              copy:
                error instanceof ApiError && error.code === "history_cache_miss"
                  ? "miss"
                  : "failed",
            });
        },
      },
    );
    return () => {
      current = false;
      read.close();
    };
  }, [key, away, sessionId, machineId, userId, projectId, heldItems]);

  const justReconnected = connected && lastAway.current === key;
  useEffect(() => {
    if (
      !justReconnected &&
      connected &&
      !away &&
      ready &&
      reading?.key === key &&
      lastAway.current !== key
    ) {
      setReading(null);
    }
  }, [key, justReconnected, connected, away, ready, reading]);

  const copy = reading?.key === key ? reading.copy : null;
  const returning = connected && (justReconnected || !ownStream || stream.loading);
  if (!userId || !projectId || !machineId) return null;
  if (!away && !(returning && copy && typeof copy === "object" && !stream.error)) return null;
  return {
    alias: machine?.alias ?? owner?.alias ?? machineId,
    connected: !away,
    /** The machines account's reading of the machine while it is away; null otherwise. */
    away: away ? machineStatus : null,
    /**
     * The read gave up on a machine the account does not read as away: why, and the one Retry
     * (a single attempt — the hub retries a machine it gave up on no further).
     */
    stopped:
      away && !directoryAway && stopped !== null
        ? { reason: stopped, onRetry: stream.retry }
        : null,
    projectId,
    copy: away && ready ? { items } : copy,
  };
}

export type OfflineSessionView = NonNullable<ReturnType<typeof useOfflineSessionHistory>>;

/** Nothing on a cached copy takes input: no approvals, no answers. */
export const OFFLINE_CONTEXT: StreamRenderContext = {
  pendingApprovals: new Map(),
  onApprove: async () => {},
  origin: [],
  taskRunning: false,
};

/** The messages the offline view shows, or null when it has none to show (yet). */
export function offlineItems(view: OfflineSessionView): ChatItem[] | null {
  return view.copy !== null && typeof view.copy === "object" ? view.copy.items : null;
}

/**
 * What the input box's cover is told about the machine. `live`: the conversation's own read is
 * showing, so the transcript on screen is not the copy.
 */
export function offlineCover(view: OfflineSessionView, live = false): MachineCoverReading {
  return {
    alias: view.alias,
    connected: view.connected,
    away: view.away,
    stopped: view.stopped,
    cached: !live && offlineItems(view) !== null,
  };
}

/**
 * The transcript's place while the offline view has no messages to show: the cached copy being
 * read, missing, unreadable, or empty.
 */
export function OfflineHistoryNote({ copy }: { copy: OfflineSessionView["copy"] }) {
  const words = S.chat.offlineHistory;
  if (copy === null) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }
  return (
    <EmptyState
      title={copy === "miss" ? words.miss : copy === "failed" ? words.failed : words.empty}
    />
  );
}

/**
 * The offline view of a conversation the page has no row for yet (a link opened before the list
 * knows it): the copy, and an input box that holds nothing but the cover, where the composer
 * stands once the conversation is known.
 */
export function OfflineSessionHistory(view: OfflineSessionView) {
  const items = offlineItems(view);
  return (
    <>
      <div className="relative min-h-0 flex-1">
        {items !== null && items.length > 0 ? (
          <MessageStream items={items} version={items.length} ctx={OFFLINE_CONTEXT} />
        ) : (
          <OfflineHistoryNote copy={items !== null ? { items } : view.copy} />
        )}
      </div>
      <WallpaperSurface className="shrink-0 border-t border-gray-200 bg-canvas px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:pb-3 dark:border-gray-800">
        <div className="mx-auto max-w-3xl">
          <ComposerCard
            textarea={{ value: "", readOnly: true, tabIndex: -1, "aria-hidden": true }}
            cover={
              <MachineCover
                projectId={view.projectId}
                reading={offlineCover(view)}
                drafted={false}
              />
            }
          />
        </div>
      </WallpaperSurface>
    </>
  );
}
