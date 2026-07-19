/**
 * Doc page: renders the Markdown body (react-markdown + GFM) in .md-body style with a
 * sticky "on this page" TOC on wide screens, a per-page Copy Markdown button, and
 * prev/next pagination following the sidebar order. Headings get slug ids (same
 * slugifier as the TOC) and the active section is tracked while scrolling — the same
 * mechanics as the landing page blog. Internal links written as "/<slug>" navigate
 * client-side; external links open in a new tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import { docMarkdown, docTitle, getDoc } from "../lib/docs";
import { DOC_SLUGS, HOME_SLUG, sectionOf } from "../lib/nav";
import { extractToc, slugifyHeading } from "../lib/toc";
import { CopyMarkdownButton } from "../components/copy-markdown-button";
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

function Toc({
  entries,
  activeId,
  onNavigate,
}: {
  entries: ReturnType<typeof extractToc>;
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <aside className="hidden xl:block">
      <nav
        className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto"
        aria-label={S.doc.toc}
      >
        <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
          {S.doc.toc}
        </p>
        <ul className="mt-3 space-y-1 border-l border-gray-200 text-sm dark:border-gray-800">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                onClick={() => onNavigate(entry.id)}
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

function Pager({ slug }: { slug: string }) {
  const { locale } = useLocale();
  const index = DOC_SLUGS.indexOf(slug);
  if (index === -1) return null;
  const prev = index > 0 ? DOC_SLUGS[index - 1]! : null;
  const next = index < DOC_SLUGS.length - 1 ? DOC_SLUGS[index + 1]! : null;
  const card = (target: string, dir: "prev" | "next") => (
    <Link
      to={target === HOME_SLUG ? "/" : `/${target}`}
      className={`group flex flex-col gap-1 rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700 ${
        dir === "next" ? "items-end text-right sm:col-start-2" : ""
      }`}
    >
      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {dir === "prev" && <ArrowRightIcon className="h-3 w-3 rotate-180" />}
        {dir === "prev" ? S.doc.prev : S.doc.next}
        {dir === "next" && <ArrowRightIcon className="h-3 w-3" />}
      </span>
      <span className="text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-300">
        {docTitle(target, locale)}
      </span>
    </Link>
  );
  return (
    <div className="mt-10 grid gap-3 border-t border-gray-200 pt-6 sm:grid-cols-2 dark:border-gray-800">
      {prev && card(prev, "prev")}
      {next && card(next, "next")}
    </div>
  );
}

/** Internal "/<slug>" links -> client-side navigation; external links -> new tab. */
function MdLink({ href = "", children }: { href?: string; children?: ReactNode }) {
  if (href.startsWith("/")) {
    return <Link to={href}>{children}</Link>;
  }
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

export function DocPage() {
  const { slug = HOME_SLUG } = useParams();
  const { locale } = useLocale();
  const doc = getDoc(slug, locale);
  const section = sectionOf(slug);
  const toc = useMemo(() => (doc ? extractToc(doc.body) : []), [doc]);
  const [activeId, setActiveId] = useState("");
  /**
   * A TOC click (or an initial #hash) pins the target entry as active: a short tail
   * section can never reach the reading line, so pure position tracking would highlight
   * a neighbor instead of what the user just chose. The pin releases on the first real
   * scroll gesture (wheel / touch / scroll keys) — programmatic smooth scrolling fires
   * only `scroll` events, so it never unpins by itself.
   */
  const pinnedId = useRef<string | null>(null);

  const pinTo = useCallback((id: string) => {
    pinnedId.current = id;
    setActiveId(id);
  }, []);

  // Track the heading last crossed by a moving reading line for TOC highlighting.
  // The line sits 100px under the sticky header at the top of the page and slides down
  // to ~40px above the viewport bottom at full scroll: it is monotonic in scrollY, so
  // every heading gets a highlight band of its own — short tail sections that could
  // never reach a fixed line are not skipped, and the highlight steps through sections
  // in order. Scroll-position based rather than an IntersectionObserver: with an
  // observer nothing intersects the narrow band between headings, so the highlight
  // would stall while scrolling.
  useEffect(() => {
    if (toc.length < 2) return;
    // Deep links carry the anchor percent-encoded (CJK headings); pin it if it is ours.
    const initialHash = decodeURIComponent(window.location.hash.slice(1));
    pinnedId.current = toc.some((entry) => entry.id === initialHash) ? initialHash : null;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (pinnedId.current !== null) {
        setActiveId(pinnedId.current);
        return;
      }
      const docEl = document.documentElement;
      const maxScroll = Math.max(0, docEl.scrollHeight - window.innerHeight);
      const progress = maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0;
      const line = 100 + Math.max(0, window.innerHeight - 140) * progress;
      let current = toc[0]!.id;
      for (const entry of toc) {
        const el = document.getElementById(entry.id);
        if (el && el.getBoundingClientRect().top <= line) current = entry.id;
      }
      // Safety net: fully at the bottom nothing can advance further — settle on the last
      // entry (only after the page actually scrolled; a viewport-short page stays on top).
      if (maxScroll > 0 && window.scrollY >= maxScroll - 4) current = toc[toc.length - 1]!.id;
      setActiveId(current);
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    const unpin = (e?: KeyboardEvent) => {
      if (e && !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(e.key))
        return;
      if (pinnedId.current === null) return;
      pinnedId.current = null;
      onScroll();
    };
    const onWheel = () => unpin();
    const onKey = (e: KeyboardEvent) => unpin(e);
    // Same-page hash navigation (address bar / in-content anchors) re-runs no effect,
    // so re-evaluate the pin whenever the hash changes.
    const onHashChange = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (toc.some((entry) => entry.id === hash)) {
        pinnedId.current = hash;
        setActiveId(hash);
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHashChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [toc]);

  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <p className="text-lg font-medium">{S.doc.notFound}</p>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
          {S.doc.backHome}
        </Link>
      </div>
    );
  }

  const showToc = toc.length >= 2;

  return (
    <div
      className={`anim-rise px-4 py-10 sm:px-6 lg:px-10 ${
        showToc ? "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10" : ""
      }`}
    >
      <article className="mx-auto w-full max-w-3xl xl:mx-0">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {section && (
                <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">
                  {S.sections[section.id]}
                </p>
              )}
              <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-balance">
                {doc.title}
              </h1>
            </div>
            <div className="pt-1.5">
              <CopyMarkdownButton text={docMarkdown(doc)} />
            </div>
          </div>
          {doc.description && (
            <p className="mt-3 text-[15px] text-gray-600 dark:text-gray-400">{doc.description}</p>
          )}
        </header>
        <div className="md-body mt-6 text-[15px] text-gray-800 dark:text-gray-200">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => <MdLink href={href}>{children}</MdLink>,
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
            {doc.body}
          </Markdown>
        </div>
        <Pager slug={slug} />
      </article>
      {showToc && <Toc entries={toc} activeId={activeId} onNavigate={pinTo} />}
    </div>
  );
}
