/**
 * Connecting to a machine the moment something first needs it, without anyone clicking
 * Connect: picking a workspace on a machine asks that machine for its Agents, and a machine
 * with no live forward answers 503. The tunnel is plumbing — raising it is not a decision a
 * person has to make, so the page raises it and tries again on a widening schedule.
 *
 * ONCE per machine per page load: the first need starts the attempt, every later need joins
 * it, and a settled outcome is kept — a machine that could not be reached after the whole
 * schedule is not re-tried by every keystroke that names it; the Machines page is where a
 * person takes over. The schedule lives here, on the page, for the reason the probe schedule
 * does: a retry loop on the server would keep spawning ssh after the last tab closed.
 *
 * Whether the machine is CONNECTED is read from the machine list after the job settles, not
 * from the job's verdict: a connect whose build hand-over failed still leaves the forward up
 * (the server keeps it deliberately), and that failure is reported on the Machines page for a
 * person to act on — it is not a reason to keep re-connecting.
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
    } else if (machine.connected) {
      for (const listener of listeners) listener(projectId, machineId);
      return "connected";
    } else {
      try {
        await deps.api.connectMachine(projectId, machine.id);
        const after = lookup(await settled());
        if (after?.connected === true) {
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
