import { routedClientType } from "@prismshadow/mmsp/credentials";
import type { ModelCatalogEntry } from "./catalog.js";

/** A seller's published tariff. Non-token units and native currencies never enter token pricing or usage records. */
interface ToolTariff {
  currency: "USD" | "CNY";
  rates: { unit: ToolPriceUnit; amount: number; maximum?: number }[];
  discount?: number;
  /** First instant at which the list price applies again. */
  promotionEndsAt?: string;
}
/** A registry reference only describes the listed upstream route. Vendor plans may differ. */
export type ToolPricing = ToolTariff &
  (
    | { source?: undefined }
    | { source: "mmsp"; registryRoute: { clientType: string; baseUrl: string } }
  );

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

/** Keep the entire registry route, including any credentials, path or query in an override. */
function registryEndpoint(url: string): string | undefined {
  try {
    return new URL(url).href.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function sameRegistryEndpoint(url: string, expected: string): boolean {
  const endpoint = registryEndpoint(url);
  return endpoint !== undefined && endpoint === registryEndpoint(expected);
}

/** The first rate is the primary output a user is choosing this tool for. */
export function toolPricingFor(
  entry: ModelCatalogEntry | undefined,
  route?: { clientType?: string | undefined; baseUrl?: string | undefined },
): ToolPricing | undefined {
  const price = entry?.toolPricing;
  if (entry && price?.source === "mmsp") {
    const expected = price.registryRoute;
    if (
      routedClientType(entry.modelId, route?.clientType) !== expected.clientType ||
      (route?.baseUrl && !sameRegistryEndpoint(route.baseUrl, expected.baseUrl))
    )
      return undefined;
  }
  if (price) return price;
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
