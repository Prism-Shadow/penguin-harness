/**
 * Latest updates: the four newest product-news and practice posts from the blog index, as dated
 * cards (date and category on one grey line, then the title), and a link to every post.
 */
import { Link } from "react-router";
import { S } from "../lib/strings";
import { formatPostDate, latestPosts } from "../lib/blog";
import { useReveal } from "../lib/reveal";
import { useLocale } from "../state/locale";
import { ArrowRightIcon } from "../components/icons";

/** How many posts the row shows: one row of four on wide screens. */
const SHOWN = 4;

export function Updates() {
  const { locale } = useLocale();
  const ref = useReveal<HTMLElement>();
  const posts = latestPosts(locale, SHOWN);
  if (posts.length === 0) return null;
  return (
    <section ref={ref} className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{S.updates.title}</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {posts.map((post) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="group flex flex-col rounded-xl bg-gray-50 p-4 transition-colors hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-900"
            >
              <p className="text-xs text-gray-500 dark:text-gray-400">
                <time dateTime={post.date} className="tabular-nums">
                  {formatPostDate(post.date, locale)}
                </time>
                {" · "}
                {S.blog[post.category]}
              </p>
              <h3 className="mt-2 text-[15px] leading-snug font-medium break-keep [overflow-wrap:break-word] text-gray-900 group-hover:text-brand-700 dark:text-gray-100 dark:group-hover:text-brand-300">
                {post.title}
              </h3>
            </Link>
          ))}
        </div>
        <Link
          to="/blog"
          className="group mt-5 inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {S.updates.all}
          <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}
