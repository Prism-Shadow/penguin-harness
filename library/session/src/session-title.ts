/**
 * A Session title as a person writes one — a rename (PATCH /api/sessions/:id) or the title a
 * server module gives a task it starts (the agent domain's agent-tasks): its whitespace
 * collapsed, and refused 400 `invalid_title` when it is empty, too long, or carries what no
 * title should.
 *
 * Moved from the server's http/session-title.ts beside the Session contracts (services+http+cli
 * restack S10).
 */
import { HttpError } from "@prismshadow/penguin-library-http";

/** Max title length for manual renames: looser than the auto-generated 30-char limit, to accommodate users' own organizing conventions. */
export const SESSION_TITLE_MAX = 120;

/**
 * What a manual title may not contain once its whitespace is collapsed: C0/C1 controls (an
 * ESC sequence would drive the terminal that `penguin session ls` prints it to) and the bidi
 * embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069) that make a row read as
 * something else. Not all of `\p{Cf}`: U+200D (zero-width joiner) holds emoji sequences
 * together.
 */
const SESSION_TITLE_FORBIDDEN = /[\p{Cc}‪-‮⁦-⁩]/u;

/** The title `raw` stores as, or the 400 that says why it cannot be one. */
export function sessionTitle(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, "invalid_title", "title must be a string.");
  }
  // Newlines and tabs become plain spaces here, so what is left to refuse is only
  // what no title should carry.
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title || title.length > SESSION_TITLE_MAX) {
    throw new HttpError(400, "invalid_title", `title must be 1–${SESSION_TITLE_MAX} characters.`);
  }
  if (SESSION_TITLE_FORBIDDEN.test(title)) {
    throw new HttpError(
      400,
      "invalid_title",
      "title must not contain control or bidirectional-override characters.",
    );
  }
  return title;
}
