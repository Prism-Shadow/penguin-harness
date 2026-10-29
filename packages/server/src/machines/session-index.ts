/**
 * Which machine holds a Session that this server does not: the index that lets a Session-level
 * request (`/api/sessions/:sessionId/…`) name only the Session and still reach the machine it
 * lives on (machines/session-forward.ts).
 *
 * A Session is created, run and stored on one machine and never moves to another (PRN-003), so
 * an entry stays true from the moment it is learnt until that Session is deleted. It is learnt in
 * three ways:
 *
 *  - from the machines' own events, as the event hub relays them: `session_created` notes a
 *    Session and `session_deleted` forgets it. These are heard only while a tab watches the
 *    machine, because only then does the hub hold a subscription to it;
 *  - on the first request for an id nothing has announced, by asking every connected machine the
 *    caller can reach (`GET /api/sessions/:id`) at the same time: the first machine to answer
 *    200 holds it;
 *  - from the forward's own answers: a machine that answers `session_not_found` no longer holds
 *    the Session, and a delete it accepted removes it.
 *
 * The index lives in memory, per platform generation, beside the socket cache and the event hub
 * that feed it. A hot push or a restart starts it empty, which costs one round of asks for each
 * Session touched afterwards. It is bounded: when it is full, the least recently used entry goes
 * first. An id that every machine denied is remembered as a miss for a short while, so a bad id
 * retried in a loop does not ask the whole fleet on every try.
 */
import type { MachineApi } from "./machine-api.js";

/** Where a Session lives: the machine, and the Project it belongs to there. */
export interface SessionPlace {
  machineId: string;
  projectId: string;
}

/** A connected machine that was asked about a Session and gave no answer in time, or no usable one. */
export interface SilentMachine {
  machineId: string;
  alias: string;
}

/**
 * Where a Session lives, or why that is unknown: `silent` names the machines that could hold it
 * and did not say (an empty list with no place means every machine asked answered no).
 */
export interface SessionResolution {
  place: SessionPlace | null;
  silent: readonly SilentMachine[];
}

/** A machine the index may ask about a Session: a client to its API while connected, null otherwise. */
export interface MachineCandidate {
  machineId: string;
  alias: string;
  api: Pick<MachineApi, "request"> | null;
}

export interface SessionMachineIndexOptions {
  /** The clock a miss expires by. */
  now?: () => number;
  /** The most Sessions remembered at once. */
  capacity?: number;
  /** How long an id that every machine denied stays a miss. */
  missTtlMs?: number;
  /** How long an ask waits for the machines before it calls the id unknown, without remembering that. */
  askTimeoutMs?: number;
}

const CAPACITY = 50_000;
const MISS_CAPACITY = 10_000;
const MISS_TTL_MS = 10_000;
const ASK_TIMEOUT_MS = 5_000;

/** One machine's answer to "do you hold this Session?". */
type Answer = { found: SessionPlace } | { absent: true } | { failed: true };

async function askOne(machine: MachineCandidate, path: string): Promise<Answer> {
  try {
    const res = await machine.api!.request("GET", path);
    if (res.status === 404) return { absent: true };
    if (res.status !== 200) return { failed: true };
    const body = JSON.parse(res.text) as { session?: { projectId?: unknown } } | null;
    const projectId = body?.session?.projectId;
    return typeof projectId === "string"
      ? { found: { machineId: machine.machineId, projectId } }
      : { failed: true };
  } catch {
    return { failed: true };
  }
}

export class SessionMachineIndex {
  /** sessionId → place, in order of last use (the oldest first, which is evicted first). */
  readonly #places = new Map<string, SessionPlace>();
  /** sessionId → when the miss expires. */
  readonly #misses = new Map<string, number>();
  /** The ask in flight for an id, so that concurrent requests for it share one round of asks. */
  readonly #asking = new Map<string, Promise<SessionResolution>>();
  readonly #now: () => number;
  readonly #capacity: number;
  readonly #missTtlMs: number;
  readonly #askTimeoutMs: number;

  constructor(options: SessionMachineIndexOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#capacity = options.capacity ?? CAPACITY;
    this.#missTtlMs = options.missTtlMs ?? MISS_TTL_MS;
    this.#askTimeoutMs = options.askTimeoutMs ?? ASK_TIMEOUT_MS;
  }

  /** Records that `machineId` holds the Session. */
  note(sessionId: string, machineId: string, projectId: string): void {
    this.#misses.delete(sessionId);
    this.#places.delete(sessionId);
    this.#places.set(sessionId, { machineId, projectId });
    if (this.#places.size > this.#capacity) this.#evictOldest(this.#places);
  }

  /**
   * Forgets the Session. With `machineId`, only when that machine is the one recorded: two
   * machines can mint the same id, and one of them deleting its Session says nothing about the
   * other's.
   */
  forget(sessionId: string, machineId?: string): void {
    const place = this.#places.get(sessionId);
    if (place !== undefined && (machineId === undefined || place.machineId === machineId)) {
      this.#places.delete(sessionId);
    }
  }

  /** Where the Session lives, as already known, or null. Looking it up counts as a use. */
  lookup(sessionId: string): SessionPlace | null {
    const place = this.#places.get(sessionId);
    if (place === undefined) return null;
    this.#places.delete(sessionId);
    this.#places.set(sessionId, place);
    return place;
  }

  /**
   * Where the Session lives: as already known, or else asked of `candidates`. They are all asked
   * at the same time, and the first to answer 200 wins. No place when none holds it; when every
   * connected machine answered that it does not, the id is remembered as a miss for a while, and
   * when some gave no answer in time (or none usable) they are named in `silent`.
   */
  resolve(
    sessionId: string,
    candidates: () => Promise<readonly MachineCandidate[]>,
  ): Promise<SessionResolution> {
    const known = this.lookup(sessionId);
    if (known !== null) return Promise.resolve({ place: known, silent: [] });
    const until = this.#misses.get(sessionId);
    if (until !== undefined) {
      if (until > this.#now()) return Promise.resolve({ place: null, silent: [] });
      this.#misses.delete(sessionId);
    }
    let asking = this.#asking.get(sessionId);
    if (asking === undefined) {
      asking = this.#ask(sessionId, candidates).finally(() => this.#asking.delete(sessionId));
      this.#asking.set(sessionId, asking);
    }
    return asking;
  }

  /**
   * One server event from a machine, as the event hub relays it (the `data` of its
   * `server_event` frame): a Session it created is noted, and a Session it deleted is forgotten.
   * Every other event is ignored.
   */
  hear(machineId: string, data: string): void {
    let event: { type?: unknown; sessionId?: unknown; projectId?: unknown } | null;
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      return;
    }
    if (event === null || typeof event !== "object" || typeof event.sessionId !== "string") return;
    if (event.type === "session_created" && typeof event.projectId === "string") {
      this.note(event.sessionId, machineId, event.projectId);
    } else if (event.type === "session_deleted") {
      this.forget(event.sessionId, machineId);
    }
  }

  async #ask(
    sessionId: string,
    candidates: () => Promise<readonly MachineCandidate[]>,
  ): Promise<SessionResolution> {
    // A machine that is not connected cannot be asked. It does not keep the id from being a
    // miss either: the miss is short, and a bad id must not reach every connected machine on
    // every retry while one machine stays offline.
    const fleet = (await candidates()).filter((machine) => machine.api !== null);
    const path = `/api/sessions/${encodeURIComponent(sessionId)}`;
    const outcome = await new Promise<SessionResolution>((resolve) => {
      // Who has not said no: asked and not answered yet, or answered with nothing usable.
      const unsaid = new Map(fleet.map((machine) => [machine.machineId, machine]));
      const failed = new Set<string>();
      const silent = (): SilentMachine[] =>
        [...unsaid.values()].map(({ machineId, alias }) => ({ machineId, alias }));
      if (fleet.length === 0) {
        resolve({ place: null, silent: [] });
        return;
      }
      const timer = setTimeout(
        () => resolve({ place: null, silent: silent() }),
        this.#askTimeoutMs,
      );
      timer.unref?.();
      for (const machine of fleet) {
        void askOne(machine, path).then((answer) => {
          if ("found" in answer) {
            clearTimeout(timer);
            resolve({ place: answer.found, silent: [] });
            return;
          }
          if ("failed" in answer) failed.add(machine.machineId);
          else unsaid.delete(machine.machineId);
          if (unsaid.size === failed.size) {
            clearTimeout(timer);
            resolve({ place: null, silent: silent() });
          }
        });
      }
    });
    if (outcome.place !== null) {
      this.note(sessionId, outcome.place.machineId, outcome.place.projectId);
    } else if (outcome.silent.length === 0) {
      this.#misses.delete(sessionId);
      this.#misses.set(sessionId, this.#now() + this.#missTtlMs);
      if (this.#misses.size > MISS_CAPACITY) this.#evictOldest(this.#misses);
    }
    return outcome;
  }

  #evictOldest(map: Map<string, unknown>): void {
    const oldest = map.keys().next();
    if (oldest.done !== true) map.delete(oldest.value);
  }
}
