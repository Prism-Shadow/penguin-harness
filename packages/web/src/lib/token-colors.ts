/**
 * Colors for token buckets (same blue hue family, shared across light/dark):
 * used by both the cost center's stacked chart and the trace observation's
 * component bars, keeping "cacheRead lightest / cacheWrite mid / output
 * darkest" as one consistent meaning site-wide.
 */
export const TOKEN_COLORS = {
  cacheRead: "#7dd3fc", // sky-300, lightest
  cacheWrite: "#0ea5e9", // sky-500, mid
  output: "#0369a1", // sky-700, darkest
} as const;
