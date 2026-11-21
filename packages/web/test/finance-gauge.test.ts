import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FinanceGauge, SpendMeter } from "../src/features/company/finance-gauge";

vi.mock("@prismshadow/penguin-ui", () => ({
  Ring: ({ tone }: { tone: string }) => createElement("div", { "data-ring-tone": tone }),
}));

describe("FinanceGauge budget tone", () => {
  it("uses the supplied tone instead of the default threshold", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceGauge, {
        ratio: 0.6,
        label: "60% spent",
        tone: "danger",
      }),
    );

    expect(html).toContain('data-ring-tone="danger"');
  });

  it("keeps the default tone when none is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceGauge, {
        ratio: 0.6,
        label: "60% spent",
      }),
    );

    expect(html).toContain('data-ring-tone="success"');
  });
});

describe("SpendMeter budget tone", () => {
  it("uses the supplied tone instead of the default threshold", () => {
    const html = renderToStaticMarkup(
      createElement(SpendMeter, {
        ratio: 0.6,
        label: "60% spent",
        tone: "danger",
      }),
    );

    expect(html).toContain("bg-red-500");
    expect(html).not.toContain("bg-emerald-500");
  });

  it("keeps the default tone when none is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(SpendMeter, {
        ratio: 0.6,
        label: "60% spent",
      }),
    );

    expect(html).toContain("bg-emerald-500");
  });

  it("uses a muted tone when no budget ratio exists", () => {
    const html = renderToStaticMarkup(
      createElement(SpendMeter, {
        label: "No budget",
      }),
    );

    expect(html).toContain("bg-gray-400");
    expect(html).toContain('aria-label="No budget"');
  });
});
