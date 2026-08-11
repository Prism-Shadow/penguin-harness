import type {
  BenchmarkEvaluation,
  BenchmarkSummary,
  PromotionRunInfo,
} from "@prismshadow/penguin-server/api";

export interface PendingPromotion {
  optimizationSessionId: string;
  candidateVersion: number;
  productionReferenceVersion: number;
  promotionBenchmarkId: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
}

export interface BenchmarkPromotionState {
  productionVersion: number | null;
  pending: PendingPromotion | null;
  run: PromotionRunInfo | null;
}

/** Derive workflow state only from structured fields; titles and summaries are never parsed. */
export function benchmarkPromotionState(
  development: BenchmarkSummary,
  benchmarks: readonly BenchmarkSummary[],
  activeVersion: number,
  runs: readonly PromotionRunInfo[] = [],
): BenchmarkPromotionState {
  if (development.role !== "development" || !development.pairedBenchmarkId) {
    return { productionVersion: null, pending: null, run: null };
  }
  const promotion = benchmarks.find(
    (item) =>
      item.id === development.pairedBenchmarkId &&
      item.role === "promotion" &&
      (!item.pairedBenchmarkId || item.pairedBenchmarkId === development.id),
  );
  if (!promotion) return { productionVersion: null, pending: null, run: null };

  let productionVersion: number | null =
    promotion.evaluations.find((item) => item.evaluationKind === "formal_baseline")?.version ??
    null;
  for (const item of promotion.evaluations) {
    if (item.evaluationKind !== "promotion_candidate") continue;
    if (item.promotionDecision === "promoted") productionVersion = item.version;
    if (item.promotionDecision === "restored" && item.productionReferenceVersion !== undefined) {
      productionVersion = item.productionReferenceVersion;
    }
  }

  const candidate = [...development.evaluations]
    .reverse()
    .find(
      (item) =>
        item.evaluationKind === "development_candidate" &&
        item.optimizationSessionId &&
        item.productionReferenceVersion !== undefined,
    );
  if (!candidate) return { productionVersion, pending: null, run: null };
  const matchingRun =
    runs.find(
      (item) =>
        item.optimizationSessionId === candidate.optimizationSessionId &&
        item.candidateVersion === candidate.version,
    ) ?? null;
  if (activeVersion !== candidate.version) {
    return { productionVersion, pending: null, run: matchingRun };
  }
  const alreadyDecided = promotion.evaluations.some(
    (item) =>
      item.evaluationKind === "promotion_candidate" &&
      item.optimizationSessionId === candidate.optimizationSessionId &&
      item.version === candidate.version &&
      item.promotionDecision !== undefined,
  );
  if (alreadyDecided) {
    return {
      productionVersion,
      pending: null,
      run: matchingRun,
    };
  }

  const referenceRuntime = [...promotion.evaluations]
    .reverse()
    .find(
      (item) =>
        item.version === candidate.productionReferenceVersion &&
        (item.evaluationKind === "formal_baseline" ||
          (item.evaluationKind === "promotion_candidate" && item.promotionDecision === "promoted")),
    );
  if (!referenceRuntime) return { productionVersion, pending: null, run: null };

  return {
    productionVersion,
    pending: {
      optimizationSessionId: candidate.optimizationSessionId!,
      candidateVersion: candidate.version,
      productionReferenceVersion: candidate.productionReferenceVersion!,
      promotionBenchmarkId: promotion.id,
      provider: referenceRuntime.provider,
      modelId: referenceRuntime.modelId,
      thinkingLevel: referenceRuntime.thinkingLevel,
    },
    run: matchingRun,
  };
}

export function evaluationWorkflowStatus(
  evaluation: Pick<BenchmarkEvaluation, "evaluationKind" | "promotionDecision">,
): "baseline" | "development" | "promoted" | "restored" | "evaluation" {
  if (evaluation.evaluationKind === "formal_baseline") return "baseline";
  if (evaluation.evaluationKind === "development_candidate") return "development";
  if (evaluation.evaluationKind === "promotion_candidate") {
    if (evaluation.promotionDecision === "promoted") return "promoted";
    if (evaluation.promotionDecision === "restored") return "restored";
  }
  return "evaluation";
}
