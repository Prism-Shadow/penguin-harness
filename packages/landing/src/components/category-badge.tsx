/** Blog badges: category (product news = brand tint, release notes = neutral) + pinned. */
import { S } from "../lib/strings";
import type { BlogCategory } from "../lib/blog";

export function CategoryBadge({ category }: { category: BlogCategory }) {
  const isNews = category === "news";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        isNews
          ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300"
          : "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
      }`}
    >
      {isNews ? S.blog.news : S.blog.changelog}
    </span>
  );
}

export function PinnedBadge() {
  return (
    <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300">
      {S.blog.pinned}
    </span>
  );
}
