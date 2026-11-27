/** Run against the installed npm tarball with an empty PATH, cache and no source checkout. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const gitdir = path.join(root, "history.git");
  for (const name of ["objects", "refs/heads"])
    await fs.mkdir(path.join(gitdir, name), { recursive: true });
  const ref = "refs/heads/main";
  await fs.writeFile(path.join(gitdir, "HEAD"), "ref: " + ref + "\n");
  const who = { name: "Offline test", email: "test@example.invalid" };
  const body = Buffer.from("saved from the packed plugin\n");
  const commit = await engine.commit({
    gitdir,
    ref,
    parent: null,
    rel: "workbenches/offline",
    files: [{ rel: "notes.txt", body }],
    message: "Save workbench\n",
    author: who,
    committer: who,
    when: { seconds: 1_700_000_000, offset: 0 },
  });
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal((await fs.readFile(path.join(gitdir, ref), "utf8")).trim(), commit);
  const blob = createHash("sha1")
    .update("blob " + body.length + "\0")
    .update(body)
    .digest("hex");
  const restored = await engine.readObjects(gitdir, [blob]);
  assert.deepEqual(Buffer.from(restored[0]), body);
  assert.equal(requests, 0);
  globalThis.fetch = originalFetch;
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
