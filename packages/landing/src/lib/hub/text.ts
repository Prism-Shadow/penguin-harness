/**
 * Reading the hub's records in the reader's language, and the formats its pages share. Sources
 * write English and may add Chinese (`title` / `titleZh`); Chinese readers get the Chinese text
 * where there is one, everyone else the English.
 */
import type { SiteLocale } from "@prismshadow/penguin-ui/site";

export const pick = (locale: SiteLocale, en: string, zh: string | undefined): string =>
  locale === "zh" && zh ? zh : en;

export const titleOf = (locale: SiteLocale, item: { title: string; titleZh?: string }): string =>
  pick(locale, item.title, item.titleZh);

/** A calendar date in the reader's language, from an ISO 8601 time. */
export function formatDay(iso: string, locale: SiteLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A count in millions or thousands, one decimal at most: 109.9M, 12K. */
export function formatCompact(value: number): string {
  if (value >= 1e6) return `${trim(value / 1e6)}M`;
  if (value >= 1e3) return `${trim(value / 1e3)}K`;
  return String(Math.round(value));
}

const trim = (value: number) => (value >= 100 ? String(Math.round(value)) : value.toFixed(1));

export const formatUsd = (value: number): string =>
  `$${value >= 100 ? Math.round(value) : value.toFixed(2)}`;

export const formatScore = (value: number): string => value.toFixed(1);
