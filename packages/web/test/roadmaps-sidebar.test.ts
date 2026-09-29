/**
 * One row of the sidebar's ROADMAPS section (features/company/roadmaps-sidebar.tsx): a roadmap's
 * room reads the way the channel list reads a channel — the glyph and the name, linked to the
 * room. The roadmap's number is not on the row, and the link carries no `title` of its own: the
 * name is already the row's text, and `Truncated` adds one only when the name is cut (a static
 * render measures no overflow, so none appears here). A room with unread messages gives its row
 * the channel row's own badges (count, "@me") and a bold name. Past the first five, the rows fold under
 * "> More (n)", the channel list's "> Archived (n)" fold with another word.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { RoadmapRow } from "../src/features/company/roadmaps-sidebar";
import { orgChannelPath } from "../src/features/company/company-nav";
import { FolderSection } from "../src/components/ui/group-list";
import { badgeNote, RowBadges } from "../src/features/company/channel-sidebar";
import { S, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const roadmap = {
  number: 3,
  name: "Roadmap three",
  status: "discussing",
  archived: false,
  channelId: "roadmap_3",
  createdAt: "2026-09-29T03:00:00.000Z",
};

const html = renderToStaticMarkup(
  createElement(
    MemoryRouter,
    null,
    createElement("ul", null, createElement(RoadmapRow, { projectId: "p1", orgId: "o1", roadmap })),
  ),
);

/** The row's `<a …>` opening tag. */
const anchor = (): string => {
  const match = /<a\b[^>]*>/.exec(html);
  if (match === null) throw new Error(`no link in ${html}`);
  return match[0];
};

describe("a roadmap's row in the sidebar", () => {
  it("names the roadmap and opens its room", () => {
    expect(html).toContain("Roadmap three");
    expect(anchor()).toContain(`href="${orgChannelPath("p1", "o1", "roadmap_3")}"`);
  });

  it("does not show the roadmap's number", () => {
    expect(html).not.toContain("#3");
  });

  it("puts no title on the link: the name is the row's own text", () => {
    expect(anchor()).not.toMatch(/\stitle="/);
    expect(html).not.toMatch(/\stitle="/);
  });
});

describe("a roadmap's row with unread messages in its room", () => {
  const render = (counts: { unread: number; mentionsMe: number }) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          "ul",
          null,
          createElement(RoadmapRow, { projectId: "p1", orgId: "o1", roadmap, counts }),
        ),
      ),
    );

  it("shows the count and the @me chip, and sets the name in bold, as a channel row does", () => {
    const html = render({ unread: 3, mentionsMe: 1 });
    // Exactly the badges a channel row draws (RowBadges is shared with ChannelRow).
    expect(html).toContain(
      renderToStaticMarkup(createElement(RowBadges, { unread: 3, mentionsMe: 1 })),
    );
    expect(html).toContain(">3<");
    expect(html).toContain(S.company.channels.mentionChip);
    expect(/<a\b[^>]*>/.exec(html)?.[0]).toContain("font-medium text-gray-900");
    // The badges reach a screen reader the way a channel row's do.
    expect(html).toContain(
      `aria-label="Roadmap three · ${badgeNote({ unread: 3, mentionsMe: 1 })}"`,
    );
  });

  it("shows nothing trailing and no bold when nothing is unread", () => {
    const html = render({ unread: 0, mentionsMe: 0 });
    expect(html).not.toContain(S.company.channels.mentionChip);
    expect(html).not.toContain("tabular-nums");
    expect(html).not.toContain("aria-label=");
    expect(/<a\b[^>]*>/.exec(html)?.[0]).not.toContain("font-medium");
  });
});

describe("the section's fold", () => {
  // The roadmaps past the first five fold as "> More (n)", drawn by the very component and in
  // the very shape the channel list uses for "> Archived (n)": only the word differs.
  const fold = (label: string) =>
    renderToStaticMarkup(createElement(FolderSection, { label, open: false, onToggle: () => {} }));

  it("reads More (n) in both languages", () => {
    expect(fold(`${en.company.roadmaps.moreGroup} (3)`)).toContain("More (3)");
    expect(fold(`${zh.company.roadmaps.moreGroup} (3)`)).toContain("更多 (3)");
  });

  it("is the channel list's archived fold with another word", () => {
    for (const S of [zh, en]) {
      const more = fold(`${S.company.roadmaps.moreGroup} (3)`);
      const archived = fold(`${S.company.channels.archivedGroup} (3)`);
      expect(more.replace(S.company.roadmaps.moreGroup, "·")).toBe(
        archived.replace(S.company.channels.archivedGroup, "·"),
      );
    }
  });
});
