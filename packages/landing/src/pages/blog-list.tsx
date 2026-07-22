/**
 * Blog list: category chips (all / product news / release notes) + post cards.
 * The "all" view groups cards by category under muted section headers; picking
 * a category chip shows a flat filtered list. Pinned posts sort first either way.
 */
import { useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import { formatPostDate, postsFor } from "../lib/blog";
import type { BlogCategory, BlogPost } from "../lib/blog";
import { CategoryBadge, PinnedBadge } from "../components/category-badge";

type Filter = "all" | BlogCategory;

const GROUP_ORDER: BlogCategory[] = ["news", "changelog"];

function PostCard({ post }: { post: BlogPost }) {
  const { locale } = useLocale();
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="anim-rise group rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 sm:p-6 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <time dateTime={post.date} className="tabular-nums">
          {formatPostDate(post.date, locale)}
        </time>
        <CategoryBadge category={post.category} />
        {post.pinned && <PinnedBadge />}
      </div>
      <h2 className="mt-2 text-lg font-semibold tracking-tight group-hover:text-brand-700 dark:group-hover:text-brand-300">
        {post.title}
      </h2>
      {post.excerpt && (
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{post.excerpt}</p>
      )}
    </Link>
  );
}

export function BlogListPage() {
  const { locale } = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const posts = postsFor(locale, filter === "all" ? undefined : filter);
  const groups =
    filter === "all"
      ? GROUP_ORDER.map((category) => ({
          category,
          posts: posts.filter((post) => post.category === category),
        })).filter((group) => group.posts.length > 0)
      : null;

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
      active
        ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
        : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900"
    }`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <header className="anim-rise">
        <h1 className="text-3xl font-semibold tracking-tight">{S.blog.title}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{S.blog.subtitle}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
            {S.blog.all}
          </button>
          <button
            type="button"
            className={chip(filter === "news")}
            onClick={() => setFilter("news")}
          >
            {S.blog.news}
          </button>
          <button
            type="button"
            className={chip(filter === "changelog")}
            onClick={() => setFilter("changelog")}
          >
            {S.blog.changelog}
          </button>
        </div>
      </header>

      <div className={`mt-8 flex flex-col ${groups ? "gap-10" : "gap-4"}`}>
        {posts.length === 0 && (
          <p className="rounded-xl border border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {S.blog.empty}
          </p>
        )}
        {groups
          ? groups.map((group) => (
              <section key={group.category}>
                <h2 className="anim-rise text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
                  {group.category === "news" ? S.blog.news : S.blog.changelog}
                </h2>
                <div className="mt-3 flex flex-col gap-4">
                  {group.posts.map((post) => (
                    <PostCard key={post.slug} post={post} />
                  ))}
                </div>
              </section>
            ))
          : posts.map((post) => <PostCard key={post.slug} post={post} />)}
      </div>
    </div>
  );
}
