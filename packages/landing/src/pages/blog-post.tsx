/**
 * Blog post: the local Markdown body in the shared site prose (`SiteMarkdown`, the `post`
 * variant) with the sticky "on this page" column on wide screens. The page supplies what is the
 * blog's own: raw HTML in post bodies (`rehype-raw`, see the boundary note below), links that
 * open in a new tab, and images resolved to where the blog's media is hosted.
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
  hashTargetId,
  highlightSiteCode,
  SiteCopyButton,
  SiteMarkdown,
  SITE_REMARK_PLUGINS,
  SiteToc,
  useActiveTocEntry,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { SiteMarkdownComponents, SiteRemarkPlugins } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { blogAssetUrl } from "../lib/links";
import { formatAuthors, formatPostDate, getPost, loadPostBody, loadedPostBody } from "../lib/blog";
import type { BlogPost } from "../lib/blog";
import { CategoryBadge } from "../components/category-badge";
import { PostPending } from "../components/post-pending";

/**
 * Link adapter: every link in a post body opens in a new tab (`target="_blank"` + `rel="noreferrer"`,
 * which also implies `noopener`), unconditionally — including relative and `#anchor` hrefs, since a
 * post is a reading surface people come back to. Every other anchor prop react-markdown supplies
 * (`href`, and `title` from `[text](url "title")`) is forwarded as-is — only its non-DOM `node` prop
 * is stripped — and `target`/`rel` sit after the spread so the new-tab behavior always wins.
 * Long-URL wrapping is CSS (`.site-prose a` in the UI package's site-prose.css), not handled here.
 * Mirrors the Web App's chat renderer (packages/web/src/features/chat/md.tsx).
 */
export function MdLink({
  node: _node,
  children,
  ...anchorProps
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  return (
    <a {...anchorProps} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** The path prefix post bodies use for images this repo does not carry. */
const BLOG_ASSET_PREFIX = "/blog-assets/";

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
 */
export function MdImage({
  node: _node,
  src,
  ...imgProps
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  const resolved =
    typeof src === "string" && src.startsWith(BLOG_ASSET_PREFIX)
      ? blogAssetUrl(src.slice(BLOG_ASSET_PREFIX.length))
      : src;
  return <img {...imgProps} src={resolved} />;
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

/** A post body through the page's whole pipeline: the shared prose with the blog's own Markdown. */
export function PostBody({ body, className }: { body: string; className?: string }) {
  return (
    <SiteMarkdown
      variant="post"
      className={className}
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MD_COMPONENTS}
      highlight={highlightSiteCode}
    >
      {body}
    </SiteMarkdown>
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
 * The navigation whose hash target this page last scrolled to. Module state, like
 * useRouteScroll's, so the remount a language switch causes does not jump again.
 */
let scrolledFor = "";

/**
 * Scroll to the hash target (a TOC entry, a shared `#heading` link) once the body is in the
 * DOM. The layout's own route scroll runs when the route commits, which for a body still on
 * its way is before the heading exists.
 */
function useHashTarget(ready: boolean) {
  const { key, hash } = useLocation();
  useLayoutEffect(() => {
    if (!ready || key === scrolledFor) return;
    scrolledFor = key;
    if (hash) document.getElementById(hashTargetId(hash))?.scrollIntoView();
  }, [ready, key, hash]);
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
