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
 * a read runs behind the transcript: an older window coming over (the first paint's backfill is
 * one such read from its first window to its last), or the rest of the conversation syncing
 * behind the first paint. Like the skeleton it says nothing for its first second, and it goes when
 * the read does — the data changed: there is nothing left to fetch. While the server waits for
 * the machine the same line says so: the hourglass in its mark slot and the waiting words in its
 * sentence, the amount and the bar as they stood — one line in one ink, in one place, from the
 * first byte to the last.
 *
 * Nothing on these rows changes while its data does not: the machine is named only once the
 * machine list has answered (the skeleton stays until then, then the row keeps the name it
 * started with), and the link's state is said by what the server reports of it — a machine that
 * is not connected is not one that is slow to answer.
 */
import { useState } from "react";
import type { HistoryProgress } from "@prismshadow/penguin-server/api";
import {
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  RetryStatus,
  Skeleton,
  Spinner,
  TransferProgress,
  toastError,
  useCountdown,
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

/**
 * A machine's alias from the live machines account, and whether the account has answered: a
 * row that names the machine waits for it, so its words do not change when the name arrives.
 */
function useMachineAlias(machineId: string | null): { alias: string | null; known: boolean } {
  const machines = useMachines();
  const alias =
    machineId === null
      ? null
      : (machines.state?.machines.find((m) => !m.local && m.machineId === machineId)?.alias ??
        null);
  return { alias, known: machineId === null || alias !== null || machines.settled };
}

/** Whether `active` has held for a second; false again as soon as it stops. */
function useQuietSecond(active: boolean): boolean {
  const [since, setSince] = useState<number | null>(null);
  if (active && since === null) setSince(Date.now());
  if (!active && since !== null) setSince(null);
  return useElapsedPast(active ? (since ?? undefined) : undefined, SKELETON_MS);
}

/** The words for the server's wait on the machine: the attempt now, or the seconds to the next. */
function waitingWords(waiting: NonNullable<HistoryProgress["waiting"]>): {
  now: string;
  inSeconds: (seconds: number) => string;
} {
  const words = S.chat.historyTransfer;
  return waiting.reason === "not_connected"
    ? {
        now: words.reconnecting(waiting.attempt),
        inSeconds: (seconds) => words.reconnectIn(seconds, waiting.attempt),
      }
    : {
        now: words.asking(waiting.attempt),
        inSeconds: (seconds) => words.askIn(seconds, waiting.attempt),
      };
}

/**
 * The server's retry of the link to the machine, as the shared retry row, in the words of what
 * it reports: not connected (it reconnects), or connected and silent (it asks again).
 */
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
  const said = waitingWords(waiting);
  return (
    <RetryStatus
      phase="waiting"
      label={said.now}
      countdown={said.inSeconds}
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
  const { alias, known } = useMachineAlias(machineId);
  if (!past || machineId === null || !known) {
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

/** The waiting mark in the transfer line's slot: the retry row's own hourglass, in its tone. */
const WAITING_MARK = (
  <GlyphIcon d={ICONS.hourglass} size={ICON_SIZE.inlineGlyph} className="text-tone-attention-fg" />
);

/**
 * The older-history row while a read runs behind the transcript, or null when none does: an
 * older window being read (`loading`: its progress when the server reports one, the plain
 * spinner line when it does not, as for a Session on this server), else the sync behind the
 * first paint — and, while the server waits on the machine, the same line saying so. Nothing
 * for the first second, as the skeleton.
 */
export function HistoryTransferLine({
  loading,
  older,
  fill,
}: {
  loading: boolean;
  older: HistoryProgress | null;
  fill: HistoryProgress | null;
}) {
  const active = loading || fill !== null;
  const past = useQuietSecond(active);
  const current = loading ? older : fill;
  const seconds = useCountdown(current?.waiting?.nextAt ?? null);
  if (!active || !past) return null;
  const words = S.chat.historyTransfer;
  if (loading && older === null) {
    return (
      <span className="flex items-center gap-2 py-1 text-xs text-gray-400 dark:text-gray-500">
        <Spinner size="sm" label={S.common.loading} />
        {S.chat.loadingEarlier}
      </span>
    );
  }
  const reading = current!;
  const waiting = reading.waiting === null ? null : waitingWords(reading.waiting);
  const label =
    waiting !== null
      ? seconds !== null && seconds > 0
        ? waiting.inSeconds(seconds)
        : waiting.now
      : loading
        ? S.chat.loadingEarlier
        : reading.phase === "heavy"
          ? words.heavy
          : words.fill;
  return (
    <TransferProgress
      mark={waiting !== null ? WAITING_MARK : null}
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
  const { alias, known } = useMachineAlias(progress?.machineId ?? null);
  if (!past || !known) return <Skeleton className="h-40" />;
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
