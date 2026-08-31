/**
 * Connecting to a machine the moment something first needs it, without anyone clicking
 * Connect: picking a workspace on a machine asks that machine for its Agents, and a machine
 * with no live forward answers 503. The tunnel is plumbing — raising it is not a decision a
 * person has to make, so the page raises it and tries again on a widening schedule.
 *
 * ONE attempt at a time per machine: the first need starts it and every later need joins it.
 * A FAILED outcome is then kept — a machine that could not be reached after the whole
 * schedule is not re-tried by every keystroke that names it; the Machines page is where a
 * person takes over. The schedule lives here, on the page, for the reason the probe schedule
 * does: a retry loop on the server would keep spawning ssh after the last tab closed.
 *
 * A SUCCESSFUL one is not kept, because it is not a fact about the machine — it is a fact
 * about a forward, and a forward dies: ssh drops, the network moves, the machine reboots.
 * Remembering it made the drop permanent for the life of the page — every later need, the
 * `not_connected` retry in api/client.ts included, was answered "already connected" by the
 * cache and nothing ever raised the tunnel again. Each need after a drop therefore starts a
 * fresh attempt, which costs one machine-list call when the machine is in fact still up.
 *
 * Whether the machine is CONNECTED is read from the machine list after the job settles, not
 * from the job's verdict: a connect whose build hand-over failed still leaves the forward up
 * (the server keeps it deliberately), and that failure is reported on the Machines page for a
 * person to act on — it is not a reason to keep re-connecting. But the list's word is about
 * the FORWARD, so it is confirmed by asking the machine itself (meOnMachine) before the
 * attempt counts as connected — see AutoConnectApi.meOnMachine for the loop that ran when
 * it was not.
 */
import type { MachinesResponse } from "@prismshadow/penguin-server/api";

/** The waits between attempts, doubling; after the last one the attempt gives up. */
export const AUTO_CONNECT_STEPS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 64_000] as const;

/** How often the connect job is polled while it runs. */
export const AUTO_CONNECT_POLL_MS = 1_000;

/** The wait after `failures` failed attempts, or null when the schedule is exhausted. */
export function autoConnectDelayMs(failures: number): number | null {
  if (failures < 1) return AUTO_CONNECT_STEPS_MS[0];
  return AUTO_CONNECT_STEPS_MS[failures - 1] ?? null;
}

export type AutoConnectOutcome = "connected" | "gave-up" | "unknown-machine";

export interface AutoConnectApi {
  getMachines(projectId: string): Promise<MachinesResponse>;
  /** POST connect for the machine at `address` (the `ssh:<alias>` id, not the machine's own). */
  connectMachine(projectId: string, address: string): Promise<MachinesResponse>;
  /**
   * Whether the machine's API answers through the proxy right now (endpoints.meOnMachine).
   * The list's `forward` is a fact about an ssh process on this side that outlives the far
   * server — so an attempt only counts as connected once the
   * machine itself has answered. Declaring success on the forward's word alone is what made
   * this loop forever: the listener re-ran the reachability probe, the silent machine read
   * as offline again, and the "successful" attempt had already been forgotten.
   */
  meOnMachine(machineId: string): Promise<unknown>;
}

export interface AutoConnectDeps {
  api: AutoConnectApi;
  /** Injected so a test runs the whole schedule without waiting it out. */
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}

type Listener = (projectId: string, machineId: string) => void;

const attempts = new Map<string, Promise<AutoConnectOutcome>>();
const listeners = new Set<Listener>();

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Brings `machineId` (the machine's OWN id, as workspaces record it) to connected, or gives
 * up. Idempotent per (project, machine) for the page's lifetime — see the module doc.
 */
export function ensureMachineConnected(
  projectId: string,
  machineId: string,
  deps: AutoConnectDeps,
): Promise<AutoConnectOutcome> {
  const key = `${projectId}\0${machineId}`;
  const running = attempts.get(key);
  if (running !== undefined) return running;
  const attempt = runAttempt(projectId, machineId, deps);
  attempts.set(key, attempt);
  void attempt.then(
    (outcome) => {
      // Only the outcomes that are about the MACHINE are remembered; "connected" is about a
      // forward that can die under us (see the module header).
      if (outcome === "connected") attempts.delete(key);
    },
    // A throw is not an answer either: keeping a rejected promise would reject every later
    // need with the one error that happened here.
    () => attempts.delete(key),
  );
  return attempt;
}

/** Called when an attempt reaches connected — the Session list re-asks which machines answer. */
export function onMachineAutoConnected(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forgets every remembered attempt. */
export function forgetAutoConnects(): void {
  attempts.clear();
}

async function runAttempt(
  projectId: string,
  machineId: string,
  deps: AutoConnectDeps,
): Promise<AutoConnectOutcome> {
  const sleep = deps.sleep ?? defaultSleep;
  const pollMs = deps.pollMs ?? AUTO_CONNECT_POLL_MS;
  const lookup = (state: MachinesResponse) =>
    state.machines.find((machine) => !machine.local && machine.machineId === machineId) ?? null;
  const settled = async (): Promise<MachinesResponse> => {
    let state = await deps.api.getMachines(projectId);
    while (state.job?.running === true) {
      await sleep(pollMs);
      state = await deps.api.getMachines(projectId);
    }
    return state;
  };

  const answers = async (): Promise<boolean> => {
    try {
      await deps.api.meOnMachine(machineId);
      return true;
    } catch {
      return false;
    }
  };

  let failures = 0;
  for (;;) {
    let state: MachinesResponse;
    try {
      // Whatever job is running — ours from a previous round, or someone's install — is
      // waited out first: the server holds one job at a time and answers 409 otherwise.
      state = await settled();
    } catch {
      state = { machines: [], imageVersion: null, job: null };
    }
    const machine = lookup(state);
    if (machine === null) {
      // Not listed at all is a different answer from unreachable: nothing to connect to.
      if (state.machines.length > 0) return "unknown-machine";
    } else if (machine.forward !== null && (await answers())) {
      for (const listener of listeners) listener(projectId, machineId);
      return "connected";
    } else {
      // Not connected — or connected in the list while its server does not answer, which
      // the connect job is what heals: it asks the machine what is actually running there
      // and starts its server when nothing is.
      try {
        await deps.api.connectMachine(projectId, machine.id);
        const after = lookup(await settled());
        if (after !== null && after.forward !== null && (await answers())) {
          for (const listener of listeners) listener(projectId, machineId);
          return "connected";
        }
      } catch {
        // Refused (a job started meanwhile) or the network — the same next step either way.
      }
    }
    failures += 1;
    const delay = autoConnectDelayMs(failures);
    if (delay === null) return "gave-up";
    await sleep(delay);
  }
}
