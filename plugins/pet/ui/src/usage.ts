/**
 * The dialog's Token reading: how many Tokens this install used on each day of the last few
 * weeks, as the daily contribution graph draws them.
 *
 * The server already has the shape (GET /api/projects/<p>/usage with `groupBy=date`,
 * `granularity=day` and a from/to window zero-fills every day in between), so nothing here
 * aggregates — one read per Project, summed per bucket, because the pet is one companion for
 * the whole install and every Project's usage feeds her coins (widget.js mines the same way).
 *
 * The window is aligned to weeks on the reader's own clock: the graph is a grid of weeks, so it
 * starts on the Monday `weeks - 1` weeks before this week's, and the days after today in this
 * week are drawn as blanks rather than invented.
 */

const API = "/api/projects";

/** One day's total, over every Project. */
export interface DayUsage {
  /** `yyyy-mm-dd`, the reader's own calendar day. */
  day: string;
  tokens: number;
}

/** A point of the server's usage series (`UsageSeriesPoint`) — only what is read here. */
interface SeriesPoint {
  bucket?: unknown;
  total?: unknown;
}

/** The local calendar day of an instant, `yyyy-mm-dd`. */
export function localDay(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The same instant `days` days later, at the same time of day. */
export function addDays(at: Date, days: number): Date {
  const next = new Date(at);
  next.setDate(next.getDate() + days);
  return next;
}

/** The Monday of the week `at` falls in, at its first instant. */
export function weekStart(at: Date): Date {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** `1.2M` / `34k` / `812`: a Token count as a reader reads it at a glance. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

/** Every Project this user can read, by id. */
async function projectIds(): Promise<string[]> {
  const res = await fetch(API, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`/api/projects answered ${res.status}`);
  const body = (await res.json()) as { projects?: Array<{ projectId?: unknown }> };
  return (body.projects ?? [])
    .map((project) => project.projectId)
    .filter((id): id is string => typeof id === "string");
}

/**
 * The window the graph draws, before anything is read: the same `weeks` weeks, oldest first,
 * every day at zero.
 *
 * It exists so the graph can be drawn from the first frame. The dialog is measured the moment it
 * opens, so a card that held a one-line "reading…" until the numbers landed would grow by the
 * height of a half-year grid when they did — a layout shift in a panel whose height is already
 * on screen, and the numbers arrive slowly (one usage read per Project). Drawn from this window,
 * the cells are in place from the first paint and only their colours change.
 */
export function dayWindow(weeks: number, today: Date = new Date()): DayUsage[] {
  const days: DayUsage[] = [];
  for (let at = windowStart(weeks, today); at <= today; at = addDays(at, 1)) {
    days.push({ day: localDay(at), tokens: 0 });
  }
  return days;
}

/** The Monday `weeks - 1` weeks before this week's: the first day the window covers. */
function windowStart(weeks: number, today: Date): Date {
  return addDays(weekStart(today), -(weeks - 1) * 7);
}

/** The last `weeks` weeks of daily totals, oldest first, zero-filled. */
export async function readDailyUsage(weeks: number): Promise<DayUsage[]> {
  const today = new Date();
  const days = dayWindow(weeks, today);
  const totals = new Map<string, number>();
  for (const id of await projectIds()) {
    const query = new URLSearchParams({
      groupBy: "date",
      granularity: "day",
      from: localDay(windowStart(weeks, today)),
      to: localDay(today),
    });
    const res = await fetch(`${API}/${encodeURIComponent(id)}/usage?${query}`, {
      credentials: "same-origin",
    });
    // A Project that answers nothing (deleted between the list and the read) contributes
    // nothing rather than emptying the graph: one bad project must not blank the others.
    if (!res.ok) continue;
    const body = (await res.json()) as { series?: SeriesPoint[] };
    for (const point of body.series ?? []) {
      if (typeof point.bucket !== "string" || typeof point.total !== "number") continue;
      totals.set(point.bucket, (totals.get(point.bucket) ?? 0) + point.total);
    }
  }
  return days.map(({ day }) => ({ day, tokens: totals.get(day) ?? 0 }));
}

/**
 * How dark one day's cell is drawn: 0 for a day with nothing, then a quarter of the window's
 * busiest day per step. Relative, not absolute — a quiet install's own busiest day is what its
 * graph is about, and a fixed Token threshold would paint the whole grid one shade.
 */
export function heatLevel(tokens: number, busiest: number): 0 | 1 | 2 | 3 | 4 {
  if (tokens <= 0) return 0;
  if (busiest <= 0) return 0;
  const share = tokens / busiest;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  if (share <= 0.75) return 3;
  return 4;
}
