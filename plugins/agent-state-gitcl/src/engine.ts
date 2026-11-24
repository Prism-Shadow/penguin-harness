/**
 * The Agent State engine on the host's Git command line: a commit is the standard git pipeline
 * any script uses, one process per command; a version read back is one process.
 *
 * A commit: hash-object writes the files' blobs, read-tree loads the parent's tree into a
 * temporary index (empty for a root commit), update-index drops the folder the commit replaces
 * and adds the new files, write-tree writes the tree, commit-tree writes the commit — the
 * identity and the time the harness decided arrive as that process's environment variables, not
 * read from any config — and update-ref moves the branch only from the parent the commit names,
 * so a branch another writer moved meanwhile refuses the write. Plumbing writes loose objects
 * and runs no hooks, and the blobs are hashed without filters, so the bytes are the built-in
 * engine's bytes.
 *
 * Reading a version back is one `git cat-file --batch`: the harness walked the version's trees
 * itself and asks for every blob of it at once.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentStateCommit,
  AgentStateEngine,
  AgentStateEngineHost,
} from "@prismshadow/penguin-core/plugin";
import { probeGit, type GitProgram } from "./binary.js";
import { finish, start } from "./git.js";

/** The zone of git's raw date form, computed from an offset in minutes: `+hhmm` east of UTC. */
const zoneOf = (offset: number): string => {
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${offset < 0 ? "-" : "+"}${hh}${mm}`;
};

/** One `cat-file --batch` process, asked for many objects at a time and answered in order. */
class Objects {
  private readonly child;
  private readonly done: Promise<Buffer>;
  private pending: Buffer[] = [];
  private readonly waiting: Array<{
    oid: string;
    resolve: (o: { type: string; body: Buffer }) => void;
    reject: (err: Error) => void;
  }> = [];
  private failed: Error | null = null;

  constructor(git: GitProgram, gitdir: string) {
    this.child = start(git, gitdir, ["cat-file", "--batch"]);
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.pending.push(chunk);
      this.drain();
    });
    this.done = finish(this.child, "cat-file", undefined, { keepStdout: false });
    this.done.catch((err: Error) => {
      this.failed = err;
      for (const w of this.waiting.splice(0)) w.reject(err);
    });
  }

  /** Answers whatever the bytes in hand complete, in the order asked. */
  private drain(): void {
    let buffer = this.pending.length === 1 ? this.pending[0]! : Buffer.concat(this.pending);
    while (this.waiting.length > 0) {
      const nl = buffer.indexOf(0x0a);
      if (nl === -1) break;
      const header = buffer.subarray(0, nl).toString();
      const [oid, type, length] = header.split(" ");
      if (type === "missing" || length === undefined) {
        buffer = buffer.subarray(nl + 1);
        this.waiting.shift()!.reject(new Error(`object ${oid} is not in the repository`));
        continue;
      }
      const end = nl + 1 + Number(length);
      if (buffer.length < end + 1) break;
      const body = Buffer.from(buffer.subarray(nl + 1, end));
      buffer = buffer.subarray(end + 1);
      this.waiting.shift()!.resolve({ type: type!, body });
    }
    this.pending = buffer.length === 0 ? [] : [buffer];
  }

  get(oids: string[]): Promise<Array<{ type: string; body: Buffer }>> {
    if (this.failed !== null) return Promise.reject(this.failed);
    const answers = oids.map(
      (oid) =>
        new Promise<{ type: string; body: Buffer }>((resolve, reject) =>
          this.waiting.push({ oid, resolve, reject }),
        ),
    );
    this.child.stdin.write(oids.map((oid) => `${oid}\n`).join(""));
    return Promise.all(answers);
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    await this.done;
  }
}

/**
 * The folder sizes, in files, from which this engine beats the built-in one, set from the same
 * table the agent-state-dugite plugin's bench (bench/engines.bench-run.ts there) measured: a
 * write here is a short pipeline of git commands (the blobs, the tree, the commit, the branch
 * move — one process each), a read one cat-file, so what decides is what a process start costs.
 *
 * - Linux (about 4 ms a process): a commit wins from the first file, and a restore from
 *   100–200 files.
 * - macOS (about 7 ms): a load with a change wins from 20–50 files, a restore from 50–100.
 * - Windows (about 34 ms): a load with a change wins only between 200 and 500 files, a restore
 *   from 100–200.
 */
export function fasterFrom(platform: NodeJS.Platform = process.platform): {
  commit: number;
  read: number;
} {
  if (platform === "win32") return { commit: 300, read: 150 };
  if (platform === "darwin") return { commit: 30, read: 100 };
  return { commit: 1, read: 150 };
}

/** The message as the built-in engine's serializer stores it: no carriage returns, no blank
 * edges, and one newline at the end — `commit-tree` writes what it is given, as it is. */
function normalizedMessage(message: string): string {
  return message.replace(/\r/g, "").replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
}

export function gitEngine(git: GitProgram, version: string): AgentStateEngine {
  return {
    name: `git ${version} (cli)`,
    fasterFrom: fasterFrom(),

    async commit(c) {
      // The commands any script uses, one process each. The index is a temporary file of this
      // commit's own, so nothing here touches a worktree or a concurrent writer's index — the
      // repository itself is bare, and git still asks every index-writing command for a work
      // tree, so the temporary folder stands in as one; none of these commands reads it.
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-gitcl-"));
      try {
        const indexEnv = { GIT_INDEX_FILE: path.join(tmp, "index"), GIT_WORK_TREE: tmp };
        if (c.parent !== null) {
          await finish(start(git, c.gitdir, ["read-tree", c.parent], indexEnv), "read-tree");
          const old = await finish(
            start(git, c.gitdir, ["ls-tree", "-r", "-z", c.parent, "--", c.rel]),
            "ls-tree",
          );
          const gone = old
            .toString("utf8")
            .split("\0")
            .filter((line) => line !== "")
            .map((line) => line.slice(line.indexOf("\t") + 1));
          if (gone.length > 0) {
            await finish(
              start(git, c.gitdir, ["update-index", "-z", "--force-remove", "--stdin"], indexEnv),
              "update-index",
              Buffer.from(gone.map((p) => `${p}\0`).join(""), "utf8"),
            );
          }
        }
        const files = c.files ?? [];
        if (files.length > 0) {
          // The blobs: hashed without filters (--no-filters), so the bytes stored are the bytes
          // the harness handed over, whoever's autocrlf or attributes say otherwise — and so
          // the objects are the built-in engine's objects. They come out of memory, and a bare
          // repository has no worktree to add from, so they go through temporary files this
          // commit names itself (`blobs/0000`, one per file): plain paths of our own keep
          // `--stdin-paths` free of any quoting, and a name a version carries — a quote, a tab,
          // a line break, `..` — never touches the filesystem.
          const paths: string[] = [];
          await fs.mkdir(path.join(tmp, "blobs"), { recursive: true });
          for (const [i, file] of files.entries()) {
            const abs = path.join(tmp, "blobs", String(i).padStart(4, "0"));
            await fs.writeFile(abs, file.body);
            paths.push(abs);
          }
          const shas = (
            await finish(
              start(git, c.gitdir, ["hash-object", "-w", "--no-filters", "--stdin-paths"]),
              "hash-object",
              Buffer.from(paths.join("\n") + "\n", "utf8"),
            )
          )
            .toString("utf8")
            .split("\n")
            .filter((sha) => sha !== "");
          const added = files.map(
            (file, i) => `100644 ${shas[i]}\t${c.rel}/${file.rel}`,
          );
          await finish(
            start(git, c.gitdir, ["update-index", "-z", "--index-info"], indexEnv),
            "update-index",
            Buffer.from(added.map((line) => `${line}\0`).join(""), "utf8"),
          );
        }
        const tree = (
          await finish(start(git, c.gitdir, ["write-tree"], indexEnv), "write-tree")
        )
          .toString("utf8")
          .trim();
        const args = ["commit-tree", tree];
        if (c.parent !== null) args.push("-p", c.parent);
        const when = `${c.when.seconds} ${zoneOf(c.when.offset)}`;
        const sha = (
          await finish(
            start(git, c.gitdir, args, {
              GIT_AUTHOR_NAME: c.author.name,
              GIT_AUTHOR_EMAIL: c.author.email,
              GIT_AUTHOR_DATE: when,
              GIT_COMMITTER_NAME: c.committer.name,
              GIT_COMMITTER_EMAIL: c.committer.email,
              GIT_COMMITTER_DATE: when,
            }),
            "commit-tree",
            Buffer.from(normalizedMessage(c.message), "utf8"),
          )
        )
          .toString("utf8")
          .trim();
        // The old value the ref must still hold: the parent, or (a root commit) nothing at all.
        await finish(start(git, c.gitdir, ["update-ref", c.ref, sha, c.parent ?? "0".repeat(40)]), "update-ref");
        return sha;
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    },

    async readBlobs(gitdir, oids) {
      if (oids.length === 0) return [];
      const objects = new Objects(git, gitdir);
      try {
        return (await objects.get([...oids])).map((object, i) => {
          if (object.type !== "blob") throw new Error(`${oids[i]} is a ${object.type}, not a blob`);
          return object.body;
        });
      } finally {
        await objects.close().catch(() => undefined);
      }
    },
  };
}

/** One fetch per cache directory per process: a hot swap asks again, and gets the same answer. */
const opening = new Map<string, Promise<AgentStateEngine | null>>();

/**
 * The engine for this host, once its Git is in place and starts; null (with a log line saying
 * why) when there is none, so the harness keeps its built-in engine.
 */
export function openGitEngine(host: AgentStateEngineHost): Promise<AgentStateEngine | null> {
  let open = opening.get(host.cacheDir);
  if (open === undefined) {
    open = (async () => {
      const say = (line: string) => host.log(`[agent-state-gitcl] ${line}`);
      const found = await probeGit();
      if (found === null) {
        say(`no git on this host's PATH`);
        return null;
      }
      say(`git ${found.version} from the PATH`);
      return gitEngine(found.git, found.version);
    })();
    opening.set(host.cacheDir, open);
  }
  return open;
}
