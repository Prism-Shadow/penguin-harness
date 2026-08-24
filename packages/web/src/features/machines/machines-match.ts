/**
 * The machine picker's fuzzy search: an ssh config can declare hundreds of hosts, so the
 * picker never lists them all — a few rows render and the query reaches the rest.
 *
 * Matching is a subsequence, not a substring, because ssh aliases are punctuated (`gpu-01`,
 * `db_prod.eu`) and the useful query is the letters you remember, not the separators you do
 * not: `gpu1` has to find `gpu-01`. The score then puts the obvious hits on top, and the
 * matched characters are handed back as positions so the row can show WHY it matched — with
 * a subsequence match, a row whose hit characters are invisible looks like a wrong result.
 */

/** One `Host` entry as the picker needs it: the alias is the label, the id is what installs. */
export interface MachineLike {
  id: string;
  alias: string;
}

/**
 * How many rows the picker shows at once. The search box reaches everything past this, and
 * a counter names how many the current view leaves out — a silent truncation would read as
 * "that host is not in my config".
 */
export const MAX_VISIBLE_MACHINES = 6;

/** One machine that survived the query, with the character positions the query hit. */
export interface MachineMatch<T extends MachineLike = MachineLike> {
  machine: T;
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
 * server's order (which is the ssh config's own order); otherwise matches sort by score
 * with that order as the tiebreak, so equally good hits stay in the order the config
 * declares them rather than being reshuffled by something invisible.
 */
export function matchMachines<T extends MachineLike>(
  machines: readonly T[],
  query: string,
): MachineMatch<T>[] {
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
