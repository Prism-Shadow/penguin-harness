/**
 * How a list card opens its item's detail — the one rule every list page in the menu keeps.
 *
 * A click anywhere on a card's body opens the detail, and a click on a control inside the card —
 * one of its buttons, a link, a field — belongs to that control alone, so a card's own buttons
 * act on their own and never open the detail as well. The detail is a page of its own or a
 * dialog; either way the card's title is the keyboard's way in — a link to the page, or the
 * button that opens the dialog — and the card itself is no control: a control wrapped around
 * other controls hides them from assistive technology.
 *
 * The card decides, rather than each button stopping propagation: a button added to a card later
 * is a control the moment it renders, with nothing for its author to remember.
 */
import type { MouseEvent } from "react";

/** What a click inside a card can land on that has an action of its own. */
const CONTROL = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='menuitem']",
  "[role='option']",
  "[role='tab']",
].join(", ");

/** The part of a node the decision reads: an element in the app, a stand-in in a test. */
interface NodeLike {
  closest?: (selector: string) => unknown;
}

/** The part of a click the decision reads. */
export interface CardClick {
  target: unknown;
  currentTarget: { contains(node: never): boolean };
}

/** A drag that selected text inside the card was someone reading or copying, not a click to open. */
function selectingTextIn(card: CardClick["currentTarget"]): boolean {
  const selection = typeof getSelection === "function" ? getSelection() : null;
  if (selection === null || selection.isCollapsed || selection.anchorNode === null) return false;
  return card.contains(selection.anchorNode as never);
}

/**
 * Whether a click on a card landed on its body, which opens the detail. Not when it landed on a
 * control inside the card, and not when it only reached the card through a portal: a menu or a
 * dialog opened from inside a card renders under `document.body`, yet React still bubbles its
 * clicks up to the card.
 */
export function landsOnCardBody(event: CardClick): boolean {
  const card = event.currentTarget;
  const target = event.target as NodeLike | null;
  if (target === null || !card.contains(target as never)) return false;
  if (selectingTextIn(card)) return false;
  const control = typeof target.closest === "function" ? target.closest(CONTROL) : null;
  return control === null || !card.contains(control as never);
}

/**
 * The look of a card that opens something: the pointer, and a hover on the border alone — a
 * filled hover takes the neutral badges on the card (a version, a tag) into its own fill in
 * themes where the two are one colour.
 */
export const OPENS_DETAIL_CLASS =
  "cursor-pointer transition-colors duration-150 hover:border-line-emphasis";

/**
 * The card's click handler: a click on its body opens the detail — the page its title links to,
 * or the dialog its title button opens. The title stays the keyboard's way in.
 */
export function cardBodyClick(open: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if (landsOnCardBody(event)) open();
  };
}
