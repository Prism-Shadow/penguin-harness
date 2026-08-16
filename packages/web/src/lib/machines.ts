/**
 * The machines menu's client side: which machines this server can point the window at, and
 * the connect flow against the PLATFORM's `/api/machines` routes (served through the HTTP
 * seam, so the whole capability — list, probe, auto-install, tunnel — ships by hot push;
 * the shell contributes nothing but permission to navigate between loopback origins).
 *
 * A server without the capability (an older platform, a non-admin session) answers 404 or
 * 403 — both read as "no machines to offer" and the menu section simply does not render.
 *
 * Switching lands on ANOTHER origin, so the page cannot come back by memory of its own —
 * localStorage is bucketed per origin. The navigation therefore carries `?penguinHome=`,
 * the origin it came from; the destination stores it (captureHomeOrigin, called once at
 * app start) and offers it as the way back.
 */
import { apiFetch } from "../api/client";

export interface MachineTargetInfo {
  id: string;
  /** The alias as written in ~/.ssh/config — the label. Resolution happens at connect time. */
  alias: string;
  /** Origin of an already-live tunnel, when the server has one up for this machine. */
  origin: string | null;
}

/**
 * How many rows the machines block shows at once. An ssh config can declare hundreds of
 * hosts; the server orders them live-first, then by recency, so the visible few are the
 * useful few — the search box reaches the rest.
 */
export const MAX_VISIBLE_MACHINES = 6;

/** Case-insensitive substring filter over aliases; an empty query keeps the server's order. */
export function filterMachines(machines: MachineTargetInfo[], query: string): MachineTargetInfo[] {
  const q = query.trim().toLowerCase();
  if (q === "") return machines;
  return machines.filter((m) => m.alias.toLowerCase().includes(q));
}

export interface ConnectJobState {
  machineId: string;
  running: boolean;
  log: string[];
  result:
    | null
    | { ok: true; origin: string }
    | { ok: false; code?: "port-conflict" | "not-supported" | "no-image"; message: string };
}

export interface MachinesResponse {
  machines: MachineTargetInfo[];
  job: ConnectJobState | null;
}

export const getMachines = () => apiFetch<MachinesResponse>("/api/machines");

export const connectMachine = (id: string, allowRestart = false) =>
  apiFetch<{ started: boolean }>("/api/machines/connect", {
    method: "POST",
    body: { id, allowRestart },
  });

/**
 * Runs a connect to completion: starts the job and polls the machines route until it
 * settles. The server refuses a second job while one runs, so a 409 from the start is
 * surfaced as a plain failure.
 */
export async function runConnect(
  id: string,
  opts: { allowRestart?: boolean; onLog?: (line: string) => void } = {},
): Promise<Exclude<ConnectJobState["result"], null>> {
  await connectMachine(id, opts.allowRestart === true);
  let seen = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    let state: MachinesResponse;
    try {
      state = await getMachines();
    } catch {
      continue; // A poll that fails is retried; the job keeps running server-side.
    }
    const job = state.job;
    if (job === null || job.machineId !== id) continue;
    for (; seen < job.log.length; seen++) opts.onLog?.(job.log[seen]!);
    if (!job.running && job.result !== null) return job.result;
  }
}

/** localStorage key of the origin this window arrived FROM (per-origin, like all storage). */
export const HOME_ORIGIN_KEY = "penguin.homeOrigin";

/**
 * Captures `?penguinHome=` into localStorage and strips it from the address bar. Call once
 * at app start, before the router runs: the login redirect would otherwise drop the query
 * and with it the only way this origin learns where "back" is.
 */
export function captureHomeOrigin(): void {
  try {
    const url = new URL(window.location.href);
    const home = url.searchParams.get("penguinHome");
    if (home === null) return;
    if (/^https?:\/\//.test(home) && home !== window.location.origin) {
      localStorage.setItem(HOME_ORIGIN_KEY, home);
    }
    url.searchParams.delete("penguinHome");
    window.history.replaceState(null, "", url.toString());
  } catch {
    // Storage or URL trouble: the breadcrumb is a convenience, never a failure.
  }
}

/** The origin to offer as "back", or null (not arrived from anywhere, or that IS here). */
export function homeOrigin(): string | null {
  try {
    const stored = localStorage.getItem(HOME_ORIGIN_KEY);
    return stored !== null && stored !== window.location.origin ? stored : null;
  } catch {
    return null;
  }
}

/** The URL a switch navigates to: the target origin, telling it where it came from. */
export function switchUrl(targetOrigin: string): string {
  return `${targetOrigin}/?penguinHome=${encodeURIComponent(window.location.origin)}`;
}
