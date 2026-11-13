// @vitest-environment jsdom
/**
 * A part of the page that crashes while rendering (the UI package's `CrashBoundary`, which the
 * app puts round the page body, each dock panel and the whole router), and the report it offers.
 *
 * - Given a component that throws as it renders, the window shows the crash notice in its place
 *   — Reload and Report — instead of going blank, and what stands beside it keeps working.
 * - Given Report pressed, the report dialog opens on the error, its stack with the home
 *   directory's name taken out, the components it crashed in, and the page as its pattern.
 * - Given the boundary's reset key changing (another page), the children get another chance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { CrashBoundary, ReportHost, closeReport, setReportRoute } from "@prismshadow/penguin-ui";
import { button, click, mount, unmountAll } from "./helpers/dom";

function Title({ session }: { session: { title: string } | undefined }) {
  if (session === undefined) {
    const error = new TypeError("Cannot read properties of undefined (reading 'title')");
    error.stack = `${error.message}\n    at Title (/Users/alice/penguin/packages/web/src/title.tsx:4:2)`;
    throw error;
  }
  return h("h1", null, session.title);
}

const report = () => document.querySelector("[data-report]")?.textContent ?? "";

beforeEach(() => {
  setReportRoute(() => "/chat/:sessionId");
  // React reports every caught render error on the console; the crash here is the point.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  closeReport();
  setReportRoute(null);
  await unmountAll();
  vi.restoreAllMocks();
});

describe("a part of the page that crashes", () => {
  it("shows the notice with Reload and Report in its place, and leaves the rest of the page", async () => {
    const page = await mount(
      h("div", null, [
        h("nav", { key: "nav" }, "Sidebar"),
        h(CrashBoundary, { key: "body" }, h(Title, { session: undefined })),
      ]),
    );
    expect(page.container.querySelector("[data-crash-notice]")?.textContent).toContain(
      "[Error]: this part of the page could not be shown",
    );
    expect(button("Reload")).toBeDefined();
    expect(button("Report")).toBeDefined();
    expect(page.container.querySelector("nav")?.textContent).toBe("Sidebar");
  });

  it("reports the error, its stack without the home directory's name, the components and the page", async () => {
    await mount(
      h("div", null, [
        h(CrashBoundary, { key: "body" }, h(Title, { session: undefined })),
        h(ReportHost, { key: "host" }),
      ]),
    );
    await click(button("Report"));
    const shown = report();
    expect(shown).toContain("- What happened: the page crashed while rendering");
    expect(shown).toContain("- Page: /chat/:sessionId");
    expect(shown).toContain(
      "- Error: TypeError: Cannot read properties of undefined (reading 'title')",
    );
    expect(shown).toContain("/Users/<user>/penguin/packages/web/src/title.tsx:4:2");
    expect(shown).not.toContain("alice");
    expect(shown).toMatch(/Component stack:[\s\S]*at Title/);
  });

  it("gives its children another chance once the page it shows changes", async () => {
    const page = await mount(
      h(CrashBoundary, { resetKey: "/chat/a" }, h(Title, { session: undefined })),
    );
    expect(page.container.querySelector("[data-crash-notice]")).not.toBeNull();
    await page.rerender(
      h(CrashBoundary, { resetKey: "/chat/b" }, h(Title, { session: { title: "Release notes" } })),
    );
    expect(page.container.querySelector("[data-crash-notice]")).toBeNull();
    expect(page.container.textContent).toBe("Release notes");
  });
});
