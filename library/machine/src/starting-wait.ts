/**
 * A machine's server that is still starting, waited out rather than taken for its answer.
 *
 * A server binds its port before it has an App to answer with (index.ts's listen): until the App
 * is built, every request is answered with the starting response, a 503 that asks for a retry
 * (hmr/starting.ts). `penguin server status`, which a start waits on (server-control.ts), calls a
 * server running as soon as its pid lives and its port accepts — so the first question this side
 * asks a server it has just started, or one a reboot has just brought back, lands in that window.
 * A connect took that 503 for "could not ask that machine what it runs", and handed it no config.
 *
 * So the questions a job asks a machine's server go through here: an answer that says its server
 * is starting is asked again after the wait it asks for, until it is anything else or the budget
 * is spent, and the last answer is the outcome either way. Asking again is safe for every method:
 * the starting response is the entry's own, given before any App has seen the request. A 503
 * without a retry — a platform that could not boot (noPlatformResponse) — does not end by itself,
 * and is returned at once.
 */
import type { MachineAnswer, MachineApi } from "./machine-api.js";

/** How long a server may go on answering that it is starting before the question gives up. */
export const STARTING_BUDGET_MS = 60_000;

/** The shortest and the longest wait between two asks, whatever the retry-after says. */
const SHORTEST_PAUSE_MS = 250;
const LONGEST_PAUSE_MS = 5_000;

/** How long to wait, and for whose work. */
export interface StartingWait {
  /** The work's own signal: once it is cut, the wait ends and the last answer is returned. */
  signal?: AbortSignal;
  budgetMs?: number;
}

/** An answer saying its server is starting: a 503 that asks for a retry. */
export function isStarting(answer: MachineAnswer): boolean {
  return answer.status === 503 && answer.retryAfter !== undefined;
}

/** Asks, and asks again while the answer says its server is starting. Throws what `ask` throws. */
export async function pastStarting(
  ask: () => Promise<MachineAnswer>,
  opts: StartingWait = {},
): Promise<MachineAnswer> {
  const deadline = Date.now() + (opts.budgetMs ?? STARTING_BUDGET_MS);
  // Read afresh each time: the signal is cut from outside, while this waits.
  const cut = (): boolean => opts.signal?.aborted === true;
  let answer = await ask();
  while (isStarting(answer) && !cut()) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const asked = (answer.retryAfter ?? 0) * 1000;
    await pause(Math.min(Math.max(asked, SHORTEST_PAUSE_MS), LONGEST_PAUSE_MS, left), opts.signal);
    if (cut()) break;
    answer = await ask();
  }
  return answer;
}

/** The same API, every call of which waits out a server that is starting. */
export function waitingOutStarting(api: MachineApi, opts: StartingWait = {}): MachineApi {
  return {
    request: (method, path, body) => pastStarting(() => api.request(method, path, body), opts),
    postBytes: (path, contentType, body, timeoutMs, headers) =>
      pastStarting(() => api.postBytes(path, contentType, body, timeoutMs, headers), opts),
  };
}

/** A wait that a cut ends early. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
