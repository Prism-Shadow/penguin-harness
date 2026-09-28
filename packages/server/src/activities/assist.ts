/**
 * Assist: an agent session in an activity's context, started from the studio's
 * conversation panel with whatever the author is looking at.
 *
 * The other run kinds each produce one artifact the server collects and checks. An assist
 * run produces a conversation. It is still a run, not a bare Session, so that "an agent
 * worked on this activity" has one answer: the activity's runs list, which already links
 * every run to its Session and Trace. The run finishes when the agent's first reply does,
 * so it holds the activity's one-run-at-a-time slot only while that reply is being written.
 * Follow-up turns are ordinary Session traffic, traced in that Session.
 *
 * The session works in a copy of the draft, as every run does, so nothing it writes there
 * changes the activity. Changing the activity stays with the author and the stage runs,
 * where every change is reviewed.
 */
import { HttpError } from "../http/errors.js";
import { validateActivitySpec } from "./domain.js";

/** The workspace sections a focus can name; the studio's tree rows map onto these. */
export const ASSIST_SECTIONS = [
  "description",
  "specification",
  "module",
  "speech",
  "scenes",
  "library",
  "history",
  "configuration",
  "assessment",
  "stats",
  "features",
] as const;

export type AssistSection = (typeof ASSIST_SECTIONS)[number];

/** What the author had open when they asked. Recorded on the run, so a trace says. */
export interface AssistFocus {
  section: AssistSection;
  sceneId?: string;
  assetKey?: string;
  language?: string;
}

/** Long enough for a pasted paragraph of feedback; the Session holds anything longer. */
export const ASSIST_MESSAGE_MAX = 20_000;
const FOCUS_TEXT_MAX = 200;

function focusText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > FOCUS_TEXT_MAX)
    throw new HttpError(400, "assist_invalid", `focus.${key} must be a short string.`);
  return value;
}

/** The focus a request names, or null when it names none. Anything malformed is refused. */
export function parseAssistFocus(value: unknown): AssistFocus | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "assist_invalid", "focus must be an object.");
  const record = value as Record<string, unknown>;
  if (!ASSIST_SECTIONS.includes(record.section as AssistSection))
    throw new HttpError(400, "assist_invalid", "focus.section is not a workspace section.");
  const sceneId = focusText(record, "sceneId");
  const assetKey = focusText(record, "assetKey");
  const language = focusText(record, "language");
  return {
    section: record.section as AssistSection,
    ...(sceneId !== undefined ? { sceneId } : {}),
    ...(assetKey !== undefined ? { assetKey } : {}),
    ...(language !== undefined ? { language } : {}),
  };
}

const SECTION_WORDS: Record<AssistSection, string> = {
  description: "the activity script (description.md)",
  specification: "the activity specification (draft.spec in input.json)",
  module: "the assembled WAF module",
  speech: "the activity's speech coverage (audio assets in draft.mediaPlan)",
  scenes: "the scenes and their media",
  library: "the activity's media library",
  history: "the activity's generation history",
  configuration: "the module's configuration (configurations/<product>-<ref>.json in the module)",
  assessment: "the module's assessment data (assessments/<product>-<ref>.json in the module)",
  stats: "the activity's media counts and sizes (draft.mediaPlan)",
  features: "the implementation features this ref asks its module assembly to reproduce",
};

/** Where the author is, in words the agent can find in input.json. */
export function describeFocus(focus: AssistFocus | null): string {
  if (!focus) return "the activity as a whole";
  if (focus.assetKey)
    return `the media asset ${JSON.stringify(focus.assetKey)}${
      focus.sceneId ? ` in scene ${JSON.stringify(focus.sceneId)}` : " (in no scene)"
    }${focus.language ? `, language ${JSON.stringify(focus.language)}` : ""}`;
  if (focus.sceneId) return `scene ${JSON.stringify(focus.sceneId)}`;
  return SECTION_WORDS[focus.section];
}

/**
 * The first turn: the author's words first, as they wrote them, then the context. The
 * context comes second so the conversation reads as the author's question, not as a
 * system brief with a question at the bottom.
 */
export function assistPrompt(message: string, focus: AssistFocus | null): string {
  return `${message}

---
Context from the activity studio: the author is looking at ${describeFocus(focus)}.
This workspace holds a copy of the activity: input.json (the whole draft, including the specification and media plan) and description.md (the activity script). Read them before answering.
Files you write here do not change the activity. ${PROPOSAL_INSTRUCTIONS}
Answer the author directly. Do not delegate.`;
}

/**
 * How the agent hands a change back. The studio reads this file after each reply and shows
 * each change as a diff against the live draft, which the author accepts or leaves; so the
 * agent never needs write access to anything but its own workspace, and every change an
 * agent made to an activity is one an author accepted, in the Trace and the draft history.
 */
export const PROPOSAL_FILE = "proposal.json";
/** Where a proposal the author discarded is kept, beside the run that made it. */
export const DISCARDED_PROPOSAL_FILE = "proposal.discarded.json";

const PROPOSAL_INSTRUCTIONS = `When the author asks for a change, or agrees to one you suggested, write it to ${PROPOSAL_FILE} in this workspace, and the studio will show it to them to accept. Replace the whole file each time; it holds your current proposal, not a history. Its shape, as JSON without Markdown fences:
{"summary":"one or two sentences on what changes and why","changes":[ ...one or more of:
  {"target":"description","text":"the complete new activity script"},
  {"target":"spec","spec":{ the complete new specification, in the same shape as draft.spec in input.json }},
  {"target":"media","language":"en-US","assetKey":"an asset key from draft.mediaPlan","field":"description" or "script","text":"the new image description or spoken script"}
]}
Write complete values, never fragments or diffs. Change only what the author asked for. Tell the author in your reply that a proposal is ready to review.`;

export type ProposalChange =
  | { target: "description"; text: string }
  | { target: "spec"; spec: Record<string, unknown> }
  | {
      target: "media";
      language: string;
      assetKey: string;
      field: "description" | "script";
      text: string;
    };

export interface AssistProposal {
  summary: string;
  changes: ProposalChange[];
}

/** Room for a long script or a large spec; a proposal past this is not one to review. */
export const PROPOSAL_MAX_BYTES = 1024 * 1024;
const MAX_CHANGES = 20;

function proposalText(value: unknown, what: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max)
    throw new Error(
      `${what} must be ${allowEmpty ? "" : "non-empty "}text of at most ${max} characters.`,
    );
  return value;
}

/**
 * The proposal in a file the agent wrote, checked the way each change's own route would
 * check it, so a proposal the studio shows is one it can apply. Throws with a sentence the
 * author can read (and paste back to the agent) when it is not.
 */
export function parseAssistProposal(raw: string): AssistProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${PROPOSAL_FILE} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${PROPOSAL_FILE} must be a JSON object.`);
  const record = parsed as Record<string, unknown>;
  const summary = proposalText(record.summary ?? "", "summary", 2000, true);
  if (!Array.isArray(record.changes) || !record.changes.length)
    throw new Error("A proposal needs at least one change.");
  if (record.changes.length > MAX_CHANGES)
    throw new Error(`A proposal holds at most ${MAX_CHANGES} changes.`);
  const seen = new Set<string>();
  const changes = record.changes.map((value, index): ProposalChange => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Change ${index + 1} must be an object.`);
    const change = value as Record<string, unknown>;
    // Two changes to one thing leave the author to guess which the agent meant.
    const once = (key: string) => {
      if (seen.has(key)) throw new Error(`Change ${index + 1} changes ${key} a second time.`);
      seen.add(key);
    };
    if (change.target === "description") {
      once("the activity script");
      return {
        target: "description",
        text: proposalText(change.text, "The activity script", 100_000),
      };
    }
    if (change.target === "spec") {
      once("the specification");
      try {
        return { target: "spec", spec: validateActivitySpec(change.spec) };
      } catch (error) {
        throw new Error(`The proposed specification is invalid: ${(error as Error).message}`);
      }
    }
    if (change.target === "media") {
      const language = proposalText(change.language, "language", 64);
      const assetKey = proposalText(change.assetKey, "assetKey", 200);
      if (change.field !== "description" && change.field !== "script")
        throw new Error(`Change ${index + 1} must set field to "description" or "script".`);
      once(`${assetKey} (${language})`);
      return {
        target: "media",
        language,
        assetKey,
        field: change.field,
        text: proposalText(change.text, `The new ${change.field}`, 5000),
      };
    }
    throw new Error(`Change ${index + 1} has an unknown target.`);
  });
  return { summary, changes };
}
