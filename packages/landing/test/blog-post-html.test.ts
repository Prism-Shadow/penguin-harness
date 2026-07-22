/**
 * Raw-HTML rendering contract for post bodies, via react-dom/server static markup.
 *
 * Post bodies are first-party Markdown in this repo, so the blog renderer enables `rehype-raw`
 * (see the boundary note on REHYPE_PLUGINS in src/pages/blog-post.tsx). These tests pin the two
 * halves of that: the raw tags posts actually use become elements, and the surrounding Markdown
 * still parses — a `<details>` body is separated from its tags by blank lines precisely so the
 * fenced code inside it stays Markdown.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../src/pages/blog-post";

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: REMARK_PLUGINS, rehypePlugins: REHYPE_PLUGINS },
      markdown,
    ),
  );

const DETAILS = `<details>
<summary><strong>Expand: the layout</strong></summary>

\`\`\`text
benchmark_config.toml
\`\`\`

</details>
`;

describe("blog post raw HTML", () => {
  it("renders <details>/<summary> as elements, not escaped text", () => {
    const html = render(DETAILS);
    expect(html).toContain("<details>");
    expect(html).toContain("<summary><strong>Expand: the layout</strong></summary>");
    expect(html).not.toContain("&lt;details&gt;");
  });

  it("keeps the Markdown inside a <details> body as Markdown", () => {
    const html = render(DETAILS);
    expect(html).toContain("<pre>");
    expect(html).toContain("benchmark_config.toml");
  });

  it("renders the inline <img> attributes posts use", () => {
    const html = render('<img width="491" height="481" alt="A screenshot" src="/a.png" />');
    expect(html).toContain('alt="A screenshot"');
    expect(html).toContain('width="491"');
    expect(html).not.toContain("&lt;img");
  });

  it("still escapes angle brackets inside code spans", () => {
    const html = render("Snapshots live at `snapshots/v<version>.tar.gz`.");
    expect(html).toContain("<code>snapshots/v&lt;version&gt;.tar.gz</code>");
  });
});
