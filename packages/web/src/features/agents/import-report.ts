/**
 * What an Agent import says when it lands, as one toast: created or replaced (with the State
 * versions), then what came in — only the parts that brought something — the conversations it
 * skipped, the vault keys and blanked MCP values the user has to fill in, and the server's notes
 * (a built-in tool this install lacks, say) in the reader's language (archive-notes.ts).
 */
import type { AgentArchiveImportResponse } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { archiveNoteText } from "./archive-notes";

export function importReportText(res: AgentArchiveImportResponse, name: string): string {
  const join = S.agent.importReportJoin;
  const counts = S.agent.importCounts;
  const { imported } = res;
  const brought = [
    imported.skills > 0 ? counts.skills(imported.skills) : null,
    imported.hooks > 0 ? counts.hooks(imported.hooks) : null,
    imported.memoryFiles > 0 ? counts.memoryFiles(imported.memoryFiles) : null,
    imported.workbenches > 0 ? counts.workbenches(imported.workbenches) : null,
    imported.schedules > 0 ? counts.schedules(imported.schedules) : null,
    imported.traces.sessions > 0 ? counts.sessions(imported.traces.sessions) : null,
  ].filter((part): part is string => part !== null);
  const lead =
    res.mode === "created"
      ? S.agent.importDoneCreated(name)
      : S.agent.importDoneReplaced(name, res.previousVersion, res.version);
  const clauses = [
    brought.length > 0 ? `${lead}${join.lead}${brought.join(join.list)}` : lead,
    res.skippedTraces.length > 0 ? S.agent.importSkipped(res.skippedTraces.length) : null,
    res.toFill.length > 0 ? S.agent.importToFill(res.toFill.join(join.list)) : null,
    ...res.notes.map(archiveNoteText),
  ].filter((clause): clause is string => clause !== null);
  return clauses.join(join.clause);
}
