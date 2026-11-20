// @vitest-environment jsdom
/**
 * A cover card's own parts on a live page (src/components/showcase/cover-card.tsx): the bar of
 * text actions under the card, the version chip and the origin line.
 *
 * - A bar action is named by its word, its second line and the card's title, so two cards'
 *   "Install" are told apart; pressing it runs it and does not open the card.
 * - A disabled bar action stays on the card and runs nothing.
 * - The version chip shows the caller's words and stays outside the opener, which still opens
 *   the card.
 * - The origin line is part of the opener, so the opener's name says where the card came from.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverCard } from "../src/components/showcase/cover-card";
import type { CoverCardProps } from "../src/components/showcase/cover-card";
import { mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

async function card(props: Partial<CoverCardProps>) {
  const { container } = await mount(
    createElement(CoverCard, {
      cover: createElement("span", null, "cover"),
      title: "Goal Mode",
      description: "Loop the session on an objective until it is done.",
      ...props,
    }),
  );
  return container.querySelector<HTMLElement>('[data-part="card"]')!;
}

const opener = (root: Element) => root.querySelector<HTMLButtonElement>(".showcase-card-open")!;
const barButton = (root: Element, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === name,
  );

describe("a cover card's bar", () => {
  it("names each action by its words and the card's title, and runs it without opening the card", async () => {
    const install = vi.fn();
    const onOpen = vi.fn();
    const root = await card({
      onOpen,
      bar: [
        { key: "install", label: "Install", note: "2 agents", onClick: install },
        { key: "quick", label: "Quick start", hint: "Start a chat with it" },
      ],
    });
    const button = barButton(root, "Install · 2 agents · Goal Mode");
    expect(button).toBeDefined();
    expect(barButton(root, "Quick start · Goal Mode")?.getAttribute("data-tooltip")).toBe(
      "Start a chat with it",
    );
    button!.click();
    expect(install).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps a disabled action in place and runs nothing", async () => {
    const quick = vi.fn();
    const root = await card({
      bar: [{ key: "quick", label: "Quick start", disabled: true, onClick: quick }],
    });
    const button = barButton(root, "Quick start · Goal Mode")!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(quick).not.toHaveBeenCalled();
  });
});

describe("a cover card's version and origin", () => {
  it("shows the version outside the opener, which still opens the card", async () => {
    const onOpen = vi.fn();
    const root = await card({ version: "v0.2.18", onOpen });
    expect(root.querySelector(".showcase-card-version")?.textContent).toBe("v0.2.18");
    expect(opener(root).textContent).not.toContain("v0.2.18");
    opener(root).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says where the card came from inside the opener", async () => {
    const root = await card({ origin: "build-box" });
    expect(opener(root).textContent).toContain("build-box");
  });
});
