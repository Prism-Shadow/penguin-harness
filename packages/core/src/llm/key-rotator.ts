/**
 * API key rotation and health tracking for LLM endpoints.
 *
 * Supports:
 * - Parsing multiple keys from arrays or delimited strings (comma, newline, semicolon);
 * - Round-robin key rotation across healthy keys;
 * - Failover on 429 (rate limit) with cooldown timers;
 * - Permanent key eviction on 401 (auth failure) with automatic rollover to remaining keys;
 * - Observability metrics (success/failure counts, last used timestamp).
 */

export type KeyHealth = "healthy" | "cooldown" | "evicted";

export interface KeyStatus {
  key: string;
  /** High-level health status: healthy, cooldown (transient), or evicted (auth failure). */
  status?: KeyHealth;
  /** Permanently failed (e.g. 401 invalid API key). Excluded from rotation unless reset. */
  isFailed: boolean;
  /** Cooldown expiry timestamp in ms (e.g. 429 rate limit). */
  cooldownUntil: number;
  successCount: number;
  failureCount: number;
  lastUsedAt?: number;
}

export interface ApiKeyRotatorOptions {
  /** Default cooldown period in milliseconds for rate-limited keys (default 60,000ms = 1 min). */
  cooldownMs?: number;
  /** Alias for cooldownMs. */
  rateLimitCooldownMs?: number;
}

/**
 * Extracts and trims API keys from an array of strings or a delimited string (comma, newline, semicolon).
 * Filters out empty tokens and deduplicates while preserving order.
 */
export function parseApiKeys(input?: string | string[]): string[] {
  if (!input) return [];
  const rawList: string[] = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        for (const token of item.split(/[\r\n,;]+/)) {
          const trimmed = token.trim();
          if (trimmed.length > 0) rawList.push(trimmed);
        }
      }
    }
  } else if (typeof input === "string") {
    for (const token of input.split(/[\r\n,;]+/)) {
      const trimmed = token.trim();
      if (trimmed.length > 0) rawList.push(trimmed);
    }
  }
  return [...new Set(rawList)];
}

export class ApiKeyRotator {
  private readonly keys: KeyStatus[] = [];
  private currentIndex: number = -1;
  private readonly cooldownMs: number;

  constructor(keys: string[] | string, opts: ApiKeyRotatorOptions = {}) {
    this.cooldownMs = opts.cooldownMs ?? opts.rateLimitCooldownMs ?? 60_000;
    const parsed = parseApiKeys(keys);
    for (const key of parsed) {
      this.keys.push({
        key,
        isFailed: false,
        cooldownUntil: 0,
        successCount: 0,
        failureCount: 0,
      });
    }
  }

  /**
   * Total number of configured keys.
   */
  get totalKeys(): number {
    return this.keys.length;
  }

  /**
   * Number of keys that have not permanently failed (auth error).
   */
  get workingKeysCount(): number {
    return this.keys.filter((k) => !k.isFailed).length;
  }

  /**
   * Whether there is at least one working key available.
   */
  hasWorkingKeys(): boolean {
    return this.keys.some((k) => !k.isFailed);
  }

  /**
   * Checks whether an alternative working key exists other than `currentKey`.
   */
  hasAlternativeKey(currentKey?: string): boolean {
    return this.keys.some((k) => !k.isFailed && k.key !== currentKey);
  }

  /**
   * Selects the next eligible key via round-robin.
   *
   * 1. Filters for keys that are not permanently failed and not currently in cooldown.
   * 2. If all working keys are currently in cooldown, falls back to the one with the earliest cooldown expiry.
   * 3. Returns undefined if all keys have permanently failed or if no keys are configured.
   */
  nextKey(): string | undefined {
    if (this.keys.length === 0) return undefined;
    const workingKeys = this.keys.filter((k) => !k.isFailed);
    if (workingKeys.length === 0) return undefined;

    const now = Date.now();
    const len = this.keys.length;

    // Search round-robin starting from currentIndex + 1
    for (let i = 1; i <= len; i++) {
      const idx = (this.currentIndex + i) % len;
      const candidate = this.keys[idx];
      if (candidate && !candidate.isFailed && candidate.cooldownUntil <= now) {
        this.currentIndex = idx;
        candidate.lastUsedAt = now;
        return candidate.key;
      }
    }

    // If all working keys are cooling down, select the one with the earliest cooldown
    let bestCandidate: KeyStatus | undefined;
    let bestIdx = -1;
    for (let i = 0; i < len; i++) {
      const candidate = this.keys[i];
      if (candidate && !candidate.isFailed) {
        if (!bestCandidate || candidate.cooldownUntil < bestCandidate.cooldownUntil) {
          bestCandidate = candidate;
          bestIdx = i;
        }
      }
    }

    if (bestCandidate && bestIdx >= 0) {
      this.currentIndex = bestIdx;
      bestCandidate.lastUsedAt = now;
      return bestCandidate.key;
    }

    return undefined;
  }

  /**
   * Returns the currently selected key (or picks one if not yet selected).
   */
  currentKey(): string | undefined {
    if (this.currentIndex >= 0 && this.currentIndex < this.keys.length) {
      const cur = this.keys[this.currentIndex];
      if (cur && !cur.isFailed) return cur.key;
    }
    return this.nextKey();
  }

  /**
   * Records a successful request with `key`, clearing any cooldown and incrementing success count.
   */
  recordSuccess(key?: string): void {
    if (!key) return;
    const target = this.keys.find((k) => k.key === key);
    if (target) {
      target.successCount++;
      target.cooldownUntil = 0;
    }
  }

  /**
   * Records a failure for `key`:
   * - "auth": marks the key permanently failed (will not be selected again unless reset).
   * - "rate_limit": places the key in cooldown for `cooldownMs`.
   * - "other": increments failure count without cooldown.
   */
  recordFailure(
    key?: string,
    errorType: "auth" | "rate_limit" | "other" = "other",
    customCooldownMs?: number,
  ): void {
    if (!key) return;
    const target = this.keys.find((k) => k.key === key);
    if (!target) return;

    target.failureCount++;
    if (errorType === "auth") {
      target.isFailed = true;
    } else if (errorType === "rate_limit") {
      const ms = customCooldownMs ?? this.cooldownMs;
      target.cooldownUntil = Date.now() + ms;
    }
  }

  /**
   * Semantic helper to mark a key rate limited (429 cooldown).
   */
  markRateLimited(key?: string, cooldownMs?: number): void {
    this.recordFailure(key, "rate_limit", cooldownMs);
  }

  /**
   * Semantic helper to mark a key failed (401 evicted).
   */
  markFailed(key?: string): void {
    this.recordFailure(key, "auth");
  }

  /**
   * Updates key set, preserving state for existing keys.
   */
  updateKeys(newKeysInput?: string | string[]): void {
    const newKeys = parseApiKeys(newKeysInput);
    const existingMap = new Map<string, KeyStatus>();
    for (const k of this.keys) {
      existingMap.set(k.key, k);
    }
    this.keys.length = 0;
    for (const key of newKeys) {
      const existing = existingMap.get(key);
      if (existing) {
        this.keys.push(existing);
      } else {
        this.keys.push({
          key,
          isFailed: false,
          cooldownUntil: 0,
          successCount: 0,
          failureCount: 0,
        });
      }
    }
    this.currentIndex = -1;
  }

  /**
   * Readonly view of all key statuses.
   */
  getKeys(): readonly KeyStatus[] {
    const now = Date.now();
    return this.keys.map((k) => {
      let status: KeyHealth = "healthy";
      if (k.isFailed) {
        status = "evicted";
      } else if (k.cooldownUntil > now) {
        status = "cooldown";
      }
      return {
        ...k,
        status,
      };
    });
  }

  /**
   * Alias for getKeys().
   */
  getKeyStatuses(): readonly KeyStatus[] {
    return this.getKeys();
  }

  /**
   * Alias for getKeyStatuses().
   */
  getStatus(): readonly KeyStatus[] {
    return this.getKeys();
  }

  /**
   * Resets all key statuses (clears failure flags, cooldowns, and counters).
   */
  reset(): void {
    for (const k of this.keys) {
      k.isFailed = false;
      k.cooldownUntil = 0;
      k.successCount = 0;
      k.failureCount = 0;
      k.lastUsedAt = undefined;
    }
    this.currentIndex = -1;
  }

  /**
   * Alias for reset().
   */
  resetFailed(): void {
    this.reset();
  }
}
