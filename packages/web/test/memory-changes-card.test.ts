/**
 * The memory-change card's header (features/chat/memory-changes-card.tsx), rendered to static
 * markup. The card's own brain mark leads it; a second brain glyph on the action would read as
 * a duplicate rather than as a way into the list.
 *
 * - With the Memory panel wired, the header opens the list through a text button (no tooltip,
 *   no glyph), and the brain mark stays the only one.
 * - With nothing to open, there is no action and still one mark.
 * - The action's words follow the UI language.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ICONS } from "@prismshadow/penguin-ui";
import { MemoryChangesCard } from "../src/features/chat/memory-changes-card";
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
const memoryMarks = (html: string) => html.split(`d="${ICONS.brain}"`).length - 1;

afterEach(() => {
  setActiveStrings(zh);
});

describe("MemoryChangesCard header", () => {
  it("opens the list through a text action, leaving the card's own brain mark the only one", () => {
    const html = render(() => {});
    expect(html).toMatch(
      new RegExp(`<button type="button"[^>]*>${S.chat.memoryOpenList}</button>`),
    );
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
    const html = render(() => {});
    expect(html).toContain(en.chat.memoryOpenList);
    expect(html).not.toContain(zh.chat.memoryOpenList);
  });
});
