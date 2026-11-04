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
  if (meta === undefined) return html;
  const content = (property, value, attribute = "property") =>
    `<meta ${attribute}="${property}" content="${escapeAttribute(value)}" />`;
  // The site's own title and description ride along, for the page to put back when the reader
  // leaves it inside the app (lib/document-meta.ts): the shell is all the app booted from.
  // Both are copied as the shell encodes them: the title is element text (an attribute needs its
  // quotes encoded too), the description already an attribute value.
  const home = {
    title: (TAGS.title.exec(shell)?.[0].replace(/<\/?title>/g, "") ?? "").replace(/"/g, "&quot;"),
    description: /\scontent="([^"]*)"/.exec(TAGS.description.exec(shell)?.[0] ?? "")?.[1] ?? "",
  };
  html = replaceTag(
    html,
    "title",
    `<title data-default="${home.title}">${escapeText(meta.title)}</title>`,
  );
  html = replaceTag(
    html,
    "description",
    `<meta name="description" content="${escapeAttribute(meta.description)}" data-default="${home.description}" />`,
  );
  html = replaceTag(html, "og:title", content("og:title", meta.title));
  html = replaceTag(html, "og:description", content("og:description", meta.description));
  html = replaceTag(html, "og:image", content("og:image", meta.image));
  html = replaceTag(html, "og:image:alt", content("og:image:alt", meta.imageAlt));
  html = replaceTag(html, "twitter:image", content("twitter:image", meta.image, "name"));
  return html;
}

/**
 * The shell for paths that do not exist (404.html): no canonical, since claiming the home page as
 * the canonical of an unknown URL would ask search engines to fold every typo into it.
 */
export function notFoundShell(shell) {
  return shell.replace(TAGS.canonical, "");
}
