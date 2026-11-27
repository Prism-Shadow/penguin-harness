/**
 * The Agent State engine on gitoxide: the two engine steps in-process, no Git process.
 *
 * A commit builds the tree in memory on the parent's tree — the folder goes, the files go back
 * under it — and writes the commit with the reference update refusing a branch that moved
 * meanwhile, the CAS the harness asks for. Reading a version back is object reads straight off
 * the repository's object database.
 *
 * The engine writes the same bytes as the real-Git engines: the message whole, both identity
 * lines with the zone the harness computed, every file `100644`, trees in git's order — the
 * same input is the same commit under either, and the interchange tests pin that.
 */
import type {
  AgentStateCommit,
  AgentStateEngine,
  AgentStateEngineHost,
} from "@prismshadow/penguin-core/plugin";
import { loadNative, type Native } from "./binary.js";

export function gixEngine(native: Native, version: string): AgentStateEngine {
  return {
    name: `${version} (gitoxide)`,

    async commit(c: AgentStateCommit) {
      const identity = (who: AgentStateCommit["author"]) => ({
        name: who.name,
        email: who.email,
        whenSeconds: c.when.seconds,
        whenOffsetMinutes: c.when.offset,
      });
      return native.commit({
        gitdir: c.gitdir,
        refName: c.ref,
        parent: c.parent ?? undefined,
        rel: c.rel,
        files: c.files === null ? undefined : c.files.map((f) => ({ rel: f.rel, body: f.body })),
        message: c.message,
        author: identity(c.author),
        committer: identity(c.committer),
      });
    },

    async readBlobs(gitdir: string, oids: readonly string[]) {
      if (oids.length === 0) return [];
      return native.readBlobs(gitdir, [...oids]);
    },
  };
}

/** One load per process: the addon either loads or it does not, and the answer never changes. */
let native: Native | undefined;

/**
 * The engine for this host, once its addon loads; null (with a log line saying why) when the
 * native half cannot load on this host, so the harness keeps its built-in engine.
 */
export function openGixEngine(host: AgentStateEngineHost): AgentStateEngine | null {
  const say = (line: string) => host.log(`[agent-state-gix] ${line}`);
  if (native === undefined) {
    try {
      native = loadNative();
    } catch (err) {
      say(`the native half did not load: ${(err as Error).message}`);
      return null;
    }
  }
  const version = native.engineVersion();
  say(`${version} in-process`);
  return gixEngine(native, version);
}
