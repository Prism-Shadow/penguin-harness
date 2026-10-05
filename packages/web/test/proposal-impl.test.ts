/**
 * features/proposals/proposal-impl.tsx's branch line, via react-dom/server static markup (node
 * env, no DOM): a declared side the server resolved is a link to its GitHub branch page in a new
 * tab, one it could not resolve is text with the reason on hover, and the PR link is as before.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalImplBranch } from "@prismshadow/penguin-server/api";
import { ImplBranchLine } from "../src/features/proposals/proposal-impl";

const PR = "https://github.com/acme/site/pull/7";

const render = (impl: ProposalImplBranch) =>
  renderToStaticMarkup(createElement(ImplBranchLine, { impl, diff: null }));

const impl = (overrides: Partial<ProposalImplBranch>): ProposalImplBranch => ({
  head: {
    remote: "origin",
    branch: "feat/qa",
    url: "https://github.com/acme/site/tree/feat/qa",
    unresolved: null,
  },
  base: {
    remote: "origin",
    branch: "main",
    url: "https://github.com/acme/site/tree/main",
    unresolved: null,
  },
  pr: PR,
  by: "user:u1",
  at: "2026-10-05T00:00:00.000Z",
  ...overrides,
});

describe("the impl branch line", () => {
  it("links each resolved side to its branch page in a new tab", () => {
    const html = render(impl({}));
    expect(html).toContain(
      '<a href="https://github.com/acme/site/tree/feat/qa" target="_blank" rel="noreferrer"',
    );
    expect(html).toContain(
      '<a href="https://github.com/acme/site/tree/main" target="_blank" rel="noreferrer"',
    );
    expect(html).toContain(">origin/feat/qa</a>");
    expect(html).toContain(">origin/main</a>");
    expect(html).not.toContain(" title=");
  });

  it("keeps an unresolved side as text with the reason on hover", () => {
    const html = render(
      impl({
        base: {
          remote: "upstream",
          branch: "main",
          url: null,
          unresolved: "Remote upstream names no GitHub repository.",
        },
      }),
    );
    expect(html).not.toContain('href="https://github.com/acme/site/tree/main"');
    expect(html).toMatch(/<span data-tooltip="[^"]*Remote upstream names no GitHub repository\.">/);
    expect(html).toContain(">upstream/main</span>");
    // The resolved head is still a link.
    expect(html).toContain('href="https://github.com/acme/site/tree/feat/qa"');
  });

  it("renders a side from a server without branch links as plain text", () => {
    const html = render(
      impl({
        head: { remote: "origin", branch: "feat/qa" },
        base: { remote: "origin", branch: "main" },
      }),
    );
    expect(html).not.toContain("/tree/");
    expect(html).toContain("<span>origin/feat/qa</span>");
  });

  it("leaves the PR link as it was", () => {
    const html = render(impl({}));
    expect(html).toContain(
      `<a href="${PR}" target="_blank" rel="noreferrer" data-tooltip="${PR}" class="font-medium hover:underline">acme/site/pull/7</a>`,
    );
  });
});
