/**
 * Blog badges on the shared site pill: category (news = brand fill, practice = brand outline,
 * perspectives = teal fill, changelog = neutral) and the pinned marker.
 */
import { SitePill } from "@prismshadow/penguin-ui/site";
import type { SitePillTone } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import type { BlogCategory } from "../lib/blog";

const CATEGORY_TONE: Record<BlogCategory, SitePillTone> = {
  news: "brand",
  practice: "brand-outline",
  perspectives: "teal",
  changelog: "neutral",
};

export function CategoryBadge({ category }: { category: BlogCategory }) {
  return <SitePill tone={CATEGORY_TONE[category]}>{S.blog[category]}</SitePill>;
}

export function PinnedBadge() {
  return <SitePill tone="brand">{S.blog.pinned}</SitePill>;
}
