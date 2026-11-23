/**
 * The transcript's place when a conversation's history could not be read.
 *
 * For a conversation on a machine the server cannot reach right now, the history lives on that
 * machine, so the failure is the machine's state and is said as such: the machine by its alias
 * and where its link stands; while the server brings it back or has stopped trying, the Machines
 * page's own retry row (the attempt and the countdown to it with Retry now and Stop retrying, or
 * where it stopped with Retry, the last failure after its sentence); and in every state one press
 * to the Machines page, where everything else that can be done about the machine lives. The history
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
import { ICONS, LoadFailed, exceptionReport, isReportable } from "@prismshadow/penguin-ui";
import { HistoryMachineRetry } from "./history-machine-retry";
import { machineLink } from "../../lib/machine-link";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import { useMachines } from "../../state/machines";
import { machineAway } from "./machine-away";

export function HistoryLoadFailed({
  projectId,
  sessionId,
  error,
  cause,
  onRetry,
}: {
  projectId: string | null;
  sessionId: string;
  /** The read's error, in words. */
  error: string;
  /** What the read threw: a defect (not the person's to fix) offers 「[报告问题]」. */
  cause?: unknown;
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
        report={
          isReportable(cause)
            ? () =>
                exceptionReport(cause, { what: "the conversation's history could not be loaded" })
            : null
        }
      />
    );
  }

  return (
    <LoadFailed
      glyph={ICONS.server}
      title={away.headline}
      description={S.chat.machineAway.hint}
      action={{ label: S.chat.machineAway.openMachines, onClick: () => navigate("/machines") }}
      details={{ title: S.chat.machineAway.details, text: error }}
    >
      {away.retry !== null && <HistoryMachineRetry projectId={projectId} away={away} />}
    </LoadFailed>
  );
}
