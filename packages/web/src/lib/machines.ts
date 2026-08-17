/**
 * The machines picker's client side: which machines the LOCAL server can reach, and the
 * connect flow against its `/api/machines` routes (platform-served through the HTTP seam,
 * so the whole capability — list, probe, auto-install, tunnel, proxy — ships by hot push;
 * the shell contributes nothing at all).
 *
 * Every call here is `local: true`: the machines surface belongs to the local server —
 * where the ssh config, the tunnels and the proxy live — whichever server the rest of the
 * app is looking at. Switching is not a navigation any more: picking a machine sets the
 * ACTIVE SERVER (lib/server-context.ts) and reloads the document; all API and SSE traffic
 * then rides `/server/<id>/api/…` through the local proxy, and the window never leaves
 * this origin.
 *
 * A server without the capability (an older platform, a non-admin session) answers 404 or
 * 403 — both read as "no machines to offer" and the picker simply does not render.
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
 * How many rows the machines picker shows at once. An ssh config can declare hundreds of
 * hosts; the server orders them live-first, then by recency, so the visible few are the
 * useful few — the search box reaches the rest.
 */
export const MAX_VISIBLE_MACHINES = 6;

/** One machine that survived the query, with the character positions the query hit. */
export interface MachineMatch {
  machine: MachineTargetInfo;
  /** Indices into `machine.alias` to highlight; empty for the empty query. */
  positions: number[];
}

/** True when the alias character at `index` starts a word (`gpu-01` → g, 0). */
const isWordStart = (alias: string, index: number) =>
  index === 0 || /[-_./ ]/.test(alias[index - 1]!);

/**
 * Fuzzy match of `query` against one alias: every query character must appear, in order,
 * but not adjacently — `gpu1` hits `gpu-01`. Greedy left-to-right with a small score:
 * +3 for a character adjacent to the previous hit, +2 for one starting a word, +1
 * otherwise — so contiguous runs rank above initial-letter matches, which rank above
 * scattered ones. Null when the query does not fit at all.
 */
export function fuzzyMatch(
  alias: string,
  query: string,
): { positions: number[]; score: number } | null {
  const haystack = alias.toLowerCase();
  const needle = query.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let at = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, at);
    if (found === -1) return null;
    const previous = positions[positions.length - 1];
    score +=
      previous !== undefined && found === previous + 1 ? 3 : isWordStart(alias, found) ? 2 : 1;
    positions.push(found);
    at = found + 1;
  }
  return { positions, score };
}

/**
 * The machines a query keeps, best first. An empty query keeps every machine in the
 * server's order (live tunnels, then recency); otherwise matches sort by score with the
 * server's order as the tiebreak, so among equal hits the connected and recent still win.
 */
export function matchMachines(machines: MachineTargetInfo[], query: string): MachineMatch[] {
  const q = query.trim();
  if (q === "") return machines.map((machine) => ({ machine, positions: [] }));
  return machines
    .map((machine, index) => {
      const match = fuzzyMatch(machine.alias, q);
      return match === null
        ? null
        : { machine, positions: match.positions, score: match.score, index };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.index - b.index))
    .map(({ machine, positions }) => ({ machine, positions }));
}

/** The alias split into contiguous runs for rendering: `hit` runs carry the highlight. */
export function highlightSegments(
  alias: string,
  positions: number[],
): Array<{ text: string; hit: boolean }> {
  const hits = new Set(positions);
  const out: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < alias.length; i++) {
    const hit = hits.has(i);
    const last = out[out.length - 1];
    if (last !== undefined && last.hit === hit) last.text += alias[i]!;
    else out.push({ text: alias[i]!, hit });
  }
  return out;
}

export interface ConnectJobState {
  machineId: string;
  running: boolean;
  /** Step-prefixed progress lines (`[2/4] …`) — the wait has a visible shape. */
  log: string[];
  result:
    | null
    | {
        ok: true;
        origin: string;
        /** A fresh install's seeded admin sign-in — shown before leaving, or the remote's login page is a locked door. */
        initialAdmin?: { userId: string; password: string };
      }
    | {
        ok: false;
        code?: "port-conflict" | "not-supported" | "no-image" | "self";
        message: string;
      };
}

export interface MachinesResponse {
  machines: MachineTargetInfo[];
  job: ConnectJobState | null;
}

export const getMachines = () => apiFetch<MachinesResponse>("/api/machines", { local: true });

export const connectMachine = (id: string, allowRestart = false) =>
  apiFetch<{ started: boolean }>("/api/machines/connect", {
    method: "POST",
    body: { id, allowRestart },
    local: true,
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
