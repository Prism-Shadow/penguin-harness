/**
 * The static shell of one route, cut from the built index.html: its self-referencing URLs
 * (canonical, og:url) pointed at the route and, for a page with metadata of its own, its title,
 * description and share card in place of the home page's. This is what a crawler or a link
 * unfurler reads — neither runs the SPA — so a page that should be shared under its own name needs
 * it here. Pure: postbuild.mjs reads and writes the files.
 *
 * Every tag a route needs must be in the shell; a missing one throws, failing the build rather
 * than shipping a page under the home page's name or URL.
 */

/** The tags this module rewrites, matched loosely enough to survive Vite's HTML rewriting. */
const TAGS = {
  canonical: /<link\s+rel="canonical"[^>]*>/,
  "og:url": /<meta\s+property="og:url"[^>]*>/,
  title: /<title>[\s\S]*?<\/title>/,
  description: /<meta\s+name="description"[^>]*>/,
  "og:type": /<meta\s+property="og:type"[^>]*>/,
  "og:title": /<meta\s+property="og:title"[^>]*>/,
  "og:description": /<meta\s+property="og:description"[^>]*>/,
  "og:image": /<meta\s+property="og:image"[^>]*>/,
  "og:image:alt": /<meta\s+property="og:image:alt"[^>]*>/,
  "twitter:image": /<meta\s+name="twitter:image"[^>]*>/,
};

const escapeAttribute = (value) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeText = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function replaceTag(html, name, tag) {
  const pattern = TAGS[name];
  if (!pattern.test(html)) {
    throw new Error(`[postbuild] no ${name} tag in dist/index.html — index.html must declare one`);
  }
  return html.replace(pattern, () => tag);
}

/**
 * The shell for a route at `url` (absolute). `meta`, when given, names the page: its title,
 * description, share image (an absolute URL) and the image's alt text.
 */
export function shellFor(shell, url, meta) {
  let html = replaceTag(
    shell,
    "canonical",
    `<link rel="canonical" href="${escapeAttribute(url)}" />`,
  );
  html = replaceTag(html, "og:url", `<meta property="og:url" content="${escapeAttribute(url)}" />`);
  if (meta) {
    // Keep the site defaults from the template so leaving a directly opened detail restores
    // the same home metadata as a visit that started on the home page.
    const homeTitle = TAGS.title.exec(shell)?.[0].slice("<title>".length, -"</title>".length) ?? "";
    html = replaceTag(
      html,
      "title",
      `<title data-default="${homeTitle.replace(/"/g, "&quot;")}">${escapeText(meta.title)}</title>`,
    );
    for (const [name, value] of Object.entries({
      description: meta.description,
      "og:title": meta.title,
      "og:description": meta.description,
      "og:type": meta.type ?? "website",
      "og:image": meta.image,
      "og:image:alt": meta.imageAlt,
      "twitter:image": meta.image,
    })) {
      const tag = TAGS[name].exec(shell)?.[0] ?? "";
      const original = /\scontent="([^"]*)"/.exec(tag)?.[1] ?? "";
      const attribute = name.startsWith("og:") ? "property" : "name";
      html = replaceTag(
        html,
        name,
        `<meta ${attribute}="${name}" content="${escapeAttribute(value)}" data-default="${original}" />`,
      );
    }
  }
  // Twitter and Open Graph describe the same page, including their home defaults.
  const twitter = ["title", "description", "url"].map((field) =>
    TAGS[`og:${field}`].exec(html)[0].replace(`property="og:${field}"`, `name="twitter:${field}"`),
  );
  return html.replace("</head>", () => twitter.join("\n") + "\n</head>");
}

/**
 * The shell for paths that do not exist (404.html): no canonical, since claiming the home page as
 * the canonical of an unknown URL would ask search engines to fold every typo into it.
 */
export function notFoundShell(shell) {
  return shell.replace(TAGS.canonical, "");
}

/** Directory links also reach crawlers and readers that do not execute the SPA. */
export function withDirectoryLinks(shell, links) {
  const items = links.map(
    ({ href, label }) => `<li><a href="${escapeAttribute(href)}">${escapeText(label)}</a></li>`,
  );
  return shell.replace("</body>", () => `<noscript><ul>${items.join("")}</ul></noscript>\n</body>`);
}
