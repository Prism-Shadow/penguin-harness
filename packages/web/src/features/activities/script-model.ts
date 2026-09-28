/**
 * The Activity Script as an author reads it: prose before the first scene, then scenes
 * under `Scene N: Name` headings, with media written inline as `<audio>`, `<video>`,
 * `<image>` and `<animation>` elements.
 *
 * The heading and end rules are Loom's script editor's, so a script folds into the same
 * scenes here as it did there. Pure, so the folding, the changed-scene chips and the
 * minimap all read one layout.
 */
import { diffRegions, type DiffRow } from "./spec-diff";

/**
 * A scene heading: `Scene 3:`, `Scene 3.`, `Scene 3 –`, optionally behind Markdown heading
 * marks or bold. A sub-heading like `Scene 8a` is not one, so it stays inside scene 8.
 */
const SCENE_HEADING = /^\s*(?:#{1,6}\s+)?\*{0,2}\s*scene\s+(\d+)\s*[:.\-–—]\s*(.*)$/i;

/** `Activity End` closes the last scene; what follows it belongs to no scene. */
const ACTIVITY_END =
  /^\s*(?:#{1,6}\s+)?\*{0,2}\s*(?:<\/?activity[-_\s]*end\b|activity[-_\s]*end\b)/i;

export function isSceneHeading(line: string): boolean {
  return SCENE_HEADING.test(line);
}

export interface ScriptScene {
  number: number;
  title: string;
  /** 1-based line of the heading. */
  heading: number;
  /** 1-based last line of the scene's body, which may equal `heading` for an empty scene. */
  last: number;
}

export function sceneRanges(text: string): ScriptScene[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const scenes: ScriptScene[] = [];
  let open: ScriptScene | null = null;
  for (const [index, line] of lines.entries()) {
    const heading = SCENE_HEADING.exec(line);
    const ends = !heading && ACTIVITY_END.test(line);
    if (heading || ends) {
      if (open) open.last = index;
      open = null;
    }
    if (heading) {
      open = {
        number: Number(heading[1]),
        title: heading[2]!.replace(/\*+\s*$/, "").trim(),
        heading: index + 1,
        last: index + 1,
      };
      scenes.push(open);
    }
    if (ends) break;
  }
  if (open) open.last = lines.length;
  return scenes;
}

export const MEDIA_ELEMENTS = ["audio", "video", "image", "animation"] as const;
export type MediaElement = (typeof MEDIA_ELEMENTS)[number];

const MEDIA_TAG = /<\s*\/?\s*(audio|video|image|animation)\b[^<>]*>/gi;

export interface MediaTagSpan {
  /** Offsets into the text given, end exclusive. */
  from: number;
  to: number;
  element: MediaElement;
}

/** The opening, closing and self-closing media tags in a piece of text. Other markup is prose. */
export function mediaTagSpans(text: string): MediaTagSpan[] {
  return [...text.matchAll(MEDIA_TAG)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
    element: match[1]!.toLowerCase() as MediaElement,
  }));
}

/**
 * Where each changed row sits in the edited text. A removed line has no line of its own
 * there, so it sits where it was removed from: just after the last line both texts kept.
 */
function positions(rows: readonly DiffRow[]): number[] {
  let lastAfter = 0;
  return rows.map((row) => {
    if (row.after !== undefined) lastAfter = row.after;
    return row.after ?? lastAfter + 1;
  });
}

/** The scene numbers a diff touches, in order. Changes outside every scene name none. */
export function scenesTouched(rows: readonly DiffRow[], scenes: readonly ScriptScene[]): number[] {
  const at = positions(rows);
  const touched = new Set<number>();
  for (const [index, row] of rows.entries()) {
    if (row.kind === "same") continue;
    const scene = scenes.find((item) => at[index]! >= item.heading && at[index]! <= item.last);
    if (scene) touched.add(scene.number);
  }
  return [...touched];
}

export interface DiffMarker {
  /** 1-based line in the edited text a marker jumps to. */
  line: number;
  /** Percent of the script's height, from the top. */
  top: number;
  height: number;
}

/** The thinnest marker still worth a click, in percent. */
const MARKER_MIN = 0.75;

/** One marker per run of changed lines, placed on the edited text's scale. */
export function diffMarkers(rows: readonly DiffRow[], totalLines: number): DiffMarker[] {
  if (totalLines <= 0) return [];
  const at = positions(rows);
  const unit = 100 / totalLines;
  return diffRegions(rows).map((region) => {
    const line = at[region.start]!;
    const added = rows.slice(region.start, region.end).filter((row) => row.kind === "added").length;
    return {
      line,
      top: (line - 1) * unit,
      height: Math.max(MARKER_MIN, Math.max(1, added) * unit),
    };
  });
}
