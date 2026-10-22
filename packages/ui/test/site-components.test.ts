/**
 * The public sites' shared components, as a page renders them (static markup, Node).
 *
 * - An article: every ## and ### heading carries the id its contents entry links to; a fenced
 *   block shows its code as text before any highlighter answers; with the docs' dialect a run
 *   of `tab="…"` fences becomes one tab strip showing only the first panel, and a `[!INFO]-`
 *   quote becomes a collapsed box with its title; a host's link adapter replaces the links
 *   while the headings stay the shared ones; a host's footnote options name the citations and
 *   label their list, and the label keeps the id every citation is described by; a run of
 *   citations reads as one bracketed group, each number its own link, tied to the text before it.
 * - The highlighter a site hands its articles colours a PowerShell and a JSON Lines fence with
 *   both themes baked in, and answers nothing for a language it does not carry.
 * - The footer: an external link opens a new tab and a route link renders through the host's
 *   router; without brand or columns it is one line of links.
 * - An article's contents mark the entry being read as the current location, and only that one.
 * - The docs sidebar marks the current page, lists sub-pages under their parent, and leads with
 *   a search button that names its shortcut.
 * - A code card mutes `#` comment lines only, and its copy button names the action.
 */
import { createElement as h } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { SiteCodeCard } from "../src/components/site/site-code";
import { SiteFooter } from "../src/components/site/site-footer";
import type { SiteLinkProps } from "../src/components/site/site-header";
import { highlightSiteCode } from "../src/components/site/site-highlight";
import { extractToc } from "../src/components/site/markdown-text";
import { SITE_DOC_REMARK_PLUGINS, SiteMarkdown } from "../src/components/site/site-markdown";
import type { SiteMarkdownComponents } from "../src/components/site/site-markdown";
import { SiteSidebarNav } from "../src/components/site/site-sidebar";
import { SiteToc } from "../src/components/site/site-toc";
import { renderStatic } from "../src/testing";

const article = (body: string, extra: Partial<Parameters<typeof SiteMarkdown>[0]> = {}) =>
  renderStatic(h(SiteMarkdown, { variant: "doc", ...extra, children: body }));

/** A host's router link, told apart from a plain anchor by its marker. */
const routed = ({ href, ...props }: SiteLinkProps): ReactElement =>
  h("a", { ...props, href: `/base${href}`, "data-routed": "" });

describe("an article", () => {
  it("gives every ## and ### heading the id its contents entry links to", () => {
    const body = "## 安装参考\n\ntext\n\n### Tool Calls (streaming)\n\nmore";
    const html = article(body);
    for (const entry of extractToc(body)) expect(html).toContain(`id="${entry.id}"`);
  });

  it("shows a fenced block's code as text before a highlighter answers", () => {
    const html = article("```ts\nconst port = 7364;\n```", { highlight: highlightSiteCode });
    expect(html).toContain("<pre><code>const port = 7364;</code></pre>");
  });

  it("turns a run of tab fences into one strip showing only the first panel", () => {
    const html = article(
      '```bash tab="Linux"\ncurl install.sh\n```\n\n```powershell tab="Windows"\nirm install.ps1\n```',
      { remarkPlugins: SITE_DOC_REMARK_PLUGINS },
    );
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("curl install.sh");
    expect(html).not.toContain("irm install.ps1");
  });

  it("turns a marked quote into a collapsed box with its title", () => {
    const html = article("> [!INFO]- First launch blocked\n>\n> Allow it.", {
      remarkPlugins: SITE_DOC_REMARK_PLUGINS,
    });
    expect(html).toMatch(
      /<details class="callout callout-info">\s*<summary[^>]*>First launch blocked/,
    );
    expect(html).not.toContain("<details open");
  });

  it("takes the host's link adapter while keeping the shared headings", () => {
    const components: SiteMarkdownComponents = {
      a: ({ href, children }) => h("a", { href, target: "_blank" }, children),
    };
    const html = article("## Links\n\n[repo](https://example.test)", { components });
    expect(html).toContain('<a href="https://example.test" target="_blank">repo</a>');
    expect(html).toContain('id="links"');
  });

  it("names citations and labels their list with the host's footnote options", () => {
    const html = article("A claim.[^1]\n\n[^1]: A source.", {
      remarkRehypeOptions: {
        clobberPrefix: "",
        footnoteLabel: "References",
        footnoteLabelProperties: { className: ["refs"] },
      },
    });
    expect(html).toContain('href="#fn-1" id="fnref-1"');
    expect(html).toContain('aria-describedby="footnote-label"');
    expect(html).toMatch(/<h2 id="footnote-label" class="[^"]*\brefs\b[^"]*">References<\/h2>/);
  });

  it("sets a run of citations as one bracketed group, each number its own link", () => {
    const html = article("A claim[^1][^2]. Another[^2].\n\n[^1]: One.\n[^2]: Two.");
    const ref = (n: number) => `<a [^>]*data-footnote-ref[^>]*>${n}</a>`;
    expect(html).toMatch(
      new RegExp(`A claim\u2060<sup class="site-cite">\\[${ref(1)},\u00a0${ref(2)}\\]</sup>\\.`),
    );
    expect(html).toMatch(
      new RegExp(`Another\u2060<sup class="site-cite">\\[${ref(2)}\\]</sup>\\.`),
    );
  });
});

describe("the site highlighter", () => {
  it("colours PowerShell and JSON Lines fences with both themes baked in", async () => {
    for (const [code, language] of [
      ["irm https://penguin.ooo/install.ps1 | iex", "ps1"],
      ['{"type":"event"}', "jsonl"],
    ] as const) {
      const html = await highlightSiteCode(code, language);
      expect(html, language).toContain("<span");
      expect(html, language).toContain("--shiki-dark");
    }
  });

  it("answers nothing for a language it does not carry", async () => {
    expect(await highlightSiteCode("IDENTIFICATION DIVISION.", "cobol")).toBeUndefined();
  });
});

describe("the footer", () => {
  it("opens an external link in a new tab and renders a route through the host's router", () => {
    const html = renderStatic(
      h(SiteFooter, {
        brand: { name: "PenguinHarness", logo: "/logo.svg", tagline: "Tagline" },
        columns: [
          {
            title: "Product",
            links: [
              { id: "blog", href: "/blog", label: "Blog", render: routed },
              { id: "repo", href: "https://example.test/repo", label: "Repo", external: true },
            ],
          },
        ],
        copyright: "© 2026",
      }),
    );
    expect(html).toMatch(/<a[^>]*href="\/base\/blog"[^>]*data-routed=""[^>]*>Blog<\/a>/);
    expect(html).toMatch(/<a[^>]*href="https:\/\/example.test\/repo"[^>]*target="_blank"/);
  });

  it("is one line of links without brand or columns", () => {
    const html = renderStatic(
      h(SiteFooter, {
        copyright: "© 2026",
        links: [{ id: "site", href: "/", label: "Home" }],
      }),
    );
    expect(html).toContain(">Home</a>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<ul");
  });
});

describe("an article's contents", () => {
  it("marks the entry being read as the current location, and only that one", () => {
    const html = renderStatic(
      h(SiteToc, {
        label: "On this page",
        entries: extractToc("## One\n\n### Two\n\n## Three"),
        activeId: "two",
      }),
    );
    expect(html.match(/aria-current="location"/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="#two"[^>]*aria-current="location"/);
  });
});

describe("the docs sidebar", () => {
  const html = renderStatic(
    h(SiteSidebarNav, {
      label: "Docs",
      renderLink: routed,
      search: { label: "Search docs", shortcut: "Ctrl K", onOpen: () => undefined },
      sections: [
        {
          id: "start",
          title: "Get started",
          items: [
            { id: "intro", href: "/", label: "Introduction" },
            {
              id: "quickstart",
              href: "/quickstart",
              label: "Quickstart",
              children: [{ id: "cli", href: "/quickstart-cli", label: "CLI", active: true }],
            },
          ],
        },
      ],
    }),
  );

  it("marks the current page, among sub-pages listed under their parent", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/Quickstart<\/a><ul[^>]*><li><a[^>]*aria-current="page"[^>]*>CLI/);
  });

  it("leads with a search button that names its shortcut", () => {
    expect(html.indexOf("Search docs")).toBeLessThan(html.indexOf("Introduction"));
    expect(html).toContain("<kbd");
    expect(html).toContain("Ctrl K</kbd>");
  });
});

describe("a code card", () => {
  it("mutes comment lines only, and its copy button names the action", () => {
    const html = renderStatic(
      h(SiteCodeCard, {
        code: "# Linux\ncurl -fsSL https://penguin.ooo/install.sh | sh",
        copy: { label: "Copy", announcement: "Copied" },
      }),
    );
    expect(html.match(/data-comment="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-comment="true"[^>]*># Linux</);
    expect(html).toMatch(/<button[^>]*>.*<span>Copy<\/span><\/button>/);
  });
});
