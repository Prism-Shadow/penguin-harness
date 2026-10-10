/**
 * The standing marks a model carries wherever it is listed — the models page's cards and the
 * model picker's rows — so the two agree on which marks exist, what they say, their order and
 * their tone.
 *
 * Every mark is the package's tag — an outlined sm `Badge`, so the marks look like every other
 * tag in the theme, and with no fill, so a row of marks sits on its row rather than on top of
 * it. Six marks filling six coloured chips turned a row of tags into confetti; on a list whose
 * job is scanning names, the marks are meant to be noticed second.
 *
 * Three tones, so the row groups instead of enumerating: what the model IS (its default status,
 * `info`), what it CAN do (`success`), and what it COSTS (`attention`). These sort identities
 * rather than rate a state: they are the three semantic tones nearest the brand blue, emerald
 * and amber the marks have always worn, and identity is carried by the words in every case —
 * the tone only sorts them at a glance, and never alone says which mark this is.
 */
import type { ToneName } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
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
