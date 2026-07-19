/**
 * Context window resolution: falls back to the default of 128000 when a
 * model has no `context_window` configured (or it resolves to a non-positive
 * value like `"unknown"`), giving the chat page and Trace page a consistent
 * upper bound for the context-usage ring.
 */

/** Default upper bound when a model has no configured context window. */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/** Resolves the context window upper bound: uses the value if positive (or a string parseable as positive), otherwise falls back to 128000. */
export function resolveContextWindow(x: number | string | undefined | null): number {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTEXT_WINDOW;
}
