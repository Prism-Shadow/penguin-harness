/**
 * An Agent's card is the link to the Agent's settings page, a full page of its own
 * (features/agents/agents-page.tsx `AgentCardLink`, on the rule in lib/card-open.ts).
 *
 * - A click anywhere on the card's body opens the Agent's settings page.
 * - Enter while the card itself has focus opens it too; Enter on a button inside the card presses
 *   that button and opens nothing.
 * - A click on a control inside the card — its Delete button here — is that control's alone.
 * - A click that only reaches the card through a portal, such as the confirmation Delete opens,
 *   opens nothing.
 * - A drag that selected text on the card opens nothing.
 * - An Agent that lives only on a machine has no settings page on this server: its card is no link.
 *
 * vitest runs node-only here, so the card is called as a function and its handlers are handed
 * clicks as a browser delivers them, landing on stand-in elements (test/helpers/dom.ts).
 */
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@prismshadow/penguin-ui";
import { AgentCardLink } from "../src/features/agents/agents-page";
import { S } from "../src/lib/strings";
import { clickOn, fakeElement, keyOn } from "./helpers/dom";

type CardProps = {
  role?: string;
  "aria-label"?: string;
  onClick?: (event: never) => void;
  onKeyDown?: (event: never) => void;
};

/** The card with one Delete button inside, as the list draws a deletable Agent's. */
function card(onOpen: (() => void) | null, onDelete = vi.fn()) {
  const element = AgentCardLink({
    name: "Report writer",
    onOpen,
    children: createElement(
      Button,
      { size: "icon", "aria-label": S.agent.deleteAgent, onClick: onDelete },
      "×",
    ),
  }) as ReactElement<CardProps & { children: ReactNode }>;
  const [deleteButton] = ([] as ReactNode[])
    .concat(element.props.children)
    .filter(isValidElement) as ReactElement<{ onClick: () => void }>[];
  return { element, props: element.props, deleteButton: deleteButton!, onDelete };
}

/** The card's box and what lies inside it: the body's text, and the Delete button. */
function layout() {
  const box = fakeElement("div", { role: "link", tabindex: "0" });
  const description = fakeElement("p", {}, box);
  const button = fakeElement("button", { type: "button" }, box);
  const glyph = fakeElement("svg", {}, button);
  return { box, description, button, glyph };
}

describe("an Agent's card", () => {
  it("a click anywhere on its body opens the Agent's settings page", () => {
    const onOpen = vi.fn();
    const { props } = card(onOpen);
    const { box, description } = layout();
    props.onClick!(clickOn(description, box));
    props.onClick!(clickOn(box, box));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(props.role).toBe("link");
    expect(props["aria-label"]).toBe("Report writer");
  });

  it("Enter on the focused card opens it; Enter on a button inside it presses only the button", () => {
    const onOpen = vi.fn();
    const { props } = card(onOpen);
    const { box, button } = layout();
    const onCard = keyOn("Enter", box, box);
    props.onKeyDown!(onCard.event);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onCard.prevented()).toBe(true);

    props.onKeyDown!(keyOn("Enter", button, box).event);
    props.onKeyDown!(keyOn(" ", box, box).event);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("a click on its Delete button deletes and opens nothing", () => {
    const onOpen = vi.fn();
    const { props, deleteButton, onDelete } = card(onOpen);
    const { box, glyph } = layout();
    // The browser runs the button's handler, then the card's with the click's own target.
    deleteButton.props.onClick();
    props.onClick!(clickOn(glyph, box));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a click that reaches the card through a portal opens nothing", () => {
    const onOpen = vi.fn();
    const { props } = card(onOpen);
    const { box } = layout();
    // A dialog opened from the card renders under the document body, outside the card's box.
    const dialogText = fakeElement("p", {}, fakeElement("div", { role: "dialog" }));
    props.onClick!(clickOn(dialogText, box));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a drag that selected text on the card opens nothing", () => {
    const onOpen = vi.fn();
    const { props } = card(onOpen);
    const { box, description } = layout();
    vi.stubGlobal("getSelection", () => ({ isCollapsed: false, anchorNode: description }));
    props.onClick!(clickOn(description, box));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("an Agent that lives only on a machine has no settings page here: its card is no link", () => {
    const { props } = card(null);
    expect(props.role).toBeUndefined();
    expect(props.onClick).toBeUndefined();
    expect(props.onKeyDown).toBeUndefined();
  });
});
