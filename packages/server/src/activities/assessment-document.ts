/**
 * The assessment a generation writes, made into the file every ref of a product shares.
 *
 * An agent may word the file however it likes, but what is kept is one shape -- titles
 * derived from the product and its canonical ref, one question per item, choices with string ids and a score that follows `isCorrect`. Only the
 * two choice interactions are generated; anything else refuses the run rather than being
 * kept half understood.
 *
 * Also here: the hints the same run writes (the questions the scenes imply), read with
 * bounds, and the written items in the form `assessment-hints.ts` compares them with.
 *
 * Pure: no filesystem, no services.
 */
import type { AssessmentHint, WrittenItem } from "./assessment-hints.js";
import type { AssessmentData } from "./sandbox-assessment.js";

/** The interactions a generated assessment may use, with the key their choices live under. */
export const CHOICE_KEYS = {
  SIMPLE_CHOICE: "simpleChoice",
  MULTIPLE_RESPONSE_CHOICE: "multipleResponseChoice",
} as const;

export type ChoiceInteraction = keyof typeof CHOICE_KEYS;

/** How many hints a run may write, and how long any one of their strings may be. */
export const HINTS_MAX = 200;
export const HINT_TEXT_MAX = 500;

/** The file's title: `<productCode>-<canonicalRef>`. */
export function assessmentTitle(productCode: string, canonicalRef: number): string {
  return `${productCode}-${canonicalRef}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Environment metadata belongs to a deploy, never to the file an author keeps. */
function rejectEnvironmentKeys(value: unknown, at = "<root>"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => rejectEnvironmentKeys(child, `${at}[${index}]`));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (/^(qa|prod|dev)_/.test(key))
      throw new Error(
        `The generated assessment must not contain the environment key ${at}.${key}.`,
      );
    rejectEnvironmentKeys(child, `${at}.${key}`);
  }
}

function normalizeChoice(item: number, index: number, raw: unknown): Record<string, unknown> {
  const at = `Assessment item ${item} choice ${index}`;
  const choice = record(raw);
  if (!choice) throw new Error(`${at} must be an object.`);
  if (!("id" in choice) || choice.id === null || choice.id === undefined)
    throw new Error(`${at} must have an id.`);
  const id = String(choice.id).trim();
  if (!id) throw new Error(`${at} must have a non-empty id.`);
  if (typeof choice.isCorrect !== "boolean") throw new Error(`${at} must say isCorrect.`);
  const value = record(choice.value);
  if (!value) throw new Error(`${at} must have a value.`);
  if (typeof value.text !== "string" || !value.text.trim())
    throw new Error(`${at} must have value.text.`);
  return {
    id,
    isCorrect: choice.isCorrect,
    score: choice.isCorrect ? 1 : 0,
    value: { ...value, text: value.text.trim() },
  };
}

function normalizeItem(title: string, index: number, raw: unknown): Record<string, unknown> {
  const at = `Assessment item ${index}`;
  const item = record(raw);
  if (!item) throw new Error(`${at} must be an object.`);
  const interaction = String(item.interactionKey ?? "").trim();
  if (interaction !== "SIMPLE_CHOICE" && interaction !== "MULTIPLE_RESPONSE_CHOICE")
    throw new Error(
      `${at} has the interaction "${interaction}"; only SIMPLE_CHOICE and MULTIPLE_RESPONSE_CHOICE are generated.`,
    );
  const configuration = record(item.configuration);
  if (!configuration) throw new Error(`${at} must have a configuration.`);
  const question = record(configuration.question);
  if (!question || typeof question.text !== "string" || !question.text.trim())
    throw new Error(`${at} must have a question with text.`);
  const key = CHOICE_KEYS[interaction];
  const list = configuration[key];
  if (!Array.isArray(list) || list.length < 2)
    throw new Error(`${at} must have at least two ${key} choices.`);
  const choices = list.map((choice, position) => normalizeChoice(index, position + 1, choice));
  const correct = choices.filter((choice) => choice.isCorrect === true).length;
  if (interaction === "SIMPLE_CHOICE" && correct !== 1)
    throw new Error(`${at} is a single choice, so it needs exactly one correct choice.`);
  if (interaction === "MULTIPLE_RESPONSE_CHOICE" && correct < 1)
    throw new Error(`${at} needs at least one correct choice.`);
  const ids = new Set(choices.map((choice) => choice.id));
  if (ids.size !== choices.length) throw new Error(`${at} repeats a choice id.`);
  return {
    title: `${title}-${index}`,
    interactionKey: interaction,
    configuration: {
      shuffle: Boolean(configuration.shuffle ?? configuration.shuffled ?? false),
      question: { ...question, text: question.text.trim() },
      [key]: choices,
    },
  };
}

/**
 * A generated assessment in the one shape it is kept in. Throws, naming the item, when the
 * agent wrote something that is not a choice assessment.
 */
export function normalizeAssessment(
  value: unknown,
  productCode: string,
  canonicalRef: number,
): AssessmentData {
  const document = record(value);
  if (!document) throw new Error("The generated assessment must be a JSON object.");
  rejectEnvironmentKeys(document);
  if (!Array.isArray(document.items))
    throw new Error("The generated assessment must have an items list.");
  if (!document.items.length) throw new Error("The generated assessment must have an item.");
  const title = assessmentTitle(productCode, canonicalRef);
  const items = document.items.map((item, index) => normalizeItem(title, index + 1, item));
  return {
    title,
    configuration: { maxItems: items.length, nextItemsSize: 1 },
    behavior: "LINEAR",
    items,
  };
}

/** The written items as the coverage check reads them: each item's choices, by their text. */
export function writtenItems(data: AssessmentData): WrittenItem[] {
  return data.items.map((item) => {
    const configuration = record(item.configuration) ?? {};
    const list = configuration.simpleChoice ?? configuration.multipleResponseChoice;
    return {
      choices: (Array.isArray(list) ? list : []).map((raw) => {
        const choice = record(raw) ?? {};
        const text = record(choice.value)?.text;
        return { text: typeof text === "string" ? text : "", isCorrect: choice.isCorrect === true };
      }),
    };
  });
}

function hintText(value: unknown, what: string): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (text.length > HINT_TEXT_MAX)
    throw new Error(`A hint's ${what} must be ${HINT_TEXT_MAX} characters or fewer.`);
  return text;
}

/**
 * The questions a run says the scenes imply: `{ items: [...] }` or a bare list; an entry with
 * fewer than two choices is no question and is dropped, and a repeated one is kept once. Refuses more than {@link HINTS_MAX} hints or an overlong string.
 */
export function parseHints(value: unknown): AssessmentHint[] {
  const list = Array.isArray(value) ? value : record(value)?.items;
  if (!Array.isArray(list)) throw new Error("assessment-hints.json must have an items list.");
  if (list.length > HINTS_MAX)
    throw new Error(`assessment-hints.json may list at most ${HINTS_MAX} questions.`);
  const hints: AssessmentHint[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const entry = record(raw);
    if (!entry) continue;
    const choices = (Array.isArray(entry.choices) ? entry.choices : [])
      .map((choice) => hintText(choice, "choice"))
      .filter(Boolean);
    if (choices.length < 2) continue;
    const sceneId = hintText(entry.sceneId, "sceneId");
    const source = hintText(entry.source, "source") || "selection";
    const correct = hintText(entry.correct, "correct answer");
    const key = JSON.stringify([sceneId, source, correct, choices]);
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({
      ...(sceneId ? { sceneId } : {}),
      source,
      choices,
      ...(correct ? { correct } : {}),
    });
  }
  return hints;
}
