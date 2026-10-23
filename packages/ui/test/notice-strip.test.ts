/**
 * The notice strip (src/components/feedback/notice/notice-strip.tsx): the one `ui-notice` box,
 * naming its tone in the hook's words and painting it as a tint with its own ink on the neutral
 * line, around whatever layout and words the caller brings. A strip in the page declares itself a
 * tone surface, so a custom background thins its tint; a toast (a pressed notice) keeps its
 * surface. How the background thins it is the stylesheet's (wallpaper.css), checked in a browser.
 *
 * Which call sites use it, and the icon-slot convention they are held to, is the web app's
 * `notice-chart-hooks.test.ts`.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { NOTICE_TONE, NoticeStrip } from "../src/components/feedback/notice/notice-strip";
import type { NoticeStripTone } from "../src/components/feedback/notice/notice-strip";
import { classTokens, renderStatic } from "../src/testing";

const TONES = Object.keys(NOTICE_TONE) as NoticeStripTone[];

type StripProps = Omit<Parameters<typeof NoticeStrip>[0], "tone">;

const strip = (tone: NoticeStripTone, props: StripProps = {}) =>
  renderStatic(createElement(NoticeStrip, { ...props, tone }, "Heads up"));

/** The strip's own opening tag: what its root element carries. */
const rootTag = (html: string) => /^<[^>]*>/.exec(html)?.[0] ?? "";

describe("NoticeStrip", () => {
  it("names every tone in the hook's five words, the attention tone as a warning", () => {
    expect([...TONES].sort()).toEqual(["attention", "danger", "info", "neutral", "success"]);
    expect(new Set(Object.values(NOTICE_TONE))).toEqual(
      new Set(["info", "success", "warning", "danger", "neutral"]),
    );
    expect(strip("attention")).toContain('data-tone="warning"');
    expect(strip("danger")).toContain('data-tone="danger"');
  });

  it("paints each tone as its tint and ink on the neutral line, never its own line", () => {
    for (const tone of TONES) {
      const tokens = classTokens(strip(tone));
      expect(tokens, tone).toEqual(
        expect.arrayContaining([
          "ui-notice",
          "border-line",
          `bg-tone-${tone}-bg`,
          `text-tone-${tone}-fg`,
        ]),
      );
      expect(
        tokens.filter((t) => t.startsWith("border-tone-")),
        tone,
      ).toEqual([]);
    }
  });

  it("keeps the caller's layout, words and attributes", () => {
    const html = strip("danger", {
      className: "mt-4 rounded-md border px-3 py-2 text-sm",
      role: "alert",
    });
    expect(html).toMatch(/^<div role="alert"/);
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["mt-4", "rounded-md", "border", "px-3", "py-2", "text-sm"]),
    );
    expect(html).toContain(">Heads up</div>");
  });

  it("declares itself a tone surface in the page, so a custom background thins its tint", () => {
    for (const as of ["div", "p"] as const) {
      const root = rootTag(strip("attention", { as }));
      expect(root, as).toContain('data-wallpaper-surface="tone"');
      expect(root, as).toContain('data-tone="warning"');
    }
  });

  it("leaves a toast, a pressed notice, out of the background: it floats and keeps its surface", () => {
    const root = rootTag(strip("success", { as: "button" }));
    expect(root).toMatch(/^<button /);
    expect(root).not.toContain("data-wallpaper-surface");
  });

  it("is a paragraph for one sentence of prose, and a real button when pressed", () => {
    expect(strip("neutral", { as: "p" })).toMatch(/^<p /);
    expect(strip("info", { as: "button" })).toMatch(/^<button type="button"/);
    expect(strip("info")).not.toContain("type=");
  });
});
