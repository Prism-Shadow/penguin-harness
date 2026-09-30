/**
 * The telemetry machine view (`GET /api/telemetry?view=machine`): this process as it stands
 * at the moment of the read — its memory, the App generations it has created, and what each
 * loaded Session reports it holds. Nothing here is buffered: it is computed per read, which
 * is why it costs nothing between reads.
 */
import type {
  TelemetryGenerations,
  TelemetryMachineView,
  TelemetrySessionReport,
} from "../api/types.js";

/** A report as the Sessions module registers it: an array of TelemetrySessionReport, or anything else (ignored). */
function asSessionReports(report: unknown): TelemetrySessionReport[] | null {
  return Array.isArray(report) ? (report as TelemetrySessionReport[]) : null;
}

export function machineView(
  generations: TelemetryGenerations,
  sessionsReport: unknown,
  memory: NodeJS.MemoryUsage = process.memoryUsage(),
): TelemetryMachineView {
  const sessions = asSessionReports(sessionsReport);
  return {
    process: {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    generation: generations,
    sessions,
    totals:
      sessions === null
        ? null
        : sessions.reduce(
            (t, s) => ({
              sessions: t.sessions + 1,
              resumedHistory: t.resumedHistory + (s.resumedHistory ?? 0),
              channelBytes: t.channelBytes + (s.channelBytes ?? 0),
              liveBytes: t.liveBytes + (s.liveBytes ?? 0),
              subscribers: t.subscribers + (s.subscribers ?? 0),
            }),
            { sessions: 0, resumedHistory: 0, channelBytes: 0, liveBytes: 0, subscribers: 0 },
          ),
  };
}
