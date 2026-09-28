/**
 * The media markup a scene description carries, and the scene set a media pass may not
 * change.
 *
 * A scene's description is prose with media elements embedded in it — `<audio>`, `<video>`,
 * `<image>`, `<animation>` — which is how an author says where a track plays or a picture
 * appears. When `generate_activity_spec` produces one, the markup has to be well formed, or
 * the module built from it wires media to nothing.
 *
 * Both rules are Loom's, read out of `media_contract.py` and `generate_media_spec.py`. The
 * reporting is the part worth having: every issue with a line and column, sorted, so an
 * author or a repair pass can see all of them at once.
 */

/** The four elements a scene description may embed. */
export const MEDIA_ELEMENTS = ["audio", "video", "image", "animation"] as const;
const NAMES = MEDIA_ELEMENTS.join("|");

const TAG = new RegExp(`<\\s*(/?)\\s*(${NAMES})\\b[^>]*?\\s*(/?)>`, "gi");
/** A closing tag written without its `<`, e.g. `/audio>`, which an LLM produces often. */
const MALFORMED_CLOSING = new RegExp(`(?<!<)/\\s*(${NAMES})\\s*>`, "gi");

export interface MarkupIssue {
  sceneId: string;
  line: number;
  column: number;
  message: string;
}

/** One-based line and column of an offset, for pointing at the problem. */
function locate(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  for (let at = 0; at < offset; at += 1) if (source[at] === "\n") line += 1;
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return { line, column: offset - lineStart + 1 };
}

/**
 * What is wrong with one scene's media markup.
 *
 * A stack, because these nest: an unclosed `<audio>` around an `<image>` is a different
 * problem from a stray `</audio>`, and an author needs to be told which. Self-closing tags
 * never go on the stack.
 */
export function sceneMarkupIssues(sceneId: string, description: string): MarkupIssue[] {
  const issues: MarkupIssue[] = [];

  for (const match of description.matchAll(MALFORMED_CLOSING)) {
    const { line, column } = locate(description, match.index);
    issues.push({
      sceneId,
      line,
      column,
      message: `malformed closing tag for "${match[1]!.toLowerCase()}"; expected a leading '<'`,
    });
  }

  const open: { name: string; at: number }[] = [];
  for (const match of description.matchAll(TAG)) {
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    const selfClosing = match[3] === "/";
    if (!closing) {
      if (!selfClosing) open.push({ name, at: match.index });
      continue;
    }
    if (!open.length) {
      const { line, column } = locate(description, match.index);
      issues.push({ sceneId, line, column, message: `closing tag for "${name}" was never opened` });
      continue;
    }
    const last = open.pop()!;
    if (last.name !== name) {
      const { line, column } = locate(description, match.index);
      issues.push({
        sceneId,
        line,
        column,
        message: `closing tag for "${name}" does not match the open "${last.name}"`,
      });
    }
  }
  for (const unclosed of open) {
    const { line, column } = locate(description, unclosed.at);
    issues.push({ sceneId, line, column, message: `"${unclosed.name}" was never closed` });
  }

  return issues;
}

const sceneList = (spec: Record<string, unknown> | null): Record<string, unknown>[] => {
  const scenes = spec?.["scenes"] ?? spec?.["stages"];
  return Array.isArray(scenes) ? (scenes as Record<string, unknown>[]) : [];
};

/**
 * Every markup issue in a specification, sorted.
 *
 * Sorted by scene, then line, then column, then message — Loom's order, and the reason is
 * that an unsorted list of issues from a regex scan reads as random and makes a repair
 * pass look like it fixed nothing.
 */
export function specMarkupIssues(spec: Record<string, unknown> | null): MarkupIssue[] {
  const issues: MarkupIssue[] = [];
  for (const scene of sceneList(spec)) {
    const sceneId = typeof scene["id"] === "string" ? scene["id"] : "unknown-scene";
    const description = typeof scene["description"] === "string" ? scene["description"] : "";
    issues.push(...sceneMarkupIssues(sceneId, description));
  }
  return issues.sort(
    (a, b) =>
      a.sceneId.localeCompare(b.sceneId) ||
      a.line - b.line ||
      a.column - b.column ||
      a.message.localeCompare(b.message),
  );
}

/** Scene ids, in order, for comparing one pass's output against its input. */
export function sceneIds(spec: Record<string, unknown> | null): string[] {
  return sceneList(spec).map((scene) => (typeof scene["id"] === "string" ? scene["id"] : ""));
}

/**
 * Whether a media pass changed the scene set it was given.
 *
 * `generate_media_spec` enriches an existing specification with media. It must not add,
 * drop or rename a scene — an enrichment that quietly changes the scene set invalidates
 * every later stage, and the module gets built for scenes the author never wrote.
 *
 * Compared as sets: a pass reordering scenes is not the failure being guarded against.
 */
export function sceneSetChange(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string | null {
  const expected = sceneIds(before);
  const actual = sceneIds(after);
  const same =
    expected.length === actual.length &&
    [...expected].sort().every((id, at) => id === [...actual].sort()[at]);
  if (same) return null;
  return (
    `Media enrichment changed the scene set. Expected ${expected.length} ` +
    `${expected.length === 1 ? "scene" : "scenes"} [${expected.join(", ")}], ` +
    `got ${actual.length} [${actual.join(", ")}].`
  );
}

/** What one scene says about one media entry it lists, for comparing across scenes. */
interface SceneMediaEntry {
  key: string;
  type: (typeof MEDIA_ELEMENTS)[number];
  description: string;
  script: string;
}

/** The lists a scene names its media in, and the element each one holds. */
const SCENE_MEDIA_LISTS = [
  ["media", "images", "image"],
  ["media", "video", "video"],
  ["media", "animations", "animation"],
  ["audio", "tracks", "audio"],
] as const;

function sceneMediaEntries(scene: Record<string, unknown>): SceneMediaEntry[] {
  const entries: SceneMediaEntry[] = [];
  for (const [block, list, type] of SCENE_MEDIA_LISTS) {
    const holder = scene[block];
    if (!holder || typeof holder !== "object" || Array.isArray(holder)) continue;
    const items = (holder as Record<string, unknown>)[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      // Compared exactly as the media plan compares them, so this warns whenever it refuses.
      const key = String(record["key"]);
      entries.push({
        key,
        type,
        description: String(record["description"]),
        script: type === "audio" && record["script"] !== undefined ? String(record["script"]) : "",
      });
    }
  }
  return entries;
}

/**
 * Media keys the specification describes differently in different places: one scene naming
 * `welcome` as a sound and another as a picture, or the same picture with two descriptions.
 * A key names one asset, so every place that uses it has to ask for the same thing; the
 * media plan refuses a specification that does not. Sorted, each key once.
 */
export function conflictingMediaKeys(spec: Record<string, unknown> | null): string[] {
  const first = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const scene of sceneList(spec)) {
    if (!scene || typeof scene !== "object") continue;
    for (const entry of sceneMediaEntries(scene)) {
      const requirement = JSON.stringify([entry.type, entry.description, entry.script]);
      const seen = first.get(entry.key);
      if (seen === undefined) first.set(entry.key, requirement);
      else if (seen !== requirement) conflicting.add(entry.key);
    }
  }
  return [...conflicting].sort((a, b) => a.localeCompare(b));
}
