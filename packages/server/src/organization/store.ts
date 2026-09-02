/**
 * File I/O for organization directories: the one place that knows how the files are laid
 * out on disk. Reads return the raw text next to the parse result so callers can hash,
 * echo or report it; writes are whole-file replacements. No SQLite here — the caches are
 * the service's business.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OrgChatMessage, OrgTicketStatus } from "../api/types.js";
import type { CalendarEvent, Desks, OrgChart, OrgConfig, ParseResult, TicketDoc } from "./files.js";
import {
  parseCalendarEvent,
  parseChatLine,
  parseDesks,
  parseOrgChart,
  parseOrgConfig,
  parseTicket,
  serializeDesks,
  serializeOrgChart,
  serializeOrgConfig,
  serializeTicket,
} from "./files.js";
import {
  ORG_TICKET_COLUMNS,
  calendarDir,
  calendarEventPath,
  chatDir,
  chatFilePath,
  desksPath,
  handbookPath,
  isTicketColumn,
  orgChartPath,
  orgConfigPath,
  orgDir,
  organizationsDir,
  ticketPath,
  ticketsDir,
  workspaceDir,
} from "./paths.js";

/** Directory names that are Agent ids (organizations, calendar owners). */
const ID = /^[a-z][a-z0-9_]{1,63}$/;
/** Calendar event names: the same rule as any user-named file (hyphens included). */
const EVENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export interface OrgFile<T> {
  raw: string;
  parsed: ParseResult<T>;
}

export interface CalendarFile {
  agentId: string;
  name: string;
  raw: string;
  parsed: ParseResult<CalendarEvent>;
  mtimeMs: number;
}

export interface TicketFile {
  /** Path relative to the organization directory. */
  relPath: string;
  ticketId: string;
  /** The column directory the file sits in. */
  column: OrgTicketStatus;
  raw: string;
  parsed: ParseResult<TicketDoc>;
  mtimeMs: number;
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeText(p: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, "utf8");
}

export class OrgStore {
  constructor(readonly root: string) {}

  dir(projectId: string, orgId: string): string {
    return orgDir(this.root, projectId, orgId);
  }

  /** Organization ids under a Project: the directories that carry an `org_config.toml`. */
  async listOrgIds(projectId: string): Promise<string[]> {
    let items: import("node:fs").Dirent[];
    try {
      items = await fs.readdir(organizationsDir(this.root, projectId), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const d of items) {
      if (!d.isDirectory() || !ID.test(d.name)) continue;
      if (
        (await readText(
          orgConfigPath(path.join(organizationsDir(this.root, projectId), d.name)),
        )) !== null
      ) {
        out.push(d.name);
      }
    }
    return out.sort();
  }

  async exists(projectId: string, orgId: string): Promise<boolean> {
    return (await readText(orgConfigPath(this.dir(projectId, orgId)))) !== null;
  }

  /** Creates the directory skeleton; the callers write the files. */
  async createLayout(dir: string): Promise<void> {
    await fs.mkdir(path.dirname(dir), { recursive: true });
    // Not recursive: an existing directory is a taken id, never something to reuse.
    await fs.mkdir(dir, { recursive: false });
    for (const sub of [calendarDir(dir), ticketsDir(dir), chatDir(dir), workspaceDir(dir)]) {
      await fs.mkdir(sub, { recursive: true });
    }
  }

  async remove(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
  }

  // ---- org_config.toml / org_chart.yaml / desks.toml / README.md ----

  async readConfig(dir: string): Promise<OrgFile<OrgConfig> | null> {
    const raw = await readText(orgConfigPath(dir));
    return raw === null ? null : { raw, parsed: parseOrgConfig(raw) };
  }

  async writeConfig(dir: string, cfg: OrgConfig): Promise<void> {
    await writeText(orgConfigPath(dir), serializeOrgConfig(cfg));
  }

  async readChart(dir: string, orgId: string): Promise<OrgFile<OrgChart> | null> {
    const raw = await readText(orgChartPath(dir));
    return raw === null ? null : { raw, parsed: parseOrgChart(raw, orgId) };
  }

  async writeChart(dir: string, chart: OrgChart): Promise<void> {
    await writeText(orgChartPath(dir), serializeOrgChart(chart));
  }

  /** A missing ledger is an empty ledger. */
  async readDesks(dir: string): Promise<OrgFile<Desks>> {
    const raw = await readText(desksPath(dir));
    return raw === null
      ? { raw: "", parsed: { ok: true, value: {} } }
      : { raw, parsed: parseDesks(raw) };
  }

  async writeDesks(dir: string, desks: Desks): Promise<void> {
    await writeText(desksPath(dir), serializeDesks(desks));
  }

  async readHandbook(dir: string): Promise<string> {
    return (await readText(handbookPath(dir))) ?? "";
  }

  async writeHandbook(dir: string, content: string): Promise<void> {
    await writeText(handbookPath(dir), content);
  }

  // ---- calendar ----

  async listCalendar(dir: string): Promise<CalendarFile[]> {
    const out: CalendarFile[] = [];
    let agents: import("node:fs").Dirent[];
    try {
      agents = await fs.readdir(calendarDir(dir), { withFileTypes: true });
    } catch {
      return out;
    }
    for (const a of agents) {
      if (!a.isDirectory() || !ID.test(a.name)) continue;
      const files = await fs.readdir(calendarDir(dir, a.name), { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".toml")) continue;
        const name = f.name.slice(0, -".toml".length);
        if (!EVENT_NAME.test(name)) continue;
        const p = calendarEventPath(dir, a.name, name);
        const [raw, stat] = await Promise.all([fs.readFile(p, "utf8"), fs.stat(p)]);
        out.push({
          agentId: a.name,
          name,
          raw,
          parsed: parseCalendarEvent(name, raw),
          mtimeMs: stat.mtimeMs,
        });
      }
    }
    return out.sort((x, y) => x.agentId.localeCompare(y.agentId) || x.name.localeCompare(y.name));
  }

  async readCalendarEvent(
    dir: string,
    agentId: string,
    name: string,
  ): Promise<CalendarFile | null> {
    const p = calendarEventPath(dir, agentId, name);
    const raw = await readText(p);
    if (raw === null) return null;
    const stat = await fs.stat(p);
    return { agentId, name, raw, parsed: parseCalendarEvent(name, raw), mtimeMs: stat.mtimeMs };
  }

  async writeCalendarEvent(dir: string, agentId: string, name: string, raw: string): Promise<void> {
    await writeText(calendarEventPath(dir, agentId, name), raw);
  }

  async deleteCalendarEvent(dir: string, agentId: string, name: string): Promise<boolean> {
    try {
      await fs.unlink(calendarEventPath(dir, agentId, name));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  // ---- tickets ----

  /**
   * Every ticket file across months and columns. A file whose name is not a ticket id, or
   * that sits in a directory that is not a column, is skipped — it is not a ticket.
   */
  async listTickets(dir: string): Promise<TicketFile[]> {
    const out: TicketFile[] = [];
    let months: import("node:fs").Dirent[];
    try {
      months = await fs.readdir(ticketsDir(dir), { withFileTypes: true });
    } catch {
      return out;
    }
    for (const m of months) {
      if (!m.isDirectory() || !MONTH.test(m.name)) continue;
      for (const column of ORG_TICKET_COLUMNS) {
        const colDir = path.join(ticketsDir(dir), m.name, column);
        let files: import("node:fs").Dirent[];
        try {
          files = await fs.readdir(colDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith(".md")) continue;
          const ticketId = f.name.slice(0, -".md".length);
          const p = path.join(colDir, f.name);
          const [raw, stat] = await Promise.all([fs.readFile(p, "utf8"), fs.stat(p)]);
          out.push({
            relPath: path.relative(dir, p),
            ticketId,
            column,
            raw,
            parsed: parseTicket(raw),
            mtimeMs: stat.mtimeMs,
          });
        }
      }
    }
    return out.sort((a, b) => a.ticketId.localeCompare(b.ticketId));
  }

  /** Locates a ticket by id: its month is in the id, its column is whichever directory holds it. */
  async findTicket(dir: string, ticketId: string): Promise<TicketFile | null> {
    for (const column of ORG_TICKET_COLUMNS) {
      const p = ticketPath(dir, ticketId, column);
      const raw = await readText(p);
      if (raw === null) continue;
      const stat = await fs.stat(p);
      return {
        relPath: path.relative(dir, p),
        ticketId,
        column,
        raw,
        parsed: parseTicket(raw),
        mtimeMs: stat.mtimeMs,
      };
    }
    return null;
  }

  async writeTicket(
    dir: string,
    ticketId: string,
    column: OrgTicketStatus,
    doc: TicketDoc,
  ): Promise<void> {
    await writeText(ticketPath(dir, ticketId, column), serializeTicket(doc));
  }

  /** Rewrites the file in its new column and removes the old one (the header was updated by the caller). */
  async moveTicket(
    dir: string,
    ticketId: string,
    from: OrgTicketStatus,
    to: OrgTicketStatus,
    doc: TicketDoc,
  ): Promise<void> {
    await this.writeTicket(dir, ticketId, to, doc);
    if (from !== to) await fs.unlink(ticketPath(dir, ticketId, from)).catch(() => {});
  }

  // ---- chat ----

  async listChatDays(dir: string): Promise<string[]> {
    let files: import("node:fs").Dirent[];
    try {
      files = await fs.readdir(chatDir(dir), { withFileTypes: true });
    } catch {
      return [];
    }
    return files
      .filter(
        (f) =>
          f.isFile() && f.name.endsWith(".jsonl") && DATE.test(f.name.slice(0, -".jsonl".length)),
      )
      .map((f) => f.name.slice(0, -".jsonl".length))
      .sort()
      .reverse();
  }

  async appendChatLine(dir: string, date: string, line: string): Promise<void> {
    const p = chatFilePath(dir, date);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, `${line}\n`, "utf8");
  }

  /** Every parsable message of a day, in file order; malformed lines are reported alongside. */
  async readChatDay(
    dir: string,
    date: string,
  ): Promise<{ messages: OrgChatMessage[]; invalid: number }> {
    const raw = await readText(chatFilePath(dir, date));
    if (raw === null) return { messages: [], invalid: 0 };
    const messages: OrgChatMessage[] = [];
    let invalid = 0;
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      const r = parseChatLine(line);
      if (r.ok) messages.push(r.value);
      else invalid++;
    }
    return { messages, invalid };
  }

  /**
   * Tail scan: the complete lines after a byte offset, and the offset they end at. A file
   * shorter than the offset (rewritten by hand) is re-read from the start.
   */
  async readChatFrom(
    dir: string,
    date: string,
    offset: number,
  ): Promise<{ lines: string[]; nextOffset: number }> {
    const p = chatFilePath(dir, date);
    let buf: Buffer;
    try {
      buf = await fs.readFile(p);
    } catch {
      return { lines: [], nextOffset: 0 };
    }
    const start = offset > buf.length ? 0 : offset;
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < start) return { lines: [], nextOffset: start };
    const text = buf.subarray(start, lastNl + 1).toString("utf8");
    return {
      lines: text.split("\n").filter((l) => l.trim() !== ""),
      nextOffset: lastNl + 1,
    };
  }

  // ---- workspace ----

  /**
   * Resolves an employee's workspace as the chart writes it: relative → under the shared
   * workspace (and it must stay inside it); absolute → as given. Null when the directory
   * does not exist — the caller reports the entry as invalid rather than creating anything.
   */
  async resolveWorkspace(shared: string, spec: string): Promise<string | null> {
    const target = path.isAbsolute(spec) ? spec : path.resolve(shared, spec);
    if (!path.isAbsolute(spec)) {
      const rel = path.relative(shared, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    }
    try {
      const stat = await fs.stat(target);
      return stat.isDirectory() ? target : null;
    } catch {
      return null;
    }
  }

  isColumn(value: string): value is OrgTicketStatus {
    return isTicketColumn(value);
  }
}
