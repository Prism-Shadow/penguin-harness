/**
 * Whether a narration is a main instruction (what the learner is told to do), scaffolding
 * (hints, retries, corrections) or neither. Derived from the words in the asset on every
 * render and never stored, so it follows the script as the author edits it.
 *
 * The keyword lists and their order are Loom's audio instruction classifier, kept exactly so
 * an activity imported from Loom sorts the same way it did there. Like Loom, a keyword
 * matches as a plain substring of the normalized text, so "tap" also matches "tape" and
 * "select" matches "selection": authors migrating from Loom saw those same results.
 */

export type InstructionType = "main" | "scaffolding" | "other";

export type InstructionFilter = "all" | "main" | "scaffolding";

const SCAFFOLDING_KEYWORDS = [
  "scaffold",
  "incorrect",
  "wrong",
  "try again",
  "hint",
  "retry",
  "re prompt",
  "reprompt",
  "second attempt",
  "another attempt",
  "keep trying",
  "not quite",
  "nudge",
  "redirect",
  "corrective",
] as const;

const EXCLUDE_KEYWORDS = [
  "background",
  "bgm",
  "music",
  "ambient",
  "soundtrack",
  "sfx",
  "sound effect",
  "chime",
  "ding",
  "sting",
  "whoosh",
  "jingle",
  "fanfare",
  "transition",
  "outro",
  "ending",
  "credits",
  "celebration",
  "celebrate",
  "applause",
  "cheer",
  "reward",
] as const;

const MAIN_INSTRUCTION_KEYWORDS = ["press and hold", "tap", "select"] as const;

/** Joins the parts, turns `-`, `_`, `.` and `/` into spaces, lowercases and collapses spaces. */
function normalize(...parts: (string | undefined)[]): string {
  return parts
    .filter((part): part is string => !!part)
    .join(" ")
    .replace(/[-_./]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, keywords: readonly string[]): boolean {
  return !!text && keywords.some((keyword) => text.includes(keyword));
}

/** Which kind of line an asset is, from its key, description and script. */
export function instructionType(asset: {
  key: string;
  description?: string;
  script?: string;
  kind?: string;
}): InstructionType {
  // Music and sound effects are never spoken instructions.
  if (asset.kind) return "other";
  // A script of "empty" is Loom's placeholder for no script at all.
  const script = asset.script?.trim().toLowerCase() === "empty" ? "" : asset.script;
  const label = normalize(asset.key, asset.description);
  if (hasAny(label, SCAFFOLDING_KEYWORDS)) return "scaffolding";
  if (hasAny(label, EXCLUDE_KEYWORDS)) return "other";
  if (hasAny(normalize(asset.key, asset.description, script), MAIN_INSTRUCTION_KEYWORDS))
    return "main";
  const spoken = normalize(script);
  if (hasAny(spoken, SCAFFOLDING_KEYWORDS)) return "scaffolding";
  return "other";
}

/** Whether a line of this type belongs under the filter. */
export function inInstructionFilter(type: InstructionType, filter: InstructionFilter): boolean {
  return filter === "all" || type === filter;
}

/**
 * Every line's type by key. In a translation, `sources` holds the default language's scripts
 * by key and each line is sorted by those words instead of its own: the keywords are English,
 * and a line keeps one type in every language, even while its translation is still missing.
 */
export function instructionTypes(
  assets: readonly { key: string; description?: string; script?: string; kind?: string }[],
  sources?: ReadonlyMap<string, string>,
): Map<string, InstructionType> {
  return new Map(
    assets.map((asset) => {
      const source = sources?.get(asset.key);
      return [
        asset.key,
        instructionType(source === undefined ? asset : { ...asset, script: source }),
      ];
    }),
  );
}
