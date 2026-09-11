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
import type { SubagentKeyStrategy } from "../interfaces/environment.js";

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
  /** Number of active subagent sessions currently leasing this key. */
  activeLeases?: number;
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
  private static allocCounter = 0;
  private readonly keys: KeyStatus[] = [];
  private currentIndex: number = -1;
  private readonly cooldownMs: number;
  private leasedKey?: KeyStatus;

  constructor(keys: string[] | string | KeyStatus[], opts: ApiKeyRotatorOptions = {}) {
    this.cooldownMs = opts.cooldownMs ?? opts.rateLimitCooldownMs ?? 60_000;
    if (
      Array.isArray(keys) &&
      keys.length > 0 &&
      typeof keys[0] === "object" &&
      keys[0] !== null &&
      "key" in keys[0]
    ) {
      this.keys = (keys as KeyStatus[]).slice();
    } else {
      const parsed = parseApiKeys(keys as string | string[]);
      for (const key of parsed) {
        this.keys.push({
          key,
          isFailed: false,
          cooldownUntil: 0,
          successCount: 0,
          failureCount: 0,
          activeLeases: 0,
        });
      }
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
  nextKey(now: number = Date.now()): string | undefined {
    if (this.keys.length === 0) return undefined;
    const workingKeys = this.keys.filter((k) => !k.isFailed);
    if (workingKeys.length === 0) return undefined;

    const len = this.keys.length;

    // Search round-robin starting from currentIndex + 1
    for (let i = 1; i <= len; i++) {
      const idx = (this.currentIndex + i) % len;
      const candidate = this.keys[idx];
      if (candidate && !candidate.isFailed && candidate.cooldownUntil <= now) {
        this.currentIndex = idx;
        candidate.lastUsedAt = now;
        if (this.leasedKey && this.leasedKey !== candidate) {
          this.leasedKey.activeLeases = Math.max(0, (this.leasedKey.activeLeases ?? 0) - 1);
          candidate.activeLeases = (candidate.activeLeases ?? 0) + 1;
          this.leasedKey = candidate;
        }
        return candidate.key;
      }
    }

    // If all working keys are cooling down, return undefined so caller/engine can wait for cooldown
    return undefined;
  }

  /**
   * Returns whether at least one non-failed key is currently available (not on cooldown).
   */
  hasAvailableKeys(now: number = Date.now()): boolean {
    return this.keys.some((k) => !k.isFailed && k.cooldownUntil <= now);
  }

  /**
   * Returns the epoch timestamp when the earliest cooling-down key will become available.
   * Returns undefined if no keys exist or all keys are permanently failed.
   * Returns now if at least one key is already available.
   */
  getEarliestAvailableTime(now: number = Date.now()): number | undefined {
    let earliest: number | undefined;
    for (const k of this.keys) {
      if (!k.isFailed) {
        if (k.cooldownUntil <= now) return now;
        if (earliest === undefined || k.cooldownUntil < earliest) {
          earliest = k.cooldownUntil;
        }
      }
    }
    return earliest;
  }

  /**
   * Returns milliseconds remaining until the earliest key becomes available.
   * Returns 0 if a key is immediately available.
   * Returns undefined if all keys are permanently failed or list is empty.
   */
  getEarliestCooldownMs(now: number = Date.now()): number | undefined {
    const earliestTime = this.getEarliestAvailableTime(now);
    if (earliestTime === undefined) return undefined;
    return Math.max(0, earliestTime - now);
  }

  /**
   * Returns the currently selected key (or picks one if not yet selected).
   */
  currentKey(now: number = Date.now()): string | undefined {
    if (this.currentIndex >= 0 && this.currentIndex < this.keys.length) {
      const cur = this.keys[this.currentIndex];
      if (cur && !cur.isFailed && cur.cooldownUntil <= now) return cur.key;
    }
    return this.nextKey(now);
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

  /**
   * Sets current selection index.
   */
  setCurrentIndex(index: number): void {
    this.currentIndex = index;
  }

  /**
   * Tracks an active subagent key lease.
   */
  trackLease(keyStatus: KeyStatus): void {
    this.leasedKey = keyStatus;
  }

  /**
   * Releases an active subagent key lease.
   */
  releaseLease(): void {
    if (this.leasedKey) {
      this.leasedKey.activeLeases = Math.max(0, (this.leasedKey.activeLeases ?? 0) - 1);
      this.leasedKey = undefined;
    }
  }

  /**
   * Total number of active subagent leases across all keys.
   */
  get activeLeases(): number {
    return this.keys.reduce((sum, k) => sum + (k.activeLeases ?? 0), 0);
  }

  /**
   * Generates an ordered list of KeyStatus references optimized for a subagent according to `strategy`.
   */
  allocateSubagentOrderedStatuses(
    strategy: SubagentKeyStrategy = "auto",
    now: number = Date.now(),
  ): KeyStatus[] {
    if (this.keys.length === 0) return [];
    const working = this.keys.filter((k) => !k.isFailed);
    const evicted = this.keys.filter((k) => k.isFailed);
    if (working.length === 0) return [...this.keys];

    const available = working.filter((k) => k.cooldownUntil <= now);
    const inCooldown = working.filter((k) => k.cooldownUntil > now);
    // Sort cooldown keys by earliest expiry
    inCooldown.sort((a, b) => a.cooldownUntil - b.cooldownUntil);

    let orderedAvailable: KeyStatus[] = [];

    switch (strategy) {
      case "partition":
      case "round_robin": {
        const offset = ApiKeyRotator.allocCounter++ % working.length;
        const rotatedWorking = [...working.slice(offset), ...working.slice(0, offset)];
        const rotAvail = rotatedWorking.filter((k) => k.cooldownUntil <= now);
        const rotCool = rotatedWorking.filter((k) => k.cooldownUntil > now);
        return [...rotAvail, ...rotCool, ...evicted];
      }

      case "random": {
        orderedAvailable = [...available];
        for (let i = orderedAvailable.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [orderedAvailable[i], orderedAvailable[j]] = [orderedAvailable[j]!, orderedAvailable[i]!];
        }
        return [...orderedAvailable, ...inCooldown, ...evicted];
      }

      case "least_busy": {
        orderedAvailable = [...available].sort((a, b) => {
          const leaseDiff = (a.activeLeases ?? 0) - (b.activeLeases ?? 0);
          if (leaseDiff !== 0) return leaseDiff;
          const failDiff = a.failureCount - b.failureCount;
          if (failDiff !== 0) return failDiff;
          return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
        });
        return [...orderedAvailable, ...inCooldown, ...evicted];
      }

      case "auto":
      default: {
        // Optimized algorithm:
        // 1. Group available keys by active lease count.
        // 2. For lowest-lease group, break ties with round-robin offset so distinct subagents distribute evenly.
        orderedAvailable = [...available].sort((a, b) => {
          const leaseDiff = (a.activeLeases ?? 0) - (b.activeLeases ?? 0);
          if (leaseDiff !== 0) return leaseDiff;
          const failDiff = a.failureCount - b.failureCount;
          if (failDiff !== 0) return failDiff;
          return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
        });

        if (orderedAvailable.length > 1) {
          const minLeases = orderedAvailable[0]!.activeLeases ?? 0;
          const minGroup = orderedAvailable.filter((k) => (k.activeLeases ?? 0) === minLeases);
          if (minGroup.length > 1) {
            const shift = ApiKeyRotator.allocCounter++ % minGroup.length;
            const rotatedMin = [...minGroup.slice(shift), ...minGroup.slice(0, shift)];
            const rest = orderedAvailable.filter((k) => (k.activeLeases ?? 0) > minLeases);
            orderedAvailable = [...rotatedMin, ...rest];
          }
        }
        return [...orderedAvailable, ...inCooldown, ...evicted];
      }
    }
  }

  /**
   * Returns ordered list of API key strings optimized for a subagent.
   */
  allocateSubagentKeys(strategy: SubagentKeyStrategy = "auto", now: number = Date.now()): string[] {
    return this.allocateSubagentOrderedStatuses(strategy, now).map((k) => k.key);
  }

  /**
   * Allocates an isolated ApiKeyRotator instance for a subagent sharing underlying key statuses and tracking leases.
   */
  allocateSubagentRotator(
    strategy: SubagentKeyStrategy = "auto",
    now: number = Date.now(),
  ): { rotator: ApiKeyRotator; release: () => void } {
    const ordered = this.allocateSubagentOrderedStatuses(strategy, now);
    const primary =
      ordered.find((k) => !k.isFailed && k.cooldownUntil <= now) ??
      ordered.find((k) => !k.isFailed) ??
      ordered[0];

    if (primary) {
      primary.activeLeases = (primary.activeLeases ?? 0) + 1;
    }

    const childRotator = new ApiKeyRotator(ordered, { cooldownMs: this.cooldownMs });
    if (primary) {
      const idx = ordered.indexOf(primary);
      childRotator.setCurrentIndex(idx >= 0 ? idx : 0);
      childRotator.trackLease(primary);
    }

    let released = false;
    return {
      rotator: childRotator,
      release: () => {
        if (released) return;
        released = true;
        childRotator.releaseLease();
      },
    };
  }
}

/**
 * Process-wide registry for ApiKeyRotator instances, keyed by scope (e.g. `${projectId}/${provider}/${modelId}`).
 * Allows GenerativeModel at runtime and server-side ModelKeyHealthService to operate on the same state.
 */
export class KeyRotatorRegistry {
  private static readonly instances = new Map<string, ApiKeyRotator>();

  /**
   * Retrieves or creates an ApiKeyRotator for a given scope.
   * If `keys` is provided and non-empty, updates the rotator's keys.
   */
  static get(scope: string, keys?: string[]): ApiKeyRotator {
    let rotator = this.instances.get(scope);
    if (!rotator) {
      rotator = new ApiKeyRotator(keys ?? []);
      this.instances.set(scope, rotator);
    } else if (keys !== undefined && keys.length > 0) {
      rotator.updateKeys(keys);
    }
    return rotator;
  }

  /**
   * Sets or overrides an existing rotator instance for a given scope.
   */
  static set(scope: string, rotator: ApiKeyRotator): void {
    this.instances.set(scope, rotator);
  }

  /**
   * Returns whether a rotator exists for the given scope.
   */
  static has(scope: string): boolean {
    return this.instances.has(scope);
  }

  /**
   * Resets failed and cooldown states for the rotator at `scope`.
   */
  static reset(scope: string): void {
    this.instances.get(scope)?.resetFailed();
  }

  /**
   * Clears all registered rotators (used in tests or server reset).
   */
  static clear(): void {
    this.instances.clear();
  }

  /**
   * Allocates an isolated ApiKeyRotator for a subagent with lease tracking.
   * If candidateKeys are provided, joins/updates the pool in scope.
   */
  static allocateSubagentRotator(
    scope: string,
    candidateKeys?: string[] | string,
    strategy: SubagentKeyStrategy = "auto",
  ): { rotator: ApiKeyRotator; release: () => void } {
    const parsed = candidateKeys ? parseApiKeys(candidateKeys) : [];
    if (parsed.length > 0) {
      const rotator = this.get(scope, parsed);
      return rotator.allocateSubagentRotator(strategy);
    }
    const rotator = this.get(scope);
    return rotator.allocateSubagentRotator(strategy);
  }
}
