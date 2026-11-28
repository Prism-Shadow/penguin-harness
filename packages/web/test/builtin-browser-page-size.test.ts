/**
 * The Browser panel's page size control (plugins/browser-automation/src/web/page-size-menu.tsx and
 * page-size.ts), rendered to static markup (node env, no DOM), and its requests against the fetch
 * fake.
 *
 * - A tab that fits the panel: the button says so and stands at rest.
 * - A tab with a fixed size: the button takes the accent and names the size with the zoom it is
 *   drawn at in the panel; in the user's Chrome, which shows the page whole, the size alone.
 * - With no tab the button is disabled.
 * - A choice asks the server for the tab's size, the panel's again as `fit`; a refusal says why.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
// The browser reaches the app's own helpers through the plugin face; this hands them over.
import "../src/web-app/plugin-host";
import { PageSizeMenu } from "../../../plugins/browser-automation/src/web/page-size-menu";
import {
  pageEdge,
  pageSizeLabel,
  resizeTab,
} from "../../../plugins/browser-automation/src/web/page-size";
import { S as B } from "../../../plugins/browser-automation/src/web/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

const toasts = vi.hoisted(() => [] as string[]);

vi.mock("@prismshadow/penguin-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismshadow/penguin-ui")>();
  return {
    ...actual,
    toastError: (text: string) => toasts.push(`error: ${text}`),
  };
});

afterEach(() => {
  toasts.length = 0;
});

const tab = (patch: Partial<BuiltinBrowserTab> = {}): BuiltinBrowserTab => ({
  id: 7,
  title: "Example",
  url: "https://example.test/",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  ...patch,
});

/** The button's markup: its accessible name and its classes. */
function button(html: string): { label: string | null; className: string; disabled: boolean } {
  const tag = /<button[^>]*data-testid="builtin-browser-page-size"[^>]*>/.exec(html)?.[0] ?? "";
  return {
    label: /aria-label="([^"]*)"/.exec(tag)?.[1] ?? null,
    className: /class="([^"]*)"/.exec(tag)?.[1] ?? "",
    disabled: / disabled=""/.test(tag),
  };
}

const render = (t: BuiltinBrowserTab | null, slot: { width: number; height: number } | null) =>
  button(renderToStaticMarkup(createElement(PageSizeMenu, { tab: t, slot })));

describe("the page size button", () => {
  it("says the page fits the panel, at rest, while the tab has no size", () => {
    const shown = render(tab(), { width: 512, height: 640 });
    expect(shown.label).toBe(B.builtinBrowser.pageSizeFit);
    expect(shown.className).not.toContain("text-accent");
    expect(shown.disabled).toBe(false);
  });

  it("takes the accent and names a fixed size with the zoom the panel draws it at", () => {
    const shown = render(tab({ viewport: { width: 1280, height: 800 } }), {
      width: 512,
      height: 640,
    });
    // 512 / 1280 = 40 %, the tighter of the two edges.
    expect(shown.label).toBe(B.builtinBrowser.pageSizeFixed(1280, 800, 40));
    expect(shown.className).toContain("text-accent");
  });

  it("names the size alone in the user's Chrome, which shows the page whole", () => {
    expect(render(tab({ viewport: { width: 1440, height: 900 } }), null).label).toBe(
      B.builtinBrowser.pageSizeFixed(1440, 900, null),
    );
    expect(pageSizeLabel({ width: 1440, height: 900 }, null)).toBe(
      B.builtinBrowser.pageSizeFixed(1440, 900, null),
    );
  });

  it("is disabled with no tab to size", () => {
    expect(render(null, { width: 512, height: 640 }).disabled).toBe(true);
  });
});

describe("choosing a size", () => {
  it("asks the server for the tab's size, and for the panel's again as fit", async () => {
    const fetch = stubFetch(() => json({ tab: tab(), width: 1440, height: 900, scale: 1 }));
    expect(await resizeTab(7, { width: 1440, height: 900 })).toBe(true);
    expect(await resizeTab(7, null)).toBe(true);
    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/api/builtin-browser/tabs/7/viewport", { width: 1440, height: 900 }],
      ["POST", "/api/builtin-browser/tabs/7/viewport", { fit: true }],
    ]);
  });

  it("says why when the server refuses", async () => {
    stubFetch(() => apiError(404, "no_such_tab", "Tab 7 is not open in the built-in browser."));
    expect(await resizeTab(7, { width: 1440, height: 900 })).toBe(false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.startsWith(`error: ${B.builtinBrowser.resizeFailed("")}`)).toBe(true);
  });

  it("reads a custom edge only as whole CSS pixels within the server's bounds", () => {
    expect(pageEdge(" 1200 ")).toBe(1200);
    expect(["", "199", "4097", "12.5", "1e3", "-300"].map(pageEdge)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
