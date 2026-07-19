/**
 * Blog post: renders the local Markdown body (react-markdown + GFM) in .md-body
 * style, with a sticky table of contents on wide screens. Headings get slug ids
 * (same slugifier as the TOC) and the active section is tracked with an
 * IntersectionObserver so the TOC highlights while scrolling.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import { getPost } from "../lib/blog";
import { extractToc, slugifyHeading } from "../lib/toc";
import { CategoryBadge } from "../components/category-badge";
import { ArrowRightIcon } from "../components/icons";

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
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <time dateTime={post.date} className="tabular-nums">
              {post.date}
            </time>
            <CategoryBadge category={post.category} />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">{post.title}</h1>
        </header>
        <div className="md-body mt-8 text-[15px] text-gray-800 dark:text-gray-200">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
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
            }}
          >
            {post.body}
          </Markdown>
        </div>
      </article>
      {showToc && <Toc entries={toc} activeId={activeId} />}
    </div>
  );
}
