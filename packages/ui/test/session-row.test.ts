/**
 * The sidebar's conversation row and its hover actions (src/components/shell/session-row/): a
 * button that opens the conversation, the title drawn by the caller in the row's ink, marks that
 * each name themselves, one reserved box for the live state, and a trailing slot whose time gives
 * way to the hover actions. The row's menu mounts only while open, which a static render never
 * is; what its wiring must keep doing on a real page is session-row.dom.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { NAV_FILL } from "../src/components/navigation/nav-list/nav-list";
import { RowHoverActions, SessionRow } from "../src/components/shell/session-row/session-row";
import type { SessionRowProps } from "../src/components/shell/session-row/session-row";
import { classTokens, renderStatic, markupStructure } from "../src/testing";
import { elementsOf, readMarkup } from "./helpers/markup";

const action = (id: string, label: string, danger = false) => ({
  id,
  label,
  glyph: ICONS.archive,
  danger,
  onSelect: () => {},
});

const row = (props: Partial<SessionRowProps> = {}) =>
  renderStatic(
    createElement(SessionRow, {
      sessionId: "s-1",
      renderTitle: (className: string) => createElement("span", { className }, "Fix the build"),
      time: "3 分钟前",
      hoverActions: [action("archive", "归档")],
      menuActions: [action("rename", "重命名"), action("delete", "删除", true)],
      moreLabel: "更多",
      onOpen: () => {},
      ...props,
    }),
  );

describe("SessionRow", () => {
  it("is a list item whose button opens the conversation, under the title-reveal hook", () => {
    const html = row();
    expect(html).toMatch(/^<li class="[^"]*">/);
    expect(html).toContain('data-title-reveal="true"');
    expect(html).toContain('data-testid="session-row" data-session-id="s-1"');
  });

  it("fills the open row with the column's selected wash and the others with its hover", () => {
    expect(classTokens(row({ active: true }))).toContain(NAV_FILL.selected);
    expect(classTokens(row())).toContain(NAV_FILL.hover);
    expect(classTokens(row())).not.toContain(NAV_FILL.selected);
  });

  it("marks the open row's button as the current page, and no other row", () => {
    const button = elementsOf(readMarkup(row({ active: true }))).find(
      (e) => e.attrs["data-testid"] === "session-row",
    );
    expect(button?.attrs["aria-current"]).toBe("page");
    expect(row()).not.toContain("aria-current");
  });

  it("names every standing mark in words, from the caller's labels", () => {
    const html = row({
      sourceGlyph: ICONS.terminalPrompt,
      sourceLabel: "CLI",
      pinnedLabel: "已置顶",
      relayLabel: "飞书远程控制",
      scheduledLabel: "定时任务",
      background: { count: 2, label: "2 个后台任务" },
      approvals: { count: 3, label: "3 个待审批" },
      agent: { id: "coder", name: "Coder" },
    });
    expect(markupStructure(html)).toContain('<span data-tooltip="CLI">');
    expect(html).toContain('<span class="sr-only">CLI</span>');
    expect(html).toContain('<span class="sr-only">已置顶</span>');
    expect(html).toContain('<span class="sr-only">飞书远程控制</span>');
    expect(html).toContain('<span class="sr-only">Coder</span>');
    expect(html).toContain('role="img" aria-label="定时任务"');
    expect(html).toContain('role="img" aria-label="2 个后台任务"');
    expect(html).toMatch(
      /data-tooltip="3 个待审批" class="[^"]*tabular-nums text-tone-attention-fg"><span aria-hidden="true">3<\/span><span class="sr-only">3 个待审批<\/span>/,
    );
  });

  it("draws a source mark only when it has both a glyph and its words", () => {
    // A mark is the subtle-ink span after the title; neither half alone draws one.
    expect(row({ sourceLabel: "API" })).not.toContain("API");
  });

  it("draws no background mark and no approval count at zero", () => {
    const html = row({
      background: { count: 0, label: "0 个后台任务" },
      approvals: { count: 0, label: "0 个待审批" },
    });
    expect(html).not.toContain("0 个后台任务");
    expect(html).not.toContain("0 个待审批");
  });

  it("keeps the live state's box whether or not it holds a glyph", () => {
    expect(markupStructure(row())).toContain('<span aria-hidden="true"></span>');
    const running = row({ activity: { state: "running", label: "运行中" } });
    expect(running).toContain('role="status" aria-label="运行中"');
  });

  it("shows the time in the reader's language", () => {
    expect(row()).toContain(">3 分钟前</span>");
  });

  it("offers the hover actions and the menu's pointer entry, never the menu rows while closed", () => {
    const html = row();
    expect(html).toContain('aria-label="归档"');
    expect(html).toContain('aria-label="更多" aria-haspopup="menu"');
    expect(html).not.toContain("重命名");
  });

  it("drags only under manual order, with the drop line on the edge it would land on", () => {
    expect(row()).not.toContain('draggable="true"');
    const dragged = row({ draggable: true, dropEdge: "below" });
    expect(dragged).toMatch(/^<li class="[^"]*" draggable="true">/);
  });
});

describe("RowHoverActions", () => {
  const html = renderStatic(
    createElement(RowHoverActions, {
      actions: [action("archive", "Archive"), action("delete", "Delete", true)],
      moreLabel: "More",
      onMore: () => {},
    }),
  );

  it("names each button", () => {
    expect(html).toContain('data-tooltip="Archive" aria-label="Archive"');
    expect(html).toContain('data-tooltip="More" aria-label="More" aria-haspopup="menu"');
  });

  // A named guard, kept by decision: the hidden buttons' tap gate lives in these classes alone,
  // and without it a tap on a row's hidden trailing edge archives or deletes on a touch screen.
  it("gates taps exactly as it gates sight, on hover and on focus", () => {
    expect(classTokens(html)).toEqual(
      expect.arrayContaining([
        "pointer-events-none",
        "group-hover:pointer-events-auto",
        "focus:pointer-events-auto",
      ]),
    );
  });
});
