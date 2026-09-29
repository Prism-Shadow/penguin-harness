/**
 * One row of the sidebar's ROADMAPS section (features/company/roadmaps-sidebar.tsx): a roadmap's
 * room reads the way the channel list reads a channel — the glyph and the name, linked to the
 * room. The roadmap's number is not on the row, and the link carries no `title` of its own: the
 * name is already the row's text, and `Truncated` adds one only when the name is cut (a static
 * render measures no overflow, so none appears here).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { RoadmapRow } from "../src/features/company/roadmaps-sidebar";
import { orgChannelPath } from "../src/features/company/company-nav";

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
