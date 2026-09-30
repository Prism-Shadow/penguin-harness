/**
 * The standing marks a model carries wherever it is listed — the models page's cards and the
 * model picker's rows — so the two agree on which marks exist, what they say, their order and
 * their ink.
 *
 * Every mark wears one small neutral pill — the same faint border whatever it says — and the
 * hue survives only in the text. Six marks filling six coloured chips turned a row of tags into
 * confetti; on a list whose job is scanning names, the marks are meant to be noticed second.
 *
 * Three inks, so the row groups instead of enumerating: what the model IS (its default status),
 * what it CAN do, and what it COSTS. Identity is carried by the words in every case — the ink
 * only sorts them at a glance, and never alone says which mark this is.
 *
 * These are identities, not judgements, which is why they are spelled here instead of in
 * `lib/tone.ts`, whose five tones each rate a thing's state — the same reason
 * `category-colors.ts` and `update-dot.tsx` keep their own colours. Contrast against the
 * surfaces a mark sits on (white and gray-50 in light; this app's overridden gray-950 `#000000`
 * and gray-900 `#0d0d0d` in dark) clears 4.5:1 for every ink; the shared border is decorative,
 * so it is not held to 3:1.
 */
import { S } from "../../lib/strings";
import type { DiscountedPrice } from "./model-grouping";

/** The pill itself: no fill at all, so a row of marks sits on its row rather than on top of it. */
export const TAG_SHAPE =
  "whitespace-nowrap rounded-full border border-gray-200 px-1.5 text-[10px] font-medium leading-[15px] dark:border-gray-700";

export const TAG_INK = {
  /** This model's standing in the Project. */
  status: "text-brand-700 dark:text-brand-300",
  /** What it can do. */
  capability: "text-emerald-700 dark:text-emerald-400",
  /** What it costs. */
  price: "text-amber-700 dark:text-amber-400",
} as const;

export interface ModelTag {
  key: "default" | "vision" | "visionModel" | "fastMode" | "free" | "discount";
  label: string;
  /** Hover text, for a mark whose word needs a sentence behind it (a discount's terms). */
  title?: string;
  /** One of TAG_INK. */
  className: string;
}

/** What a list knows about one model, from which its marks follow. */
export interface ModelTagFacts {
  /** The Project's default model. */
  isDefault: boolean;
  /** Accepts image input (the effective annotation: unset counts as supported). */
  vision: boolean;
  /** The Project's vision proxy for read_file. Only the models page shows it. */
  isVisionModel?: boolean;
  /** Fast mode (premium serving tier) is on for this entry. */
  fastMode?: boolean;
  /** Zero-cost (isFreeModel). */
  free: boolean;
  /** The saving that applies right now (discountedPrice); absent when none does. */
  discount?: DiscountedPrice | undefined;
}

/**
 * Every mark `facts` earns, in a fixed order rather than by which happen to be true, so the eye
 * can learn where to look: what this Project chose (default, vision proxy) before what the
 * model is (vision, fast, free) before what it costs today (the discount).
 */
export function modelTags(facts: ModelTagFacts): ModelTag[] {
  const { discount } = facts;
  const tags: Array<ModelTag | false | undefined> = [
    facts.isDefault && { key: "default", label: S.models.default, className: TAG_INK.status },
    facts.vision && { key: "vision", label: S.models.visionBadge, className: TAG_INK.capability },
    facts.isVisionModel && {
      key: "visionModel",
      label: S.models.visionModelBadge,
      className: TAG_INK.capability,
    },
    facts.fastMode && {
      key: "fastMode",
      label: S.models.fastModeBadge,
      className: TAG_INK.capability,
    },
    facts.free && { key: "free", label: S.models.freeBadge, className: TAG_INK.price },
    discount && {
      key: "discount",
      label: S.models.discountBadge(discount.percent),
      title: discount.peak
        ? S.models.offPeakTitle(discount.percent, discount.peak)
        : S.models.discountTitle(discount.percent),
      className: TAG_INK.price,
    },
  ];
  return tags.filter((tag): tag is ModelTag => !!tag);
}
