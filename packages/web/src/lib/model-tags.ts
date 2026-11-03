<<<<<<< HEAD:packages/web/src/lib/model-tags.ts
import { S } from "./strings";
|||||||| parent of c87e240ae8 (b4a: move models group (routes, balance/oauth/modelscope services, models web) to plugins/models):packages/web/src/features/models/model-tags.ts
import { S } from "../../lib/strings";
========
import { S } from "@prismshadow/penguin-web/internal";

import type { DiscountedPrice } from "./model-grouping";

/** Each group's tone, for the `Badge` a mark renders as. */
export const TAG_TONE = {
  status: "info",
  capability: "success",
  price: "attention",
} as const satisfies Record<string, ToneName>;

export interface ModelTag {
  key: "default" | "vision" | "visionModel" | "fastMode" | "free" | "discount";
  label: string;
  /** Hover text, for a mark whose word needs a sentence behind it (a discount's terms). */
  title?: string;
  /** The mark's group's tone (TAG_TONE), for the `Badge` it renders as. */
  tone: ToneName;
}

type MarkGroup = keyof typeof TAG_TONE;

/** A group's tone, as the mark carries it. */
const toneOf = (group: MarkGroup) => ({ tone: TAG_TONE[group] });

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
    facts.isDefault && { key: "default", label: S.models.default, ...toneOf("status") },
    facts.vision && { key: "vision", label: S.models.visionBadge, ...toneOf("capability") },
    facts.isVisionModel && {
      key: "visionModel",
      label: S.models.visionModelBadge,
      ...toneOf("capability"),
    },
    facts.fastMode && { key: "fastMode", label: S.models.fastModeBadge, ...toneOf("capability") },
    facts.free && { key: "free", label: S.models.freeBadge, ...toneOf("price") },
    discount && {
      key: "discount",
      label: S.models.discountBadge(discount.percent),
      title: discount.peak
        ? S.models.offPeakTitle(discount.percent, discount.peak)
        : S.models.discountTitle(discount.percent),
      ...toneOf("price"),
    },
  ];
  return tags.filter((tag): tag is ModelTag => !!tag);
}
