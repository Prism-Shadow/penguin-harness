/**
 * What an Agent export carries, as the export dialog holds it and as the archive routes are asked
 * for it (api/types.ts, "Agent archive"): the parts query both GETs take, and the dialog's
 * defaults, which are the ones the server applies to an absent key.
 */
import type { AgentArchiveParts, TraceSelection } from "@prismshadow/penguin-server/api";

/** The parts that are switched on or off (the Trace selection is the one that is not). */
export type ArchiveSwitch = Exclude<keyof AgentArchiveParts, "traces">;

/**
 * The export dialog's switches on opening: everything but the schedules, which would start
 * running on the server the zip is imported into. It opens with no Traces.
 */
export const DEFAULT_SWITCHES: Readonly<Record<ArchiveSwitch, boolean>> = {
  skills: true,
  hooks: true,
  memory: true,
  workbenches: true,
  workbenchData: true,
  schedules: false,
};

/** How many of the latest Sessions "Latest N" starts at. */
export const DEFAULT_TRACE_COUNT = 20;
/** The most Sessions `traces=last:<N>` selects (the server refuses more). */
export const MAX_TRACE_COUNT = 500;

/**
 * The size an upload may have (the server's `MAX_UPLOAD_BYTES`, agent-archive/limits.ts): the
 * export dialog says when a selection is larger, uncompressed, since the zip of it may not
 * import again.
 */
export const IMPORT_LIMIT_BYTES = 100 * 1024 * 1024;

/** `traces=` in its text form: `none`, `last:<N>` or `<from>..<to>`. */
function tracesText(traces: TraceSelection): string {
  switch (traces.kind) {
    case "none":
      return "none";
    case "last":
      return `last:${traces.count}`;
    case "range":
      return `${traces.from}..${traces.to}`;
  }
}

/** The `<parts>` query, every key spelled out: each switch as `0`/`1`, and the Trace selection. */
export function archivePartsQuery(parts: AgentArchiveParts): Record<string, string> {
  const flag = (on: boolean) => (on ? "1" : "0");
  return {
    skills: flag(parts.skills),
    hooks: flag(parts.hooks),
    memory: flag(parts.memory),
    workbenches: flag(parts.workbenches),
    // Its own data means nothing without the workbenches: sent off with them.
    workbenchData: flag(parts.workbenches && parts.workbenchData),
    schedules: flag(parts.schedules),
    traces: tracesText(parts.traces),
  };
}
