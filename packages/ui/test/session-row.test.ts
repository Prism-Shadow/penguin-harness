/**
 * The sidebar's conversation row and its hover actions (src/components/shell/session-row/): a
 * button that opens the conversation, the title drawn by the caller in the row's ink, marks that
 * each name themselves, one reserved box for the live state, and a trailing slot whose time gives
 * way to the hover actions. The row's menu mounts only while open, which a static render never
 * is; what its wiring must keep doing is pinned against the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { NAV_FILL } from "../src/components/navigation/nav-list/nav-list";
import { RowHoverActions, SessionRow } from "../src/components/shell/session-row/session-row";
import type { SessionRowProps } from "../src/components/shell/session-row/session-row";
import { classTokens, renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const SOURCE = readFileSync(join(SRC_DIR, "components/shell/session-row/session-row.tsx"), "utf8");

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
    expect(html).toMatch(/^<li class="relative">/);
    expect(html).toContain('data-title-reveal="true"');
    expect(html).toContain('data-testid="session-row" data-session-id="s-1"');
  });

  it("hands the title its ink: medium on the open row, subtle when archived, near-full at rest", () => {
    expect(row({ active: true })).toContain(
      'class="min-w-0 flex-1 font-sans text-sm font-medium text-fg"',
    );
    expect(row({ archived: true })).toContain(
      'class="min-w-0 flex-1 font-sans text-sm text-fg-subtle"',
    );
    expect(row()).toContain('class="min-w-0 flex-1 font-sans text-sm text-fg/80"');
  });

  it("fills the open row with the column's selected wash and the others with its hover", () => {
    expect(classTokens(row({ active: true }))).toContain(NAV_FILL.selected);
    expect(classTokens(row())).toContain(NAV_FILL.hover);
    expect(classTokens(row())).not.toContain(NAV_FILL.selected);
  });

  it("names every standing mark in words, from the caller's labels", () => {
    const html = row({
      pinnedLabel: "已置顶",
      relayLabel: "飞书远程控制",
      scheduledLabel: "定时任务",
      background: { count: 2, label: "2 个后台任务" },
      approvals: { count: 3, label: "3 个待审批" },
      agent: { id: "coder", name: "Coder" },
    });
    expect(html).toContain('<span class="sr-only">已置顶</span>');
    expect(html).toContain('<span class="sr-only">飞书远程控制</span>');
    expect(html).toContain('<span class="sr-only">Coder</span>');
    expect(html).toContain('role="img" aria-label="定时任务"');
    expect(html).toContain('role="img" aria-label="2 个后台任务"');
    expect(html).toMatch(
      /data-tooltip="3 个待审批" class="[^"]*tabular-nums text-tone-attention-fg">3</,
    );
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
    expect(row()).toContain('<span aria-hidden="true" class="block h-3 w-3 shrink-0"></span>');
    const running = row({ activity: { state: "running", label: "运行中" } });
    expect(running).toContain('role="status" aria-label="运行中"');
    expect(running).not.toContain("block h-3 w-3 shrink-0");
  });

  it("reserves a trailing slot per language, its time on the small rung", () => {
    expect(classTokens(row())).toContain("w-14");
    expect(classTokens(row({ timeSlot: "wide" }))).toContain("w-[4.5rem]");
    const tokens = classTokens(row());
    expect(tokens).toContain("text-xs");
    expect(tokens).not.toContain("text-[11px]");
    expect(row()).toContain(">3 分钟前</span>");
    expect(row({ time: "" })).not.toContain("tabular-nums text-fg-subtle transition-opacity");
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
    expect(dragged).toMatch(/^<li class="relative" draggable="true">/);
    expect(classTokens(dragged)).toEqual(
      expect.arrayContaining(["cursor-grab", "-bottom-px", "bg-accent"]),
    );
  });

  it("wires all three menu openers and names the anchor's owner", () => {
    expect(SOURCE).toContain("{...ctx.rowProps}");
    expect(SOURCE).toContain("ctx.consumeLongPressClick()");
    expect(SOURCE).toContain("anchorOwner={ctx.anchorOwner}");
    // A menu row hands focus back to the row before it acts.
    expect(SOURCE).toMatch(/ctx\.returnFocus\(\)\?\.focus\(\);\s*ctx\.close\(\);/);
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

  it("gates taps exactly as it gates sight, on hover and on focus", () => {
    const tokens = classTokens(html);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "pointer-events-none",
        "opacity-0",
        "group-hover:pointer-events-auto",
        "group-hover:opacity-100",
        "focus:pointer-events-auto",
        "focus:opacity-100",
      ]),
    );
    expect(tokens).not.toContain("focus-visible:opacity-100");
    expect(tokens).not.toContain("transition-all");
  });

  it("names each button, and gives only the destructive one the danger ink", () => {
    expect(html).toContain('data-tooltip="Archive" aria-label="Archive"');
    expect(html.match(/hover:text-tone-danger-fg/g)).toHaveLength(1);
    expect(html).toContain('data-tooltip="More" aria-label="More" aria-haspopup="menu"');
  });
});
