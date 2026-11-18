import type { ModelPricing } from "@prismshadow/penguin-core";
import type { CapabilityResult } from "../api/capabilities.js";
import { catalogEntryFor } from "../model-catalog/catalog.js";

/** Estimation is a read-time operation. A tool run stores quantities, never money. */
export interface ToolCostEstimate {
  minimumUsd: number;
  maximumUsd: number;
}

export function estimateImageToolCost(
  run: Pick<CapabilityResult, "capability" | "model" | "usage" | "measurements">,
  projectPricing?: ModelPricing,
): ToolCostEstimate | null {
  if (run.capability !== "image") return null;
  const preset = catalogEntryFor(run.model.provider, run.model.modelId)?.imagePricing;
  const pricing = projectPricing
    ? {
        unit: "usd_per_mtok" as const,
        input: projectPricing.cache_write,
        cached: projectPricing.cache_read,
        thoughts: projectPricing.output,
        output: projectPricing.output,
      }
    : preset;
  if (!pricing) return null;
  if (pricing.unit === "usd_per_image") {
    const images = run.measurements.find(({ unit }) => unit === "image")?.quantity;
    if (images === undefined || !Number.isSafeInteger(images) || images < 0) return null;
    // OpenRouter publishes two Seedream 5.5 tariffs. Its response does not identify
    // which was billed. Expose both bounds instead of inferring a price from the token count.
    return {
      minimumUsd: images * pricing.output,
      maximumUsd: images * (pricing.highResolution ?? pricing.output),
    };
  }
  const usage = run.usage;
  if (
    !usage ||
    usage.response_tokens === null ||
    (pricing.input > 0 && usage.prompt_tokens === null)
  )
    return null;
  const cached = usage.cached_tokens ?? 0;
  if (cached > 0 && pricing.cached === undefined) return null;
  if (
    [usage.response_tokens, usage.prompt_tokens, usage.cached_tokens, usage.thoughts_tokens].some(
      (n) => n !== null && (!Number.isFinite(n) || n < 0),
    )
  )
    return null;
  // MMSP's input excludes cache hits and its response excludes separately reported thinking.
  // Mixed image/text output is intentionally estimated at the image rate.
  const usd =
    ((usage.prompt_tokens ?? 0) * pricing.input +
      cached * (pricing.cached ?? 0) +
      (usage.thoughts_tokens ?? 0) * pricing.thoughts +
      usage.response_tokens * pricing.output) /
    1_000_000;
  return { minimumUsd: usd, maximumUsd: usd };
}
