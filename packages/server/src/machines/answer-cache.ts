/**
 * The last answer of each read the hub forwarded to a machine, kept to revalidate rather than
 * to fetch again.
 *
 * A machine answers its JSON reads with an ETag (http/json-validators.ts). The hub keeps the
 * last such answer per machine, per reader and per path, and asks the next time with
 * `If-None-Match`: an unchanged answer comes back as a 304 of a few hundred bytes, and the
 * reader is answered with the kept body — byte for byte what the machine sent before. A changed
 * one comes back whole and replaces it. Nothing is ever answered without asking the machine:
 * this is not a cache that goes stale, so a page never shows an old answer and then flips to a
 * new one, and a machine out of reach is out of reach as before.
 *
 * Scoped so that one reader's answer is never anyone else's: the key is the machine, this
 * server's user who asked, and the path with its query (a Project's reads name the Project in
 * the path). The machine's ETag hashes the answer itself, so a 304 already means "the same
 * bytes"; the scope does not lean on that, so it holds for a route that sets a tag of its own.
 *
 * Bounded: an answer over {@link MAX_ANSWER_BYTES} is not kept, and past {@link MAX_TOTAL_BYTES}
 * the least recently used go first. In memory only, one per platform generation, like the socket
 * cache: a hot push or a restart starts empty, and the first read of each pays in full again. A
 * machine's answers go when it is taken out of a Project or uninstalled (service.ts).
 */

import { isJsonAnswer } from "../http/json-answer.js";

/** One kept answer: what the machine said, with the validator it said it under. */
export interface KeptAnswer {
  etag: string;
  /** The answer's headers as relayed (decoded: no encoding, no length). */
  headers: [string, string][];
  body: Uint8Array;
}

/** An answer larger than this is relayed and not kept. */
export const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
/** What all kept answers may add up to, together. */
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export class MachineAnswers {
  /** In use order, least recent first (a Map iterates in insertion order). */
  readonly #kept = new Map<string, KeptAnswer>();
  #bytes = 0;

  constructor(
    private readonly limits: { answerBytes: number; totalBytes: number } = {
      answerBytes: MAX_ANSWER_BYTES,
      totalBytes: MAX_TOTAL_BYTES,
    },
  ) {}

  /** The key of one read: which machine, who asked here, and what was asked (path and query). */
  static key(machineId: string, readerId: string, pathAndQuery: string): string {
    return `${machineId}\0${readerId}\0${pathAndQuery}`;
  }

  /** The answer kept for `key`, marked as just used. */
  get(key: string): KeptAnswer | null {
    const kept = this.#kept.get(key);
    if (kept === undefined) return null;
    this.#kept.delete(key);
    this.#kept.set(key, kept);
    return kept;
  }

  /** Keeps `answer` for `key`, in place of what was kept; one too large is not kept at all. */
  keep(key: string, answer: KeptAnswer): void {
    this.drop(key);
    if (answer.body.byteLength > this.limits.answerBytes) return;
    this.#kept.set(key, answer);
    this.#bytes += answer.body.byteLength;
    for (const [oldest, kept] of this.#kept) {
      if (this.#bytes <= this.limits.totalBytes) break;
      this.#kept.delete(oldest);
      this.#bytes -= kept.body.byteLength;
    }
  }

  drop(key: string): void {
    const kept = this.#kept.get(key);
    if (kept === undefined) return;
    this.#kept.delete(key);
    this.#bytes -= kept.body.byteLength;
  }

  /** Every answer kept from `machineId`. */
  dropMachine(machineId: string): void {
    const prefix = `${machineId}\0`;
    for (const key of [...this.#kept.keys()]) if (key.startsWith(prefix)) this.drop(key);
  }
}

/** One reader's use of the kept answers, as a forward is handed it. */
export interface AnswerReader {
  answers: MachineAnswers;
  /** This server's user who asked. */
  readerId: string;
}

/**
 * Whether a machine's answer to a GET is one to keep: a 200 with a JSON body and a validator,
 * that the machine did not mark `no-store`.
 */
export function keepable(status: number, headers: Headers): boolean {
  return (
    status === 200 &&
    headers.has("etag") &&
    isJsonAnswer(headers) &&
    !/(^|,)\s*no-store\s*(,|$)/i.test(headers.get("cache-control") ?? "")
  );
}

/** A kept answer relayed again: the same 200, the same bytes, the same headers. */
export function keptResponse(kept: KeptAnswer): Response {
  return new Response(kept.body.slice(), { status: 200, headers: kept.headers });
}
