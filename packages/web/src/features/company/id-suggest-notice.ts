/**
 * What the id field says about the id a proposal just handed it (pure, unit tested).
 *
 * `POST /organizations/suggest-id` always answers with a valid id, so the field's job is not
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

/** The field's own dictionary slice — `S.company.idSuggest`. */
export type IdSuggestStrings = Strings["company"]["idSuggest"];

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
