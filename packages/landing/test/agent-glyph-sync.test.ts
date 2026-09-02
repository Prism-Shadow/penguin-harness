/**
 * Landing ↔ Web App agent-glyph sync: the page that sells the product and the product itself
 * draw the Agent with the same mark, and there is no shared module to draw it from — the
 * landing page deliberately carries zero icon dependencies, so the path exists twice.
 *
 * A copy is exactly what drifts: this glyph was hand-copied once before (the new-chat page's
 * example folder) and quietly stayed on the old drawing the day it was redrawn. Both sides are
 * read as text rather than imported, because text is what the duplication actually is.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webGlyphSource = join(
  __dirname,
  "..",
  "..",
  "web",
  "src",
  "components",
  "ui",
  "group-list.tsx",
);
const landingIconsSource = join(__dirname, "..", "src", "components", "icons.tsx");

/** `export const AGENT_GROUP_ICON = "…"`, however prettier has wrapped it. */
function webAgentGlyph(): string | null {
  const source = readFileSync(webGlyphSource, "utf8");
  return /export const AGENT_GROUP_ICON\s*=\s*"([^"]+)"/.exec(source)?.[1] ?? null;
}

/** The single `<path d="…">` of the landing set's BotIcon. */
function landingBotGlyph(): string | null {
  const source = readFileSync(landingIconsSource, "utf8");
  const body = /export function BotIcon\([\s\S]*?\n}/.exec(source)?.[0] ?? "";
  const paths = [...body.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  return paths.length === 1 ? (paths[0] ?? null) : null;
}

describe("landing ↔ Web App agent glyph", () => {
  it("finds both sides", () => {
    expect(webAgentGlyph()).not.toBeNull();
    // null also means BotIcon stopped being a single path, which is what makes it comparable.
    expect(landingBotGlyph()).not.toBeNull();
  });

  it("draws the same Agent", () => {
    expect(landingBotGlyph()).toBe(webAgentGlyph());
  });
});
