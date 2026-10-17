/**
 * Streaming text that fades in as it arrives. Under a `fade` reveal (stream-reveal.ts) every
 * stretch of text the reveal puts on screen is an arrival: where it starts in the text and when
 * it came, in milliseconds on the document timeline (the frame clock). While an arrival is
 * younger than the reveal duration, the text it brought sits in a run of its own that carries
 * `data-arrive` with that time, and the theme fades the run in (theme.css: `ui-stream`'s
 * `[data-arrive]`). Once the last arrival has faded, the host renders without them, so a
 * settled reply is exactly the markup a reply that never streamed gets.
 *
 * Three places split text into runs, all through {@link splitRuns}:
 *
 * - a plain host (a tool's output) splits its one text node ({@link arrivalText});
 * - Markdown goes through {@link rehypeStreamArrivals}, a rehype pass that reads where each text
 *   node sits in the source (its position) and splits it there. An element that itself started
 *   in a live arrival — a new list item, table, paragraph, link or inline code — carries
 *   `data-arrive` as a whole instead, so its bullet, rules and fill fade in with its text, and
 *   the text inside it is split only by the arrivals after the one it came with;
 * - a fenced code block, which `MdPre` hands to `CodeBlock` as a string: the pass encodes the
 *   code's runs on its `<code>` (`data-arrivals`, {@link encodeArrivals}), and `CodeSurface`
 *   splits its unhighlighted text with them.
 *
 * A run's element may be a different one on the next frame — React reuses elements by position,
 * and the oldest run merging back into the text before it shifts every run after it — so a fade
 * is never left to start when its element appears: {@link pinArrivals} sets each run's animation
 * to start at the run's own arrival time after every commit, wherever it lands.
 */
import { createElement } from "react";
import type { ReactNode } from "react";

/** A stretch of text the reveal put on screen: where it starts in the text and when (ms). */
export interface RevealArrival {
  readonly start: number;
  readonly at: number;
}

/** One piece of a split text: the characters, and the arrival time of a run (none: plain). */
export interface ArrivalPiece {
  readonly text: string;
  readonly at?: number;
}

/** The attribute a fading run carries, the arrival time in whole milliseconds. */
const ARRIVE = "data-arrive";

const stamp = (at: number): string => String(Math.round(at));

/**
 * The text cut at each run's start: what comes before the first run is plain, each run runs to
 * the next one's start (the last to the end). Runs must be in order; one at or past the end of
 * the text, or one starting where the next does, brings nothing.
 */
export function splitRuns(text: string, runs: readonly RevealArrival[]): ArrivalPiece[] {
  if (runs.length === 0) return [{ text }];
  const pieces: ArrivalPiece[] = [];
  const first = Math.min(Math.max(0, runs[0]!.start), text.length);
  if (first > 0) pieces.push({ text: text.slice(0, first) });
  runs.forEach((run, i) => {
    const start = Math.min(Math.max(0, run.start), text.length);
    const end = i + 1 < runs.length ? Math.min(runs[i + 1]!.start, text.length) : text.length;
    if (end > start) pieces.push({ text: text.slice(start, end), at: run.at });
  });
  return pieces;
}

/** The text with its live runs as `data-arrive` spans, for a plain host; the text itself when none. */
export function arrivalText(text: string, runs: readonly RevealArrival[] | undefined): ReactNode {
  if (runs === undefined || runs.length === 0) return text;
  return splitRuns(text, runs).map((piece, i) =>
    piece.at === undefined
      ? piece.text
      : createElement("span", { key: `${i}-${piece.at}`, [ARRIVE]: stamp(piece.at) }, piece.text),
  );
}

/** Runs as one attribute value, `start:at` pairs, for a code block's `data-arrivals`. */
export function encodeArrivals(runs: readonly RevealArrival[]): string {
  return runs.map((run) => `${run.start}:${stamp(run.at)}`).join(" ");
}

/** The runs {@link encodeArrivals} wrote; nothing for a missing or malformed value. */
export function decodeArrivals(value: unknown): RevealArrival[] {
  if (typeof value !== "string" || value === "") return [];
  const runs: RevealArrival[] = [];
  for (const pair of value.split(" ")) {
    const [start, at] = pair.split(":").map(Number);
    if (Number.isFinite(start) && Number.isFinite(at)) runs.push({ start: start!, at: at! });
  }
  return runs;
}

/**
 * Starts every run's fade at its own arrival time: each animation on an element under `host`
 * that carries `data-arrive` gets that time as its start, so a run whose element was just
 * created, or reused for another run, shows the fade exactly as far along as its arrival is old.
 * A reused element's fade may have finished already; the theme keeps a finished fade on its
 * element (it fills forwards), which is what lets it be found and started again here. Call it
 * after a commit, before the frame paints. Nothing happens where the browser has no Web
 * Animations, or where the theme animates no run.
 */
export function pinArrivals(host: Element): void {
  if (typeof host.getAnimations !== "function") return;
  for (const animation of host.getAnimations({ subtree: true })) {
    const target = (animation.effect as { target?: Element | null } | null)?.target;
    const value = typeof target?.getAttribute === "function" ? target.getAttribute(ARRIVE) : null;
    if (value === null || value === undefined) continue;
    const at = Number(value);
    if (Number.isFinite(at) && animation.startTime !== at) animation.startTime = at;
  }
}

// ---- the rehype pass ----

interface Point {
  offset?: number;
}
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: Point; end: Point };
}

interface Pass {
  readonly arrivals: readonly RevealArrival[];
  readonly source: string;
}

/** The index of the arrival whose run holds `offset` (the last to start at or before it); -1 for none. */
function ownerOf(arrivals: readonly RevealArrival[], offset: number): number {
  let lo = 0;
  let hi = arrivals.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arrivals[mid]!.start <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The runs of the arrivals after `after` that fall in a source range ending at `end`, in the
 * coordinates of a text `index` maps the source into. Several arrivals that map to one point
 * leave the latest, which owns what follows.
 */
function runsIn(
  pass: Pass,
  after: number,
  from: number,
  end: number,
  index: (offset: number) => number,
): RevealArrival[] {
  const runs: RevealArrival[] = [];
  for (let i = after + 1; i < pass.arrivals.length; i++) {
    const arrival = pass.arrivals[i]!;
    if (arrival.start >= end) break;
    const start = index(Math.max(arrival.start, from));
    if (runs.length > 0 && runs[runs.length - 1]!.start === start) runs.pop();
    runs.push({ start, at: arrival.at });
  }
  return runs;
}

function hastPieces(value: string, runs: readonly RevealArrival[]): HastNode[] {
  return splitRuns(value, runs).map((piece) =>
    piece.at === undefined
      ? { type: "text", value: piece.text }
      : {
          type: "element",
          tagName: "span",
          properties: { dataArrive: stamp(piece.at) },
          children: [{ type: "text", value: piece.text }],
        },
  );
}

/**
 * Where a text node's characters sit in the source. A text node's own position covers exactly
 * its characters, except that escapes and entities make the source longer than the value; the
 * text of inline code or inline math carries its element's position, delimiters included, so
 * those are trimmed evenly off both ends.
 */
function textRange(node: HastNode, parent: HastNode): [number, number] | null {
  const length = node.value?.length ?? 0;
  const own = node.position;
  const box = own ?? parent.position;
  const start = box?.start.offset;
  const end = box?.end.offset;
  if (start === undefined || end === undefined) return null;
  if (parent.tagName !== "code" && own !== undefined) return [start, end];
  if (parent.tagName !== "code") return null;
  const pad = Math.max(0, Math.floor((end - start - length) / 2));
  return [start + pad, end - pad];
}

/**
 * A text node, split by the arrivals after `inherited` (the one its nearest marked ancestor came
 * with). The newest characters are at the end, so a source offset is mapped from the end of the
 * range: whatever escapes or quote marks sit earlier in it never shift where a new run begins.
 */
function splitText(node: HastNode, parent: HastNode, inherited: number, pass: Pass): HastNode[] {
  const range = textRange(node, parent);
  if (range === null) return [node];
  const [start, end] = range;
  const value = node.value ?? "";
  const runs = runsIn(pass, inherited, start, end, (offset) =>
    Math.max(0, Math.min(value.length, value.length - (end - offset))),
  );
  return runs.length === 0 ? [node] : hastPieces(value, runs);
}

/** A closing fence or display-math delimiter on a line of its own. */
const CLOSING_LINE = /^\s*(?:`{3,}|~{3,}|\$\$|\\\])\s*$/;

/**
 * A fenced block (`pre > code`, one text node, no position of its own): the block's own mark
 * moves to its `<code>`, which is what `MdPre` reads (display math renders that element as it
 * is); the runs inside are found from the block's source — the code runs from the line after the
 * opening fence to the line before a closing one — and either encoded on the `<code>` for
 * `CodeBlock` or, for display math, split in place.
 */
function markFence(pre: HastNode, own: number, pass: Pass): void {
  const code = pre.children?.find((child) => child.type === "element" && child.tagName === "code");
  if (code === undefined) return;
  if (pre.properties?.dataArrive !== undefined)
    code.properties = { ...code.properties, dataArrive: pre.properties.dataArrive };
  const text = code.children?.length === 1 ? code.children[0] : undefined;
  const start = pre.position?.start.offset;
  const end = pre.position?.end.offset;
  if (text?.type !== "text" || start === undefined || end === undefined) return;
  const source = pass.source.slice(start, end);
  const firstBreak = source.indexOf("\n");
  // The opening fence alone: no code yet.
  if (firstBreak < 0) return;
  const body = source.endsWith("\n") ? source.length - 1 : source.length;
  const lastBreak = source.lastIndexOf("\n", body - 1);
  const closed = lastBreak >= firstBreak && CLOSING_LINE.test(source.slice(lastBreak + 1, body));
  const contentEnd = start + (closed ? lastBreak : body);
  const value = text.value ?? "";
  const valueEnd = value.endsWith("\n") ? value.length - 1 : value.length;
  const runs = runsIn(pass, own, start, contentEnd, (offset) =>
    Math.max(0, Math.min(valueEnd, valueEnd - (contentEnd - offset))),
  );
  if (runs.length === 0) return;
  const className = code.properties?.className;
  const math = Array.isArray(className) && className.includes("language-math");
  if (math) code.children = hastPieces(value, runs);
  else code.properties = { ...code.properties, dataArrivals: encodeArrivals(runs) };
}

/**
 * Marks what arrived under `parent`: an element that starts in a live arrival later than the one
 * its nearest marked ancestor came with carries `data-arrive` itself; text is split into runs by
 * the arrivals after its element's. Everything that ends before the first live arrival is left
 * exactly as it was.
 */
function mark(parent: HastNode, inherited: number, pass: Pass): void {
  const children = parent.children;
  if (children === undefined) return;
  const first = pass.arrivals[0]!.start;
  const out: HastNode[] = [];
  for (const child of children) {
    const end = child.position?.end.offset;
    if (end !== undefined && end <= first) {
      out.push(child);
      continue;
    }
    if (child.type === "text") {
      out.push(...splitText(child, parent, inherited, pass));
      continue;
    }
    if (child.type !== "element") {
      out.push(child);
      continue;
    }
    let own = inherited;
    const start = child.position?.start.offset;
    if (start !== undefined) {
      const owner = ownerOf(pass.arrivals, start);
      if (owner > inherited) {
        own = owner;
        child.properties = { ...child.properties, dataArrive: stamp(pass.arrivals[owner]!.at) };
      }
    }
    if (child.tagName === "pre") markFence(child, own, pass);
    else mark(child, own, pass);
    out.push(child);
  }
  parent.children = out;
}

/**
 * The rehype pass for Markdown that is still arriving: `arrivals` are the live runs, in order,
 * as offsets into the Markdown source. It reads the source from the file it is handed, the way
 * the remark passes do. With no arrivals it changes nothing.
 */
export function rehypeStreamArrivals(options: { arrivals: readonly RevealArrival[] }) {
  return (tree: HastNode, file: { value?: unknown }): void => {
    if (options.arrivals.length === 0) return;
    const source = typeof file.value === "string" ? file.value : String(file.value ?? "");
    mark(tree, -1, { arrivals: options.arrivals, source });
  };
}
