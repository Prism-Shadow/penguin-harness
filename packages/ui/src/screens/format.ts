/**
 * Number formatting for the screen mock-ups, following the web app's `lib/format.ts` rules so
 * the numbers read the way the product prints them. A stand-in: the formatters move into this
 * package with the components that need them (W4's `DurationSlot`, W6's stats line).
 */

const trimZero = (n: number): string => n.toFixed(1).replace(/\.0$/, "");

/** A settled duration: `412ms`, `2.4s`, `1m12s`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trimZero(s)}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/** A running clock: whole seconds only (`7s`, `1m3s`). */
export function liveDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

/** Token counts: `780`, `16.4k`, `1.2M`. */
export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trimZero(n / 1000)}k`;
  return `${trimZero(n / 1_000_000)}M`;
}

/** Money in USD with the precision small agent spend needs: `$0.0231`, `$2.31`, `$41.37`. */
export function usd(n: number): string {
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/** A byte size, as the app writes it — no gap between figure and unit: `942B`, `47.1KB`. */
export function bytes(n: number): string {
  return n < 1024 ? `${n}B` : `${trimZero(n / 1024)}KB`;
}

/**
 * A reply's time, as the chat footer prints it: `Sep 14, 6:02 AM` / `9月14日 06:02`. Fixed to UTC
 * so a mock-up reads the same in every capture, wherever it is rendered.
 */
export function messageTime(atIso: string, lang: "en" | "zh"): string {
  return new Date(atIso).toLocaleString(lang === "en" ? "en-US" : "zh-CN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** One count per another, to one decimal: `3.5`, or an em dash when there is nothing to divide. */
export function average(total: number, count: number): string {
  const avg = total / count;
  return count > 0 && Number.isFinite(avg) ? avg.toFixed(1) : "—";
}

/** A percentage of a whole: `79%`. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}
