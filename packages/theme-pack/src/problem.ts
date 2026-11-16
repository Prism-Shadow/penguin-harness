/**
 * Why a pack was refused. A pack is refused whole, never cleaned up and kept: the designer gets
 * the file, the line and the reason, and fixes the source.
 *
 * Three kinds, because a caller answers them differently: `invalid` (the pack breaks a rule),
 * `too_large` (it breaks a size or time budget) and `api_unsupported` (it targets a theme API
 * this build does not implement yet).
 */
export type ThemePackRefusal = "invalid" | "too_large" | "api_unsupported";

/** Where a refusal points: the entry's path inside the pack, and a 1-based position in it. */
export interface ThemePackProblem {
  readonly file: string;
  readonly reason: string;
  readonly line?: number;
  readonly column?: number;
}

export class ThemePackError extends Error {
  constructor(
    readonly kind: ThemePackRefusal,
    readonly problem: ThemePackProblem,
  ) {
    const at =
      problem.line === undefined
        ? problem.file
        : `${problem.file}:${problem.line}${problem.column === undefined ? "" : `:${problem.column}`}`;
    super(`${at}: ${problem.reason}`);
    this.name = "ThemePackError";
  }
}

/** A refusal for breaking a rule, at an optional position. */
export function invalid(
  file: string,
  reason: string,
  at?: { line: number; column: number } | null,
): ThemePackError {
  return new ThemePackError("invalid", {
    file,
    reason,
    ...(at ? { line: at.line, column: at.column } : {}),
  });
}

/** A refusal for breaking a size or time budget. */
export function tooLarge(file: string, reason: string): ThemePackError {
  return new ThemePackError("too_large", { file, reason });
}
