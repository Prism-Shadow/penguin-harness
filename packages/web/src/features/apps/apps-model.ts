/**
 * Pure logic of the App Center page (unit tested): the status filter and search over the
 * registered apps, the status → badge tone and kind → glyph maps, the host shown in a row's
 * meta line, and the "registered N ago" age that reaches into weeks and months (the sidebar's
 * short form stops at a week, and an app is usually older than that).
 */
import type { AppItem, AppKind, AppStatus } from "@prismshadow/penguin-server/api";
import type { BadgeTone } from "../../components/ui/badge";
import { NAV_ICONS } from "../../components/ui/icons";

export type AppStatusFilter = "all" | AppStatus;

/** The filter segment's order: everything, then the three statuses. */
export const APP_STATUS_FILTERS: readonly AppStatusFilter[] = [
  "all",
  "running",
  "stopped",
  "unknown",
];

/** Kinds in the form's order. */
export const APP_KINDS: readonly AppKind[] = ["web", "api", "cli", "other"];

/** Status pill tones: running is the healthy green, stopped recedes, unknown asks for a URL. */
export const APP_STATUS_BADGE: Record<AppStatus, BadgeTone> = {
  running: "green",
  stopped: "gray",
  unknown: "amber",
};

/** Kind glyphs (24×24 line paths): a globe, code brackets, the terminal prompt, a package box. */
export const APP_KIND_ICONS: Record<AppKind, string> = {
  web: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 3.5 9 14 14 0 0 1-3.5 9 14 14 0 0 1-3.5-9A14 14 0 0 1 12 3z",
  api: "M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16",
  cli: NAV_ICONS.terminal,
  other: "M21 8l-9-4-9 4v8l9 4 9-4zM3 8l9 4 9-4M12 12v8",
};

/** Rows matching the status segment and the search box (name, id, description, URL; case-insensitive substring). */
export function filterApps<
  T extends Pick<AppItem, "id" | "name" | "description" | "url" | "status">,
>(apps: readonly T[], query: string, filter: AppStatusFilter): T[] {
  const q = query.trim().toLowerCase();
  return apps.filter(
    (a) =>
      (filter === "all" || a.status === filter) &&
      (q === "" ||
        [a.name, a.id, a.description ?? "", a.url ?? ""].some((f) => f.toLowerCase().includes(q))),
  );
}

/** The host part of an app URL for the meta line (`localhost:3000`); an unparsable value shows as written. */
export function appHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function enAgo(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/**
 * "How long ago" for a registration time: minutes, hours, days, weeks, months, then years;
 * under a minute reads as just now. A future time (clock skew) reads as just now too, and an
 * unparsable value is shown as written.
 */
export function relativeAge(iso: string, locale: "zh" | "en", nowMs = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const zh = locale === "zh";
  const minutes = Math.floor(Math.max(0, nowMs - ms) / 60_000);
  if (minutes < 1) return zh ? "刚刚" : "just now";
  if (minutes < 60) return zh ? `${minutes} 分钟前` : enAgo(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : enAgo(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return zh ? `${days} 天前` : enAgo(days, "day");
  const weeks = Math.floor(days / 7);
  if (days < 30) return zh ? `${weeks} 周前` : enAgo(weeks, "week");
  const months = Math.floor(days / 30);
  if (months < 12) return zh ? `${months} 个月前` : enAgo(months, "month");
  const years = Math.floor(days / 365);
  return zh ? `${years} 年前` : enAgo(years, "year");
}
