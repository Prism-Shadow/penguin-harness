/**
 * The Agent State history vocabulary an engine plugin compiles against: types only.
 *
 * The harness records an Agent's workbench versions as commits in the bare repository beside its
 * Agent State (`<agentDir>/agent_state.git/`). Everything that is cheap in-process stays in the
 * harness and is never handed to an engine: reading HEAD and trees, comparing a folder with the
 * tree HEAD has, walking the history, creating the repository, deciding which file names git
 * refuses, and choosing who a version is by. An ENGINE does the two steps whose cost grows with
 * the files: writing one commit (its blobs, trees, the commit and the branch move) and reading
 * many blobs back. The built-in engine is pure JavaScript; a plugin may contribute another to the
 * server's `AgentStateHistoryModule.engines` slot, and the harness hands it a step only from the
 * folder size it says it is faster from (`fasterFrom`), keeping the rest built-in.
 *
 * Both engines must write the same bytes: the same input gives the same commit id under either,
 * so a repository can change hands between them at any commit.
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
  /**
   * The smallest folder, in files, for which this engine does each step faster than the built-in
   * one, as measured on this host's platform: a commit of a smaller folder, and a read of a
   * smaller version, stay built-in. Absent, or a step absent: from one file.
   */
  readonly fasterFrom?: { commit?: number; read?: number };
  /** Writes the commit's objects, then moves the branch from `parent` to it; the commit id (full hex). */
  commit(commit: AgentStateCommit): Promise<string>;
  /** The bodies of these blobs (full hex ids), in the order asked; an id not in the repository rejects. */
  readBlobs(gitdir: string, oids: readonly string[]): Promise<Uint8Array[]>;
}

/**
 * Raised by an engine that could not run at all — its program missing, not executable, or killed
 * before it answered — as opposed to git running and refusing the write. Only this kind is
 * retried with the built-in engine, and the harness stops asking that engine for the rest of the
 * process; a refusal (the branch moved, a ref locked by another program) is the repository's
 * answer and is reported as it is.
 */
export interface AgentStateEngineUnavailable extends Error {
  readonly engineUnavailable: true;
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
 * The code half of an `AgentStateHistoryModule.engines` contribution: the engine, or null when it
 * cannot run on this host, or a promise of either for an engine that has to fetch or probe a
 * program first. The harness asks once per App, does not wait for the answer, and records with
 * the built-in engine until a non-null one arrives.
 */
export type AgentStateEngineSource = (
  host: AgentStateEngineHost,
) => AgentStateEngine | null | Promise<AgentStateEngine | null>;
