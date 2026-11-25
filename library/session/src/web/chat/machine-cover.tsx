/**
 * What a conversation's input box says while the machine the conversation lives on is out of
 * reach: the one place the conversation says where its machine stands, laid over the box it
 * cannot be written in (the UI package's `ComposerCover` on the card's `cover`). The transcript
 * above stays as it is, readable and scrollable; only the box is taken.
 *
 * One line for what is happening — the machine by its alias and its state, from the same machines
 * account the Machines page shows — then, while the server brings it back or after it stopped,
 * the machine's own retry row (the attempt and the countdown, Retry now and Stop retrying while it
 * runs; Retry and Go to Machines once it stopped), or the presses that stand in for it: Go to
 * Machines for a machine nothing brings back on its own, a single Retry for a read that gave up on
 * a machine the list reads as connected. Then what it means for sending. A job working on the
 * machine (an update, a restart) is said as that job. Once the machine is back, the box says the
 * conversation is being read afresh, and is itself again once it is.
 *
 * Go to Machines is offered to whoever can open that page — a person the account lists machines
 * for. Its own component, reading the machines account itself: a job's steps change the list
 * often, and the chat page does not re-render for them.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type { MachineJob } from "@prismshadow/penguin-server/api";
import { ComposerCover, Spinner, TextAction } from "@prismshadow/penguin-ui";
import { S, jobFor, useMachines } from "@prismshadow/penguin-web/internal";
import { HistoryMachineRetry } from "./history-machine-retry";
import { listedAway, machineAway } from "./machine-away";
import type { MachineAway, StoppedReason } from "./machine-away";

/** What the cover is told about the conversation's machine. */
export interface MachineCoverReading {
  /** The machine's alias, as far as it is known (its id when nothing names it). */
  alias: string;
  /** The machine is connected again and the conversation is being read afresh. */
  connected: boolean;
  /** The machines account's reading of the machine; null when the account has none. */
  away: MachineAway | null;
  /** A read gave up on a machine the account does not read as away: why, and its one Retry. */
  stopped: { reason: StoppedReason; onRetry: () => void } | null;
  /** The transcript shown is the copy kept from the last sync rather than one read live. */
  cached: boolean;
}

/** What a job does, as the cover names it. */
const JOB_WORDS: Record<MachineJob["kind"], keyof typeof S.chat.machineCover.working> = {
  use: "install",
  install: "install",
  restart: "restart",
  connect: "connect",
  stop: "stop",
  uninstall: "stop",
  sync: "sync",
};

export function MachineCover({
  projectId,
  reading,
  drafted,
}: {
  projectId: string | null;
  reading: MachineCoverReading;
  /** Something is typed or staged in the box under the cover. */
  drafted: boolean;
}) {
  const machines = useMachines();
  const navigate = useNavigate();
  const words = S.chat.machineCover;
  const { alias, away, stopped } = reading;
  const note = words.note(drafted, reading.cached);

  if (reading.connected) {
    return (
      <ComposerCover
        title={words.refreshing(alias)}
        status={
          // The title says what runs; the spinner adds no second announcement.
          <span aria-hidden="true">
            <Spinner size="sm" label={S.common.loading} />
          </span>
        }
      />
    );
  }

  // Go to Machines is for whoever the account lists machines for; the page is theirs.
  const open = machines.state !== null && {
    label: S.chat.machineAway.openMachines,
    onClick: () => navigate("/machines"),
  };
  const presses = (...actions: ({ label: string; onClick: () => void } | false)[]) => {
    const shown = actions.filter((action) => action !== false);
    return shown.length === 0 ? null : (
      <span className="flex flex-wrap items-baseline justify-center gap-x-3 text-sm">
        {shown.map((action) => (
          <TextAction key={action.label} onClick={action.onClick}>
            {action.label}
          </TextAction>
        ))}
      </span>
    );
  };

  const entry = away?.machine ?? null;
  const job =
    entry !== null && machines.state !== null ? jobFor(machines.state.jobs, entry.id) : null;
  if (job !== null && (job.queued || job.running)) {
    const step = job.queued
      ? S.machines.queued
      : job.phase !== null
        ? S.machines.phase[job.phase]
        : S.machines.working;
    return (
      <ComposerCover
        title={words.working[JOB_WORDS[job.kind]](alias)}
        status={
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span aria-hidden="true">
                <Spinner size="sm" label={step} />
              </span>
              {step}
            </span>
            {presses(open)}
          </span>
        }
        note={note}
      />
    );
  }

  if (away !== null && away.retry !== null) {
    return (
      <ComposerCover
        title={
          away.link === "reconnecting" ? words.reconnecting(alias) : words.stoppedTrying(alias)
        }
        status={
          <HistoryMachineRetry
            // Its presses are made again once the retries stop: a focused Stop retrying does not
            // turn into the Go to Machines in its place, focus goes back to the first press.
            key={away.retry.offers.stop ? "running" : "stopped"}
            projectId={projectId}
            away={away}
            rest={open || null}
            reason={false}
            className="justify-center"
          />
        }
        note={note}
      />
    );
  }

  if (stopped !== null) {
    return (
      <ComposerCover
        title={
          stopped.reason === "unreachable"
            ? words.noService(alias)
            : stopped.reason === "retrying"
              ? words.silent(alias)
              : words.reconnecting(alias)
        }
        status={presses({ label: S.common.retry, onClick: stopped.onRetry }, open)}
        note={note}
      />
    );
  }

  // A person the account lists no machines for has no state to read but "out of reach".
  const link = machines.state !== null ? (away?.link ?? null) : null;
  return (
    <ComposerCover
      title={
        link === "stopped"
          ? words.stopped(alias)
          : link === "notConnected"
            ? words.notConnected(alias)
            : link === "missing"
              ? words.missing
              : words.reconnecting(alias)
      }
      status={presses(open)}
      note={note}
    />
  );
}

/**
 * The cover for a composer that writes to a machine's conversation with no read of its own to
 * judge by (the Agents panel's): the machines account's reading alone, while the account lists
 * the machine and reads it as away; null otherwise, and for a conversation on this server.
 */
export function useListedAwayCover(
  projectId: string | null,
  machineId: string | null,
): ((drafted: boolean) => ReactNode) | null {
  const machines = useMachines();
  if (machineId === null || !listedAway(machines.state, machines.settled, machineId)) return null;
  const away = machineAway(machines.state, machines.settled, machineId);
  const reading: MachineCoverReading = {
    alias: away?.machine?.alias ?? machineId,
    connected: false,
    away,
    stopped: null,
    cached: false,
  };
  return (drafted) => <MachineCover projectId={projectId} reading={reading} drafted={drafted} />;
}
