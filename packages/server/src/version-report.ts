/**
 * The one assembler behind `penguin version --json` and GET /api/version.
 *
 * The report has two halves that no single layer can produce. Core knows the artifact this
 * process is executing and nothing about data roots; the HMR store knows what harness was
 * pushed to a root and nothing about the process reading it. Joining them here — rather
 * than in each caller — is what makes "the CLI and the API report the same thing" a
 * structural fact instead of two spreads that have to be kept in step.
 *
 * It lives in the server package because that is where the harness.json format is owned
 * (see ./hmr/manifest.ts), and is exported as its own entry point so the CLI can reach it
 * without pulling in a server: the module graph here is core plus a `node:fs` read.
 */
import { buildInfo } from "@prismshadow/penguin-core";
import type { VersionReport } from "@prismshadow/penguin-core/interfaces";
import { readHarnessInfo } from "./hmr/manifest.js";

/**
 * The running build's identity plus the harness committed to `root`'s HMR store.
 *
 * Never throws: an unreadable or malformed store reports `harness: null`, which is also
 * what a root with nothing ever pushed to it reports. Version reporting degrades to fewer
 * facts, never to a failure.
 */
export async function versionReport(root: string): Promise<VersionReport> {
  return { ...buildInfo(), harness: await readHarnessInfo(root) };
}
