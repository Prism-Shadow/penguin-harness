/**
 * Browsing history of a profile: Chromium's `History` (table `urls`, `last_visit_time` in
 * microseconds since 1601) and Firefox's `places.sqlite` (table `moz_places`, `last_visit_date`
 * in microseconds since 1970). http(s) pages only, the newest {@link HISTORY_LIMIT}, newest first.
 * Pages a browser keeps hidden (subframes, redirect hops) stay out.
 */
import type { DatabaseSync } from "node:sqlite";
import type { BuiltinBrowserHistoryEntry } from "../../api/types.js";
import type { DiscoveredProfile } from "./discovery.js";
import type { HistoryReadResult, ImportEnv } from "./index.js";
import { columnsOf, readDatabaseCopy, unreadableStoreWarning } from "./sqlite-copy.js";

export const HISTORY_LIMIT = 5000;

const HTTP_ONLY = "(url LIKE 'http://%' OR url LIKE 'https://%')";

interface HistoryRow {
  url: string;
  title: string | null;
  visits: number | null;
  /** Epoch ms, converted in SQL (Chromium's raw column exceeds a double's exact range). */
  last_visit: number;
}

export async function readProfileHistory(
  profile: DiscoveredProfile,
  env: ImportEnv,
): Promise<HistoryReadResult> {
  const { source, historyFile } = profile;
  if (historyFile === null) return { entries: [], warnings: ["This profile has no history."] };
  const read = source.browser === "firefox" ? readFirefox : readChromium;
  let rows: HistoryRow[];
  try {
    rows = await readDatabaseCopy(historyFile, env, read);
  } catch (err) {
    return { entries: [], warnings: [unreadableStoreWarning(err, source.browserName, "history")] };
  }
  const entries: BuiltinBrowserHistoryEntry[] = rows.map((row) => ({
    url: row.url,
    title: row.title ?? "",
    visitCount: Math.max(0, Math.floor(row.visits ?? 0)),
    lastVisitAt: Math.floor(row.last_visit),
    source: source.browser,
  }));
  return { entries, warnings: [] };
}

function readChromium(db: DatabaseSync): HistoryRow[] {
  const hidden = columnsOf(db, "urls").has("hidden") ? "AND hidden = 0" : "";
  return db
    .prepare(
      `SELECT url, title, visit_count AS visits,
         last_visit_time / 1000 - 11644473600000 AS last_visit
       FROM urls
       WHERE ${HTTP_ONLY} AND last_visit_time > 0 ${hidden}
       ORDER BY last_visit_time DESC
       LIMIT ${HISTORY_LIMIT}`,
    )
    .all() as unknown as HistoryRow[];
}

function readFirefox(db: DatabaseSync): HistoryRow[] {
  const hidden = columnsOf(db, "moz_places").has("hidden") ? "AND hidden = 0" : "";
  return db
    .prepare(
      `SELECT url, title, visit_count AS visits, last_visit_date / 1000 AS last_visit
       FROM moz_places
       WHERE ${HTTP_ONLY} AND last_visit_date IS NOT NULL ${hidden}
       ORDER BY last_visit_date DESC
       LIMIT ${HISTORY_LIMIT}`,
    )
    .all() as unknown as HistoryRow[];
}
