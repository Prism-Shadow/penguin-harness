/**
 * How the model is told to query a Trace file it is pointed at, in one wording for the
 * `[context_summary]` trailer and the `[model_switch_from]` block. A Trace line can be long (a
 * `write_file` call carries the whole file), so reading the file whole would flood the context
 * the block meant to spare: the guidance lists the matching line numbers with a search that
 * prints only the match, then reads those lines with `read_file`'s `offset` / `limit`. The
 * patterns are fragments of real records; `"arguments"` right after the name keeps
 * `tool_list_ready`, which lists the same names with a `"description"`, out of the matches.
 * `<file>` stands for the path the surrounding text gives once, so a fork that rewrites that
 * path has one place to rewrite.
 */

/** How a shell is spoken to, for the search command in the guidance. */
export type TraceQueryShell = "posix" | "powershell" | "cmd";

/**
 * The shell kind behind the system prompt's `Shell:` value, or undefined when none is known;
 * every name that is not PowerShell or cmd speaks POSIX quoting.
 */
export function traceQueryShellOf(shell: string | undefined): TraceQueryShell | undefined {
  const name = shell?.trim().toLowerCase();
  if (!name) return undefined;
  if (name === "pwsh" || name === "powershell") return "powershell";
  if (name === "cmd") return "cmd";
  return "posix";
}

/** A user text record, and one tool's calls, as JSON fragments of the records themselves. */
const USER_PATTERN = `'"role":"user","text"'`;
const TOOL_PATTERN = `'"name":"exec_command","arguments"'`;
/** The same two, as regexes needing no double quotes (each `.` stands for one). */
const USER_REGEX = `'role.:.user.,.text'`;
const TOOL_REGEX = `'name.:.exec_command.,.arguments'`;

const POSIX_SEARCH = "`rg -n -o '<pattern>' <file>` (or `grep -n -o`)";
const POWERSHELL_SEARCH =
  "`(Select-String -Path <file> -SimpleMatch -Pattern '<pattern>').LineNumber`";
const CMD_SEARCH =
  "`powershell -NoProfile -Command \"(Select-String -Path '<file>' -Pattern '<pattern>').LineNumber\"`";

function searchClause(shell: TraceQueryShell | undefined): string {
  switch (shell) {
    case "posix":
      return `${POSIX_SEARCH}, for example the pattern ${USER_PATTERN} for user messages or ${TOOL_PATTERN} for one tool's calls`;
    case "powershell":
      return `${POWERSHELL_SEARCH}, for example the pattern ${USER_PATTERN} for user messages or ${TOOL_PATTERN} for one tool's calls`;
    case "cmd":
      return `${CMD_SEARCH}, for example the pattern ${USER_REGEX} for user messages or ${TOOL_REGEX} for one tool's calls (each \`.\` stands for a quote)`;
    case undefined:
      return `${POSIX_SEARCH} in a POSIX shell, or ${POWERSHELL_SEARCH} in PowerShell, for example the pattern ${USER_PATTERN} for user messages or ${TOOL_PATTERN} for one tool's calls`;
  }
}

/** The two lines that tell the model how to read a Trace file precisely, worded for `shell`. */
export function traceQueryGuidance(shell?: string): string {
  return [
    `These files are JSONL, one record per line. Query them precisely and never read or cat a whole file: list the matching line numbers with ${searchClause(traceQueryShellOf(shell))}.`,
    "Then read only those lines with read_file offset/limit; a record can be long, and read_file caps each line.",
  ].join("\n");
}
