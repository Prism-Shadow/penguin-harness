/**
 * Drops the lines a sandbox runner prints on stderr before it execs the confined command
 * (see `ConfinedSpawn.runnerLines`) — the Landlock launcher's "partial enforcement"
 * report on an older kernel, printed on every run. Only the HEAD of the stream is examined:
 * the runner writes before the exec, so once a line that is not one of them (or any byte that
 * cannot begin one) has passed, everything after is the command's own and flows untouched. A
 * command whose own FIRST stderr line is word for word one of them loses that line — the price
 * of not parsing the command's output.
 */
export interface RunnerLineFilter {
  /** Feeds one stderr chunk; returns what to pass on now (possibly empty). */
  push(chunk: string): string;
  /** The stream ended: returns what was held back waiting for a line's end. */
  flush(): string;
}

/** A filter for one stream; the identity when the runner names no lines. */
export function runnerLineFilter(lines: readonly string[] | undefined): RunnerLineFilter {
  // Matched by exact line, case-insensitively, as the runner contract states it.
  const known = (lines ?? []).map((l) => l.toLowerCase());
  let head = known.length > 0;
  let held = "";
  // A held tail may already carry the CR of a CRLF line end.
  const startsOne = (partial: string) => {
    const p = partial.replace(/\r$/, "").toLowerCase();
    return known.some((l) => l.startsWith(p));
  };
  return {
    push(chunk) {
      if (!head) return chunk;
      held += chunk;
      for (;;) {
        const nl = held.indexOf("\n");
        if (nl === -1) {
          if (startsOne(held)) return "";
          break;
        }
        const line = held.slice(0, nl).replace(/\r$/, "");
        if (!known.includes(line.toLowerCase())) break;
        held = held.slice(nl + 1);
      }
      head = false;
      const out = held;
      held = "";
      return out;
    },
    flush() {
      head = false;
      const out = held;
      held = "";
      return out;
    },
  };
}
