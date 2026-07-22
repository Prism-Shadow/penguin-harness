/**
 * Blog post: renders the local Markdown body (react-markdown + GFM) in .md-body
 * style, with a sticky table of contents on wide screens. Headings get slug ids
 * (same slugifier as the TOC) and the active section is tracked with an
 * IntersectionObserver so the TOC highlights while scrolling.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import { formatAuthors, formatPostDate, getPost } from "../lib/blog";
import { extractToc, slugifyHeading } from "../lib/toc";
import { CategoryBadge } from "../components/category-badge";
import { ArrowRightIcon, CheckIcon, LinkIcon } from "../components/icons";

/** Flatten react-markdown heading children to plain text for slugging. */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/**
 * Link adapter: every link in a post body opens in a new tab (`target="_blank"` + `rel="noreferrer"`,
 * which also implies `noopener`), unconditionally — including relative and `#anchor` hrefs, since a
 * post is a reading surface people come back to. Every other anchor prop react-markdown supplies
 * (`href`, and `title` from `[text](url "title")`) is forwarded as-is — only its non-DOM `node` prop
 * is stripped — and `target`/`rel` sit after the spread so the new-tab behavior always wins.
 * Long-URL wrapping is CSS (`.md-body a` in styles.css), not handled here. Mirrors the Web App's
 * chat renderer (packages/web/src/features/chat/md.tsx).
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

/**
 * Built once at module scope rather than inline per render: react-markdown uses each entry as the
 * element **type**, so a fresh arrow every render is a new type on every commit and React remounts
 * that subtree instead of updating it. None of these adapters closes over render state, so a single
 * frozen map is enough.
 */
const MD_COMPONENTS: Components = {
  h2: ({ children }) => (
    <h2 id={slugifyHeading(nodeText(children))} className="scroll-mt-20">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={slugifyHeading(nodeText(children))} className="scroll-mt-20">
      {children}
    </h3>
  ),
  a: MdLink,
};

/** Copy text to the clipboard; reports whether a copy actually happened. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (e.g. non-secure context): fall back to a textarea
    // kept out of layout (fixed + invisible) so select() cannot scroll the page.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try {
      ta.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

/** Copies the page URL to the clipboard; the label flips to "copied" for ~2s. */
function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    if (!(await copyToClipboard(window.location.href))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="inline-flex items-center gap-1.5 transition-colors hover:text-gray-900 dark:hover:text-gray-100"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
      ) : (
        <LinkIcon className="h-3.5 w-3.5" />
      )}
      {copied ? S.blog.linkCopied : S.blog.copyLink}
    </button>
  );
}

function Toc({ entries, activeId }: { entries: ReturnType<typeof extractToc>; activeId: string }) {
  return (
    <aside className="hidden xl:block">
      <nav className="sticky top-24" aria-label={S.blog.toc}>
        <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
          {S.blog.toc}
        </p>
        <ul className="mt-3 space-y-1 border-l border-gray-200 text-sm dark:border-gray-800">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className={`-ml-px block border-l py-0.5 transition-colors ${
                  entry.depth === 3 ? "pl-6" : "pl-3"
                } ${
                  activeId === entry.id
                    ? "border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-300"
                    : "border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                }`}
              >
                {entry.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

export function BlogPostPage() {
  const { slug = "" } = useParams();
  const { locale } = useLocale();
  const post = getPost(slug, locale);
  const toc = useMemo(() => (post ? extractToc(post.body) : []), [post]);
  const [activeId, setActiveId] = useState("");

  // Track the last heading scrolled past the reading line (~100px under the sticky
  // header) for TOC highlighting. Scroll-position based rather than an
  // IntersectionObserver: with an observer nothing intersects the narrow top band
  // between headings, so the highlight would stall or skip while scrolling.
  useEffect(() => {
    if (toc.length < 2) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 4;
      let current = toc[0]!.id;
      if (atBottom) {
        current = toc[toc.length - 1]!.id;
      } else {
        for (const entry of toc) {
          const el = document.getElementById(entry.id);
          if (el && el.getBoundingClientRect().top <= 100) current = entry.id;
        }
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [toc]);

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
            <CopyLinkButton />
          </div>
        </header>
        <div className="md-body mt-8 text-[15px] text-gray-800 dark:text-gray-200">
          <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {post.body}
          </Markdown>
        </div>
      </article>
      {showToc && <Toc entries={toc} activeId={activeId} />}
    </div>
  );
}
