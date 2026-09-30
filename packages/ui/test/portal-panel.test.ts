/**
 * The portal panel's scroll rule (src/components/overlays/portal-panel/use-portal-panel.ts).
 *
 * An anchored panel — a Select's list, an InfoPopover, the app's context menu — dismisses once
 * the content under its anchor moves, but the listener that decides this is capture-phase, and
 * therefore hears every scroller in the document. The reported failure was a Session row's menu
 * that "kept getting wiped": while a conversation streams, the message list scrolls itself on
 * every chunk, and each of those scrolls was closing a menu opened in the sidebar.
 *
 * The hook's wiring (that each consumer attaches `triggerRef`, that `onScroll` asks the rule) is
 * pinned by the web app's `portal-panel-dismiss.test.ts`, which scans both roots.
 */
import { describe, expect, it } from "vitest";
import { scrollMovesAnchor } from "../src/components/overlays/portal-panel/use-portal-panel";

describe("scrollMovesAnchor", () => {
  /** A stand-in for a DOM node, implementing the containment the rule reads off one. */
  interface FakeNode {
    parent: FakeNode | null;
    contains: (n: FakeNode | null) => boolean;
  }
  /** `contains` is inclusive, exactly as the DOM's is: a node contains itself. */
  const node = (parent: FakeNode | null): FakeNode => {
    const self: FakeNode = {
      parent,
      contains: (n) => {
        for (let at = n; at !== null; at = at.parent) if (at === self) return true;
        return false;
      },
    };
    return self;
  };
  // The suite is node-only, so the rule is fed stand-ins rather than real elements; it
  // reads nothing off a node but `contains`, which is what these implement.
  const asNode = (n: FakeNode) => n as unknown as Node;

  // The page as the bug found it: a sidebar that scrolls its Session list, a chat pane
  // that scrolls its messages, and no relation between the two but the document.
  const doc = node(null);
  const sidebarScroller = node(doc);
  const row = node(sidebarScroller);
  const messageList = node(doc);

  it("ignores a scroll in an unrelated container, so streaming output leaves the menu open", () => {
    expect(scrollMovesAnchor(asNode(messageList), asNode(row))).toBe(false);
  });

  it("dismisses when the container holding the anchored row scrolls", () => {
    expect(scrollMovesAnchor(asNode(sidebarScroller), asNode(row))).toBe(true);
  });

  it("dismisses when the anchored row is itself what scrolled", () => {
    expect(scrollMovesAnchor(asNode(row), asNode(row))).toBe(true);
  });

  it("dismisses on a page-level scroll, which targets the document and needs no case of its own", () => {
    expect(scrollMovesAnchor(asNode(doc), asNode(row))).toBe(true);
  });

  it("dismisses on any scroll when the caller names no owner, as anchored panels always did", () => {
    expect(scrollMovesAnchor(asNode(messageList), null)).toBe(true);
  });
});
