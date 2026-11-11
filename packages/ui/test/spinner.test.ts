/**
 * The one spinner (src/components/icons/spinner/spinner.tsx): a status named by its label, drawn
 * in two styles at once — the arc on its track and a pencil scribble — that turn together, of
 * which the theme's CSS shows one.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Spinner } from "../src/components/icons/spinner/spinner";
import { renderStatic } from "../src/testing";
import { childElements, readMarkup } from "./helpers/markup";

const spinner = () =>
  childElements(readMarkup(renderStatic(createElement(Spinner, { label: "Loading" }))));

describe("Spinner", () => {
  it("is a status named by its label, as one svg", () => {
    const roots = spinner();
    expect(roots).toHaveLength(1);
    expect(roots[0]!.tag).toBe("svg");
    expect(roots[0]!.attrs).toMatchObject({
      role: "status",
      "aria-label": "Loading",
      "data-live": "spinner",
    });
  });

  it("draws both styles, the arc and the scribble, as the svg's children", () => {
    const drawings = childElements(spinner()[0]!).map((child) => child.attrs["data-set"]);
    expect(drawings.sort()).toEqual(["arc", "scribble"]);
  });
});
