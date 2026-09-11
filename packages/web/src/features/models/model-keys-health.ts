/**
 * Telemetry and presentation helpers for multi-key rotation and health monitoring.
 */
import type { Tone } from "../../lib/tone";

export type KeyHealthStatus = "healthy" | "cooldown" | "evicted";

export interface KeyHealthItemDto {
  maskedKey: string;
  status: KeyHealthStatus;
  isFailed: boolean;
  cooldownRemainingMs: number;
  successCount: number;
  failureCount: number;
  lastUsedAt?: number;
}

export interface ModelKeyHealthReportDto {
  modelRef: string;
  totalKeys: number;
  healthyCount: number;
  cooldownCount: number;
  evictedCount: number;
  keys: KeyHealthItemDto[];
}

/**
 * Maps key health status to semantic design tone token.
 */
export function keyHealthTone(status: KeyHealthStatus): Tone {
  switch (status) {
    case "healthy":
      return "success";
    case "cooldown":
      return "attention";
    case "evicted":
      return "danger";
    default:
      return "muted";
  }
}

/**
 * Formats remaining cooldown duration into a human-readable tag (e.g. "30s", "2m").
 */
export function formatCooldown(remainingMs: number): string {
  if (remainingMs <= 0) return "";
  const sec = Math.ceil(remainingMs / 1000);
  if (sec <= 60) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  return `${min}m`;
}

/**
 * Parses multi-line or delimited API key inputs.
 */
export function parseMultiKeys(input?: string | string[]): string[] {
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

/**
 * Returns user-facing status label for a key chip.
 */
export function keyHealthLabel(item: KeyHealthItemDto): string {
  if (item.status === "evicted") return "Evicted (401)";
  if (item.status === "cooldown") {
    const cd = formatCooldown(item.cooldownRemainingMs);
    return cd ? `Cooldown (${cd})` : "Cooldown";
  }
  return "Active";
}
