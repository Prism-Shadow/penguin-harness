/**
 * What the server notes about an Agent archive — on the export's preview and in an import's
 * answer — said in the reader's language: each known code in the dictionary's words, a part
 * named by its settings tab, and the server's English sentence for a code this client does not
 * know (a newer server). Reads S at call time (live binding), so it follows a language switch.
 */
import type { AgentArchiveNote } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

/** A part directory as the note's subject names it, by the settings tab that shows it. */
function partName(subject: string): string {
  switch (subject) {
    case "memory":
      return S.agent.tabMemory;
    case "skills":
      return S.agent.tabSkills;
    case "hooks":
      return S.agent.tabHooks;
    case "workbenches":
      return S.agent.tabWorkbenches;
    case "schedule":
      return S.agent.tabSchedules;
    case "tools":
      return S.agent.tabTools;
    default:
      return subject;
  }
}

export function archiveNoteText(note: AgentArchiveNote): string {
  const said = S.agent.archiveNotes;
  switch (note.code) {
    case "unknown_tool":
      return note.subject === undefined ? note.message : said.unknownTool(note.subject);
    case "no_known_tools":
      return said.noKnownTools;
    case "link_skipped":
      return note.subject === undefined ? note.message : said.linkSkipped(partName(note.subject));
    default:
      return note.message;
  }
}
