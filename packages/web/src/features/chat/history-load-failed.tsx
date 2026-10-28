/**
 * The transcript's place when a conversation's history could not be read.
 *
 * For a conversation on a machine the server cannot reach right now, the history lives on that
 * machine, so the failure is the machine's state and is said as such: the machine by its alias
 * and where its link stands; while the server brings it back or has stopped trying, the Machines
 * page's own retry row (the attempt and the countdown to it with Retry now and Stop retrying, or
 * where it stopped with Retry, the last failure behind its "?"); and in every state one press to
 * the Machines page, where everything else that can be done about the machine lives. The history
 * loads again on its own once the machine is connected. The transport's error — the machine's
 * internal id, a SOCKS port — is kept one fold away for whoever has to diagnose it, never the
 * headline.
 *
 * Anything else is the read's own failure: the error and a Retry.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  Button,
  GlyphIcon,
  HelpFold,
  ICONS,
  ICON_SIZE,
  RetryStatus,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { machineLink } from "../../lib/machine-link";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import { useMachines } from "../../state/machines";
import { retryStatus } from "../machines/machine-card";
import { machineAway } from "./machine-away";

export function HistoryLoadFailed({
  projectId,
  sessionId,
  error,
  onRetry,
}: {
  projectId: string | null;
  sessionId: string;
  /** The read's error, in words. */
  error: string;
  /** Reads the history again. */
  onRetry: () => void;
}) {
  const machines = useMachines();
  const navigate = useNavigate();
  const machineId = machineForSession(sessionId);
  const link = machineId === null ? null : machineLink(machines.state, machines.settled, machineId);
  const away = machineId === null ? null : machineAway(machines.state, machines.settled, machineId);

  // Back from being away: read the history again, once per return. A failure while the machine
  // still reads as connected waits for a Retry — nothing about it is known to have changed.
  const wasAway = useRef(false);
  useEffect(() => {
    if (link === null || link === "unknown") return;
    if (link !== "connected") {
      wasAway.current = true;
      return;
    }
    if (!wasAway.current) return;
    wasAway.current = false;
    onRetry();
  }, [link, onRetry]);

  if (away === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-red-600 dark:text-red-400">
          {S.chat.historyLoadFailed}：{error}
        </p>
        <Button onClick={onRetry}>{S.common.retry}</Button>
      </div>
    );
  }

  const entry = away.machine;
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

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <GlyphIcon d={ICONS.server} size={ICON_SIZE.sectionMark} className="text-fg-subtle" />
        <h2 className="max-w-full break-words text-base font-semibold text-fg">{away.headline}</h2>
        <p className="text-sm text-fg-muted">{S.chat.machineAway.hint}</p>
        {away.retry !== null && (
          <RetryStatus
            {...retryStatus(away.retry, {
              onRetry: () => ask(api.reconnectMachine),
              onStop: () => ask(api.stopReconnectingMachine),
              held: false,
              size: "sm",
            })}
            className="justify-center text-left"
          />
        )}
        <Button onClick={() => navigate("/machines")}>{S.chat.machineAway.openMachines}</Button>
        <HelpFold title={S.chat.machineAway.details} className="mt-2 max-w-full text-left">
          <p className="break-words font-mono text-xs text-fg-muted">{error}</p>
        </HelpFold>
      </div>
    </div>
  );
}
