/**
 * The assessment's items as an author edits them: question text, choices, which is correct
 * and whether they shuffle, without touching JSON. Kept apart from the view so every
 * operation and every blocker can be tested without a DOM.
 *
 * Only the two choice interactions are edited here. A document
 * holding any other kind is left to the JSON editor, and whatever the author does not see
 * here (a question's audio, a choice's picture, the document's own fields) is written back
 * as it was.
 */

export type ChoiceInteraction = "SIMPLE_CHOICE" | "MULTIPLE_RESPONSE_CHOICE";

export interface AssessmentDraftChoice {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface AssessmentDraftItem {
  /** The item's title as read; empty for an item added here. Saving derives it from position. */
  title: string;
  interaction: ChoiceInteraction;
  question: string;
  shuffle: boolean;
  choices: AssessmentDraftChoice[];
  /** Where the item sits in the document it was read from; absent for an added item. */
  origin?: number;
}

export type AssessmentBlocker =
  | { code: "noItems" }
  | {
      code: "fewChoices" | "correctCount" | "emptyQuestion" | "emptyChoice" | "duplicateChoiceId";
      /** The item's position, from 0. */
      item: number;
    };

const CHOICE_KEY: Record<ChoiceInteraction, "simpleChoice" | "multipleResponseChoice"> = {
  SIMPLE_CHOICE: "simpleChoice",
  MULTIPLE_RESPONSE_CHOICE: "multipleResponseChoice",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** An item's interaction, by its key or else by where its choices live. */
function interactionOf(item: Record<string, unknown>): ChoiceInteraction | null {
  const key = typeof item.interactionKey === "string" ? item.interactionKey.toUpperCase() : "";
  if (key === "SIMPLE_CHOICE" || key === "MULTIPLE_RESPONSE_CHOICE") return key;
  if (key) return null;
  const configuration = record(item.configuration);
  if (!configuration) return null;
  if (Array.isArray(configuration.simpleChoice)) return "SIMPLE_CHOICE";
  if (Array.isArray(configuration.multipleResponseChoice)) return "MULTIPLE_RESPONSE_CHOICE";
  return null;
}

/**
 * The items of an assessment document, or null when it is not one this editor can show
 * whole: not an assessment, or holding an item of another interaction.
 */
export function readItems(value: unknown): AssessmentDraftItem[] | null {
  const document = record(value);
  if (!document || !Array.isArray(document.items)) return null;
  const items: AssessmentDraftItem[] = [];
  for (const [index, raw] of document.items.entries()) {
    const item = record(raw);
    const interaction = item ? interactionOf(item) : null;
    if (!item || !interaction) return null;
    const configuration = record(item.configuration) ?? {};
    const list = configuration[CHOICE_KEY[interaction]];
    const question = record(configuration.question)?.text;
    items.push({
      title: typeof item.title === "string" ? item.title : "",
      interaction,
      question: typeof question === "string" ? question : "",
      shuffle: configuration.shuffle === true,
      choices: (Array.isArray(list) ? list : []).map((entry) => {
        const choice = record(entry) ?? {};
        const text = record(choice.value)?.text;
        return {
          id: choice.id === undefined || choice.id === null ? "" : String(choice.id),
          text: typeof text === "string" ? text : "",
          isCorrect: choice.isCorrect === true,
        };
      }),
      origin: index,
    });
  }
  return items;
}

/** The next `<prefix>-<n>` not already in use. */
function nextName(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/**
 * The title of the item at `index` (0-based): `<document title>-<n>`, 1-based by position, as
 * the server names a generated assessment's items. Titles follow position, so removing or
 * adding an item renumbers the ones after it.
 */
export function itemTitle(document: unknown, index: number): string {
  const title = record(document)?.title;
  const prefix = typeof title === "string" && title ? title : "item";
  return `${prefix}-${index + 1}`;
}

/**
 * The document with the edited items in it. Every field of the original the editor does not
 * show is kept: the document's own, an item's, a question's and a choice's (matched by id).
 * Every item's title is derived from its position ({@link itemTitle}), and a count of items
 * the document kept in step with its items (`configuration.maxItems`) stays in step.
 */
export function writeItems(
  items: readonly AssessmentDraftItem[],
  original: unknown,
): Record<string, unknown> {
  const document = record(original) ?? {};
  const originalItems = Array.isArray(document.items) ? document.items : [];
  const written = items.map((item, index) => {
    const source = record(item.origin === undefined ? null : originalItems[item.origin]) ?? {};
    const configuration = record(source.configuration) ?? {};
    const sourceKey = interactionOf(source);
    const sourceChoices = sourceKey ? configuration[CHOICE_KEY[sourceKey]] : undefined;
    const byId = new Map<string, Record<string, unknown>>();
    for (const entry of Array.isArray(sourceChoices) ? sourceChoices : []) {
      const choice = record(entry);
      if (choice && choice.id !== undefined && choice.id !== null)
        byId.set(String(choice.id), choice);
    }
    return {
      ...source,
      title: itemTitle(document, index),
      interactionKey: item.interaction,
      configuration: {
        ...configuration,
        shuffle: item.shuffle,
        question: { ...record(configuration.question), text: item.question },
        [CHOICE_KEY[item.interaction]]: item.choices.map((choice) => {
          const before = byId.get(choice.id) ?? {};
          return {
            ...before,
            id: choice.id,
            isCorrect: choice.isCorrect,
            score: choice.isCorrect ? 1 : 0,
            value: { ...record(before.value), text: choice.text },
          };
        }),
      },
    };
  });
  const configuration = record(document.configuration);
  return {
    ...document,
    ...(configuration && configuration.maxItems === originalItems.length
      ? { configuration: { ...configuration, maxItems: written.length } }
      : {}),
    items: written,
  };
}

/** Mark a choice correct or not. A single choice has one answer, so marking one clears the rest. */
export function setCorrect(
  item: AssessmentDraftItem,
  choiceId: string,
  on: boolean,
): AssessmentDraftItem {
  return {
    ...item,
    choices: item.choices.map((choice) =>
      choice.id === choiceId
        ? { ...choice, isCorrect: on }
        : item.interaction === "SIMPLE_CHOICE" && on
          ? { ...choice, isCorrect: false }
          : choice,
    ),
  };
}

/** A new single-choice item at the end, with its first choice the correct one. */
export function addItem(items: readonly AssessmentDraftItem[]): AssessmentDraftItem[] {
  return [
    ...items,
    {
      title: "",
      interaction: "SIMPLE_CHOICE",
      question: "",
      shuffle: false,
      choices: [
        { id: "choice-1", text: "", isCorrect: true },
        { id: "choice-2", text: "", isCorrect: false },
      ],
    },
  ];
}

export function removeItem(
  items: readonly AssessmentDraftItem[],
  index: number,
): AssessmentDraftItem[] {
  return items.filter((_, at) => at !== index);
}

/** A new, empty, incorrect choice with an id the item does not use yet. */
export function addChoice(item: AssessmentDraftItem): AssessmentDraftItem {
  const id = nextName("choice", new Set(item.choices.map((choice) => choice.id)));
  return { ...item, choices: [...item.choices, { id, text: "", isCorrect: false }] };
}

/** Whether a choice may be removed: every item keeps at least two. */
export function canRemoveChoice(item: AssessmentDraftItem): boolean {
  return item.choices.length > 2;
}

/** The item without that choice; refused (the item unchanged) when it would leave fewer than two. */
export function removeChoice(item: AssessmentDraftItem, choiceId: string): AssessmentDraftItem {
  if (!canRemoveChoice(item)) return item;
  return { ...item, choices: item.choices.filter((choice) => choice.id !== choiceId) };
}

export function updateItem(
  items: readonly AssessmentDraftItem[],
  index: number,
  change: (item: AssessmentDraftItem) => AssessmentDraftItem,
): AssessmentDraftItem[] {
  return items.map((item, at) => (at === index ? change(item) : item));
}

/** What stands between the items and a save, each naming its item. */
export function blockers(items: readonly AssessmentDraftItem[]): AssessmentBlocker[] {
  if (!items.length) return [{ code: "noItems" }];
  const found: AssessmentBlocker[] = [];
  items.forEach((item, index) => {
    if (!item.question.trim()) found.push({ code: "emptyQuestion", item: index });
    if (item.choices.length < 2) found.push({ code: "fewChoices", item: index });
    if (item.choices.some((choice) => !choice.text.trim()))
      found.push({ code: "emptyChoice", item: index });
    const ids = item.choices.map((choice) => choice.id.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
      found.push({ code: "duplicateChoiceId", item: index });
    const correct = item.choices.filter((choice) => choice.isCorrect).length;
    if (item.interaction === "SIMPLE_CHOICE" ? correct !== 1 : correct < 1)
      found.push({ code: "correctCount", item: index });
  });
  return found;
}

/** Whether the edited items differ from what was read. */
export function itemsChanged(
  items: readonly AssessmentDraftItem[],
  saved: readonly AssessmentDraftItem[],
): boolean {
  return JSON.stringify(items) !== JSON.stringify(saved);
}

/** The run fields the assessment panel reads. */
export interface AssessmentRunLike {
  runId: string;
  kind: string;
  status: string;
  inputRevision: string;
  hasCandidate: boolean;
  error: string | null;
}

/**
 * What the latest assessment run means for the draft at `revision`: still running, a
 * candidate waiting to be used or kept, a failure worth saying, or nothing. A run made from
 * another revision of the draft is history, not something to act on here.
 */
export function assessmentRunState<T extends AssessmentRunLike>(
  runs: readonly T[],
  revision: string,
  dismissed: ReadonlySet<string>,
):
  | { state: "running"; run: T }
  | { state: "candidate"; run: T }
  | { state: "failed"; run: T }
  | null {
  const run = runs.find((entry) => entry.kind === "assessment");
  if (!run) return null;
  if (run.status === "running") return { state: "running", run };
  if (run.inputRevision !== revision || dismissed.has(run.runId)) return null;
  if (run.status === "succeeded" && run.hasCandidate) return { state: "candidate", run };
  if (run.status === "failed" || run.status === "conflict") return { state: "failed", run };
  return null;
}
