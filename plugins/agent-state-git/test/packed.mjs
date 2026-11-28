/** Run against the installed npm tarball with an empty PATH, cache and no source checkout. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const installed = path.resolve(process.argv[2]);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-offline-agent-git-"));
try {
  const mod = await import(pathToFileURL(path.join(installed, "dist/index.js")).href);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    throw new Error("Unexpected network request");
  };
  delete process.env.LOCAL_GIT_DIRECTORY;
  delete process.env.DUGITE_CACHE_DIR;
  process.env.PATH = root;
  const engine = await mod.openGitEngine({ cacheDir: path.join(root, "cache"), log: console.log });
  assert.ok(engine, "packaged native engine must start");
  assert.equal(typeof engine.open, "function", "packaged engine must implement GitEngine.open");

  const gitdir = path.join(root, "history.git");
  for (const name of ["objects", "refs/heads"])
    await fs.mkdir(path.join(gitdir, name), { recursive: true });
  const ref = "refs/heads/main";
  await fs.writeFile(path.join(gitdir, "HEAD"), "ref: " + ref + "\n");
  const who = { name: "Offline test", email: "test@example.invalid" };
  const body = Buffer.from("saved from the packed plugin\n");

  const repo = await engine.open(gitdir);
  try {
    const headBefore = await repo.resolveHead();
    assert.deepEqual(headBefore, { ref, commit: null });

    const commit = await repo.commit({
      ref,
      parent: null,
      prefix: "workbenches/offline",
      change: {
        kind: "replace",
        files: [{ rel: "notes.txt", source: { kind: "bytes", body } }],
      },
      message: "Save workbench\n",
      author: who,
      committer: who,
      when: { seconds: 1_700_000_000, offset: 0 },
    });
    assert.match(commit, /^[a-f0-9]{40}$/);
    assert.equal((await fs.readFile(path.join(gitdir, ref), "utf8")).trim(), commit);

    const outDir = path.join(root, "extracted");
    const extracted = await repo.extractTree({
      commitOid: commit,
      prefix: "workbenches/offline",
      destDir: outDir,
    });
    assert.deepEqual(extracted.files, ["notes.txt"]);
    assert.equal(extracted.totalBytes, body.length);
    assert.deepEqual(await fs.readFile(path.join(outDir, "notes.txt")), body);
  } finally {
    await repo.close();
  }

  assert.equal(requests, 0);
  globalThis.fetch = originalFetch;
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
