// @vitest-environment jsdom
/**
 * EntityCard and EntityCardAction (src/components/data/entity-card/entity-card.tsx) on a real
 * page (test/helpers/dom.ts), pressed the way a person presses them.
 *
 * - Given a card, its title is a button that opens the detail; a press on one of the card's
 *   actions runs that action and does not open the detail.
 * - Given a card without facts, tags or actions, none of those lines is drawn.
 * - Given an action whose request is in flight, it takes no press and says it is busy.
 * - Given an action, its word names it — `name` when that says more — and is its tooltip; a hint
 *   replaces the tooltip and is marked as saying what the word does not. The word is in the
 *   button at every width, so it is read as its text whether or not the card is wide enough to
 *   show it (the width itself is a container query, measured in a browser).
 * - Given extra attributes, they land on the card itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import {
  EntityCard,
  EntityCardAction,
  type EntityCardProps,
} from "../src/components/data/entity-card/entity-card";
import { ICONS } from "../src/components/icons/icons";
import { fire, mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

const click = (el: Element) => fire(el, new MouseEvent("click", { bubbles: true }));

const card = (props: Partial<EntityCardProps> = {}) =>
  h(EntityCard, {
    lead: h("span", { "data-lead": "" }),
    title: "Charts",
    description: "Draws charts from a table.",
    onOpen: () => undefined,
    ...props,
  });

const buttonNamed = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name);

describe("EntityCard", () => {
  it("opens the detail from its title, and an action press only runs the action", async () => {
    const onOpen = vi.fn();
    const onInstall = vi.fn();
    await mount(
      card({
        onOpen,
        actions: [
          h(EntityCardAction, {
            key: "install",
            glyph: ICONS.download,
            label: "Install",
            name: "Install charts",
            onClick: onInstall,
          }),
        ],
      }),
    );
    // The body is the card's first button, and the title is its text.
    const body = document.querySelector("button")!;
    expect(body.textContent).toContain("Charts");
    await click(body);
    expect(onOpen).toHaveBeenCalledTimes(1);

    await click(buttonNamed("Install charts")!);
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("draws no facts, tag or action line when it has none", async () => {
    const { container } = await mount(card());
    expect(container.textContent).toBe("ChartsDraws charts from a table.");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("puts extra attributes on the card itself", async () => {
    const { container } = await mount(
      h(EntityCard, {
        lead: null,
        title: "Charts",
        description: "Draws charts from a table.",
        onOpen: () => undefined,
        "data-plugin": "charts",
      } as EntityCardProps),
    );
    expect(container.firstElementChild?.getAttribute("data-plugin")).toBe("charts");
  });
});

describe("EntityCardAction", () => {
  it("takes no press and says it is busy while its request runs", async () => {
    const onClick = vi.fn();
    await mount(
      card({
        actions: [
          h(EntityCardAction, {
            key: "install",
            glyph: ICONS.download,
            label: "Installing…",
            name: "Installing charts",
            busy: true,
            onClick,
          }),
        ],
      }),
    );
    const action = buttonNamed("Installing charts")!;
    expect(action.disabled).toBe(true);
    expect(action.getAttribute("aria-busy")).toBe("true");
    await click(action);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is named by its word, which is also its tooltip, at every width", async () => {
    for (const words of ["wide", "always"] as const) {
      await mount(
        h(EntityCardAction, { glyph: ICONS.trash, label: "Uninstall", words, onClick: vi.fn() }),
      );
      const action = buttonNamed("Uninstall")!;
      expect(action.textContent).toBe("Uninstall");
      expect(action.getAttribute("data-tooltip")).toBe("Uninstall");
      expect(action.hasAttribute("data-tooltip-extra")).toBe(false);
      await unmountAll();
    }
  });

  it("takes a fuller name, and a hint as its marked tooltip", async () => {
    await mount(
      h(EntityCardAction, {
        glyph: ICONS.paperPlane,
        label: "Quick start",
        name: "Quick start charts",
        hint: "Opens a new chat that uses it",
        onClick: vi.fn(),
      }),
    );
    const action = buttonNamed("Quick start charts")!;
    expect(action.textContent).toBe("Quick start");
    expect(action.getAttribute("data-tooltip")).toBe("Opens a new chat that uses it");
    expect(action.hasAttribute("data-tooltip-extra")).toBe(true);
  });
});
