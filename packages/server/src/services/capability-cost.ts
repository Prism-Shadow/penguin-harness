import { listSupportedModels, type ModelPricing as MmspPricing } from "@prismshadow/mmsp";
import { CLIENT_CREDENTIALS, clientTypeForModel } from "@prismshadow/mmsp/credentials";
import type { ModelPricing } from "@prismshadow/penguin-core";
import { sameEndpoint } from "@prismshadow/penguin-core/model-connection";
import type {
  CapabilityInputMeter,
  CapabilityResult,
  CapabilityUsage,
} from "../api/capabilities.js";
import {
  catalogEntryFor,
  effectivePricing,
  providerInfo,
  type ModelCatalogEntry,
} from "../model-catalog/catalog.js";
import { toolPricingFor, type ToolPriceUnit } from "../model-catalog/tool-pricing.js";

/** Estimation is a read-time operation. A tool run stores quantities, never money. */
export interface ToolCostEstimate {
  minimumUsd: number;
  maximumUsd: number;
}
type MeteredRun = Pick<
  CapabilityResult,
  "capability" | "model" | "createdAt" | "inputMeter" | "usage" | "measurements"
>;
type BucketRates = Partial<Record<keyof CapabilityUsage, number>>;
const supportedModels = listSupportedModels("USD");

/** Match the seller as well as the model. An identically named model on another gateway may have a different price. */
function registryPrice(entry: ModelCatalogEntry): MmspPricing | undefined {
  const provider = providerInfo(entry.provider);
  const client = entry.clientType ?? provider?.clientType ?? clientTypeForModel(entry.modelId);
  if (!client) return;
  const base = entry.baseUrl ?? provider?.gatewayBaseUrl;
  const defaults = CLIENT_CREDENTIALS[client];
  const endpoints = base
    ? [base]
    : defaults
      ? [defaults.defaultBaseUrl, ...(defaults.otherBaseUrls ?? [])]
      : [];
  const matches = supportedModels.filter(
    (m) =>
      m.model === entry.modelId &&
      m.client === client &&
      endpoints.some((url) => sameEndpoint(url, m.base_url)),
  );
  if (matches.length === 1) return matches[0]?.pricing;
}

function priceBuckets(usage: CapabilityUsage | null, rates: BucketRates): ToolCostEstimate | null {
  if (!usage || Object.values(usage).every((q) => q === null)) return null;
  let total = 0;
  for (const bucket of [
    "cached_tokens",
    "prompt_tokens",
    "thoughts_tokens",
    "response_tokens",
  ] as const) {
    const count = usage[bucket] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) return null;
    if (!count) continue;
    const rate = rates[bucket];
    if (rate === undefined || !Number.isFinite(rate) || rate < 0) return null;
    total += count * rate;
  }
  const usd = total / 1_000_000;
  return { minimumUsd: usd, maximumUsd: usd };
}

const physicalUnits: Partial<Record<ToolPriceUnit, [CapabilityInputMeter["unit"], number]>> = {
  audioHour: ["billed_audio_second", 3600],
  audioSecond: ["billed_audio_second", 1],
  tenThousandChars: ["billed_character", 10000],
  millionBytes: ["utf8_byte", 1000000],
  thousandSuccesses: ["billable_request", 1000],
};

export function estimateToolCost(
  run: MeteredRun,
  projectPricing?: ModelPricing,
): ToolCostEstimate | null {
  const entry = catalogEntryFor(run.model.provider, run.model.modelId);
  const now = new Date(run.createdAt);
  if (entry?.capability && entry.capability !== run.capability) return null;
  const tariff = toolPricingFor(entry);
  const primary = tariff?.rates[0];
  if (tariff && primary) {
    const discount =
      !tariff.promotionEndsAt || now < new Date(tariff.promotionEndsAt)
        ? (tariff.discount ?? 0)
        : 0;
    const discounted = (usd: number) => usd * (1 - discount);
    const usd = (amount: number) => discounted(amount / (tariff.currency === "CNY" ? 7 : 1));
    const physical = physicalUnits[primary.unit];
    // A seller bills in one unit. Counts that MMSP encodes into prompt_tokens and
    // the same number of seconds/characters/requests must never both incur a charge.
    if (physical || primary.unit === "image" || primary.unit === "request") {
      const [unit, divisor] = physical ?? [primary.unit, 1];
      const quantity = physical
        ? run.inputMeter?.unit === unit
          ? run.inputMeter.quantity
          : undefined
        : run.measurements.find((m) => m.unit === unit)?.quantity;
      if (quantity === undefined || !Number.isSafeInteger(quantity) || quantity < 0) return null;
      return {
        minimumUsd: usd((quantity * primary.amount) / divisor),
        maximumUsd: usd((quantity * (primary.maximum ?? primary.amount)) / divisor),
      };
    }
    if (!projectPricing && entry) {
      const rate = (unit: ToolPriceUnit) => {
        const value = tariff.rates.find((r) => r.unit === unit);
        return value && usd(value.amount);
      };
      const sdk = registryPrice(entry);
      // The protocol puts thinking in its own bucket. For Gemini Omni the seller
      // bills it as text and the response as video. Never count it twice as output.
      return priceBuckets(run.usage, {
        prompt_tokens: rate("inputTokens") ?? (sdk && discounted(sdk.prompt_tokens)),
        cached_tokens:
          rate("cachedInputTokens") ??
          (sdk?.cached_tokens !== undefined ? discounted(sdk.cached_tokens) : undefined),
        thoughts_tokens:
          rate("thoughtTokens") ??
          rate("textOutputTokens") ??
          (sdk && discounted(sdk.thoughts_tokens)),
        response_tokens:
          rate("imageTokens") ??
          rate("audioTokens") ??
          rate("videoTokens") ??
          rate("textOutputTokens") ??
          (sdk && discounted(sdk.response_tokens)),
      });
    }
  }
  const pricing = projectPricing ?? (entry && effectivePricing(entry, now));
  if (pricing)
    return priceBuckets(run.usage, {
      cached_tokens: pricing.cache_read,
      prompt_tokens: pricing.cache_write,
      thoughts_tokens: pricing.output,
      response_tokens: pricing.output,
    });
  const sdk = entry && registryPrice(entry);
  return sdk ? priceBuckets(run.usage, sdk) : null;
}
