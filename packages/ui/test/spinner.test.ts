/**
 * The one spinner (src/components/icons/spinner/spinner.tsx): a status named by its label, drawn
 * in two styles at once — the arc on its track and a pencil scribble — that turn together, of
 * which the theme's CSS shows one.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Spinner } from "../src/components/icons/spinner/spinner";
import { classTokens, renderStatic } from "../src/testing";

describe("Spinner", () => {
  it("is a status named by its label, turning as one svg", () => {
    const html = renderStatic(createElement(Spinner, { label: "Loading" }));
    expect(html).toMatch(/^<svg role="status" aria-label="Loading" data-live="spinner"/);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["ui-live", "animate-spin"]));
  });

  it("draws the arc and the scribble as the svg's two children, one per style", () => {
    const html = renderStatic(createElement(Spinner, { label: "Loading" }));
    const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</svg>"));
    expect(inner).toMatch(
      /^<g data-set="arc">(?:<circle[^>]*><\/circle>){2}<\/g><polyline data-set="scribble"/,
    );
    expect(inner).toMatch(/<polyline [^>]*stroke="currentColor"[^>]*stroke-linecap="round"/);
  });
});
