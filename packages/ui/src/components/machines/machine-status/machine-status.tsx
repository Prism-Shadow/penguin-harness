/**
 * A machine's state as one label pill (`Pill`): the state's word in the state's tone — the one
 * status mark every machine surface wears (a card on the Machines page, the Machine dialog's
 * header), the same shape as the 「本服务端」 tag beside it. Words only: the word says the state,
 * and this server's card says it is this server with its tag. Never a bare coloured dot: the
 * reason behind the word (a failure's own words, ssh's diagnostic, the line a job is on) is the
 * pill's hover hint and part of its accessible name.
 *
 * `MACHINE_STATE_TONE` maps a state to its tone, by meaning: running (this server, or a held
 * connection) is `info` — in contact, not a verdict; work under way is `success` (the busy tone's
 * fill); what waits on someone or something is `attention`; a failure is `danger`; a state that
 * should recede is `neutral`. The words are the caller's.
 */
import type { ToneName } from "../../../tokens";
import { Pill } from "../../feedback/pill/pill";

/** Every state a machine's pill can say. `serving` is this server's own entry. */
export const MACHINE_STATES = [
  "serving",
  "ready",
  "queued",
  "working",
  "reconnecting",
  "reconnectStopped",
  "failed",
  "signInRefused",
  "installedOnly",
  "behind",
  "notConnected",
  "unreachable",
  "stopped",
  "notInstalled",
  "unknown",
] as const;
export type MachineState = (typeof MACHINE_STATES)[number];

export const MACHINE_STATE_TONE: Readonly<Record<MachineState, ToneName>> = {
  serving: "info",
  ready: "info",
  queued: "success",
  working: "success",
  reconnecting: "success",
  // The automatic attempts stopped: it waits on a person's Retry, not on time.
  reconnectStopped: "attention",
  failed: "danger",
  signInRefused: "danger",
  installedOnly: "neutral",
  behind: "attention",
  notConnected: "attention",
  unreachable: "attention",
  stopped: "attention",
  notInstalled: "attention",
  unknown: "neutral",
};

export interface MachineStatusPillProps {
  state: MachineState;
  /** The state's word ("Running", "Stopped"). */
  label: string;
  /** What stands behind the word, when there is more to say; shown on hover. */
  reason?: string | null;
}

export function MachineStatusPill({ state, label, reason = null }: MachineStatusPillProps) {
  return (
    <Pill tone={MACHINE_STATE_TONE[state]} {...(reason === null ? {} : { tooltip: reason })}>
      <span data-machine-state={state}>
        {label}
        {reason !== null && <span className="sr-only">{` · ${reason}`}</span>}
      </span>
    </Pill>
  );
}
