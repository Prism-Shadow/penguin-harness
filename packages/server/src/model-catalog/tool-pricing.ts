import type { ModelCatalogEntry } from "./catalog.js";

/** A seller's published tariff. Non-token units and native currencies never enter token pricing or usage records. */
export interface ToolPricing {
  currency: "USD" | "CNY";
  rates: { unit: ToolPriceUnit; amount: number; maximum?: number }[];
  discount?: number;
  /** First instant at which the list price applies again. */
  promotionEndsAt?: string;
}
export type ToolPriceUnit =
  | "audioHour"
  | "audioSecond"
  | "tenThousandChars"
  | "millionBytes"
  | "thousandSuccesses"
  | "request"
  | "image"
  | "inputTokens"
  | "cachedInputTokens"
  | "thoughtTokens"
  | "imageTokens"
  | "audioTokens"
  | "videoTokens"
  | "textOutputTokens";

/** The first rate is the primary output a user is choosing this tool for. */
export function toolPricingFor(entry: ModelCatalogEntry | undefined): ToolPricing | undefined {
  if (entry?.toolPricing) return entry.toolPricing;
  const image = entry?.imagePricing;
  if (!image) return undefined;
  if (image.unit === "usd_per_image") {
    const rate = { unit: "image" as const, amount: image.output };
    return {
      currency: "USD",
      rates: [
        image.highResolution === undefined ? rate : { ...rate, maximum: image.highResolution },
      ],
    };
  }
  const rates: ToolPricing["rates"] = [
    { unit: "imageTokens", amount: image.output },
    { unit: "inputTokens", amount: image.input },
  ];
  if (image.cached !== undefined) rates.push({ unit: "cachedInputTokens", amount: image.cached });
  rates.push({ unit: "thoughtTokens", amount: image.thoughts });
  return { currency: "USD", rates };
}
