/**
 * Positional slash-command matching for the chat input (pure logic, unit-tested):
 * like @ mentions, a `/` opens the command menu from ANY caret position — it must sit at
 * the start of the text or be preceded by whitespace (so URLs and paths like `a/b` never
 * trigger it), with only command characters between the `/` and the caret. Running a
 * command removes just the `start..end` token, leaving the rest of the text intact.
 */

/** Command characters allowed between `/` and the caret (command names and skill names: letters, digits, underscore, hyphen). */
const CMD_PREFIX = /^[\w-]*$/;

/** The slash token currently being typed: `start` is the index of `/`, `query` is the text between `/` and the caret (no leading slash), `end` extends over the same token to the right of the caret. */
export interface SlashMatch {
  start: number;
  end: number;
  query: string;
}

/** Finds the slash command currently being typed at the caret; returns null if none. */
export function matchSlash(text: string, caret: number): SlashMatch | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("/");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (!CMD_PREFIX.test(query)) return null;
  const rest = /^[\w-]*/.exec(text.slice(caret))![0];
  return { start: at, end: caret + rest.length, query };
}

/** Removes the matched token from the text (what a slash command's run leaves behind); collapses a doubled space at the seam. */
export function removeSlashToken(text: string, match: SlashMatch): string {
  const before = text.slice(0, match.start);
  const after = text.slice(match.end);
  return (before + after).replace(/  +/g, " ").replace(/^\s+$/, "");
}
