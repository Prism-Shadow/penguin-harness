/**
 * Whether a generated assessment actually covers the questions the scenes implied.
 *
 * `generate_assessment` runs two agent passes: the first enumerates the questions a
 * specification implies — a scene where a learner picks between three words implies a
 * question with those three choices — and the second writes the assessment JSON. The
 * second pass can quietly drop one, and an assessment missing a question nobody notices is
 * an activity that never asks it.
 *
 * So the enumerated questions are kept as hints and the written assessment is checked
 * against them. Ported from `assessment_item_hints.py`, including the two details that
 * carry the weight: matching is by normalised choice text, and the search is ORDERED.
 */

export interface AssessmentHint {
  /** The scene that implied this question. */
  sceneId?: string;
  /** Where in the scene it came from, for the message. */
  source?: string;
  /** The choices the scene offered. */
  choices: string[];
  /** Which of them is right, when the scene said. */
  correct?: string;
}

export interface WrittenChoice {
  text: string;
  isCorrect?: boolean;
}

export interface WrittenItem {
  choices: WrittenChoice[];
}

/**
 * Choice text reduced to what is comparable.
 *
 * Case-folded, accents dropped, everything but letters and digits (in any script) collapsed
 * to single spaces, trimmed. The two passes are separate agent calls, so the second writes
 * `"The cat."` where the first enumerated `"the cat"` — comparing raw strings would report a
 * question as missing because a full stop moved.
 *
 * A choice with no letters or digits at all (`">"`, `"="`) keeps its trimmed text, so a
 * comparison activity's symbols still compare exactly instead of all becoming empty.
 */
export function normalizeChoiceText(value: string): string {
  const folded = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return folded || value.trim().replace(/\s+/g, " ");
}

/**
 * Whether one written item satisfies one hint.
 *
 * The hint's choices must be a SUBSET of the item's: the second pass may add a distractor
 * the scene did not name, and that is fine — it may not drop one the scene did.
 *
 * A hint that names a correct answer also requires the item to mark that choice correct.
 * A hint that does not is satisfied by the choices alone.
 */
export function itemSatisfiesHint(item: WrittenItem, hint: AssessmentHint): boolean {
  if (!item.choices.length) return false;
  const wanted = new Set(hint.choices.map(normalizeChoiceText).filter(Boolean));
  if (!wanted.size) return false;
  const present = new Set(item.choices.map((choice) => normalizeChoiceText(choice.text)));
  for (const choice of wanted) if (!present.has(choice)) return false;

  const expected = normalizeChoiceText(hint.correct ?? "");
  if (!expected) return true;
  const correct = new Set(
    item.choices
      .filter((choice) => choice.isCorrect === true)
      .map((choice) => normalizeChoiceText(choice.text)),
  );
  return correct.has(expected);
}

/** A hint written for a person, so a failure names which question went missing. */
export function describeHint(hint: AssessmentHint): string {
  const scene = hint.sceneId || "<unknown scene>";
  const source = hint.source || "selection";
  const correct = hint.correct || "<unknown correct choice>";
  return `${scene} ${source} ${correct} (${hint.choices.join(", ")})`;
}

/**
 * Which enumerated questions the written assessment does not cover.
 *
 * The search is ORDERED: each hint is matched from just after the previous match, never
 * from the start. That is Loom's behaviour and it is deliberate — it means one written item
 * cannot satisfy two hints, so an assessment that collapsed three similar questions into
 * one is caught rather than passing because the one item matches all three.
 *
 * It also means the written assessment has to keep the scenes' order, which is what an
 * author expects: the questions come in the order the activity asks them.
 */
export function uncoveredHints(
  items: readonly WrittenItem[],
  hints: readonly AssessmentHint[],
): AssessmentHint[] {
  if (!hints.length) return [];
  const missing: AssessmentHint[] = [];
  let from = 0;
  for (const hint of hints) {
    let found = -1;
    for (let at = from; at < items.length; at += 1)
      if (itemSatisfiesHint(items[at]!, hint)) {
        found = at;
        break;
      }
    if (found < 0) missing.push(hint);
    else from = found + 1;
  }
  return missing;
}

/**
 * What to say about coverage, or null when it is complete.
 *
 * Every missing question is named. An agent told only the first writes it, is checked
 * again, and is told the next — and each of those is a paid pass over the whole assessment.
 */
export function coverageProblem(
  items: readonly WrittenItem[],
  hints: readonly AssessmentHint[],
): string | null {
  const missing = uncoveredHints(items, hints);
  if (!missing.length) return null;
  return `The generated assessment is missing ${missing.length} expected ${missing.length === 1 ? "item" : "items"}: ${missing.map(describeHint).join("; ")}`;
}
