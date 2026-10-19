/**
 * The inbox's reading state, kept per organization: the filter chip in force and which of the
 * three categories feed the list at all. Both outlive the visit — a chip and a muted category
 * are reading habits, not facts about the visit — so both live in localStorage, one entry per
 * organization inside a single object per key. A stored value that names nothing real reads as
 * the default ("all", every category on), and an entry that will not parse starts over rather
 * than blocking the write, so one corrupt value can never brick the feature.
 */
import { INBOX_FILTERS } from "./overview-summary";
import type { InboxCategory, InboxFilter } from "./overview-summary";

/** The chip the reader last left in force, per organization. */
export const INBOX_FILTER_KEY = "overview.inbox-filter.v1";

/** The categories feeding the inbox, per organization (absent means every category on). */
export const INBOX_PREFS_KEY = "inbox.prefs.v1";

/** The categories in toggle order. */
export const INBOX_CATEGORIES: readonly InboxCategory[] = ["mention", "blocked", "done"];

function readBucket(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeBucketEntry(key: string, orgId: string, value: unknown): void {
  const bucket = readBucket(key);
  try {
    localStorage.setItem(key, JSON.stringify({ ...bucket, [orgId]: value }));
  } catch {
    // Private mode: the choice lasts the visit.
  }
}

/** The stored chip, or "all" for no organization, no entry, or a value naming no real chip. */
export function readInboxFilter(orgId: string | null | undefined): InboxFilter {
  if (!orgId) return "all";
  const stored = readBucket(INBOX_FILTER_KEY)[orgId];
  return (INBOX_FILTERS as readonly string[]).includes(stored as string)
    ? (stored as InboxFilter)
    : "all";
}

/** Keeps the chip for the next visit; without an organization there is nothing to keep it under. */
export function writeInboxFilter(
  orgId: string | null | undefined,
  filter: InboxFilter,
): void {
  if (!orgId) return;
  writeBucketEntry(INBOX_FILTER_KEY, orgId, filter);
}

/**
 * The stored categories, or every category for no organization, no entry, or a value that is
 * not an array. An array keeps only the entries naming real categories — which may be none,
 * when the reader muted everything.
 */
export function readInboxPrefs(orgId: string | null | undefined): InboxCategory[] {
  if (!orgId) return [...INBOX_CATEGORIES];
  const stored = readBucket(INBOX_PREFS_KEY)[orgId];
  if (!Array.isArray(stored)) return [...INBOX_CATEGORIES];
  return (stored as unknown[]).filter((c): c is InboxCategory =>
    (INBOX_CATEGORIES as readonly string[]).includes(c as string),
  );
}

/** Keeps the categories for the next visit. */
export function writeInboxPrefs(
  orgId: string | null | undefined,
  categories: readonly InboxCategory[],
): void {
  if (!orgId) return;
  writeBucketEntry(INBOX_PREFS_KEY, orgId, [...categories]);
}

/**
 * The chip in force against the categories feeding the list: a chip left pointing at a muted
 * category reads as "all" rather than showing an empty list by surprise.
 */
export function resolveInboxFilter(
  filter: InboxFilter,
  enabled: readonly InboxCategory[],
): InboxFilter {
  if (filter === "all" || (enabled as readonly string[]).includes(filter)) return filter;
  return "all";
}
