/**
 * Drops one Node warning, and only that one.
 *
 * `commands/serve.ts` pulls in `commands/reset-password.ts`, which imports
 * `@prismshadow/penguin-server/reset-admin-password` — that reaches `node:sqlite` while
 * the module graph loads, so on a Node that still flags the builtin experimental every
 * `penguin` invocation prints
 * `ExperimentalWarning: SQLite is an experimental feature ...`, including the ones whose
 * whole output is a usage error. Nothing in the CLI's own behavior depends on the
 * builtin's stability, and the user has no action to take.
 *
 * The filter lives in the entry module rather than in a launcher flag because both ways
 * of starting the CLI reach it: the release tarball's `bin/penguin` execs
 * `node lib/dist/penguin.js` with no flags, and the dev script runs
 * `tsx packages/cli/src/penguin.ts`. `--disable-warning=ExperimentalWarning` (what the
 * server's `start` script uses) would have to be added to both, and would hide every
 * future experimental warning instead of this one.
 *
 * Import this module BEFORE anything else in the entry: ESM evaluates imports in source
 * order, and the filter has to be in place before the graph reaches `node:sqlite`.
 */

/** Text of the warning Node emits for the `node:sqlite` builtin. */
const SQLITE_EXPERIMENTAL = "SQLite is an experimental feature";

/**
 * The warning category, across `emitWarning`'s overloads: an Error carries its own
 * `name`, a string warning takes the category from the second argument — a bare type
 * string, or the `type` of an options object.
 */
function warningType(warning: unknown, typeArg: unknown): string {
  if (warning instanceof Error) return warning.name;
  if (typeof typeArg === "string") return typeArg;
  if (typeof typeArg === "object" && typeArg !== null) {
    const { type } = typeArg as { type?: unknown };
    if (typeof type === "string") return type;
  }
  return "Warning";
}

/** Whether one `emitWarning` call is the `node:sqlite` experimental notice. */
export function isSqliteExperimentalWarning(warning: unknown, typeArg?: unknown): boolean {
  if (warningType(warning, typeArg) !== "ExperimentalWarning") return false;
  const text = warning instanceof Error ? warning.message : String(warning);
  return text.startsWith(SQLITE_EXPERIMENTAL);
}

/**
 * Wraps `process.emitWarning` so the sqlite notice is discarded and every other warning
 * reaches the terminal unchanged. Returns the uninstaller (tests restore the original).
 */
export function installWarningFilter(): () => void {
  const original = process.emitWarning;
  const emit = original.bind(process) as (...args: unknown[]) => void;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, rest[0])) return;
    emit(warning, ...rest);
  }) as typeof process.emitWarning;
  return () => {
    process.emitWarning = original;
  };
}

installWarningFilter();
