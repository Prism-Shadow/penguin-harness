/**
 * What the id field does with the id a proposal just handed it (pure, unit tested): what goes
 * in the box, and what the field says about it.
 *
 * `POST /suggest-id` always answers with a valid id, so the field's job is not
 * to report a refusal but to say how much the id it just received is worth. A model-made id
 * needs no note at all. A transliteration of the display name gets a quiet one, because it is
 * a mechanical reading of what the user typed rather than a name anyone chose. A placeholder
 * gets an attention-toned one: it names nothing, it says why the two real paths produced
 * nothing, and it asks to be replaced before the dialog is submitted.
 *
 * A `reason` this build does not know (a newer server) still renders a sentence — the note is
 * how the user learns the id in the box is a placeholder, and losing it over an unrecognized
 * code would be the worse failure.
 */
import type { SemanticIdSuggestResponse } from "@prismshadow/penguin-server/api";
import type { Strings } from "../../lib/strings";

/** The field's own dictionary slice — `S.semanticId.idSuggest`. */
export type IdSuggestStrings = Strings["semanticId"]["idSuggest"];

/** A line under the field, with the tone it is drawn in; null when the id speaks for itself. */
export interface IdSuggestNotice {
  tone: "attention" | "muted";
  text: string;
}

export function idSuggestNotice(
  res: SemanticIdSuggestResponse,
  s: IdSuggestStrings,
): IdSuggestNotice | null {
  if (res.source === "placeholder") {
    const known: Record<string, string> = s.reasons;
    const why = (res.reason !== undefined ? known[res.reason] : undefined) ?? s.reasonUnknown;
    return { tone: "attention", text: s.placeholder(why) };
  }
  if (res.source === "fallback") return { tone: "muted", text: s.fromName };
  return null;
}

/**
 * What goes in the box: the proposal, less the part the field draws in front of the box. The
 * server answers a non-admin's Project id whole (`alice-research_lab`) while the box holds only
 * what follows `alice-`; an id that does not start with the locked part is left whole, so the
 * caller's validation names the problem instead of the field hiding it.
 */
export function proposalValue(id: string, lockedPrefix: string | undefined): string {
  return lockedPrefix !== undefined && id.startsWith(lockedPrefix)
    ? id.slice(lockedPrefix.length)
    : id;
}
