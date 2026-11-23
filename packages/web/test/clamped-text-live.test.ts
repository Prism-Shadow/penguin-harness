// @vitest-environment jsdom
/**
 * Long text kept in sight — the UI package's `ClampedText`, which the transcript's notices and
 * the retry row's inline reason use for a provider's own words — as it lives on a page. jsdom lays
 * nothing out, so the box's two heights are given here as a browser would measure them.
 *
 * - Given text that fits its lines, no Expand is offered.
 * - Given text that runs past them, Expand is offered; pressing it shows the text whole and
 *   offers Collapse, which folds it back.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { ClampedText } from "@prismshadow/penguin-ui";
import { button, click, hasButton, mount, unmountAll } from "./helpers/dom";

/** What the clamped box measures: its full text's height and the height it is held to. */
const measured = { full: 40, shown: 40 };

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => measured.full,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => measured.shown,
  });
});
afterAll(() => {
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});
afterEach(async () => {
  await unmountAll();
});

const LONG = "503 upstream connect error or disconnect/reset before headers. ".repeat(8);

describe("long text kept in sight", () => {
  it("offers no Expand when the text fits its lines", async () => {
    Object.assign(measured, { full: 40, shown: 40 });
    await mount(h(ClampedText, { lines: 3, children: LONG }));
    expect(hasButton("Expand")).toBe(false);
  });

  it("offers Expand when the text runs past its lines, and Collapse once it is open", async () => {
    Object.assign(measured, { full: 120, shown: 40 });
    const { container } = await mount(h(ClampedText, { lines: 3, children: LONG }));
    expect(container.textContent).toContain(LONG.trim());
    await click(button("Expand"));
    expect(button("Collapse").getAttribute("aria-expanded")).toBe("true");
    await click(button("Collapse"));
    expect(button("Expand").getAttribute("aria-expanded")).toBe("false");
  });
});
