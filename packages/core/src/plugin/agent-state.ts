/**
 * The Agent State history vocabulary an engine plugin compiles against: types only.
 *
 * The harness records an Agent's workbench versions as commits in the bare repository beside its
 * Agent State (`<agentDir>/agent_state.git/`). Everything that is cheap in-process stays in the
 * harness and is never handed to an engine: reading HEAD and refs, comparing a folder with the
 * tree HEAD has, walking the history, creating the repository, deciding which file names git
 * refuses, and choosing who a version is by. An ENGINE does the two steps whose cost grows with
 * the files: writing one commit (its blobs, trees, the commit and the branch move) and reading
 * objects back. There is no built-in engine: a deployment contributes one to the server's
 * `AgentStateHistoryModule.engines` slot, and the first contributed engine that is ready does
 * every step; with none, reading or recording history is an error.
 *
 * Every engine must write the same bytes: the same input gives the same commit id under any of
 * them, so a repository can change hands between them at any commit.
 */

/** One file of a folder: its `/`-separated path inside the folder and its bytes. */
export interface AgentStateFile {
  rel: string;
  body: Uint8Array;
}

/** A name and an email as git records them; neither holds `<`, `>` or a line break. */
export interface AgentStateIdentity {
  name: string;
  email: string;
}

/** One commit for an engine to write. */
export interface AgentStateCommit {
  /** The bare repository, absolute. It exists, and HEAD names `ref`. */
  gitdir: string;
  /** The branch the commit moves, `refs/heads/main`. */
  ref: string;
  /**
   * The branch's commit the new one is made on (full hex), or null for the branch's first
   * commit. The branch moves only from this commit: if it moved since, the write is refused.
   */
  parent: string | null;
  /** The folder the commit replaces, `workbenches/<id>`: the parent's tree with this one subtree changed. */
  rel: string;
  /**
   * The folder's files, every mode 100644, none under a name git refuses (the harness filtered
   * them). Null removes the folder. Never empty: an empty folder is a removal.
   */
  files: AgentStateFile[] | null;
  /** The commit message, whole: it ends in a line break. */
  message: string;
  author: AgentStateIdentity;
  committer: AgentStateIdentity;
  /** Whole seconds since the epoch, and the zone as minutes east of UTC: both lines carry it. */
  when: { seconds: number; offset: number };
}

export interface AgentStateEngine {
  /** What log lines call it, e.g. `git 2.56.1 (dugite)`. */
  readonly name: string;
  /** Writes the commit's objects, then moves the branch from `parent` to it; the commit id (full hex). */
  commit(commit: AgentStateCommit): Promise<string>;
  /**
   * The raw content of these objects (a blob's bytes, a tree's entries, a commit's headers —
   * whatever each id names), null where an id is not in the repository, in the order asked.
   */
  readObjects(gitdir: string, oids: readonly string[]): Promise<Array<Uint8Array | null>>;
}

/** What the harness hands an engine source when it asks for the engine. */
export interface AgentStateEngineHost {
  /**
   * A directory this contribution may keep files in, under the data root, kept across restarts
   * and never read by anything else. It may not exist yet.
   */
  cacheDir: string;
  /** One line to the server log, prefixed with nothing: say who you are. */
  log(line: string): void;
}

/**
 * The code half of an `AgentStateHistoryModule.engines` contribution: the engine, or a promise
 * of it for an engine that has to fetch or probe a program first. The harness asks once per
 * App and records with the first source that answered with an engine; a source that fails
 * leaves the deployment without an engine, which the harness reports as it is.
 */
export type AgentStateEngineSource = (
  host: AgentStateEngineHost,
) => AgentStateEngine | Promise<AgentStateEngine>;
