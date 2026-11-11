/**
 * The hook recipes a gradient may paint: the running activity's sweep, a chart's area mask and
 * a streaming reply's veil (deslop.ts says why each has the job, and the de-slop and pack-rule
 * checks both read this). A module of its own, with no imports, so the pack rules
 * (pack-rules.ts) carry nothing else wherever they are imported — the server's theme-pack import
 * among them.
 */
export const GRADIENT_RECIPES =
  /\.ui-activity\[data-state="running"\]|\.ui-chart\b|\.ui-stream\[data-(?:state="streaming"|settling)\]/;
