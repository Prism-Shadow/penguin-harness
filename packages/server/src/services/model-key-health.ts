/**
 * In-memory API key health tracking and rotation registry for LLM endpoints in the server.
 */
import {
  ApiKeyRotator,
  KeyRotatorRegistry,
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
  activeLeases?: number;
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
  /**
   * Normalizes a model reference string or object (provider/modelId) into a canonical key scoped by projectId.
   */
  private normalizeRef(projectId: string, ref: string | { provider: string; modelId: string }): string {
    const pId = projectId.trim();
    if (typeof ref === "string") {
      const trimmed = ref.trim();
      return trimmed.startsWith(`${pId}/`) ? trimmed : `${pId}/${trimmed}`;
    }
    return `${pId}/${ref.provider}/${ref.modelId}`.trim();
  }

  /**
   * Retrieves or initializes an ApiKeyRotator for a given model scoped by project.
   * If rawKeys is provided, synchronizes the rotator's keys.
   */
  getRotator(
    projectId: string,
    modelRef: string | { provider: string; modelId: string },
    rawKeys?: string | string[],
  ): ApiKeyRotator {
    const scope = this.normalizeRef(projectId, modelRef);
    const keys = rawKeys !== undefined ? parseApiKeys(rawKeys) : undefined;
    return KeyRotatorRegistry.get(scope, keys);
  }

  /**
   * Generates a safe health report for a model, with all keys masked.
   */
  getKeyHealth(
    projectId: string,
    modelRef: string | { provider: string; modelId: string },
  ): ModelKeyHealthReport {
    const scope = this.normalizeRef(projectId, modelRef);
    if (!KeyRotatorRegistry.has(scope)) {
      return {
        modelRef: scope,
        totalKeys: 0,
        healthyCount: 0,
        cooldownCount: 0,
        evictedCount: 0,
        keys: [],
      };
    }

    const rotator = KeyRotatorRegistry.get(scope);
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
        activeLeases: s.activeLeases ?? 0,
      };
    });

    return {
      modelRef: scope,
      totalKeys: rotator.totalKeys,
      healthyCount,
      cooldownCount,
      evictedCount,
      keys: items,
    };
  }

  /**
   * Resets failed and cooldown states for all keys of a model within a project.
   */
  resetKeyHealth(
    projectId: string,
    modelRef: string | { provider: string; modelId: string },
  ): void {
    const scope = this.normalizeRef(projectId, modelRef);
    KeyRotatorRegistry.reset(scope);
  }

  /**
   * Clears all in-memory rotators (e.g. for testing).
   */
  clear(): void {
    KeyRotatorRegistry.clear();
  }
}
