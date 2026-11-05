/**
 * How the model is told to query a Trace file it is pointed at: the guidance shared by the
 * `[context_summary]` trailer (engine-blocks.ts) and the `[model_switch_from]` block
 * (origin-blocks.ts), so the two say it in one wording.
 *
 * A Trace file is JSONL, one record per line, and a line can be long: a `write_file` call
 * carries the whole file, a command's output its whole capture. Reading the file whole would
 * flood the very context the summary or the switch was meant to spare, so the guidance steers
 * to the precise query: list the line numbers of the matching records with a search that prints
 * only the match, then read just those lines with `read_file`'s `offset` / `limit`. The two
 * example patterns are fragments of real records (see the Trace writer's JSON): a user text is
 * `{"type":"text","role":"user","text":…}` and a tool call is
 * `{"type":"tool_call","role":"assistant","name":…,"arguments":…}` — `"arguments"` right after
 * the name keeps the `tool_list_ready` record, which lists the same names with a
 * `"description"`, out of the matches.
 *
 * The search is worded for the shell the Session's commands run in — the system prompt's
 * `Shell:` line, which names it — when the caller knows it, and names the POSIX and PowerShell
 * forms side by side when it does not. A `cmd` session goes through PowerShell, whose
 * `Select-String` prints line numbers alone, with patterns that need no inner double quotes.
 *
 * The file itself is never named here: `<file>` stands for the path the surrounding text gives
 * once, so a fork that rewrites that path has one place to rewrite.
 */

/** How a shell is spoken to, for the search command in the guidance. */
export type TraceQueryShell = "posix" | "powershell" | "cmd";

/**
 * The shell kind behind a resolved shell name (the system prompt's `Shell:` value — `bash`,
 * `zsh`, `sh`, `pwsh`, `powershell`, `cmd`, …), or undefined when none is known. Every name that
 * is not PowerShell or cmd speaks POSIX quoting.
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

/**
 * The two lines that tell the model how to read a Trace file precisely: what the file is, the
 * search that lists matching line numbers in the given shell (see {@link traceQueryShellOf}),
 * and the `read_file` window that reads only those lines.
 */
export function traceQueryGuidance(shell?: string): string {
  return [
    `These files are JSONL, one record per line. Query them precisely and never read or cat a whole file: list the matching line numbers with ${searchClause(traceQueryShellOf(shell))}.`,
    "Then read only those lines with read_file offset/limit; a record can be long, and read_file caps each line.",
  ].join("\n");
}
