/**
 * A conversation on a machine that cannot be reached: the hub's cached copy of its latest
 * messages, read-only, under one line saying where the machine stands.
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
import { EmptyState, Notice, TextAction } from "@prismshadow/penguin-ui";
import { ApiError } from "../../api/client";
import { openHistoryStream } from "../../api/sse";
import {
  createStreamModel,
  pushMessages,
  seedHistoryWindow,
  type ChatItem,
} from "../../lib/amsp/stream-model";
import { readHistory } from "../../lib/history/history-read";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import { useMachines } from "../../state/machines";
import { HistoryMachineRetry } from "./history-machine-retry";
import { listedAway, machineAway, stoppedWaiting, type StoppedReason } from "./machine-away";
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
    retry: away && machineStatus?.retry ? machineStatus : null,
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

const readOnly: StreamRenderContext = {
  pendingApprovals: new Map(),
  onApprove: async () => {},
  origin: [],
  taskRunning: false,
};

/** The line's first sentence: where the machine stands, in the words of what is known of it. */
function headline(alias: string, connected: boolean, stopped: StoppedReason | null): string {
  const words = S.chat.offlineHistory;
  if (connected) return words.refreshing(alias);
  if (stopped === "unreachable") return words.unreachable(alias);
  if (stopped === "retrying") return words.silent(alias);
  return words.disconnected(alias);
}

export function OfflineSessionHistory({
  alias,
  connected,
  copy,
  retry,
  stopped,
  projectId,
}: NonNullable<ReturnType<typeof useOfflineSessionHistory>>) {
  const words = S.chat.offlineHistory;
  return (
    <>
      <Notice role="status" tone={connected ? "info" : "attention"} className="mx-3 mt-2 shrink-0">
        {headline(alias, connected, stopped?.reason ?? null)}{" "}
        {copy && typeof copy === "object"
          ? words.cached
          : copy === "miss"
            ? words.miss
            : copy === "failed"
              ? words.failed
              : null}
        {stopped && (
          <>
            {" "}
            <TextAction onClick={stopped.onRetry}>{S.common.retry}</TextAction>
          </>
        )}
      </Notice>
      {retry && <HistoryMachineRetry projectId={projectId} away={retry} />}
      {copy && typeof copy === "object" && (
        <div className="min-h-0 flex-1">
          {copy.items.length ? (
            <MessageStream items={copy.items} version={copy.items.length} ctx={readOnly} />
          ) : (
            <EmptyState title={words.empty} />
          )}
        </div>
      )}
    </>
  );
}
