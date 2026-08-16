/**
 * Per-machine connect state, remembered across platform swaps and server restarts in one
 * JSON file under the data root: which local (= remote) port each machine's tunnel uses,
 * and the pid of the ssh child holding it.
 *
 * The PORT matters beyond convenience: the app origin is `http://localhost:<port>`, and the
 * browser's localStorage, cookies — the parked-session jar included — are bucketed per
 * origin. A machine whose port drifts loses its remembered accounts and preferences on
 * every reconnect, so once a machine has tunneled on a port, that port is its first
 * candidate forever after. Ports are remembered, not reserved: two machines never hold one
 * number at the same time (the tunnel's local bind sees to that), but a number can be
 * reused by another machine later — the collision the web app's machine tag on remembered
 * accounts exists to absorb.
 *
 * The PID is what lets a later platform adopt a tunnel it did not spawn: hot swaps replace
 * this bundle's objects, but the ssh child is a separate process and keeps forwarding. A
 * live pid whose port still answers is a connection that survived us; a dead one is stale
 * state to clear.
 *
 * Pure functions over the file's text; sibling code owns the I/O.
 */
import { DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";

export interface MachineState {
  port: number;
  /** ssh child holding the tunnel, when one was started and not seen exiting. */
  tunnelPid?: number;
  /** ISO timestamp of the last successful connect — the recency the list is ordered by. */
  lastConnectedAt?: string;
}

/** Parses the state file's text: machine identity → state. Damage reads as empty. */
export function parseMachinesState(raw: string | null): Record<string, MachineState> {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, MachineState> = {};
    for (const [machine, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const o = value as Record<string, unknown>;
      if (typeof o.port !== "number" || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) {
        continue;
      }
      const entry: MachineState = { port: o.port };
      if (typeof o.tunnelPid === "number" && Number.isInteger(o.tunnelPid) && o.tunnelPid > 0) {
        entry.tunnelPid = o.tunnelPid;
      }
      if (typeof o.lastConnectedAt === "string" && o.lastConnectedAt !== "") {
        entry.lastConnectedAt = o.lastConnectedAt;
      }
      out[machine] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

/** The file's next text after updating one machine's entry (null removes it). */
export function withMachineState(
  raw: string | null,
  machine: string,
  state: MachineState | null,
): string {
  const all = parseMachinesState(raw);
  if (state === null) delete all[machine];
  else all[machine] = state;
  return JSON.stringify(all, null, 2) + "\n";
}

/** How far past the well-known port the search goes before giving up. */
const PORT_SEARCH_SPAN = 20;

/**
 * The port a machine's tunnel should try: its remembered port first, then the well-known
 * port and the numbers after it ("往后顺延"), skipping whatever is busy locally. The remote
 * side is not asked — the server start over there is the authoritative check, and a
 * collision surfaces as its startup failure.
 */
export async function pickTunnelPort(opts: {
  remembered: number | undefined;
  busy: (port: number) => Promise<boolean>;
}): Promise<number | null> {
  const candidates: number[] = [];
  if (opts.remembered !== undefined) candidates.push(opts.remembered);
  for (let port = DEFAULT_SERVER_PORT; port < DEFAULT_SERVER_PORT + PORT_SEARCH_SPAN; port++) {
    if (!candidates.includes(port)) candidates.push(port);
  }
  for (const port of candidates) {
    if (!(await opts.busy(port))) return port;
  }
  return null;
}
