/**
 * Per-machine connect state, remembered across platform swaps and server restarts in one
 * JSON file under the data root: which local (= remote) port each machine's tunnel uses,
 * and the pid of the ssh child holding it.
 *
 * The PORT matters beyond convenience. The app origin is `http://localhost:<port>`, and a
 * browser buckets localStorage and cookies per origin — so a machine whose port drifts
 * loses everything remembered about it on every reconnect. Once a machine has tunnelled on
 * a port, that port is its first candidate forever after. Ports are remembered, not
 * reserved: two machines never hold one number at the same time (the tunnel's local bind
 * sees to that), but a number can be reused by another machine later.
 *
 * The PID is what lets a later platform adopt a tunnel it did not spawn. A hot swap
 * replaces this bundle's objects, but the ssh child is a separate process and keeps
 * forwarding; a live pid whose port still answers is a connection that survived us, and a
 * dead one is stale state to clear.
 *
 * Separate from machines-installs.json on purpose: that file records what was DONE (an
 * install, an identity) and is true until something changes it, while this one describes
 * what is RUNNING and is only ever as true as the last process check.
 *
 * Pure functions over the file's text; the service owns the I/O.
 */
import { DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";

export interface ConnectState {
  /** Local (= remote) port this machine's tunnel forwards. */
  port: number;
  /** ssh child holding the tunnel, when one was started and not seen exiting. */
  tunnelPid?: number;
  /** ISO timestamp of the last successful connect. */
  connectedAt?: string;
}

/** Parses the state file's text: machine id → state. Damage reads as empty. */
export function parseConnectState(raw: string | null): Record<string, ConnectState> {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, ConnectState> = {};
    for (const [machine, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const o = value as Record<string, unknown>;
      if (!isPort(o.port)) continue;
      const entry: ConnectState = { port: o.port };
      if (typeof o.tunnelPid === "number" && Number.isInteger(o.tunnelPid) && o.tunnelPid > 0) {
        entry.tunnelPid = o.tunnelPid;
      }
      if (typeof o.connectedAt === "string" && o.connectedAt !== "") {
        entry.connectedAt = o.connectedAt;
      }
      out[machine] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

/** The file's next text after updating one machine's entry (null removes it). */
export function withConnectState(
  raw: string | null,
  machine: string,
  state: ConnectState | null,
): string {
  const all = parseConnectState(raw);
  if (state === null) delete all[machine];
  else all[machine] = state;
  return JSON.stringify(all, null, 2) + "\n";
}

const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;

/** How far past the well-known port the search goes before giving up. */
const PORT_SEARCH_SPAN = 20;

/**
 * The port a machine's tunnel should try: its remembered port first, then the well-known
 * port and the numbers after it, skipping whatever is busy locally.
 *
 * The remote side is not asked. The server start over there is the authoritative check, and
 * a collision surfaces as its startup failure — asking first would be a race with a gap
 * between the answer and the bind. Both ends get the SAME number because preview URLs are
 * built from the server's own bound port, so a mismatch breaks Workspace previews.
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
