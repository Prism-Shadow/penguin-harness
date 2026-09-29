/**
 * The app window the hero stands over: its navigation state as a pure reducer, and its pages as
 * the modules' own compositions rather than markup of its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { en } from "../src/fixtures";
import { AppWindow } from "../src/hero";
import { SHELL_PAGE_VIEWS, pageTitle } from "../src/hero/pages";
import { SHELL_PAGES, SHELL_START, shellReducer } from "../src/hero/shell";
import type { ShellAction, ShellPage, ShellState } from "../src/hero/shell";
import { SIDEBAR_NAV } from "../src/screens/parts";
import { renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const run = (actions: readonly ShellAction[], from: ShellState = SHELL_START) =>
  actions.reduce(shellReducer, from);

describe("the app window's state", () => {
  it("opens on the chat, the first Session, the sidebar pinned and nothing typed", () => {
    expect(SHELL_START).toEqual({
      page: "chat",
      collapsed: false,
      session: 0,
      panel: 0,
      draft: "",
      sent: null,
      picker: false,
    });
  });

  it("switches pages, keeping the open Session, and closes the picker on the way", () => {
    const opened = run([
      { type: "session", index: 2 },
      { type: "picker", open: true },
    ]);
    expect(opened.picker).toBe(true);
    const away = shellReducer(opened, { type: "page", page: "plugins" });
    expect(away).toMatchObject({ page: "plugins", session: 2, picker: false });
    expect(shellReducer(away, { type: "page", page: "chat" })).toMatchObject({
      page: "chat",
      session: 2,
    });
    // The picker hangs off the chat's composer, so it opens nowhere else.
    expect(shellReducer(away, { type: "picker", open: true })).toBe(away);
  });

  it("opens a Session from any page, and ignores a row that is not in the list", () => {
    const onPage = run([{ type: "page", page: "models" }]);
    expect(shellReducer(onPage, { type: "session", index: 1 })).toMatchObject({
      page: "chat",
      session: 1,
    });
    expect(shellReducer(onPage, { type: "session", index: -1 })).toBe(onPage);
  });

  it("folds the sidebar to the rail and back, and a repeated fold changes nothing", () => {
    const rail = shellReducer(SHELL_START, { type: "collapse", collapsed: true });
    expect(rail.collapsed).toBe(true);
    expect(shellReducer(rail, { type: "collapse", collapsed: true })).toBe(rail);
    expect(shellReducer(rail, { type: "collapse", collapsed: false }).collapsed).toBe(false);
    // Folding is independent of where the reader is.
    const folded = run([
      { type: "page", page: "usage" },
      { type: "collapse", collapsed: true },
    ]);
    expect(folded).toMatchObject({ page: "usage", collapsed: true });
  });

  it("sends a prompt to the first Session and clears the draft, but never a blank one", () => {
    const written = run([
      { type: "page", page: "settings" },
      { type: "session", index: 2 },
      { type: "write", draft: "  Check the links  " },
    ]);
    expect(shellReducer(written, { type: "send", prompt: written.draft })).toMatchObject({
      page: "chat",
      session: 0,
      draft: "",
      sent: "Check the links",
    });
    const blank = run([{ type: "write", draft: "   " }]);
    expect(shellReducer(blank, { type: "send", prompt: blank.draft })).toBe(blank);
  });

  it("names every sidebar entry as a page", () => {
    for (const item of SIDEBAR_NAV) expect(SHELL_PAGES).toContain(item.key);
  });
});

describe("the app window's pages", () => {
  const PAGES = SHELL_PAGES.filter((page): page is Exclude<ShellPage, "chat"> => page !== "chat");

  it("each show a variant their module declares", () => {
    expect(Object.keys(SHELL_PAGE_VIEWS).sort()).toEqual([...PAGES].sort());
    for (const page of PAGES) {
      const view = SHELL_PAGE_VIEWS[page];
      expect(
        view.module.variants.map((variant) => variant.key),
        page,
      ).toContain(view.variant);
      expect(pageTitle(en, page).trim(), page).not.toBe("");
    }
  });

  it("render a module's composition, imported, and draw nothing of their own", () => {
    const source = readFileSync(join(SRC_DIR, "hero", "pages.tsx"), "utf8");
    const composition = /import \{ module as (\w+) \} from "\.\.\/modules\/[\w-]+\.module";/g;
    const imported = [...source.matchAll(composition)].map((match) => match[1]);
    const entries = [...source.matchAll(/^ {2}(\w+): \{ module: (\w+), variant: "[\w-]+"/gm)];
    expect(entries.map((match) => match[1]).sort()).toEqual([...PAGES].sort());
    for (const [, page, name] of entries) expect(imported, page).toContain(name);
    // The page view is a frame, a title and the composition: no list, table or control of its own.
    expect(source).toMatch(/view\.module\.render\(view\.variant/);
    expect(source).not.toMatch(/<(?:ul|ol|table|button|input|form|section|article)\b/);
  });

  it("each open in the window without throwing, and differ from one another", () => {
    const pages = SHELL_PAGES.map((page) =>
      renderStatic(createElement(AppWindow, { lang: "en", page })),
    );
    expect(new Set(pages).size).toBe(SHELL_PAGES.length);
    const empty = renderStatic(createElement(AppWindow, { lang: "zh", variant: "empty" }));
    expect(empty).toContain('class="ui-shell');
  });
});
