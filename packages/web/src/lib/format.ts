/**
 * Human-friendly formatting utilities.
 *
 * Token and duration abbreviation conventions exactly match the CLI
 * (packages/cli/src/render.ts): `4k`, `1.2k`, `1.5M`, `820ms`, `5.1s`,
 * `2m10s`; deltas are explicitly signed (`+1k` / `-1k`). Also provides
 * display formats for cost (USD), byte counts, and dates, reused by the
 * stats page and Trace page.
 */

/** Keep one decimal place but drop a trailing `.0` (same convention as the CLI). */
function trimZero(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Abbreviate a token count for humans: 1234→1.2k, 1500000→1.5M, <1000 unchanged. */
export function humanizeTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return `${n}`;
  if (abs < 1_000_000) return `${trimZero(n / 1000)}k`;
  return `${trimZero(n / 1_000_000)}M`;
}

/** Convert milliseconds to a human-readable duration: `820ms`, `2.3s`, `1m3s`. */
export function humanizeDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trimZero(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s % 60)}s`;
}

/**
 * Duration format for a still-running timer: whole seconds only (`0s`, `7s`, `1m3s`),
 * counting up (floor, never showing a second early). Decimals are reserved for settled
 * durations (humanizeDuration above) — a live timer showing tenths reads as jitter.
 */
export function humanizeDurationLive(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

/** Add an explicit sign to a delta string: non-negative gets `+`, negative already has `-` (negative when context shrinks after compaction). */
export function signedDelta(formatted: string): string {
  return formatted.startsWith("-") ? formatted : `+${formatted}`;
}

/**
 * Output TPS = output tokens ÷ LLM generation seconds (generation duration is
 * the `request_begin`–`request_end` wall clock, including tool-argument
 * generation but excluding tool execution); returns null when `llmMs ≤ 0`
 * (no timing) to avoid division by zero. The chat page and Trace page share
 * this same computation so the two TPS values are comparable.
 */
export function computeTps(outputTokens: number, llmMs: number): number | null {
  return llmMs > 0 ? outputTokens / (llmMs / 1000) : null;
}

/**
 * Output TPS display: `< 1000` keeps one decimal place (dropping a trailing
 * `.0`, e.g. `42.5 tok/s` / `120 tok/s` — TPS is usually in the 20~200 range,
 * so rounding to an integer would lose precision); `≥ 1000` abbreviates by
 * k / M magnitude (`37.8k tok/s` / `1.2M tok/s`), matching humanizeTokens so
 * four-digit-plus values don't blur together. null (no LLM timing) or a
 * non-finite value → `—`.
 */
export function formatTps(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps)) return "—";
  const v = Math.abs(tps) < 1000 ? trimZero(tps) : humanizeTokens(tps);
  return `${v} tok/s`;
}

/**
 * Cache hit rate = cacheRead ÷ (cacheRead + cacheWrite): the share of cached
 * input actually served from cache; null when the denominator is 0 (no cache
 * activity — the rate is undefined, callers omit the stat or let
 * formatPercent render `—`). The single formula shared by the Trace page's
 * turn/global summaries and the Cost center's cacheRead bubble, so the two pages can never drift apart.
 */
export function cacheHitRate(cacheRead: number, cacheWrite: number): number | null {
  const total = cacheRead + cacheWrite;
  return total > 0 ? cacheRead / total : null;
}

/**
 * Ratio display (rounded to a whole percent): `0.714` → `71%`; null
 * (denominator is 0, undefined) or a non-finite value → `—`.
 * Used with cacheHitRate above (Trace page and the Cost center's cacheRead bubble) and similar cases.
 */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Cost display (converted to the selected currency; prices are stored in
 * USD): null/undefined → `—`; 1 USD ≈ 7 CNY; decimal places scale with
 * magnitude (≥100 rounds to an integer, ≥1 uses two places, otherwise four).
 */
export function formatMoney(
  usd: number | null | undefined,
  currency: "USD" | "CNY" = "USD",
): string {
  if (usd == null) return "—";
  const symbol = currency === "CNY" ? "¥" : "$";
  const v = currency === "CNY" ? usd * 7 : usd;
  if (v === 0) return `${symbol}0`;
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return `${symbol}${v.toFixed(digits)}`;
}

/** Benchmark total score display: integers unchanged, decimals keep one place (full-score convention is defined per-Benchmark by its scoring rubric). */
export function formatScore(n: number): string {
  return Number.isInteger(n) ? `${n}` : trimZero(n);
}

/** Abbreviate a byte count: `812B`, `3.4KB`, `1.2MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${trimZero(n / 1024)}KB`;
  if (n < 1024 * 1024 * 1024) return `${trimZero(n / (1024 * 1024))}MB`;
  return `${trimZero(n / (1024 * 1024 * 1024))}GB`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** ISO timestamp → local `yyyy-MM-dd HH:mm` display; returns the input unchanged if parsing fails. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Millisecond timestamp → human-readable message time: en `Jul 2, 2:58 PM` /
 * zh `7月2日 14:58`; returns an empty string for an invalid value.
 *
 * Follows the UI language instead of hardcoding English: date formatting is
 * a localization concern, and `Jul 2` would look jarring in a Chinese UI.
 * Includes month and day (not just `HH:mm:ss`) — when scrolling back through
 * old messages, "what time" is less useful than "what day, what time".
 */
export function formatMessageTime(ms: number, locale: "zh" | "en"): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Milliseconds at local calendar-day midnight (shared by relative-day calculations). */
function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * ISO timestamp → relative days (used by the Agents card's "last modified"):
 * same day → "今天/today", one day back → "昨天/yesterday", earlier → local
 * calendar-day difference as "n 天前 / n days ago"; a future time (clock
 * skew) falls back to the absolute time, and parse failures return the
 * input unchanged.
 */
export function formatRelativeDays(iso: string, locale: "zh" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(d)) / 86_400_000);
  if (days < 0) return formatDateTime(iso);
  if (days === 0) return locale === "en" ? "today" : "今天";
  if (days === 1) return locale === "en" ? "yesterday" : "昨天";
  return locale === "en" ? `${days} days ago` : `${days} 天前`;
}

/**
 * ISO timestamp → semantic update time (skill card metadata): zh "今天更新/
 * 昨天更新/n 天前更新", en "updated today/yesterday/n days ago"; a future
 * time (clock skew) falls back to the date itself, and parse failures
 * return the input unchanged (without the "updated" wording).
 */
export function formatRelativeDate(iso: string, locale: "zh" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(d)) / 86_400_000);
  if (days < 0) return iso;
  if (days === 0) return locale === "en" ? "updated today" : "今天更新";
  if (days === 1) return locale === "en" ? "updated yesterday" : "昨天更新";
  return locale === "en" ? `updated ${days} days ago` : `${days} 天前更新`;
}

/** ISO timestamp → local `HH:mm:ss` (inline display in the Trace timeline); returns the input unchanged if parsing fails. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
