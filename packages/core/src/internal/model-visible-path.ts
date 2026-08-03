/**
 * Model-visible spelling of an absolute path.
 *
 * Every path core composes for the model to read — the system prompt's App Data Dir and CWD
 * lines, `[attached image/file: …]` lines, the goal-file line, truncated-output recovery notes —
 * goes through this helper, because the model re-emits those spellings into JSON tool arguments
 * and shell commands. On Windows that spelling uses forward slashes: Node's fs APIs accept them,
 * `exec_command` runs through (Git) Bash, and the form has no JSON backslash-escaping ambiguity.
 * Harness-composed paths are ordinary absolute paths (never `\\?\`-prefixed), so the swap is
 * lossless. POSIX paths pass through untouched — a backslash is a valid filename character there.
 */
export function modelVisiblePath(filePath: string): string {
  return process.platform === "win32" ? filePath.replaceAll("\\", "/") : filePath;
}
