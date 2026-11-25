import { useEffect, useRef, useState } from "react";
import { EmptyState, Notice } from "@prismshadow/penguin-ui";
import { ApiError, S, createStreamModel, machineForSession, openHistoryStream, pushMessages, readHistory, seedHistoryWindow, useMachines } from "@prismshadow/penguin-web/internal";
import type { ChatItem } from "@prismshadow/penguin-web/internal";

import { HistoryMachineRetry } from "./history-machine-retry";
import { machineAway } from "./machine-away";
import { MessageStream, type StreamRenderContext } from "./message-stream";
import type { SessionStreamState } from "./use-session-stream";

type Copy = { items: ChatItem[] } | "miss" | "failed";
interface Reading {
  key: string;
  copy: Copy;
}

export function useOfflineSessionHistory(
  projectId: string | null,
  userId: string | null,
  sessionId: string | null,
  stream: Pick<
    SessionStreamState,
    "sessionId" | "historyMachineId" | "reconnect" | "loading" | "error" | "transfer"
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
  // A slow or unknown machine is not evidence of a broken connection. A hub waiting on
  // SSH can also confirm a disconnect before the machine list next updates.
  const away =
    directoryAway ||
    (!!owner && !machine) ||
    (!!machineId && ownStream && stream.transfer.window?.waiting?.reason === "not_connected");
  const ready = ownStream && !stream.loading && !stream.error;
  const heldItems = ready ? items : null;
  const [reading, setReading] = useState<Reading | null>(null);
  const lastAway = useRef<string | null>(null);
  const reconnect = stream.reconnect;

  useEffect(() => {
    if (directoryAway) {
      lastAway.current = key;
    } else if (connected && lastAway.current === key) {
      lastAway.current = null;
      // Reopen both history and the live subscription. The remote may have changed its
      // messages, running task or outstanding approvals while it was unreachable.
      reconnect();
    } else if (lastAway.current !== key) {
      lastAway.current = null;
    }
  }, [key, directoryAway, connected, reconnect]);

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

export function OfflineSessionHistory({
  alias,
  connected,
  copy,
  retry,
  projectId,
}: NonNullable<ReturnType<typeof useOfflineSessionHistory>>) {
  const words = S.chat.offlineHistory;
  return (
    <>
      <Notice role="status" tone={connected ? "info" : "attention"} className="mx-3 mt-2 shrink-0">
        {connected ? words.refreshing(alias) : words.disconnected(alias)}{" "}
        {copy && typeof copy === "object"
          ? words.cached
          : copy === "miss"
            ? words.miss
            : copy === "failed"
              ? words.failed
              : null}
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
