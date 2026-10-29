/**
 * How a conversation's history coming over from its machine is shown.
 *
 * `HistoryLoading` stands in for the transcript until its newest messages arrive. For the first
 * second it is the skeleton the page always showed, so a fast read never flashes anything else;
 * a conversation on this server keeps the skeleton throughout, since its reads report no
 * progress. Past that second, for a conversation on a machine: the transfer row (where the
 * messages come from, the amount against the whole, a thin bar), centred where the could-not-load
 * notice would stand, and under it how the link stands when it does not — the machine's own retry
 * row while the machine reads as away (the Machines page's account of it, built as the
 * could-not-load notice builds it), or the server's retry of the link to it (the attempt, the
 * countdown, Retry now). The line under the transfer row keeps its height whether or not anything
 * is in it, so the row does not move when the link drops or comes back.
 *
 * `HistoryTransferLine` is the one line at the transcript's top, in the older-history row, while
 * a read runs behind the transcript: an older window still coming over (its own progress), or the
 * rest of the conversation syncing behind the first paint. It goes when the read does — the data
 * changed: there is nothing left to fetch.
 */
import { useState } from "react";
import type { HistoryProgress } from "@prismshadow/penguin-server/api";
import {
  RetryStatus,
  Skeleton,
  TransferProgress,
  toastError,
  useElapsedPast,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { transferAmount } from "../../lib/history/transfer-amount";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import { useMachines } from "../../state/machines";
import { retryStatus } from "../machines/machine-card";
import { machineAway } from "./machine-away";

/** How long a read may take before its progress replaces the skeleton. */
const SKELETON_MS = 1_000;

/** A machine's alias from the live machines account; null while the list has not answered. */
function useMachineAlias(machineId: string | null): string | null {
  const machines = useMachines();
  if (machineId === null) return null;
  return machines.state?.machines.find((m) => !m.local && m.machineId === machineId)?.alias ?? null;
}

/** The server's retry of the link to the machine, as the shared retry row. */
function LinkRetry({
  waiting,
  onRetryNow,
  size,
  className = "",
}: {
  waiting: NonNullable<HistoryProgress["waiting"]>;
  onRetryNow?: () => void;
  size: "xs" | "sm";
  className?: string;
}) {
  const words = S.chat.historyTransfer;
  return (
    <RetryStatus
      phase="waiting"
      label={words.retrying(waiting.attempt)}
      countdown={(seconds) => words.retryIn(seconds, waiting.attempt)}
      nextAt={waiting.nextAt}
      retry={onRetryNow === undefined ? null : { label: words.retryNow, onClick: onRetryNow }}
      size={size}
      className={className}
    />
  );
}

export function HistoryLoading({
  projectId,
  sessionId,
  progress,
  onRetryNow,
}: {
  projectId: string | null;
  sessionId: string;
  /** The window read's progress; null before the first report, and always for this server. */
  progress: HistoryProgress | null;
  /** Reads the window again now. */
  onRetryNow: () => void;
}) {
  const [since] = useState(() => Date.now());
  const past = useElapsedPast(since, SKELETON_MS);
  const machines = useMachines();
  const machineId = progress?.machineId ?? machineForSession(sessionId);
  const alias = useMachineAlias(machineId);
  if (!past || machineId === null) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    );
  }

  const away = machineAway(machines.state, machines.settled, machineId);
  const entry = away?.machine ?? null;
  // The Machines page's presses: the server tries the connection now, or stops trying. A refusal
  // is said and rejects, so the press can be made again.
  const ask = async (
    send: (projectId: string, machineId: string) => ReturnType<typeof api.reconnectMachine>,
  ): Promise<void> => {
    if (projectId === null || entry === null) return;
    try {
      machines.accept(await send(projectId, entry.id));
    } catch (err) {
      toastError(apiErrorText(err));
      throw err;
    }
  };

  const total = progress?.totalBytes ?? 0;
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <TransferProgress
          size="sm"
          label={S.chat.historyTransfer.window(alias)}
          amount={transferAmount(progress?.doneBytes ?? 0, total)}
          {...(total > 0 ? { value: progress?.doneBytes ?? 0, max: total } : {})}
          className="justify-center text-left"
        />
        <div className="min-h-5 text-sm">
          {away !== null && away.retry !== null ? (
            <RetryStatus
              {...retryStatus(away.retry, {
                onRetry: () => ask(api.reconnectMachine),
                onStop: () => ask(api.stopReconnectingMachine),
                held: false,
                size: "sm",
              })}
              className="justify-center text-left"
            />
          ) : progress !== null && progress.waiting !== null ? (
            <LinkRetry
              waiting={progress.waiting}
              onRetryNow={onRetryNow}
              size="sm"
              className="justify-center text-left"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The older-history row's transfer line, or null when no read runs behind the transcript. An
 * older window being read wins: it is what the reader scrolled up for.
 */
export function HistoryTransferLine({
  older,
  fill,
}: {
  older: HistoryProgress | null;
  fill: HistoryProgress | null;
}) {
  const reading = older ?? fill;
  if (reading === null) return null;
  if (reading.waiting !== null) return <LinkRetry waiting={reading.waiting} size="xs" />;
  const words = S.chat.historyTransfer;
  const label =
    reading === older
      ? S.chat.loadingEarlier
      : reading.phase === "heavy"
        ? words.heavy
        : words.fill;
  return (
    <TransferProgress
      label={label}
      amount={transferAmount(reading.doneBytes, reading.totalBytes)}
      {...(reading.totalBytes > 0 ? { value: reading.doneBytes, max: reading.totalBytes } : {})}
    />
  );
}

/**
 * A Trace file being brought over from its machine before the Trace panel opens it: the
 * skeleton for the first second, then the transfer row (where it comes from, the amount against
 * the whole, a thin bar) and the server's retry of the link while it drops.
 */
export function HistoryFileLoading({
  since,
  progress,
}: {
  /** When the fetch began. */
  since: number;
  progress: HistoryProgress | null;
}) {
  const past = useElapsedPast(since, SKELETON_MS);
  const alias = useMachineAlias(progress?.machineId ?? null);
  if (!past) return <Skeleton className="h-40" />;
  const total = progress?.totalBytes ?? 0;
  return (
    <div className="flex flex-col gap-2 py-6">
      <TransferProgress
        label={S.chat.historyTransfer.trace(alias)}
        amount={transferAmount(progress?.doneBytes ?? 0, total)}
        {...(total > 0 ? { value: progress?.doneBytes ?? 0, max: total } : {})}
      />
      <div className="min-h-4 text-xs">
        {progress !== null && progress.waiting !== null && (
          <LinkRetry waiting={progress.waiting} size="xs" />
        )}
      </div>
    </div>
  );
}
