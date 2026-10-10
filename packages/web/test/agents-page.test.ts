/**
 * An Agent's card opens the Agent's settings page, a full page of its own
 * (features/agents/agents-page.tsx `AgentCard` and `AgentNameLink`, on the rule in
 * lib/card-open.ts).
 *
 * - A click anywhere on the card's body opens the Agent's settings page.
 * - The card itself is no control: no link role, no tab stop, no label hiding what it holds.
 * - The Agent's name is a link to that page — the keyboard's way in, with a real address — and
 *   following it also makes the Agent the current one.
 * - A click on a control inside the card — the name's link, its Delete button — is that control's
 *   alone: the card does not open the page as well.
 * - A click that only reaches the card through a portal, such as the confirmation Delete opens,
 *   opens nothing.
 * - A drag that selected text on the card opens nothing.
 * - An Agent that lives only on a machine has no settings page on this server: its card opens
 *   nothing and its name is plain text.
 *
 * vitest runs node-only here, so the card is called as a function and its handler is handed
 * clicks as a browser delivers them, landing on stand-in elements (test/helpers/fake-dom.ts); the
 * name's link is rendered to static markup inside a router.
 */
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@prismshadow/penguin-ui";
import { AgentCard, AgentNameLink } from "../src/features/agents/agents-page";
import { S } from "../src/lib/strings";
import { clickOn, fakeElement } from "./helpers/fake-dom";

type CardProps = Record<string, unknown> & { onClick?: (event: never) => void };

/** The card with one Delete button inside, as the list draws a deletable Agent's. */
function card(onOpen: (() => void) | null, onDelete = vi.fn()) {
  const element = AgentCard({
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
  return { props: element.props, deleteButton: deleteButton!, onDelete };
}

/** The card's box and what lies inside it: the body's text, the name's link, the Delete button. */
function layout() {
  const box = fakeElement("div");
  const description = fakeElement("p", {}, box);
  const name = fakeElement("a", { href: "/agents/report_writer" }, box);
  const button = fakeElement("button", { type: "button" }, box);
  const glyph = fakeElement("svg", {}, button);
  return { box, description, name, button, glyph };
}

const nameLink = (onFollow: (() => void) | null) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(AgentNameLink, { agentId: "report_writer", name: "Report writer", onFollow }),
    ),
  );

describe("an Agent's card", () => {
  it("a click anywhere on its body opens the Agent's settings page", () => {
    const onOpen = vi.fn();
    const { props } = card(onOpen);
    const { box, description } = layout();
    props.onClick!(clickOn(description, box));
    props.onClick!(clickOn(box, box));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("is no control itself: no link role, no tab stop, no label hiding what it holds", () => {
    const { props } = card(vi.fn());
    expect(props.role).toBeUndefined();
    expect(props.tabIndex).toBeUndefined();
    expect(props["aria-label"]).toBeUndefined();
  });

  it("has the Agent's name as a link to its settings page, which also makes it current", () => {
    const html = nameLink(() => undefined);
    expect(html).toMatch(/<a [^>]*href="\/agents\/report_writer"[^>]*>Report writer<\/a>/);
    const onFollow = vi.fn();
    const link = AgentNameLink({ agentId: "report_writer", name: "Report writer", onFollow });
    (link.props as { onClick: () => void }).onClick();
    expect(onFollow).toHaveBeenCalledOnce();
  });

  it("leaves a click on its name's link or on its Delete button to that control alone", () => {
    const onOpen = vi.fn();
    const { props, deleteButton, onDelete } = card(onOpen);
    const { box, name, glyph } = layout();
    // The browser runs the control's handler, then the card's with the click's own target.
    props.onClick!(clickOn(name, box));
    deleteButton.props.onClick();
    props.onClick!(clickOn(glyph, box));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens nothing for a click that reaches it through a portal", () => {
    const onOpen = vi.fn();
    const { props } = card(onOpen);
    const { box } = layout();
    // A dialog opened from the card renders under the document body, outside the card's box.
    const dialogText = fakeElement("p", {}, fakeElement("div", { role: "dialog" }));
    props.onClick!(clickOn(dialogText, box));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens nothing at the end of a drag that selected text on it", () => {
    const onOpen = vi.fn();
    const { props } = card(onOpen);
    const { box, description } = layout();
    vi.stubGlobal("getSelection", () => ({ isCollapsed: false, anchorNode: description }));
    props.onClick!(clickOn(description, box));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens nothing for an Agent that lives only on a machine, whose name is plain text", () => {
    const { props } = card(null);
    expect(props.onClick).toBeUndefined();
    const html = nameLink(null);
    expect(html).not.toContain("<a ");
    expect(html).toContain("Report writer");
  });
});
