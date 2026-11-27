/**
 * What the live suites share: the local Git payload the global setup staged, this plugin's engine over it, and
 * the server's own Agent State repository and built-in engine, imported by path (this package
 * depends on core alone) to compare against.
 */
import { fileURLToPath } from "node:url";
import type { AgentStateEngine } from "@prismshadow/penguin-core/plugin";
import { mustRun } from "../../../scripts/must-run.mjs";
import { locateGit, type GitProgram } from "../src/binary.js";
import { openGitEngine } from "../src/engine.js";
import { GIT_CACHE } from "./cache.js";

export { GIT_CACHE };

/** The engine and its Git, or null where this host cannot run them (and must not have to). */
export async function liveGit(): Promise<{ engine: AgentStateEngine; git: GitProgram } | null> {
  const logged: string[] = [];
  const engine = await openGitEngine({ cacheDir: GIT_CACHE, log: (line) => logged.push(line) });
  const found = engine === null ? null : await locateGit({ cacheDir: GIT_CACHE });
  const why = engine === null || found === null ? logged.join("; ") || "no Git" : null;
  return mustRun("agent-state-git", why) ? { engine: engine!, git: found!.git } : null;
}

/** The slice of the server's ./workbenches/repo.ts these suites drive. */
export interface RepoUnderTest {
  commitPath(
    rel: string,
    files: Array<{ rel: string; body: Uint8Array }>,
    subject: string,
    opts?: { at?: Date; by?: { name?: string; email?: string } },
  ): Promise<{ commit: string; changed: boolean }>;
  removePath(rel: string, subject: string): Promise<void>;
  history(rel: string): Promise<Array<{ revision: string; commit: string; savedAt: string }>>;
  filesAt(rel: string, revision: string): Promise<Array<{ rel: string; body: Uint8Array }> | null>;
}

export interface Server {
  AgentStateRepo: new (opts: {
    gitdir: string;
    now: () => Date;
    log: (line: string) => void;
    engine: AgentStateEngine;
    identity?: {
      env: Record<string, string>;
      home: string;
      readFile: (f: string) => string | null;
    };
  }) => RepoUnderTest;
  treeId(files: Array<{ rel: string; oid: string }>): string;
  blobOid(body: Uint8Array): string;
}

export const server = (await import(
  fileURLToPath(new URL("../../../packages/server/src/workbenches/repo.ts", import.meta.url))
)) as Server;

/** No identity from this machine: the commits under test are the same everywhere. */
export const QUIET = { env: {}, home: GIT_CACHE, readFile: () => null };
