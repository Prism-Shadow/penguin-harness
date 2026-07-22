/**
 * Blog badges: category (news = brand fill, practice = brand outline, perspectives =
 * amber fill, changelog = neutral) + the pinned marker, all sharing the same pill shape.
 */
import { S } from "../lib/strings";
import type { BlogCategory } from "../lib/blog";

const CATEGORY_STYLES: Record<BlogCategory, string> = {
  news: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300",
  practice:
    "border-brand-200 bg-transparent text-brand-700 dark:border-brand-800 dark:text-brand-300",
  perspectives:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
  changelog:
    "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export function CategoryBadge({ category }: { category: BlogCategory }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CATEGORY_STYLES[category]}`}
    >
      {S.blog[category]}
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
