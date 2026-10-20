/**
 * The top-level Archived chats page (/archived) and the receipt that follows an archive.
 *
 * - The manifest names the page: a main-nav entry, released, at /archived, drawn by the
 *   ArchivedPage renderer the router registers.
 * - The nav label exists in both dictionaries and is the page's own title.
 * - The entry is pinned by default, so a conversation filed away is findable without
 *   unfolding a fold.
 * - The receipt store holds one receipt at a time: raising it replaces the one before and
 *   bumps the sequence (which is what restarts its clock), and dismissing it clears it.
 */
import { describe, expect, it } from "vitest";
import { PAGES } from "../src/lib/pages";
import { NAV_ICONS } from "../src/lib/nav-icons";
import { visibleNavKeys } from "../src/lib/nav-group-collapse";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";
import {
  archiveReceiptStore,
  dismissArchiveReceipt,
  showArchiveReceipt,
} from "../src/features/archived/archive-receipt";

describe("the archived page", () => {
  it("the manifest names it as a released main-nav page at /archived", () => {
    const page = PAGES.find((p) => p.key === "archived");
    expect(page).toBeDefined();
    expect(page).toMatchObject({
      id: "web.archived",
      path: "/archived",
      nav: "main",
      admin: false,
      released: true,
      renderer: { builtin: "ArchivedPage" },
    });
  });

  it("the nav row has a label, an icon, and the page's own title", () => {
    expect(zh.nav.archived).toBe(zh.archivedPage.title);
    expect(en.nav.archived).toBe(en.archivedPage.title);
    expect(NAV_ICONS.archived).toBeTruthy();
  });

  it("is pinned by default: it stays visible when the collapsible area is folded", () => {
    expect(visibleNavKeys(true)).toContain("archived");
  });
});

describe("the archive receipt", () => {
  it("holds one receipt at a time, and a new one replaces the old", () => {
    dismissArchiveReceipt();
    expect(archiveReceiptStore.getState().receipt).toBeNull();

    const before = archiveReceiptStore.getState().seq;
    showArchiveReceipt({ sessionId: "s1", title: "第一条" });
    expect(archiveReceiptStore.getState().receipt).toEqual({ sessionId: "s1", title: "第一条" });

    showArchiveReceipt({ sessionId: "s2", title: "第二条" });
    expect(archiveReceiptStore.getState().receipt).toEqual({ sessionId: "s2", title: "第二条" });
    expect(archiveReceiptStore.getState().seq).toBe(before + 2);

    dismissArchiveReceipt();
    expect(archiveReceiptStore.getState().receipt).toBeNull();
  });
});
