/**
 * What the workbench has to say when the thing the user asked about is outside what L1 promised
 * (PRD §9.4's honesty list, M4.4).
 *
 * §9.4 does not promise to pierce a shadow root, to look inside a frame, or to edit a dependency, and
 * §2.3 says the user must be *told* rather than quietly handed a neighbour. The DOM half already
 * carries what is needed to tell: the picker marks an element it could not reach into
 * (`domContext`, `element-picker.ts`), the payload carries the element's own box and computed style,
 * and the page can be asked how many frames it embeds.
 *
 * The three facts are turned into *reasons* here, not sentences: the copy lives in the strings tables
 * and both languages key off the same reason, exactly as `source-tier.ts` does for the source half.
 * Nothing in this module reads the DOM, so a test can state the whole matrix as data.
 */
import type { DomContext, ElementFacts } from "./element-picker";

/**
 * Why the element the panel is holding cannot be seen on the page right now.
 *
 * The first three are styles that make an element invisible; the fourth is a box with no area. All
 * four are read from values the payload itself carries, so the question can be asked again later
 * without re-reading the page — and, more to the point, so what the panel says and what the message
 * carries cannot disagree.
 */
export type VisibilityIssue = "display-none" | "visibility-hidden" | "opacity-zero" | "zero-size";

/**
 * One line of §9.4's matrix that applies to what the panel is looking at. Ordered as the panel should
 * read them: about the picked element first, then about the page as a whole.
 */
export type BoundsNote =
  | { kind: "shadow" }
  | { kind: "frame" }
  | { kind: "not-visible"; reason: VisibilityIssue }
  | { kind: "frames-in-page"; count: number };

/**
 * Whether the element's own facts say it cannot be seen. Deliberately narrow: `display: none` and
 * `visibility: hidden` elements are not hit-testable, so in practice these come from a re-read after
 * the page changed (or from an element that only *looks* invisible — `opacity: 0` is still clickable).
 * Reporting the box rather than guessing the cause is the point: an element 0 pixels tall is a fact,
 * "the user has not opened the dropdown yet" is not something this can know.
 */
export function visibilityIssue(
  target: Pick<ElementFacts, "rect" | "computed">,
): VisibilityIssue | null {
  const display = target.computed["display"];
  if (display === "none") return "display-none";
  const visibility = target.computed["visibility"];
  if (visibility === "hidden" || visibility === "collapse") return "visibility-hidden";
  if (target.computed["opacity"] === "0") return "opacity-zero";
  if (target.rect.width === 0 || target.rect.height === 0) return "zero-size";
  return null;
}

export interface BoundsInput {
  /** The element the panel is showing, if any — its context and its own style facts. */
  target: Pick<ElementFacts, "domContext" | "rect" | "computed"> | null;
  /** Whether the user is picking right now; the page-level line is only worth saying while they are. */
  picking: boolean;
  /** Frames the page embeds, as the page reported them; `null` while nobody has asked. */
  frameCount: number | null;
}

/**
 * The lines that apply, in reading order. A frame the user selected and frames the page merely
 * contains are different statements — one is about the element in hand, the other is a warning issued
 * before they go hunting — so both can appear, and neither replaces the other.
 */
export function boundsNotes(input: BoundsInput): BoundsNote[] {
  const notes: BoundsNote[] = [];
  const target = input.target;
  if (target !== null) {
    const context: DomContext | undefined = target.domContext;
    if (context === "shadow") notes.push({ kind: "shadow" });
    if (context === "frame") notes.push({ kind: "frame" });
    const issue = visibilityIssue(target);
    if (issue !== null) notes.push({ kind: "not-visible", reason: issue });
  }
  if (input.picking && input.frameCount !== null && input.frameCount > 0) {
    notes.push({ kind: "frames-in-page", count: input.frameCount });
  }
  return notes;
}
