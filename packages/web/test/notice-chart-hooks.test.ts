/**
 * The notice and chart hooks on the real app: every notice strip renders through NoticeStrip
 * (so it carries `ui-notice` and a `data-tone` in the hook's words), toasts carry the same hook,
 * and the charts' roots carry `ui-chart` with their parts named by literal `data-part` values.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOTICE_TONE, NoticeStrip } from "../src/components/ui/notice-strip";
import { scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();
const text = (id: string) => sourceFile(SCAN, `packages/web/src/${id}`).text;

describe("notices", () => {
  it("render the hook with the tone in the hook's words", () => {
    const html = renderToStaticMarkup(
      createElement(NoticeStrip, { tone: "attention", className: "px-3" }, "Heads up"),
    );
    expect(html).toContain("ui-notice");
    expect(html).toContain('data-tone="warning"');
    expect(new Set(Object.values(NOTICE_TONE))).toEqual(
      new Set(["info", "success", "warning", "danger", "neutral"]),
    );
  });

  it("go through NoticeStrip, and toasts carry the hook too", () => {
    const inline = SCAN.files
      .filter((file) => file.root === "web" && file.name.endsWith(".tsx"))
      .filter((file) => !file.id.endsWith("components/ui/notice-strip.tsx"))
      .filter((file) => /toneStrip[.[]/.test(file.text.replace(/\/\*[\s\S]*?\*\//g, "")))
      .map((file) => file.id);
    expect(inline).toEqual([]);
    expect(text("components/ui/toast.tsx")).toContain("ui-notice");
  });
});

describe("charts", () => {
  it("carry ui-chart on their roots and name their parts", () => {
    for (const id of [
      "features/usage/chart-svg.tsx",
      "components/ui/token-donut.tsx",
      "features/benchmark/score-sparkline.tsx",
    ]) {
      expect(text(id), id).toContain("ui-chart");
    }
    const parts = ["features/usage/trend-chart.tsx", "features/usage/usage-charts.tsx"]
      .map(text)
      .join("\n");
    for (const part of ["series", "area", "bar", "point"]) {
      expect(parts).toContain(`data-part="${part}"`);
    }
    expect(text("features/usage/chart-svg.tsx")).toContain('data-part="grid"');
  });
});
