/**
 * The counts server modules contribute to the start page (`StartPageModule.metrics`), as
 * `GET /api/contributions` delivers them (`startMetrics`): each a number fixed when its package
 * was built, with its name, its glyph, its place, and the system app a click opens. The start
 * page draws them after its own counts (features/chat/start-dashboard.tsx).
 *
 * Read as the server might send it: an entry without an id, a title or a finite value is skipped,
 * and so is a second entry with an id already read. An answer from a server that sends no such
 * list — an older one, or none at all in safe mode — has none.
 */

export interface StartMetric {
  id: string;
  title: string;
  titleZh?: string;
  /** Its glyph's name in the UI package's icon registry (`ICONS`). */
  icon?: string;
  order: number;
  value: number;
  /** The page key of the system app a click opens; absent: the count opens nothing. */
  app?: string;
}

const NONE: readonly StartMetric[] = [];

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The contributed counts the answer carries, by `order` (then id). */
export function startMetricsOf(answer: unknown): readonly StartMetric[] {
  const entries = (answer as { startMetrics?: unknown } | null | undefined)?.startMetrics;
  if (!Array.isArray(entries)) return NONE;
  const metrics: StartMetric[] = [];
  const seen = new Set<string>();
  for (const raw of entries as unknown[]) {
    const entry = raw as Record<string, unknown> | null;
    if (entry === null || typeof entry !== "object") continue;
    const { id, title, titleZh, icon, order, value, app } = entry;
    if (!text(id) || seen.has(id) || !text(title)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    seen.add(id);
    metrics.push({
      id,
      title,
      ...(text(titleZh) ? { titleZh } : {}),
      ...(text(icon) ? { icon } : {}),
      order: typeof order === "number" && Number.isFinite(order) ? order : 0,
      value,
      ...(text(app) ? { app } : {}),
    });
  }
  if (metrics.length === 0) return NONE;
  return metrics.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
