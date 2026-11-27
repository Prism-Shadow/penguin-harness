// @vitest-environment jsdom
/**
 * The composer card's cover (components/chat/composer/composer.tsx): what stands on the card in
 * place of the editor while the editor cannot be used, on a real page.
 *
 * - Given text in the editor and focus in its text body, when a cover comes, then the editor is
 *   still the same mounted text body holding the same text, not drawn, the cover's words stand in
 *   the card's status region, and focus moves to the cover's first press; when the cover goes,
 *   focus is back in the text body and the text is as it was.
 * - Given focus in the cover, when the press it was on leaves as the cover's words change, focus
 *   goes to the cover's first press rather than to the page.
 * - Given focus elsewhere on the page, a cover coming and going never takes it.
 */
import { act, createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ComposerCard, ComposerCover } from "../src/components/chat/composer/composer";
import { mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
});

const press = (label: string) => createElement("button", { key: label, type: "button" }, label);
const cover = (...presses: string[]) =>
  createElement(ComposerCover, {
    title: "Can't reach gpu-box right now",
    status: createElement("span", null, ...presses.map((label) => press(label))),
    note: "Messages can't be sent until it's back.",
  });
const card = (covered: ReactNode = null) =>
  createElement(ComposerCard, {
    textarea: { defaultValue: "Look at the hooks cases" },
    cover: covered,
  });

const textBody = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
const region = () => document.querySelector<HTMLElement>('[data-slot="cover"]')!;
const named = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("a composer card's cover", () => {
  it("stands over the editor it keeps, and hands focus over and back", async () => {
    const ui = await mount(card());
    const body = textBody();
    act(() => body.focus());
    expect(region().getAttribute("role")).toBe("status");
    expect(region().textContent).toBe("");

    await ui.rerender(card(cover("Retry now", "Stop retrying")));
    expect(textBody()).toBe(body);
    expect(body.value).toBe("Look at the hooks cases");
    expect(body.closest(".invisible")).not.toBeNull();
    expect(region().textContent).toContain("Can't reach gpu-box right now");
    expect(document.activeElement).toBe(named("Retry now"));

    await ui.rerender(card());
    expect(document.activeElement).toBe(body);
    expect(body.value).toBe("Look at the hooks cases");
    expect(body.closest(".invisible")).toBeNull();
  });

  it("keeps focus in the cover when the press it was on leaves", async () => {
    const ui = await mount(card(cover("Retry now", "Stop retrying")));
    act(() => named("Stop retrying").focus());
    await ui.rerender(card(cover("Retry", "Go to Machines")));
    expect(document.activeElement).toBe(named("Retry"));
  });

  it("never takes focus that is elsewhere on the page", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const ui = await mount(card());
    act(() => outside.focus());
    await ui.rerender(card(cover("Retry")));
    expect(document.activeElement).toBe(outside);
    await ui.rerender(card());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
