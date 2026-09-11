/**
 * In-memory API key health tracking and rotation registry for LLM endpoints in the server.
 */
import {
  ApiKeyRotator,
  parseApiKeys,
  type KeyStatus,
  type KeyHealth,
} from "@prismshadow/penguin-core";

export interface KeyHealthItem {
  maskedKey: string;
  status: KeyHealth;
  isFailed: boolean;
  cooldownRemainingMs: number;
  successCount: number;
  failureCount: number;
  lastUsedAt?: number;
}

export interface ModelKeyHealthReport {
  modelRef: string;
  totalKeys: number;
  healthyCount: number;
  cooldownCount: number;
  evictedCount: number;
  keys: KeyHealthItem[];
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return "****";
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

export class ModelKeyHealthService {
  private readonly rotators = new Map<string, ApiKeyRotator>();

  /**
   * Normalizes a model reference string or object (provider/modelId) into a canonical key.
   */
  private normalizeRef(ref: string | { provider: string; modelId: string }): string {
    if (typeof ref === "string") {
      return ref.trim();
    }
    return `${ref.provider}/${ref.modelId}`.trim();
  }

  /**
   * Retrieves or initializes an ApiKeyRotator for a given model.
   * If rawKeys is provided, synchronizes the rotator's keys.
   */
  getRotator(
    modelRef: string | { provider: string; modelId: string },
    rawKeys?: string | string[],
  ): ApiKeyRotator {
    const key = this.normalizeRef(modelRef);
    let rotator = this.rotators.get(key);

    if (!rotator) {
      const keys = parseApiKeys(rawKeys);
      rotator = new ApiKeyRotator(keys);
      this.rotators.set(key, rotator);
    } else if (rawKeys !== undefined) {
      const keys = parseApiKeys(rawKeys);
      rotator.updateKeys(keys);
    }

    return rotator;
  }

  /**
   * Generates a safe health report for a model, with all keys masked.
   */
  getKeyHealth(modelRef: string | { provider: string; modelId: string }): ModelKeyHealthReport {
    const key = this.normalizeRef(modelRef);
    const rotator = this.rotators.get(key);

    if (!rotator) {
      return {
        modelRef: key,
        totalKeys: 0,
        healthyCount: 0,
        cooldownCount: 0,
        evictedCount: 0,
        keys: [],
      };
    }

    const now = Date.now();
    const statuses = rotator.getStatus();
    let healthyCount = 0;
    let cooldownCount = 0;
    let evictedCount = 0;

    const items: KeyHealthItem[] = statuses.map((s: KeyStatus) => {
      let status: KeyHealth = "healthy";
      let cooldownRemainingMs = 0;

      if (s.isFailed) {
        status = "evicted";
        evictedCount++;
      } else if (s.cooldownUntil > now) {
        status = "cooldown";
        cooldownRemainingMs = s.cooldownUntil - now;
        cooldownCount++;
      } else {
        healthyCount++;
      }

      return {
        maskedKey: maskApiKey(s.key),
        status,
        isFailed: s.isFailed,
        cooldownRemainingMs,
        successCount: s.successCount,
        failureCount: s.failureCount,
        lastUsedAt: s.lastUsedAt,
      };
    });

    return {
      modelRef: key,
      totalKeys: rotator.totalKeys,
      healthyCount,
      cooldownCount,
      evictedCount,
      keys: items,
    };
  }

  /**
   * Resets failed and cooldown states for all keys of a model.
   */
  resetKeyHealth(modelRef: string | { provider: string; modelId: string }): void {
    const key = this.normalizeRef(modelRef);
    const rotator = this.rotators.get(key);
    if (rotator) {
      rotator.resetFailed();
    }
  }

  /**
   * Clears all in-memory rotators (e.g. for testing).
   */
  clear(): void {
    this.rotators.clear();
  }
}
