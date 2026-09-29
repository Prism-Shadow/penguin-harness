/**
 * Which surfaces an ink token is judged against for WCAG contrast (A-architecture §3.0), by name.
 * Pure: the tokens drawer paints the resolved colours and does the maths in lib/color.ts.
 */

export function contrastTargets(name: string): string[] {
  const tone = /^--ui-tone-([a-z]+)-(fg|emphasis-fg)$/.exec(name);
  if (tone) {
    return tone[2] === "fg"
      ? ["--ui-canvas", "--ui-surface", `--ui-tone-${tone[1]}-bg`]
      : [`--ui-tone-${tone[1]}-emphasis`];
  }
  if (name === "--ui-accent-fg") return ["--ui-accent"];
  if (name.startsWith("--ui-fg")) return ["--ui-canvas", "--ui-surface", "--ui-inset"];
  if (/^--ui-chart-(\d|cache-|output)/.test(name)) return ["--ui-canvas", "--ui-surface"];
  return [];
}

/**
 * The floor an ink is judged by: charts are graphics (3:1), and every other ink is text (4.5:1)
 * except the subtle ink, placeholder and disabled text that WCAG exempts. The contrast suite
 * (packages/ui/test/contrast.test.ts) sets no floor for it either, so its ratios are shown here,
 * never judged: null.
 */
export function contrastFloor(name: string): number | null {
  if (name === "--ui-fg-subtle") return null;
  return name.startsWith("--ui-chart") ? 3 : 4.5;
}
