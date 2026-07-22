/**
 * Blog list: category chips (all / product news / tech practice / perspectives / release notes) +
 * post cards. A flat list in every view — each card carries its category badge,
 * chips filter by category, and pinned posts sort first.
 */
import { useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import { formatPostDate, postsFor } from "../lib/blog";
import type { BlogCategory } from "../lib/blog";
import { CategoryBadge, PinnedBadge } from "../components/category-badge";

type Filter = "all" | BlogCategory;

const FILTERS: Filter[] = ["all", "news", "practice", "perspectives", "changelog"];

export function BlogListPage() {
  const { locale } = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const posts = postsFor(locale, filter === "all" ? undefined : filter);

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
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={chip(filter === value)}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? S.blog.all : S.blog[value]}
            </button>
          ))}
        </div>
      </header>

      <div className="mt-8 flex flex-col gap-4">
        {posts.length === 0 && (
          <p className="rounded-xl border border-gray-200 px-5 py-10 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {S.blog.empty}
          </p>
        )}
        {posts.map((post) => (
          <Link
            key={post.slug}
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
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                {post.excerpt}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
