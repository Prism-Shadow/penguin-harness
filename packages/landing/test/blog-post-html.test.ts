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
import { MdImage, REHYPE_PLUGINS, REMARK_PLUGINS } from "../src/pages/blog-post";
import { blogAssetUrl } from "../src/lib/links";

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: REMARK_PLUGINS, rehypePlugins: REHYPE_PLUGINS },
      markdown,
    ),
  );

/** Same pipeline plus the image adapter the page installs. */
const renderWithImages = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: REMARK_PLUGINS,
        rehypePlugins: REHYPE_PLUGINS,
        components: { img: MdImage },
      },
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

  it("renders a one-line drawn figure as an inline SVG the figure styles can reach", () => {
    const figure =
      '<figure class="post-figure" data-figure="flow">' +
      '<svg class="fig-svg" viewBox="0 0 560 80" role="img" aria-labelledby="post-flow-en-title">' +
      '<title id="post-flow-en-title">A request passing one check</title>' +
      '<defs><marker id="post-flow-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs>' +
      '<rect x="0" y="20" width="160" height="40" class="fig-box"/>' +
      '<text x="80" y="44" class="fig-label" text-anchor="middle">request</text>' +
      '<path d="M160 40L240 40" class="fig-edge" marker-end="url(#post-flow-en-arrow)"/>' +
      '<rect x="240" y="20" width="160" height="40" class="fig-s1"/>' +
      "</svg>" +
      '<ol class="fig-steps"><li>request</li></ol>' +
      "<figcaption>One request, one check.</figcaption></figure>";
    const html = render(figure);
    // An HTML block, not inline HTML: a <figure> wrapped in a <p> is split apart by the browser.
    expect(html.startsWith('<figure class="post-figure" data-figure="flow">')).toBe(true);
    expect(html).not.toContain("&lt;");
    // SVG attributes keep their case (a lowercased viewbox would not scale the drawing) and the
    // accessible name stays inside the drawing it names.
    expect(html).toContain(
      '<svg class="fig-svg" viewBox="0 0 560 80" role="img" aria-labelledby="post-flow-en-title"><title id="post-flow-en-title">A request passing one check</title>',
    );
    expect(html).toContain('refX="9" refY="5" markerWidth="7" markerHeight="7"');
    expect(html).toContain('class="fig-edge" marker-end="url(#post-flow-en-arrow)"');
    expect(html).toContain(
      '<ol class="fig-steps"><li>request</li></ol><figcaption>One request, one check.</figcaption></figure>',
    );
  });

  it("still escapes angle brackets inside code spans", () => {
    const html = render("Snapshots live at `snapshots/v<version>.tar.gz`.");
    expect(html).toContain("<code>snapshots/v&lt;version&gt;.tar.gz</code>");
  });
});

/**
 * Blog images are not committed to this repo — they are hosted in the community repo, and post
 * bodies keep writing the portable `/blog-assets/<name>` path. What has to hold is therefore not
 * that a local file exists, but that the renderer resolves that path to the hosted URL; anything
 * else a post embeds must be left alone.
 */
describe("blog post images", () => {
  const HOSTED = blogAssetUrl("rag-app-en-light.webp");

  it("resolves a Markdown /blog-assets/ image to the community repo", () => {
    const html = renderWithImages("![The generated RAG app](/blog-assets/rag-app-en-light.webp)");
    expect(html).toContain(`src="${HOSTED}"`);
    expect(html).not.toContain('src="/blog-assets/');
    expect(html).toContain('alt="The generated RAG app"');
  });

  it("resolves raw <img> tags too, keeping their attributes", () => {
    const html = renderWithImages(
      '<img class="dark:hidden" src="/blog-assets/goal-mode-en-light.webp" alt="Goal mode" width="1920" height="1350" />',
    );
    expect(html).toContain(`src="${blogAssetUrl("goal-mode-en-light.webp")}"`);
    expect(html).toContain('class="dark:hidden"');
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1350"');
  });

  it("leaves every other image source untouched", () => {
    const external = "https://github.com/user-attachments/assets/a0d866e9";
    const html = renderWithImages(`![Local config](${external})\n\n![Site asset](/og-cover.png)`);
    expect(html).toContain(`src="${external}"`);
    expect(html).toContain('src="/og-cover.png"');
  });
});
