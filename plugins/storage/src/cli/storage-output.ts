/**
 * What `penguin storage` prints: the figures by category, by Project and by server entry, and a
 * cleanup review as one table. Pure functions of the answers and the messages, so a test reads
 * them without a server.
 */
import { renderTable } from "@prismshadow/penguin-library-cli";
import type {
  StorageCategory,
  StorageCleanupItem,
  StorageCleanupReview,
  StorageUsage,
} from "../types.js";
import type { StorageMessages } from "./storage.messages.js";

/** The order the categories are listed in, as the page's bar stacks them. */
const CATEGORIES: readonly StorageCategory[] = [
  "traces",
  "agentState",
  "workspaces",
  "scratchpads",
  "caches",
  "logs",
  "plugins",
  "other",
];

/** A byte count with a space before its unit: `812 B`, `4.9 GB`. */
export function formatSize(bytes: number): string {
  const n = Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  // The unit is picked from the rounded value, so 1048570 B prints as 1 MB, not 1024.0 KB.
  while (unit < units.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, "")} ${units[unit]}`;
}

/** An ISO time in local time, to the minute: `2026-11-20 10:31`. */
export function localMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `penguin storage`: the head line, the categories, the Projects and an admin's server entries. */
export function renderUsage(usage: StorageUsage, t: StorageMessages): string {
  const s = t.storage;
  const server = usage.server;
  const bytes = server?.bytes ?? usage.bytes;
  const categories = server?.categories ?? usage.categories;
  const measured = usage.measuredAt === null ? null : localMinute(usage.measuredAt);
  const out: string[] = [
    `${s.head(server !== undefined ? "server" : "projects", formatSize(bytes), measured)}\n`,
  ];
  if (usage.measuring) out.push(`${s.measuringNote}\n`);
  if (usage.error !== undefined) out.push(`${s.measureFailed(usage.error)}\n`);
  out.push(
    "\n",
    renderTable(
      [s.categoryCol, s.sizeCol],
      CATEGORIES.filter((c) => categories[c] > 0).map((c) => [
        s.categories[c],
        formatSize(categories[c]),
      ]),
    ),
  );
  out.push("\n", `${s.projects}\n`);
  if (usage.projects.length === 0 && (server?.otherProjects.count ?? 0) === 0) {
    out.push(`${s.noProjects}\n`);
  } else {
    const rows: string[][] = [];
    for (const project of usage.projects) {
      rows.push([project.name, "", formatSize(project.bytes)]);
      for (const agent of project.agents) rows.push(["", agent.name, formatSize(agent.bytes)]);
    }
    if (server !== undefined && server.otherProjects.count > 0) {
      rows.push([
        s.otherProjects(server.otherProjects.count),
        "",
        formatSize(server.otherProjects.bytes),
      ]);
    }
    out.push(renderTable([s.projectCol, s.agentCol, s.sizeCol], rows));
  }
  if (server !== undefined && server.entries.length > 0) {
    out.push(
      "\n",
      `${s.serverFiles} (${server.root})\n`,
      renderTable(
        [s.entryCol, s.categoryCol, s.sizeCol],
        server.entries.map((e) => [e.name, s.categories[e.category], formatSize(e.bytes)]),
      ),
    );
  }
  return out.join("");
}

/** The row's kind, an idle scratchpad told apart from an orphan one. */
function kindOf(item: StorageCleanupItem, t: StorageMessages): string {
  if (item.kind === "scratchpad" && item.reason === "idle") return t.storage.kinds.scratchpadIdle;
  return t.storage.kinds[item.kind];
}

/**
 * The row's name: a chat's title where there is one to show, never a raw Session id — one whose
 * chat is gone reads as such, one whose title is not the caller's to read (another user's
 * Project, for an admin) as another user's chat.
 */
function nameOf(item: StorageCleanupItem, t: StorageMessages): string {
  if (item.kind !== "scratchpad") return item.name;
  if (item.reason === "orphan") return t.storage.deletedChat;
  if (item.title === undefined) return t.storage.hiddenChat;
  return item.title ?? t.storage.untitledChat;
}

/** A cleanup review, `chosen` marking what a removal would take. */
export function renderReview(
  review: StorageCleanupReview,
  chosen: ReadonlySet<string>,
  t: StorageMessages,
): string {
  const s = t.storage;
  if (review.items.length === 0) return `${s.nothing}\n`;
  return renderTable(
    [s.chosenCol, s.kindCol, s.whereCol, s.nameCol, s.sizeCol, s.changedCol],
    review.items.map((item) => [
      chosen.has(item.id) ? "x" : "",
      kindOf(item, t),
      item.projectName !== undefined ? `${item.projectName} / ${item.agentName ?? ""}` : "",
      nameOf(item, t),
      formatSize(item.bytes),
      item.lastModifiedAt !== null ? localMinute(item.lastModifiedAt) : "",
    ]),
  );
}
