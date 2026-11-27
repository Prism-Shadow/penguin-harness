/**
 * The engines' performance on this host: the two steps the harness hands an engine (a commit of
 * a folder, a version's files read back), at the folder sizes that decide the preference table.
 *
 * Three writers: gitoxide in-process (./dist), the dugite plugin's engine (one fast-import per
 * commit, one cat-file --batch per read), and the gitcl pipeline (the ⑨ branch's ordinary-git
 * flow — a throwaway worktree, add -A, commit, update-ref — over the host's git; its reads are
 * the same one cat-file --batch). Numbers are the median of the runs, whole operations timed
 * (process starts included).
 *
 * Run: node bench/gix.bench-run.mjs
 */
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { gixEngine, loadNative } from "../dist/index.js";
import { openGitEngine } from "@penguinharness/agent-state-git";

const GIT = "git";
const SIZES = [1, 10, 100, 500];
const RUNS = 5;
const WHEN = { seconds: 1_700_000_000, offset: 480 };
const WHO = { name: "Bench", email: "bench@example.com" };

const run = (gitdir, args, input) => {
  const r = spawnSync(GIT, ["--git-dir", gitdir, ...args], {
    input: input ?? Buffer.alloc(0),
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
  return r.stdout;
};

const git = (args, opts = {}) => {
  const r = spawnSync(GIT, args, { ...opts, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

/** One cat-file --batch process, asked for many objects at once: gitcl's read shape. */
function gitclReadBlobs(gitdir, oids) {
  return new Promise((resolve, reject) => {
    const child = spawn(GIT, ["--git-dir", gitdir, "cat-file", "--batch"], { windowsHide: true });
    const chunks = [];
    let buffer = Buffer.alloc(0);
    const answers = oids.map(() => {});
    let next = 0;
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (next < oids.length) {
        const nl = buffer.indexOf(0x0a);
        if (nl === -1) break;
        const header = buffer.subarray(0, nl).toString();
        const [oid, type, length] = header.split(" ");
        if (type === "missing" || length === undefined) {
          buffer = buffer.subarray(nl + 1);
          answers[next++] = null;
          continue;
        }
        const end = nl + 1 + Number(length);
        if (buffer.length < end + 1) break;
        answers[next++] = Buffer.from(buffer.subarray(nl + 1, end));
        buffer = buffer.subarray(end + 1);
      }
      if (next >= oids.length) child.stdin.end();
    });
    chunks.push(0);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && next >= oids.length) resolve(answers);
      else reject(new Error(`cat-file --batch: exit ${code}, answered ${next}/${oids.length}`));
    });
    child.stdin.write(oids.map((oid) => `${oid}\n`).join(""));
  });
}

/** The gitcl pipeline's commit (the ⑨ branch's flow), over the host's git. */
function gitclCommit(c) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-state-gitcl-"));
  try {
    if (c.parent !== null) {
      run(c.gitdir, ["worktree", "add", "--detach", tmp, c.parent]);
    } else {
      git(["init", "-q", tmp]);
    }
    const dir = path.join(tmp, c.rel);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const file of c.files ?? []) {
      const abs = path.join(dir, file.rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.body);
    }
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: c.author.name,
      GIT_AUTHOR_EMAIL: c.author.email,
      GIT_AUTHOR_DATE: `${c.when.seconds} +0800`,
      GIT_COMMITTER_NAME: c.committer.name,
      GIT_COMMITTER_EMAIL: c.committer.email,
      GIT_COMMITTER_DATE: `${c.when.seconds} +0800`,
    };
    const feed = (r) => ({ ...r, input: Buffer.from(c.message, "utf8"), env });
    if (c.parent !== null || (c.files?.length ?? 0) > 0) {
      git(["-C", tmp, "add", "-A", "-f", "--", c.rel]);
      git(["-C", tmp, "commit", "-q", "--cleanup=verbatim", "-F", "-"], feed());
    } else {
      git(["-C", tmp, "commit", "-q", "--allow-empty", "--cleanup=verbatim", "-F", "-"], feed());
    }
    const sha = git(["-C", tmp, "rev-parse", "HEAD"]).toString().trim();
    if (c.parent !== null) {
      run(c.gitdir, ["update-ref", c.ref, sha, c.parent]);
    } else {
      git(["-C", tmp, "push", "-q", c.gitdir, `HEAD:${c.ref}`]);
    }
    return sha;
  } finally {
    if (c.parent !== null) {
      run(c.gitdir, ["worktree", "remove", "--force", tmp]);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const filesOf = (n, run) =>
  Array.from({ length: n }, (_, i) => ({
    rel: `f${String(i).padStart(4, "0")}.txt`,
    body: Buffer.from(`file ${i} of ${n} run ${run}\n${"x".repeat(180 + (i % 50))}\n`),
  }));

let salt = 0;

const oidsOf = (gitdir, commit) =>
  [...run(gitdir, ["ls-tree", "-r", commit]).toString().matchAll(/blob ([0-9a-f]{40})\t/g)].map(
    (m) => m[1],
  );

const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (t0) => Math.round(performance.now() - t0);

async function benchEngine(name, commit, readBlobs, root) {
  const gitdir = path.join(root, `${name}.git`);
  git(["init", "--bare", "--initial-branch=main", gitdir]);
  const out = { name, commit: new Map(), read: new Map() };
  let parent = null;
  let lastSha = null;
  for (const size of SIZES) {
    const times = [];
    for (let i = 0; i < RUNS; i++) {
      const files = filesOf(size, `${salt}-${i}`);
      const t0 = performance.now();
      lastSha = await commit({
        gitdir,
        ref: "refs/heads/main",
        parent: i === 0 ? parent : lastSha,
        rel: `workbenches/w${size}`,
        files,
        message: `bench ${name} ${size} #${i}\n`,
        author: WHO,
        committer: WHO,
        when: WHEN,
      });
      times.push(ms(t0));
    }
    out.commit.set(size, median(times));
    parent = lastSha;
    // The version's files read back: every blob of the last commit's tree.
    const oids = oidsOf(gitdir, lastSha);
    const reads = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const bodies = await readBlobs(gitdir, oids);
      reads.push(ms(t0));
      if (bodies.length !== oids.length) throw new Error(`${name}: short read`);
    }
    out.read.set(size, median(reads));
    salt += 1;
  }
  return out;
}

const root = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-state-bench-"));
try {
  const native = loadNative();
  const results = [];
  results.push(await benchEngine("gitoxide", (c) => gixEngine(native, "gitoxide").commit(c), (g, o) => gixEngine(native, "gitoxide").readBlobs(g, o), root));
  const dugite = await openGitEngine({ cacheDir: path.join(root, "cache"), log: () => {} });
  if (dugite !== null) {
    results.push(
      await benchEngine("dugite-fast-import", (c) => dugite.commit(c), (g, o) => dugite.readBlobs(g, o), root),
    );
  } else {
    console.log("dugite: not available on this host, skipped");
  }
  results.push(
    await benchEngine(
      "gitcl-pipeline",
      (c) => gitclCommit(c),
      (g, o) => gitclReadBlobs(g, o),
      root,
    ),
  );

  console.log("\ncommit (median ms, folder of N files):");
  console.log("size      ".padEnd(12) + results.map((r) => r.name.padEnd(22)).join(""));
  for (const size of SIZES) {
    console.log(
      String(size).padEnd(12) + results.map((r) => String(r.commit.get(size)).padEnd(22)).join(""),
    );
  }
  console.log("\nread N blobs (median ms):");
  console.log("size      ".padEnd(12) + results.map((r) => r.name.padEnd(22)).join(""));
  for (const size of SIZES) {
    console.log(
      String(size).padEnd(12) +
        results.map((r) => String(r.read.get(size) ?? "-").padEnd(22)).join(""),
    );
  }
} finally {
  await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined);
}
