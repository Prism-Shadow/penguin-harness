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
 * Anything else is the read's own failure: what failed, the error in words under it, and a Retry.
 *
 * Both are the UI package's one "could not load" notice (`LoadFailed`), so the two states, which
 * replace each other in the same place, read as one surface.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { ICONS, LoadFailed, RetryStatus, toastError } from "@prismshadow/penguin-ui";
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
      <LoadFailed
        title={S.chat.historyLoadFailed}
        description={error}
        action={{ label: S.common.retry, onClick: onRetry }}
      />
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
    <LoadFailed
      glyph={ICONS.server}
      title={away.headline}
      description={S.chat.machineAway.hint}
      action={{ label: S.chat.machineAway.openMachines, onClick: () => navigate("/machines") }}
      details={{ title: S.chat.machineAway.details, text: error }}
    >
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
    </LoadFailed>
  );
}
