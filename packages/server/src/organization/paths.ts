/**
 * Where an organization lives on disk. Every path is under the Project directory —
 * `<root>/<projectId>/organizations/<orgId>/` — so the model's `<app_data_dir>` placeholder
 * (its Environment's App Data Dir is the Project directory) resolves to the same place the
 * server reads. Files are the truth for company mode; nothing here touches SQLite.
 */
import path from "node:path";
import { projectDir } from "@prismshadow/penguin-core";
import type { OrgTicketStatus } from "../api/types.js";

/** The kanban columns in board order; each is a directory under `tickets/<yyyy-mm>/`. */
export const ORG_TICKET_COLUMNS: readonly OrgTicketStatus[] = [
  "proposed",
  "in_progress",
  "review",
  "done",
  "rejected",
];

export function isTicketColumn(value: string): value is OrgTicketStatus {
  return (ORG_TICKET_COLUMNS as readonly string[]).includes(value);
}

export function organizationsDir(root: string, projectId: string): string {
  return path.join(projectDir(root, projectId), "organizations");
}

export function orgDir(root: string, projectId: string, orgId: string): string {
  return path.join(organizationsDir(root, projectId), orgId);
}

export function orgConfigPath(dir: string): string {
  return path.join(dir, "org_config.toml");
}

export function orgChartPath(dir: string): string {
  return path.join(dir, "org_chart.yaml");
}

export function desksPath(dir: string): string {
  return path.join(dir, "desks.toml");
}

/** `handbook/`: the organization handbook, the company's knowledge base. */
export function handbookDir(dir: string): string {
  return path.join(dir, "handbook");
}

/** `handbook/README.md`: the index every work run reads first. */
export function handbookPath(dir: string): string {
  return path.join(handbookDir(dir), "README.md");
}

/**
 * A path inside the handbook, relative to `handbook/`: plain segments (no hidden files, no
 * `.`/`..`, at most eight levels), so a request can never name a file outside the directory.
 */
export const HANDBOOK_FILE_PATTERN =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/){0,7}[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isHandbookFilePath(rel: string): boolean {
  return HANDBOOK_FILE_PATTERN.test(rel);
}

export function handbookFilePath(dir: string, rel: string): string {
  if (!isHandbookFilePath(rel)) throw new Error(`invalid handbook path: ${rel}`);
  return path.join(handbookDir(dir), ...rel.split("/"));
}

export function calendarDir(dir: string, agentId?: string): string {
  return agentId === undefined ? path.join(dir, "calendar") : path.join(dir, "calendar", agentId);
}

export function calendarEventPath(dir: string, agentId: string, name: string): string {
  return path.join(calendarDir(dir, agentId), `${name}.toml`);
}

export function ticketsDir(dir: string): string {
  return path.join(dir, "tickets");
}

/** `tickets/<yyyy-mm>/<column>/<ticketId>.md`; the month comes from the id's date prefix. */
export function ticketPath(dir: string, ticketId: string, column: OrgTicketStatus): string {
  return path.join(ticketsDir(dir), ticketMonth(ticketId), column, `${ticketId}.md`);
}

/** The `yyyy-mm` a ticket id belongs to (its first seven characters). */
export function ticketMonth(ticketId: string): string {
  return ticketId.slice(0, 7);
}

export function chatDir(dir: string): string {
  return path.join(dir, "chat");
}

export function chatFilePath(dir: string, date: string): string {
  return path.join(chatDir(dir), `${date}.jsonl`);
}

export function workspaceDir(dir: string): string {
  return path.join(dir, "workspace");
}

/** The CEO's Agent id is fixed by the organization id, so creation can check it is free before writing anything. */
export function ceoAgentId(orgId: string): string {
  return `${orgId}_ceo`;
}
