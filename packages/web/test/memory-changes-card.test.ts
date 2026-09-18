/**
 * The memory-change card's header (src/features/chat/memory-changes-card.tsx): the card's
 * own brain mark leads it, and the action that opens the Memory panel on its list is words.
 * A second brain glyph there reads as a duplicate of the first rather than as a way into the
 * list, so the header carries exactly one memory mark whether or not the action is wired.
 *
 * react-dom/server static markup (node env, no DOM), as message-stream.test.ts renders.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryChangesCard } from "../src/features/chat/memory-changes-card";
import { MEMORY_ICON } from "../src/components/ui/icons";
import type { MemoryChangeRow } from "../src/lib/omni/memory-changes";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const ROWS: MemoryChangeRow[] = [
  { scope: "user", file: "prefs.md", op: "write" },
  { scope: "workspace", scopeKey: "ws-1a2b", file: "conventions.md", op: "edit" },
];

const render = (onOpenPanel?: () => void) =>
  renderToStaticMarkup(
    createElement(MemoryChangesCard, {
      rows: ROWS,
      onLocateChange: () => {},
      ...(onOpenPanel ? { onOpenPanel } : {}),
    }),
  );

/** How many times the brain mark is drawn in the markup. */
const memoryMarks = (html: string) => html.split(`d="${MEMORY_ICON}"`).length - 1;

afterEach(() => {
  setActiveStrings(zh);
});

describe("MemoryChangesCard header", () => {
  it("opens the list through a text action, leaving the card's own brain mark the only one", () => {
    const html = render(() => {});
    expect(html).toMatch(/<button type="button"[^>]*>打开记忆列表<\/button>/);
    expect(memoryMarks(html)).toBe(1);
  });

  it("names the action in words the button shows, with no tooltip and no glyph beside them", () => {
    const html = render(() => {});
    // The header's action is the card's first button. Matched whole — attributes and content —
    // rather than pinned to the label, so a glyph creeping back inside it cannot make the
    // assertions below pass on a string that matched nothing.
    const action = html.match(/<button[\s\S]*?<\/button>/)?.[0] ?? null;
    expect(action).not.toBeNull();
    expect(action).toContain(S.chat.memoryOpenList);
    expect(action).not.toContain("title=");
    expect(action).not.toContain("<svg");
  });

  it("keeps the one mark and draws no action when nothing opens the panel", () => {
    const html = render();
    expect(html).not.toContain(S.chat.memoryOpenList);
    expect(memoryMarks(html)).toBe(1);
  });

  it("follows the UI language", () => {
    setActiveStrings(en);
    expect(render(() => {})).toMatch(/<button type="button"[^>]*>Open memory list<\/button>/);
  });
});
