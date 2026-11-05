/**
 * The grouped list's rows (src/components/navigation/group-header/): the header's toggle, the
 * lazy folder with its "more" and "show less" rows, and the pager. The words a row says on its
 * own are the interface's (`UiStrings`); the app's sidebar keeps its own grouping logic.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  FolderSection,
  GroupHeader,
  MoreRow,
} from "../src/components/navigation/group-header/group-header";
import { Pager } from "../src/components/navigation/group-header/pager";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const zh = {
  ...DEFAULT_UI_STRINGS,
  expand: "展开",
  collapse: "折叠",
  more: "更多",
  fewer: "收起",
  loading: "加载中…",
  previous: "上一页",
  next: "下一页",
  pagePosition: (page: number, count: number) => `第 ${page} 页，共 ${count} 页`,
};
const inZh = (element: ReactElement) =>
  renderStatic(createElement(UiStringsProvider, { strings: zh }, element));

describe("GroupHeader", () => {
  const header = (open: boolean, uppercase: boolean) =>
    inZh(
      createElement(GroupHeader, {
        open,
        onToggle: () => {},
        icon: null,
        label: "Coder",
        uppercase,
        count: 3,
      }),
    );

  it("shows the full value behind its label on hover, marked as adding to the visible text", () => {
    // A workspace group is labelled by its directory's basename; the path is nowhere else on
    // screen, so its hint must open even when the basename fits.
    const html = inZh(
      createElement(GroupHeader, {
        open: true,
        onToggle: () => {},
        label: "penguin-harness",
        title: "/home/me/dev/penguin-harness",
      }),
    );
    expect(html).toContain('data-tooltip="/home/me/dev/penguin-harness"');
    expect(html).toContain('data-tooltip-content="text" data-tooltip-extra="true"');
    expect(header(true, false)).not.toContain("data-tooltip");
  });

  it("keeps the qualifier whole beside a label that gives way", () => {
    // Two machines can hold groups of the same name; the machine is what tells them apart, so a
    // narrow column cuts the label, never the qualifier after it.
    const html = inZh(
      createElement(GroupHeader, {
        open: true,
        onToggle: () => {},
        label: "Temporary workspaces",
        qualifier: "[SSH: box]",
      }),
    );
    const spanOf = (text: string) =>
      new RegExp(`<span class="([^"]*)">${text.replace(/[[\]]/g, "\\$&")}</span>`).exec(html)?.[1];
    expect(spanOf("Temporary workspaces")?.split(" ")).toContain("truncate");
    const qualifier = spanOf("[SSH: box]")?.split(" ");
    expect(qualifier).toContain("shrink-0");
    expect(qualifier).not.toContain("truncate");
  });

  it("names its toggle by what pressing it does, in the interface's words", () => {
    expect(header(true, false)).toContain('aria-expanded="true" aria-label="折叠"');
    expect(header(false, false)).toContain('aria-expanded="false" aria-label="展开"');
  });

  it("sets a group label on the eyebrow rung, and a name whose casing matters on the small one", () => {
    expect(classTokens(header(true, true))).toContain("ui-eyebrow");
    expect(classTokens(header(true, true))).not.toContain("uppercase");
    expect(classTokens(header(true, false))).not.toContain("ui-eyebrow");
  });

  it("draws a registry glyph as the header's decorative mark, in the subtle ink", () => {
    const html = inZh(
      createElement(GroupHeader, {
        open: true,
        onToggle: () => {},
        glyph: "M3 7h18",
        label: "repo",
      }),
    );
    expect(html).toMatch(
      /<svg [^>]*class="block shrink-0 ui-icon-decor text-fg-subtle" data-role="group"/,
    );
  });
});

describe("FolderSection and MoreRow", () => {
  it("say the interface's More and Show less where the caller counts nothing", () => {
    const html = inZh(
      createElement(
        FolderSection,
        { label: "Archived", open: true, onToggle: () => {}, more: true, less: true },
        "rows",
      ),
    );
    expect(html).toContain('aria-label="更多"');
    expect(html).toContain(">收起</button>");
    expect(html).toContain("rows");
  });

  it("folds its rows and its paging rows away together, through the shared fold", () => {
    const folder = (open: boolean) =>
      inZh(
        createElement(
          FolderSection,
          { label: "Archived", open, onToggle: () => {}, more: true },
          createElement("ul", null, "rows"),
        ),
      );
    expect(folder(true)).toContain(
      'data-fold="settled" class="grid"><div class="min-h-0 min-w-0"><ul>',
    );
    const folded = folder(false);
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).not.toContain("rows");
    expect(folded).not.toContain('aria-label="更多"');
  });

  it("disables a pending row and shows the loading label in place of its text", () => {
    const html = inZh(
      createElement(MoreRow, { label: "Show 7 more", pending: true, onClick: () => {} }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("加载中…");
    expect(html).not.toContain("Show 7 more");
  });
});

describe("Pager", () => {
  const pager = (page: number, variant?: "labelled") =>
    inZh(
      createElement(Pager, {
        page,
        pageCount: 5,
        onChange: () => {},
        ...(variant !== undefined
          ? { variant, previousLabel: "Newer", nextLabel: "Older", readout: "Page 1 / 5" }
          : {}),
      }),
    );

  it("reads its position aloud and names its glyph steps in the interface's words", () => {
    const html = pager(1);
    expect(html).toContain('aria-live="polite" aria-label="第 2 页，共 5 页"');
    expect(html).toContain(">2/5</span>");
    expect(html).toContain('aria-label="上一页"');
    expect(html).toContain('aria-label="下一页"');
  });

  it("disables the step that would go nowhere", () => {
    expect(pager(0).match(/disabled=""/g)).toHaveLength(1);
    expect(pager(4).match(/disabled=""/g)).toHaveLength(1);
    expect(pager(2)).not.toMatch(/disabled=""/);
  });

  it("labels its steps with the caller's words in the labelled look", () => {
    const html = pager(0, "labelled");
    expect(html).toContain(">Newer</button>");
    expect(html).toContain(">Older</button>");
    expect(html).toContain(">Page 1 / 5</span>");
    expect(html).not.toContain("data-tooltip");
  });
});
