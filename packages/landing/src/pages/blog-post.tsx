/**
 * Blog post: the local Markdown body in the shared site prose (`SiteMarkdown`, the `post`
 * variant) with the sticky "on this page" column on wide screens. The page supplies what is the
 * blog's own: raw HTML in post bodies (`rehype-raw`, see the boundary note below), links that
 * open according to where they go, numbered citations, and images resolved to where the blog's
 * media is hosted.
 *
 * This module and each post's body are chunks of their own (see the router and lib/blog.ts),
 * so the Markdown renderer and the post text reach a reader only when a post is opened.
 */
import { useEffect, useLayoutEffect, useMemo, useReducer } from "react";
import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import rehypeRaw from "rehype-raw";
import { Link, useLocation, useParams } from "react-router";
import {
  ArrowRightIcon,
  extractToc,
  highlightSiteCode,
  SiteCopyButton,
  SiteMarkdown,
  SITE_REMARK_PLUGINS,
  SiteToc,
  useActiveTocEntry,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type {
  SiteMarkdownComponents,
  SiteRemarkPlugins,
  SiteRemarkRehypeOptions,
} from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import type { Strings } from "../lib/strings";
import { blogAssetUrl, SITE_HOSTS } from "../lib/links";
import { classifyPostHref, inPageHash } from "../lib/post-links";
import { landOnHash } from "../lib/hash-arrival";
import imageSizes from "../lib/blog-image-sizes.json";
import { formatAuthors, formatPostDate, getPost, loadPostBody, loadedPostBody } from "../lib/blog";
import type { BlogPost } from "../lib/blog";
import { CategoryBadge } from "../components/category-badge";
import { ExternalLink, ExternalLinkScope } from "../components/external-link";
import { PostPending } from "../components/post-pending";

/**
 * The host names that are this site: the production ones, and the one this page is served from
 * (a preview deployment, a local build). Read once; a page never changes host.
 */
const OWN_HOSTS: readonly string[] =
  typeof window === "undefined" ? SITE_HOSTS : [...SITE_HOSTS, window.location.hostname];

/**
 * Link adapter: a link opens according to where it goes (lib/post-links.ts).
 *
 * - A `#` link stays on the page: a citation and its entry in the references, a heading. The
 *   browser scrolls to the target; the route scroll and the page's hash effect agree with it. An
 *   address of this same page with a fragment (`/blog/<post>#…`, `https://penguin.ooo/blog/<post>#…`)
 *   is rendered as the bare fragment, so it is such a jump too (lib/post-links.ts, `inPageHash`).
 * - A page of this site opens in a new tab (`target="_blank"` + `rel="noreferrer"`, which also
 *   implies `noopener`), since a post is a reading surface people come back to.
 * - Anywhere else opens in a new tab once the reader confirms, through the confirmation the page
 *   mounts around the body (`ExternalLinkScope` in PostBody); outside that scope it is an ordinary
 *   new-tab link.
 *
 * Every other anchor prop react-markdown supplies (`title` from `[text](url "title")`, and the ids,
 * `data-footnote-*` and `aria-*` attributes of a citation and its back-links) is forwarded; only
 * the non-DOM `node` prop is stripped. Long-URL wrapping is CSS (`.site-prose a` in the UI
 * package's site-prose.css), not handled here.
 */
export function MdLink({
  node: _node,
  children,
  ...anchorProps
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const { href = "" } = anchorProps;
  const here = typeof window === "undefined" ? "" : window.location.pathname;
  const hash = inPageHash(href, OWN_HOSTS, here);
  if (hash) {
    return (
      <a {...anchorProps} href={hash}>
        {children}
      </a>
    );
  }
  const kind = classifyPostHref(href, OWN_HOSTS);
  if (kind === "external") {
    return (
      <ExternalLink
        href={href}
        className={anchorProps.className}
        title={anchorProps.title}
        aria-label={anchorProps["aria-label"]}
      >
        {children}
      </ExternalLink>
    );
  }
  return (
    <a {...anchorProps} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** The path prefix post bodies use for images this repo does not carry. */
const BLOG_ASSET_PREFIX = "/blog-assets/";

/** Each Markdown image's width and height, by its source as the post writes it. */
const IMAGE_SIZES: Readonly<Record<string, readonly number[] | undefined>> = imageSizes;

/**
 * Image adapter: rewrites `/blog-assets/<name>` sources to the community repo that actually hosts
 * them (see blogAssetUrl in lib/links.ts). Every other src — absolute URLs, GitHub user-attachment
 * uploads, anything else a post embeds — is forwarded untouched.
 *
 * The rewrite lives here rather than in the Markdown so there is one source of truth for the
 * hosting location: post bodies keep the stable, portable relative path, they stay readable and
 * diffable, and the tests that assert on those paths keep asserting on the paths. Applies equally
 * to `![alt](…)` and to the raw `<img src="…">` tags posts use for theme-swapped screenshots,
 * because rehype-raw turns those into ordinary `img` nodes before this map is consulted.
 *
 * A Markdown image gets the width and height recorded for it (lib/blog-image-sizes.json, written
 * by scripts/blog-image-sizes.mjs), so its place is held before the picture arrives: the
 * preflight's `height: auto` keeps it fluid at that aspect ratio. Without a size, each picture
 * that loads pushes down everything below it, the reader's place and the target of a jump in
 * flight alike. A raw `<img>` keeps the size it was written with.
 */
export function MdImage({
  node: _node,
  src,
  width,
  height,
  ...imgProps
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  const recorded =
    typeof src === "string" && width === undefined && height === undefined
      ? IMAGE_SIZES[src]
      : undefined;
  const resolved =
    typeof src === "string" && src.startsWith(BLOG_ASSET_PREFIX)
      ? blogAssetUrl(src.slice(BLOG_ASSET_PREFIX.length))
      : src;
  return (
    <img
      {...imgProps}
      src={resolved}
      width={recorded?.[0] ?? width}
      height={recorded?.[1] ?? height}
    />
  );
}

/**
 * Built once at module scope rather than inline per render: react-markdown uses each entry as the
 * element **type**, so a fresh arrow every render is a new type on every commit and React remounts
 * that subtree instead of updating it. None of these adapters closes over render state, so a single
 * frozen map is enough. Headings and code blocks are the shared renderer's.
 */
export const MD_COMPONENTS: SiteMarkdownComponents = {
  a: MdLink,
  img: MdImage,
};

/**
 * Module-scope plugin lists, for the same reason MD_COMPONENTS is: a fresh array literal per
 * render is a new prop identity and re-runs the whole unified pipeline on every commit.
 */
export const REMARK_PLUGINS: SiteRemarkPlugins = SITE_REMARK_PLUGINS;

/**
 * `rehype-raw` re-parses the raw HTML that remark leaves as opaque `raw` nodes, which is the only
 * way `<details>`/`<summary>` (and the `<img width height alt>` tags some posts already use) render
 * as elements instead of escaped text.
 *
 * **The trust boundary this depends on.** Post bodies are first-party Markdown committed to this
 * repo and bundled at build time (`import.meta.glob("../../content/blog/*.md", { query: "?raw" })`
 * in lib/blog.ts; each file becomes a chunk of this site's own build) — never fetched from anywhere
 * else, never user-submitted, never model output. Re-enabling raw HTML therefore grants the
 * content exactly the privilege its neighbours in the same repo already have: anything able to
 * land HTML here could equally land a `<script>` in this very file, so a sanitizer
 * would be guarding the *least* privileged input in the build while costing a dependency and
 * silently dropping attributes authors legitimately write. It is deliberately not paired with
 * `rehype-sanitize` for that reason, and the reason is the boundary, not the risk appetite:
 *
 *   If post bodies ever come from anywhere but this repo — a CMS, reader submissions, an API —
 *   `rehype-raw` MUST be paired with `rehype-sanitize`, or dropped.
 *
 * The Web App's chat renderer (packages/web/src/features/chat/md.tsx) renders LLM output, which is
 * untrusted by construction; it must never gain `rehype-raw`. Same library, opposite boundary.
 */
export const REHYPE_PLUGINS = [rehypeRaw];

/**
 * Citations are GFM footnotes (`…a sentence[^1].` in the text, before the sentence's punctuation,
 * and `[^1]: [Title](https://…)` at the end), rendered as numbered references with a labelled list
 * after the body. The shared renderer sets each run of them as one bracketed group, `[1, 2]`, with
 * every number its own link; the options below decide the rest:
 *
 * - No id prefix, so the ids are `fn-1` (the entry) and `fnref-1`, `fnref-1-2`, … (each place that
 *   cites it): plain ASCII whatever the post's language, and nothing for a hash to decode.
 * - The list's heading is visible and comes from the site's dictionary; posts do not write one.
 * - A back-link is an arrow, numbered from the second place that cites the same source, and
 *   names its destination for screen readers. The arrow takes the text presentation selector, or
 *   some platforms draw it as an emoji.
 *
 * One object per dictionary, so a language keeps one prop identity across renders.
 */
const footnoteOptions = new WeakMap<Strings, SiteRemarkRehypeOptions>();

const BACK_ARROW = "\u21a9\ufe0e";

function footnoteOptionsFor(strings: Strings): SiteRemarkRehypeOptions {
  const known = footnoteOptions.get(strings);
  if (known) return known;
  const options: SiteRemarkRehypeOptions = {
    clobberPrefix: "",
    footnoteLabel: strings.blog.references,
    // No class: the default one hides the heading from sight.
    footnoteLabelProperties: {},
    footnoteBackLabel: (index, citation) => strings.blog.backToRef(index + 1, citation),
    footnoteBackContent: (_index, citation) =>
      citation > 1
        ? [
            { type: "text", value: BACK_ARROW },
            {
              type: "element",
              tagName: "sup",
              properties: {},
              children: [{ type: "text", value: String(citation) }],
            },
          ]
        : BACK_ARROW,
  };
  footnoteOptions.set(strings, options);
  return options;
}

/**
 * A post body through the page's whole pipeline: the shared prose with the blog's own Markdown,
 * inside the confirmation its external links open (one dialog per post, outside the prose so the
 * article's styles never reach it).
 */
export function PostBody({ body, className }: { body: string; className?: string }) {
  return (
    <ExternalLinkScope>
      <SiteMarkdown
        variant="post"
        className={className}
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        remarkRehypeOptions={footnoteOptionsFor(S)}
        components={MD_COMPONENTS}
        highlight={highlightSiteCode}
      >
        {body}
      </SiteMarkdown>
    </ExternalLinkScope>
  );
}

const otherLocale = (post: BlogPost) => (post.lang === "en" ? "zh" : "en");

/**
 * The post's body: in the first render when it is already loaded, otherwise once it arrives.
 * The other language's version is fetched next, so a language switch — which remounts the page
 * and restores the reader's scroll position in the same frame — finds the whole post at once.
 */
function usePostBody(post: BlogPost | undefined): string | undefined {
  const [, arrived] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!post) return;
    let live = true;
    void loadPostBody(post).then(
      () => {
        if (live) arrived();
        const other = getPost(post.slug, otherLocale(post));
        if (other && other !== post) void loadPostBody(other).catch(() => undefined);
      },
      // A chunk that fails to load reloads the page (main.tsx); the page stays pending meanwhile.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [post]);
  return post && loadedPostBody(post);
}

/**
 * The navigation whose anchor this page last landed on. Module state, like useRouteScroll's, so
 * the remount a language switch causes does not jump again.
 */
let landedFor = "";

/**
 * Land on the address's anchor (a shared `#fn-3` or `#heading` link) once the body is in the DOM,
 * as the browser would have at load had the body been there (lib/hash-arrival.ts): the target is
 * marked and washed, and scrolled clear of the sticky header once the page has finished rising.
 * The layout's own route scroll runs when the route commits, which for a body still on its way is
 * before the target exists. Jumps made inside the page are the browser's own; the pictures'
 * recorded sizes (MdImage) keep their targets in place while the pictures arrive.
 */
function useHashTarget(ready: boolean) {
  const { key } = useLocation();
  useLayoutEffect(() => {
    if (!ready || key === landedFor) return;
    let live = true;
    void landOnHash(window, () => live).then(() => {
      if (live) landedFor = key;
    });
    return () => {
      live = false;
    };
  }, [ready, key]);
}

export function BlogPostPage() {
  const { slug = "" } = useParams();
  const { locale } = useSiteLocale();
  const post = getPost(slug, locale);
  const body = usePostBody(post);
  const toc = useMemo(() => (body === undefined ? [] : extractToc(body)), [body]);
  const { activeId, pinTo } = useActiveTocEntry(toc);
  useHashTarget(body !== undefined);

  if (!post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <p className="text-lg font-medium">{S.blog.notFound}</p>
        <Link
          to="/blog"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          {S.blog.back}
        </Link>
      </div>
    );
  }

  // The header and the body appear together, as one page: the layout depends on the body's
  // headings (the TOC column), so a header shown alone would shift sideways when the body lands.
  if (body === undefined) return <PostPending />;

  const showToc = toc.length >= 2;

  return (
    <div
      className={`anim-rise mx-auto px-4 py-14 sm:px-6 ${
        showToc ? "max-w-5xl xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-12" : "max-w-3xl"
      }`}
    >
      <article className={showToc ? "mx-auto w-full max-w-3xl xl:mx-0" : ""}>
        <Link
          to="/blog"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
          {S.blog.back}
        </Link>
        <header className="mt-6">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{post.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
            <time dateTime={post.date} className="tabular-nums">
              {formatPostDate(post.date, locale)}
            </time>
            <span aria-hidden="true">·</span>
            <span>{formatAuthors(post.authors, locale)}</span>
            <CategoryBadge category={post.category} />
            <SiteCopyButton
              text={() => window.location.href}
              label={S.blog.copyLink}
              announcement={S.blog.linkCopied}
              look="text"
              glyph="link"
            />
          </div>
        </header>
        <PostBody body={body} className="mt-8" />
      </article>
      {showToc && (
        <SiteToc label={S.blog.toc} entries={toc} activeId={activeId} onNavigate={pinTo} />
      )}
    </div>
  );
}
