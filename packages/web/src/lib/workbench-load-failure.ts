/**
 * What a workbench's load failure puts in its problem report (lib/failure.tsx's told failures):
 * the workbench, whether it runs on a connected machine, and the load error as the compiler or
 * the loader wrote it.
 *
 * A load failure is reported like any failure the app is told about, not left to the Agent as its
 * own work: the error may come from what the platform provides — Node's declarations, the host's
 * types, how the build was packaged — rather than from the workbench's code, and then only the
 * platform can fix it. The compiler names the workbench's files relative to its folder; a home
 * path the error still carries is masked like every report's text.
 *
 * Shared by the workbench domain's web half and the features that hand a failure over ("Fix with
 * AI", features/ai-create) or report it (the Agent settings' workbench rows): the vocabulary both
 * consume, so it lives here, below the domains, and the half reads it through the host seam.
 */
import type { ReportFact, ToldFailure } from "@prismshadow/penguin-ui";

/** The workbench whose files did not load, as the surface that shows the error has it. */
export interface WorkbenchLoadError {
  workbenchId: string;
  /** The machine it lives on; null for this server. */
  machineId: string | null;
  /** The load error, verbatim. */
  error: string;
}

/** The same, with what "Fix with AI" names besides (features/ai-create/workbench-repair.tsx). */
export interface FailedWorkbench extends WorkbenchLoadError {
  /** What the surface calls it. */
  name: string;
  /** The Agent it belongs to. */
  agentId: string;
}

export function workbenchLoadFailure({
  workbenchId,
  machineId,
  error,
}: WorkbenchLoadError): ToldFailure {
  const facts: ReportFact[] = [["Workbench", workbenchId]];
  // The environment a report adds is this server's, not that of the machine that loaded it.
  if (machineId !== null) {
    facts.push([
      "Runs on",
      "a connected machine (the version and OS below are the server this window talks to)",
    ]);
  }
  return { what: "a workbench failed to load", facts, detail: error };
}
