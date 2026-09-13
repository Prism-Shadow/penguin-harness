/**
 * Element chips and the page they came from, brought back together at send time (M4.1, AC-8).
 *
 * A chip is staged with a **snapshot**: the payload as the page was the moment the user picked the
 * element. By the time the message goes out the page may have been edited — a dev server reloading
 * after a save is the normal state of affairs, not an edge case — and sending that snapshot as-is
 * hands the Agent a line number the element has since moved off, or a style that no longer exists.
 * So every element chip is re-resolved against the page the panel is showing, immediately before the
 * message is composed: **what the message carries is what the page says now**.
 *
 * The two halves live in different components and this is the seam between them: the workbench panel
 * owns the guest (the only thing that can answer), the composer owns the chips (the only thing that
 * knows what is about to be sent). Nothing in this file knows about React, the DOM or the network —
 * a source is a function, so the rule is testable without either.
 *
 * A chip that cannot be re-resolved is **not** quietly sent: `gone` is reported to the caller, which
 * is what lets the composer hold the message and the panel say so. A chip that could not be *checked*
 * (no preview open, or the chip came from another page) is reported as such and keeps its snapshot —
 * the one thing never done here is claiming a freshness that was not measured.
 */
import type { ComposerReference } from "../../lib/workspace-tree";

/** Why a staged element no longer counts as the thing the user picked. */
export type ElementGoneReason =
  /** The page has no node matching the recorded path any more. */
  | "missing"
  /** Something is at that path, but it is not that element (another tag, another `data-testid`). */
  | "replaced"
  /** The preview is pointed at another page now: this chip belongs to the one that went away. */
  | "page-changed";

/** What one re-resolution of a staged element came back with. */
export type ElementRefresh =
  /** The element, as the page has it now. `moved` = it is the same element at a different place. */
  | { kind: "refreshed"; reference: ComposerReference; moved: boolean }
  /** The page no longer has it, or what is there is not it. */
  | { kind: "gone"; reason: ElementGoneReason }
  /** This source cannot answer — no preview, no picker, or a `refId` that is not its own. */
  | { kind: "unknown" };

export interface ElementSource {
  /** Re-read one staged element from the page as it is now. */
  refresh: (refId: string) => Promise<ElementRefresh>;
}

const sources = new Set<ElementSource>();

/**
 * Register the thing that can answer for a staged element. The panel registers itself while it is
 * mounted and unregisters on unmount; the returned function is the unregister.
 *
 * A set rather than one slot because nothing forbids two workbench panels existing in the app at
 * once, and the first source that can answer wins — a chip whose element lives in the other panel's
 * page comes back `unknown` from this one, not an error.
 */
export function registerElementSource(source: ElementSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** The first source that can answer, or `unknown` when none can. Never throws. */
export async function refreshElementReference(refId: string): Promise<ElementRefresh> {
  for (const source of [...sources]) {
    const result = await source.refresh(refId).catch((): ElementRefresh => ({ kind: "unknown" }));
    if (result.kind !== "unknown") return result;
  }
  return { kind: "unknown" };
}

export interface ReferencesRefresh {
  /** The draft's references, with every element chip replaced by its freshly resolved self. */
  references: ComposerReference[];
  /** The elements the page no longer has — reported, never silently dropped. */
  gone: { label: string; reason: ElementGoneReason }[];
  /** How many were re-resolved (a moved line, a restyled element, a new id all count as one). */
  refreshed: number;
  /** How many could not be checked at all; those keep the snapshot they were staged with. */
  unchecked: number;
}

/**
 * Re-resolve every element chip in a draft, in place and in order.
 *
 * File, directory and quote chips are not touched: a path means the same thing at send time as it did
 * when it was staged, and there is nothing in a page to ask about it. An element chip with no `refId`
 * is left alone too — it cannot be looked up, and inventing an answer is not on the table.
 */
export async function refreshElementReferences(
  references: readonly ComposerReference[],
): Promise<ReferencesRefresh> {
  const next: ComposerReference[] = [];
  const gone: { label: string; reason: ElementGoneReason }[] = [];
  let refreshed = 0;
  let unchecked = 0;
  for (const reference of references) {
    if (reference.kind !== "element" || reference.refId === undefined) {
      next.push(reference);
      continue;
    }
    const result = await refreshElementReference(reference.refId);
    switch (result.kind) {
      case "unknown":
        unchecked += 1;
        next.push(reference);
        break;
      case "gone":
        gone.push({ label: reference.label ?? reference.refId, reason: result.reason });
        // Kept, and marked: dropping the user's chip for them would hide the one thing they have to
        // act on, and sending it unmarked is what this whole path exists to prevent.
        next.push({ ...reference, stale: true });
        break;
      case "refreshed":
        refreshed += 1;
        next.push(result.reference);
        break;
    }
  }
  return { references: next, gone, refreshed, unchecked };
}
