/**
 * The Agent State engine on native Git: one process per commit, one per version read back.
 *
 * A commit is one `git fast-import`: the stream names the branch, the identities and the time,
 * the parent (`from`), deletes the folder and writes each of its files inline. fast-import builds
 * the trees, writes the commit and moves the branch only if the new commit descends from what the
 * branch holds when it gets there (no `--force`), so a branch moved meanwhile refuses the write.
 * Its objects are unpacked into loose files (`fastimport.unpackLimit`), the way git stores them
 * and reads them fastest, instead of one pack per commit.
 *
 * Reading objects back is one `git cat-file --batch`: the harness walked the version's trees
 * itself and asks for every blob of it at once; an id that is not in the repository answers
 * null.
 *
 * The engine writes the same bytes as every other engine: the message whole, both identity lines
 * with the zone the harness computed, every file `100644`, trees in git's order — so the same
 * input is the same commit under any of them.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentStateCommit,
  AgentStateEngine,
  AgentStateEngineHost,
  AgentStateIdentity,
} from "@prismshadow/penguin-core/plugin";
import { locateGit, type GitProgram } from "./binary.js";
import { finish, gitEnv, start } from "./git.js";

const LF = Buffer.from("\n");

/** A path as fast-import reads it: C-quoted, so a space, a quote or a line break is never ambiguous. */
export function quotePath(rel: string): string {
  let out = '"';
  for (const byte of Buffer.from(rel, "utf8")) {
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += "\\\\";
    else if (byte < 0x20 || byte === 0x7f) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  // Non-ASCII bytes went in one per character: put them back as the UTF-8 they were.
  return Buffer.from(`${out}"`, "latin1").toString("utf8");
}

/** git's zone: `+hhmm` east of UTC. */
export function zoneOf(offset: number): string {
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${offset < 0 ? "-" : "+"}${hh}${mm}`;
}

const ident = (who: AgentStateIdentity, when: AgentStateCommit["when"]) =>
  `${who.name} <${who.email}> ${when.seconds} ${zoneOf(when.offset)}`;

/** The fast-import stream of one commit. */
export function importStream(c: AgentStateCommit): Buffer {
  const parts: Buffer[] = [];
  const line = (text: string) => parts.push(Buffer.from(`${text}\n`, "utf8"));
  const data = (body: Uint8Array) => {
    line(`data ${body.byteLength}`);
    parts.push(Buffer.from(body.buffer, body.byteOffset, body.byteLength), LF);
  };
  line(`commit ${c.ref}`);
  line(`author ${ident(c.author, c.when)}`);
  line(`committer ${ident(c.committer, c.when)}`);
  data(Buffer.from(c.message, "utf8"));
  if (c.parent !== null) {
    line(`from ${c.parent}`);
    line(`D ${quotePath(c.rel)}`);
  }
  for (const file of c.files ?? []) {
    line(`M 100644 inline ${quotePath(`${c.rel}/${file.rel}`)}`);
    data(file.body);
  }
  line("done");
  return Buffer.concat(parts);
}

/** fast-import leaves a report in the repository when it dies; that is not the Agent's to keep. */
async function removeCrashReports(gitdir: string): Promise<void> {
  const names = await fs.readdir(gitdir).catch(() => [] as string[]);
  for (const name of names) {
    if (name.startsWith("fast_import_crash_")) {
      await fs.rm(path.join(gitdir, name), { force: true }).catch(() => undefined);
    }
  }
}

/** One `cat-file --batch` process, asked for many objects at a time and answered in order. */
class Objects {
  private readonly child;
  private readonly done: Promise<Buffer>;
  private pending: Buffer[] = [];
  private readonly waiting: Array<{
    oid: string;
    resolve: (o: { type: string; body: Buffer } | null) => void;
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
        this.waiting.shift()!.resolve(null);
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

  get(oids: string[]): Promise<Array<{ type: string; body: Buffer } | null>> {
    if (this.failed !== null) return Promise.reject(this.failed);
    const answers = oids.map(
      (oid) =>
        new Promise<{ type: string; body: Buffer } | null>((resolve, reject) =>
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

export function gitEngine(git: GitProgram, version: string, source = "dugite"): AgentStateEngine {
  return {
    name: `git ${version} (${source})`,

    async commit(c) {
      const child = start(git, c.gitdir, [
        "-c",
        "fastimport.unpackLimit=2147483647",
        "fast-import",
        "--quiet",
        "--done",
      ]);
      try {
        await finish(child, "fast-import", importStream(c));
      } catch (err) {
        await removeCrashReports(c.gitdir);
        throw err;
      }
      return (await fs.readFile(path.join(c.gitdir, c.ref), "utf8")).trim();
    },

    async readObjects(gitdir, oids) {
      if (oids.length === 0) return [];
      const objects = new Objects(git, gitdir);
      try {
        return (await objects.get([...oids])).map((object) =>
          object === null ? null : object.body,
        );
      } finally {
        await objects.close().catch(() => undefined);
      }
    },
  };
}

/** `git version`'s answer, or why there is none. */
function probe(git: GitProgram): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(git.program, ["version"], { env: gitEnv(git), windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => reject(new Error(err.code ?? err.message)));
    child.on("close", (code, signal) => {
      const version = /^git version (\S+)/.exec(out)?.[1];
      if (code === 0 && version !== undefined) resolve(version);
      else reject(new Error(signal !== null ? `killed by ${signal}` : `exit ${code}`));
    });
  });
}

/** One fetch per cache directory per process: a hot swap asks again, and gets the same answer. */
const opening = new Map<string, Promise<AgentStateEngine>>();

/**
 * The engine for this host, once its Git is in place and starts. An error when there is no Git
 * it could use or the program does not run: the deployment has no engine from this contribution.
 * A failed open is asked again by the next App, not by this one.
 */
export function openGitEngine(host: AgentStateEngineHost): Promise<AgentStateEngine> {
  let open = opening.get(host.cacheDir);
  if (open === undefined) {
    open = (async () => {
      const say = (line: string) => host.log(`[agent-state-git] ${line}`);
      const found = await locateGit({ cacheDir: host.cacheDir, log: host.log }).catch(
        (err: unknown) => {
          throw new Error(`no Git: ${err instanceof Error ? err.message : String(err)}`);
        },
      );
      if (found === null)
        throw new Error(`no Git build for ${process.platform}-${process.arch} in dugite's table`);
      const version = await probe(found.git).catch((err: Error) => {
        throw new Error(`${found.git.program} does not run (${err.message})`);
      });
      say(`git ${version} from ${found.source}`);
      return gitEngine(found.git, version);
    })();
    opening.set(host.cacheDir, open);
    open.catch(() => {
      if (opening.get(host.cacheDir) === open) opening.delete(host.cacheDir);
    });
  }
  return open;
}
