/**
 * `penguin telemetry` — the server's in-memory telemetry readings (PRFC-0008), from
 * GET /api/telemetry (admin only).
 *
 *   penguin telemetry [--by probe|session] [--samples] [--probe <name>] [--session <id>]
 *                     [--all] [--limit <n>] [--json] [--server <url>]
 *   penguin telemetry on | off | clear [--server <url>]
 *
 * Default prints the per-probe summary (count, p50, p95, max, bytes); `--by session` the
 * per-session one; `--samples` the samples themselves, oldest first. Run inside a session
 * (PENGUIN_SESSION_ID set), the view is narrowed to that session unless `--session` names
 * another or `--all` lifts it — a filter for reading, not a boundary: the route answers admins
 * only, whatever is asked. `on` / `off` flip the system setting, `clear` empties the buffer.
 */
import type { Command } from "commander";
import type {
  ServerSettingsResponse,
  TelemetryResponse,
  TelemetrySample,
} from "@prismshadow/penguin-server/api";
import { resolveConnection, ServerClient } from "../client.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const BYS = ["probe", "session"] as const;

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms * 10) / 10}ms`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** hh:mm:ss.mmm, local time. */
function clock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** The sample's attributes and keys in one short line: what tells two samples of a probe apart. */
function detail(s: TelemetrySample): string {
  const parts: string[] = [];
  const a = s.attrs ?? {};
  if (a.method !== undefined && a.route !== undefined) parts.push(`${a.method} ${a.route}`);
  for (const [key, value] of Object.entries(a)) {
    if (key === "method" || key === "route") continue;
    parts.push(`${key}=${value}`);
  }
  if (s.keys.generation !== undefined) parts.push(`gen=${s.keys.generation}`);
  if (s.keys.session !== undefined) parts.push(`session=${s.keys.session}`);
  if (s.keys.task !== undefined) parts.push(`task=${s.keys.task.slice(0, 8)}`);
  if (s.keys.request !== undefined) parts.push(`req=${s.keys.request.slice(0, 8)}`);
  return parts.join(" ");
}

export function registerTelemetryCommand(program: Command, t: Messages): void {
  const cmd = program
    .command("telemetry")
    .description(t.telemetry.desc)
    .option("--by <view>", t.telemetry.by)
    .option("--samples", t.telemetry.samples)
    .option("--probe <name>", t.telemetry.probe)
    .option("--session <id>", t.telemetry.session)
    .option("--all", t.telemetry.all)
    .option("--limit <n>", t.telemetry.limit)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const by = opts.by === undefined ? "probe" : String(opts.by);
      if (!(BYS as readonly string[]).includes(by)) {
        process.stderr.write(`${t.error(t.telemetry.byInvalid(by))}\n`);
        process.exitCode = 1;
        return;
      }
      let limit: number | undefined;
      if (opts.limit !== undefined) {
        limit = Number(opts.limit);
        if (!Number.isInteger(limit) || limit <= 0) {
          process.stderr.write(`${t.error(t.telemetry.limitInvalid(String(opts.limit)))}\n`);
          process.exitCode = 1;
          return;
        }
      }
      // Inside a session, its own samples by default (a reading filter, not a boundary).
      const ownSession = process.env.PENGUIN_SESSION_ID;
      const session =
        opts.session !== undefined
          ? String(opts.session)
          : opts.all !== true && ownSession !== undefined && ownSession !== ""
            ? ownSession
            : undefined;
      const view = opts.samples === true ? "samples" : by === "session" ? "sessions" : "probes";
      const params = new URLSearchParams({ view });
      if (opts.probe !== undefined) params.set("probe", String(opts.probe));
      if (session !== undefined) params.set("session", session);
      if (limit !== undefined) params.set("limit", String(limit));

      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const res = await client.request<TelemetryResponse>(
        "GET",
        `/api/telemetry?${params.toString()}`,
      );
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      const out = process.stdout;
      if (!res.enabled) {
        out.write(`${t.telemetry.off()}\n`);
        return;
      }
      if (session !== undefined && opts.session === undefined) {
        out.write(`${t.telemetry.scopedTo(session)}\n`);
      }
      if (view === "samples") {
        const samples = res.samples ?? [];
        if (samples.length === 0) return void out.write(`${t.telemetry.empty()}\n`);
        out.write(
          renderTable(
            [
              t.telemetry.colTime(),
              t.telemetry.colProbe(),
              t.telemetry.colDuration(),
              t.telemetry.colBytes(),
              t.telemetry.colStatus(),
              t.telemetry.colDetail(),
            ],
            samples.map((s) => [
              clock(s.ts),
              s.probe,
              formatMs(s.durMs),
              formatBytes(s.bytes),
              s.status ?? "-",
              detail(s),
            ]),
          ),
        );
        return;
      }
      if (view === "sessions") {
        const sessions = res.sessions ?? [];
        if (sessions.length === 0) return void out.write(`${t.telemetry.empty()}\n`);
        out.write(
          renderTable(
            [
              t.telemetry.colSession(),
              t.telemetry.colProbe(),
              t.telemetry.colCount(),
              t.telemetry.colDuration(),
              t.telemetry.colMax(),
            ],
            sessions.flatMap((s) =>
              s.probes.map((p, i) => [
                i === 0 ? s.session : "",
                p.probe,
                String(p.count),
                formatMs(p.totalMs),
                formatMs(p.maxMs),
              ]),
            ),
          ),
        );
        return;
      }
      const probes = res.probes ?? [];
      if (probes.length === 0) return void out.write(`${t.telemetry.empty()}\n`);
      out.write(
        renderTable(
          [
            t.telemetry.colProbe(),
            t.telemetry.colCount(),
            t.telemetry.colP50(),
            t.telemetry.colP95(),
            t.telemetry.colMax(),
            t.telemetry.colBytes(),
          ],
          probes.map((p) => [
            p.probe,
            String(p.count),
            formatMs(p.p50Ms),
            formatMs(p.p95Ms),
            formatMs(p.maxMs),
            formatBytes(p.bytes),
          ]),
        ),
      );
    });

  const setSwitch = async (server: string | undefined, telemetry: boolean): Promise<void> => {
    const client = new ServerClient(await resolveConnection({ server }, t), t);
    const res = await client.request<ServerSettingsResponse>("PUT", "/api/admin/settings", {
      telemetry,
    });
    process.stdout.write(
      `${res.settings.telemetry ? t.telemetry.turnedOn() : t.telemetry.turnedOff()}\n`,
    );
  };
  cmd
    .command("on")
    .description(t.telemetry.onDesc)
    .option("--server <url>", t.common.server)
    .action(async (opts) => setSwitch(opts.server, true));
  cmd
    .command("off")
    .description(t.telemetry.offDesc)
    .option("--server <url>", t.common.server)
    .action(async (opts) => setSwitch(opts.server, false));
  cmd
    .command("clear")
    .description(t.telemetry.clearDesc)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      await client.request("DELETE", "/api/telemetry");
      process.stdout.write(`${t.telemetry.cleared()}\n`);
    });
}
