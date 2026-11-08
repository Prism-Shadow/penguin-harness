import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContributedPage } from "../src/web-app/contributed-page";
import type { PageEntry } from "../src/web-app/page-table";

const page: PageEntry = {
  id: "plugin.reports",
  key: "reports",
  path: "reports/:number?",
  nav: "org",
  admin: false,
  released: true,
  renderer: { builtin: "ReportsPage" },
};

const message =
  'Missing builtin renderer "ReportsPage" for contributed page "reports" (reports/:number?)';

describe("ContributedPage", () => {
  it("throws a diagnostic instead of silently navigating when a builtin is missing", () => {
    // No router mock: the missing renderer must fail at the page, not in Navigate's context.
    expect(() => renderToStaticMarkup(createElement(ContributedPage, { page }))).toThrow(message);
  });

  it("also reports a missing name in an explicitly supplied registry", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ContributedPage, {
          page,
          builtins: { OtherPage: () => createElement("p", null, "other") },
        }),
      ),
    ).toThrow(message);
  });

  it("renders a registered builtin without needing a router", () => {
    expect(
      renderToStaticMarkup(
        createElement(ContributedPage, {
          page,
          builtins: { ReportsPage: () => createElement("p", null, "reports") },
        }),
      ),
    ).toBe("<p>reports</p>");
  });

  it("renders an iframe without a builtin registry", () => {
    const html = renderToStaticMarkup(
      createElement(ContributedPage, {
        page: {
          ...page,
          renderer: { iframe: { src: "/workflow/reports/", namespace: "reports" } },
        },
      }),
    );
    expect(html).toContain('<iframe title="reports" src="/workflow/reports/"');
    expect(html).toContain('class="h-full w-full border-0"');
  });
});
