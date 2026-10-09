/**
 * How a list card opens its item's detail — the one rule every list page in the menu keeps.
 *
 * A click anywhere on a card's body opens the detail, and a click on a control inside the card —
 * one of its buttons, a link, a field — belongs to that control alone, so a card's own buttons
 * act on their own and never open the detail as well. The detail is either a page of its own
 * (`pageCardProps`: the whole card is a link to it) or a dialog (`dialogCardClick`: the card's
 * main button opens it, and the rest of the body follows that button).
 *
 * The card decides, rather than each button stopping propagation: a button added to a card later
 * is a control the moment it renders, with nothing for its author to remember.
 */
import type { KeyboardEvent, MouseEvent } from "react";

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
  // A page card carries the link role itself, so reaching the card is reaching its body.
  return control === null || control === card || !card.contains(control as never);
}

/**
 * The look of a card that opens something: the pointer, the keyboard ring a link wears, and a
 * hover on the border alone — a filled hover takes the neutral badges on the card (a version, a
 * tag) into its own fill in themes where the two are one colour.
 */
export const OPENS_DETAIL_CLASS =
  "cursor-pointer transition-colors duration-150 hover:border-line-emphasis focus-visible:[outline:var(--ui-focus-ring)] focus-visible:[outline-offset:var(--ui-focus-ring-offset)]";

/**
 * Makes a whole card the link to its item's own page: a click on its body, or Enter while the
 * card itself has focus, opens it. `label` names the link — the item's name; without it the link
 * would be named by every word on the card, its buttons included.
 */
export function pageCardProps(open: () => void, label: string) {
  return {
    role: "link" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (landsOnCardBody(event)) open();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // Enter on a button inside the card presses that button; only the card's own focus opens it.
      if (event.key !== "Enter" || event.target !== event.currentTarget) return;
      event.preventDefault();
      open();
    },
  };
}

/**
 * A card whose detail is a dialog. Its main button opens the dialog and is the keyboard's way in;
 * this handler, on the card, lets a click anywhere else on the body open it too.
 */
export function dialogCardClick(open: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if (landsOnCardBody(event)) open();
  };
}
