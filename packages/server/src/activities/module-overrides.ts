/**
 * An author's edit of a module document: the configuration a ref's module reads, or the
 * assessment every ref of a product shares.
 *
 * Loom wrote these straight into the module folder of the WAF checkout. Penguin keeps them in
 * the draft instead, as an override the preview and every assembly use until the author
 * discards it. It is never overwritten by a later plan or assembly; when what it was derived
 * from changes, it is reported stale instead.
 *
 * Pure: no filesystem, no services.
 */
import { HttpError } from "../http/errors.js";
import { assessmentProblems, type AssessmentItem } from "./assessment-session.js";
import { contentRevision, type ActivityDraft, type ModuleDocumentOverride } from "./domain.js";
import { interactionType, isAssessmentData } from "./sandbox-assessment.js";

/** The largest document an author may save, serialized. */
export const MODULE_DOCUMENT_MAX_BYTES = 1_000_000;

/**
 * What a configuration is derived from: the media plan's manifest, or nothing yet. The ref's
 * number is left out: it is the manifest's address, not its media, so renumbering a ref does
 * not make its edit stale.
 */
export function configurationBasis(draft: Pick<ActivityDraft, "mediaPlan">): string | null {
  return draft.mediaPlan ? contentRevision({ ...draft.mediaPlan.manifest, refNum: 0 }) : null;
}

/** What an assessment is derived from: the specification, or nothing yet. */
export function assessmentBasis(draft: Pick<ActivityDraft, "spec">): string | null {
  return draft.spec ? contentRevision(draft.spec) : null;
}

/** Whether what the edit was derived from has changed since. */
export function isStale(override: ModuleDocumentOverride, currentBasis: string | null): boolean {
  return override.basis !== currentBasis;
}

function invalid(message: string): HttpError {
  return new HttpError(422, "document_invalid", message);
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid("The document must be a JSON object.");
  return value as Record<string, unknown>;
}

function withinSize(value: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MODULE_DOCUMENT_MAX_BYTES)
    throw invalid(`The document must be ${MODULE_DOCUMENT_MAX_BYTES} bytes or smaller.`);
}

export function validateConfiguration(value: unknown): Record<string, unknown> {
  const document = plainObject(value);
  withinSize(document);
  return document;
}

/**
 * The choice items of an assessment file, in the shape the assessment rules read, each with
 * its position in the file. Only single- and multiple-response choice items are checked;
 * other interaction kinds are passed through as they are.
 */
function checkedItems(value: unknown): { index: number; item: AssessmentItem }[] {
  if (!isAssessmentData(value)) return [];
  const checked: { index: number; item: AssessmentItem }[] = [];
  value.items.forEach((raw, index) => {
    const interaction = interactionType(raw);
    if (interaction !== "SIMPLE_CHOICE" && interaction !== "MULTIPLE_RESPONSE_CHOICE") return;
    const record = (raw ?? {}) as Record<string, unknown>;
    const configuration =
      record.configuration && typeof record.configuration === "object"
        ? (record.configuration as Record<string, unknown>)
        : {};
    const list =
      configuration[interaction === "SIMPLE_CHOICE" ? "simpleChoice" : "multipleResponseChoice"];
    const choices = (Array.isArray(list) ? list : []).map((choice) => {
      const entry = choice && typeof choice === "object" ? (choice as Record<string, unknown>) : {};
      return {
        id: entry.id === undefined || entry.id === null ? "" : String(entry.id),
        isCorrect: entry.isCorrect === true,
      };
    });
    checked.push({
      index,
      item: {
        id: typeof record.title === "string" ? record.title : "",
        interaction,
        choices,
      },
    });
  });
  return checked;
}

/** The choice items the assessment rules check, as they read them. */
export function assessmentItems(value: unknown): AssessmentItem[] {
  return checkedItems(value).map((entry) => entry.item);
}

/** How many problems a refusal names before it says how many more there are. */
const PROBLEMS_SHOWN = 5;

/**
 * An assessment's problems, each named by its place in the file and keyed by the item's id
 * rather than its place, so the same problem is recognised when items move.
 */
function namedProblems(value: unknown): { message: string; key: string }[] {
  const checked = checkedItems(value);
  // The rules number items within the list they are given; name them by their place in
  // the file instead, which is where an author will look.
  return assessmentProblems(checked.map((entry) => entry.item)).map((problem) => {
    const match = /^Item (\d+)/.exec(problem);
    const entry = match ? checked[Number(match[1]) - 1] : undefined;
    if (!match || !entry) return { message: problem, key: problem };
    const rest = problem.slice(match[0].length);
    return {
      message: `Item ${entry.index + 1}${rest}`,
      key: JSON.stringify([entry.item.id, rest]),
    };
  });
}

/**
 * Validate an assessment an author saves. `baseline` is the document they were editing, when
 * there is one: many real modules already break a rule (a single choice with two correct
 * answers, a repeated title), and Loom never checked, so a problem the baseline already had is
 * let through. Only the problems the edit introduces refuse it.
 */
export function validateAssessment(value: unknown, baseline?: unknown): Record<string, unknown> {
  const document = plainObject(value);
  if (!isAssessmentData(document)) throw invalid("An assessment needs an items list.");
  withinSize(document);
  const known = new Map<string, number>();
  if (baseline !== undefined && baseline !== null)
    for (const { key } of namedProblems(baseline)) known.set(key, (known.get(key) ?? 0) + 1);
  const introduced = namedProblems(document).filter(({ key }) => {
    const left = known.get(key) ?? 0;
    if (left > 0) {
      known.set(key, left - 1);
      return false;
    }
    return true;
  });
  if (introduced.length) {
    const shown = introduced.slice(0, PROBLEMS_SHOWN).map((problem) => problem.message);
    const more = introduced.length - shown.length;
    throw invalid(
      [
        ...shown,
        ...(more > 0 ? [`And ${more} more ${more === 1 ? "problem" : "problems"}.`] : []),
      ].join(" "),
    );
  }
  return document;
}

/**
 * Whether an assembled document kept everything the author's edit says. An assembly may add
 * to it (a key the module needs), but may not change or drop what the author wrote.
 */
export function keepsEdit(written: unknown, edit: unknown): boolean {
  if (edit && typeof edit === "object" && !Array.isArray(edit)) {
    if (!written || typeof written !== "object" || Array.isArray(written)) return false;
    return Object.entries(edit).every(([key, value]) =>
      keepsEdit(
        Object.hasOwn(written, key) ? (written as Record<string, unknown>)[key] : undefined,
        value,
      ),
    );
  }
  return contentRevision(written ?? null) === contentRevision(edit ?? null);
}
