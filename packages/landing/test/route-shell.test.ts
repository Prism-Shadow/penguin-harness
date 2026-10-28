/**
 * The static shell a route ships with, which is all a crawler or a link unfurler reads.
 *
 * - Given a page with its own name, its shell carries its title, description and share card, and
 *   none of the home page's; it keeps the site's own title and description aside, for the page to
 *   put back when the reader moves on inside the app.
 * - Given a page without one, its shell keeps the home page's name under its own address.
 * - Given a value with quotes or angle brackets, the tag still holds.
 * - Given a shell missing a tag a page needs, the build fails instead of shipping it.
 * - Given an address that does not exist, its shell claims no canonical.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notFoundShell, shellFor } from "../scripts/route-shell.mjs";

const SHELL = readFileSync(join(__dirname, "..", "index.html"), "utf8");
const HOME_TITLE = /<title>([^<]*)<\/title>/.exec(SHELL)![1]!;
const HOME_DESCRIPTION = /<meta\s+name="description"\s+content="([^"]*)"/.exec(SHELL)![1]!;
const titleOf = (html: string) => /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1];
const HOME_IMAGE = "https://penguin.ooo/og-cover.png";

const META = {
  title: "AMSP — Agent Message Stream Protocol | PenguinHarness",
  description: "AMSP is the event stream of a PenguinHarness agent.",
  image: "https://penguin.ooo/og-amsp.png",
  imageAlt: "AMSP — Agent Message Stream Protocol",
};

describe("a route's shell", () => {
  it("names a page with its own title, description and card", () => {
    const html = shellFor(SHELL, "https://penguin.ooo/amsp/", META);
    expect(titleOf(html)).toBe(META.title);
    expect(html).toContain(`<meta name="description" content="${META.description}"`);
    expect(html).toContain(`<meta property="og:title" content="${META.title}" />`);
    expect(html).toContain(`<meta property="og:image" content="${META.image}" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${META.image}" />`);
    expect(html).toContain('<link rel="canonical" href="https://penguin.ooo/amsp/" />');
    expect(html).not.toContain(HOME_IMAGE);
  });

  it("keeps the site's own title and description aside for when the reader moves on", () => {
    const html = shellFor(SHELL, "https://penguin.ooo/amsp/", META);
    expect(html).toContain(`<title data-default="${HOME_TITLE}">`);
    expect(html).toContain(`data-default="${HOME_DESCRIPTION}"`);
  });

  it("keeps the home page's name for a page without one, under its own address", () => {
    const html = shellFor(SHELL, "https://penguin.ooo/download/");
    expect(titleOf(html)).toBe(HOME_TITLE);
    expect(html).toContain(HOME_IMAGE);
    expect(html).toContain('<meta property="og:url" content="https://penguin.ooo/download/" />');
  });

  it("escapes quotes and angle brackets in a value", () => {
    const html = shellFor(SHELL, "https://penguin.ooo/amsp/", {
      ...META,
      title: 'The "<AMSP>" page & more',
    });
    expect(titleOf(html)).toBe('The "&lt;AMSP&gt;" page &amp; more');
    expect(html).toContain(
      '<meta property="og:title" content="The &quot;&lt;AMSP&gt;&quot; page &amp; more" />',
    );
  });

  it("fails when the shell lacks a tag the page needs", () => {
    const withoutCard = SHELL.replace(/<meta\s+property="og:image"[^>]*>/, "");
    expect(() => shellFor(withoutCard, "https://penguin.ooo/download/")).not.toThrow();
    expect(() => shellFor(withoutCard, "https://penguin.ooo/amsp/", META)).toThrow(/og:image/);
  });

  it("claims no canonical for an address that does not exist", () => {
    expect(notFoundShell(SHELL)).not.toMatch(/rel="canonical"/);
  });
});
