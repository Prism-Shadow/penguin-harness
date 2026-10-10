/**
 * The token donut (src/components/charts/token-donut): its name and tooltip in the caller's
 * words and figures, three arcs in the Token kinds' colours over a track in the ring's own ink,
 * and the remainder's warning at 80% and 95% of the limit.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TokenDonut } from "../src/components/charts/token-donut/token-donut";
import { classTokens, renderStatic } from "../src/testing";

const LABELS = { usage: "Kontext", cacheRead: "Lesen", cacheWrite: "Schreiben", output: "Ausgabe" };

const donut = (cacheRead: number, cacheWrite: number, output: number, max = 100) =>
  renderStatic(
    createElement(TokenDonut, {
      cacheRead,
      cacheWrite,
      output,
      max,
      labels: LABELS,
      format: (n: number) => `${n}t`,
    }),
  );

describe("TokenDonut", () => {
  it("is a named image whose name and tooltip are the caller's words and figures", () => {
    const html = donut(40, 5, 10);
    expect(html).toContain('role="img"');
    const name = "Kontext 55t/100t · Lesen 40t · Schreiben 5t · Ausgabe 10t";
    expect(html).toContain(`aria-label="${name}"`);
    expect(html).toContain(`data-tooltip="${name}"`);
    expect(classTokens(html)).toContain("ui-chart");
  });

  it("draws one arc per non-empty kind over the track, in the kinds' colours", () => {
    const html = donut(40, 0, 10);
    expect(html.match(/data-part="series"/g)).toHaveLength(2);
    expect(html.match(/data-part="grid"/g)).toHaveLength(1);
    expect(html).toContain("var(--ui-chart-cache-read)");
    expect(html).toContain("var(--ui-chart-output)");
    expect(html).not.toContain("var(--ui-chart-cache-write)");
  });

  it("inks the remainder by how close usage is to the limit, in tokens", () => {
    expect(classTokens(donut(40, 0, 10))).toContain("text-line-emphasis");
    expect(classTokens(donut(80, 0, 5))).toContain("text-tone-attention-fg");
    expect(classTokens(donut(90, 0, 10))).toContain("text-tone-danger-fg");
    expect(donut(40, 0, 10)).not.toMatch(/gray-|dark:/);
  });
});
