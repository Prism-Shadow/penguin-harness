/** Real local Git/LFS smoke experiment. All generated data stays in a new temp directory. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaWorkspacesPrototype, git, gitEnvironment } from "./manager.mts";

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-media-PROTOTYPE-"));
const source = path.join(scratch, "source");
const root = path.join(scratch, "managed");
await fs.mkdir(source);
const manager = new MediaWorkspacesPrototype(root, (message) => console.error(message));
const asset = (seed: number) => Buffer.alloc(64 * 1024, seed);
const original = asset(1);
const image = asset(2);
const video = asset(3);
const oid = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const exists = async (file: string) => Boolean(await fs.stat(file).catch(() => null));
const check = (message: string) => console.log(`PASS ${message}`);

await git(source, ["init", "-b", "main"]);
await git(source, ["config", "user.name", "Media prototype"]);
await git(source, ["config", "user.email", "prototype@example.invalid"]);
await git(source, ["lfs", "install", "--local"]);
await git(source, ["config", "--local", "lfs.storage", "lfs"]);
await fs.writeFile(
  path.join(source, ".gitattributes"),
  "*.bin filter=lfs diff=lfs merge=lfs -text\n",
);
for (const [directory, bytes] of [
  ["audio/welcome", original],
  ["images/icons", image],
  ["videos/trailers", video],
] as const) {
  await fs.mkdir(path.join(source, directory), { recursive: true });
  await fs.writeFile(path.join(source, directory, "sample.bin"), bytes);
}
await fs.writeFile(path.join(source, "audio/welcome/manifest.json"), '{"audio":"sample.bin"}\n');
await git(source, ["add", "."]);
await git(source, ["commit", "-m", "Seed three independently downloadable LFS assets"]);

await manager.init(source);
await manager.init(source); // Reopening the same managed repo is idempotent.
const first = await manager.create("session-a", "main", ["audio/welcome"]);
const alternative = await manager.create("session-a", "alternative", ["audio/welcome"]);
const second = await manager.create("session-b", "main", ["images/icons"]);
assert.equal(first.baseCommit, second.baseCommit);
assert.notEqual(first.branch, alternative.branch);
assert.notEqual(first.branch, second.branch);
assert.deepEqual(await fs.readFile(path.join(first.path, "audio/welcome/sample.bin")), original);
assert.deepEqual(
  JSON.parse(await fs.readFile(path.join(first.path, "audio/welcome/manifest.json"), "utf8")),
  { audio: "sample.bin" },
);
assert.deepEqual(await fs.readFile(path.join(second.path, "images/icons/sample.bin")), image);
assert.equal(await exists(path.join(first.path, "images")), false);
assert.equal(await exists(path.join(second.path, "audio")), false);
check("Two sessions and an alternative have independent sparse branches and hydrated assets.");

const statuses = await manager.status();
for (const status of statuses) {
  assert.ok("changes" in status);
  assert.equal(status.changes, "");
  assert.deepEqual(status.remainingPointers, []);
}
const caches = statuses.map((status) =>
  "lfsObjectDirectory" in status ? status.lfsObjectDirectory : undefined,
);
assert.ok(caches[0]);
assert.equal(new Set(caches).size, 1);
const cache = caches[0]!;
const objectPath = (bytes: Buffer) =>
  path.join(cache, oid(bytes).slice(0, 2), oid(bytes).slice(2, 4), oid(bytes));
assert.equal(await exists(objectPath(original)), true);
assert.equal(await exists(objectPath(image)), true);
assert.equal(await exists(objectPath(video)), false);
check("Worktrees share one LFS cache; unrequested video content was not downloaded.");

const edit = asset(9);
await fs.writeFile(path.join(first.path, "audio/welcome/sample.bin"), edit);
await manager.ensure("session-a", "main", ["images/icons"]);
assert.deepEqual(await fs.readFile(path.join(first.path, "audio/welcome/sample.bin")), edit);
assert.deepEqual(
  await fs.readFile(path.join(alternative.path, "audio/welcome/sample.bin")),
  original,
);
assert.equal(await exists(path.join(alternative.path, "images")), false);
assert.deepEqual(await fs.readFile(path.join(first.path, "images/icons/sample.bin")), image);
check("Expanding one workspace preserves its edits and leaves the alternative untouched.");

await fs.rm(path.join(alternative.path, "audio/welcome/sample.bin"));
await manager.ensure("session-a", "alternative", []);
assert.equal(await exists(path.join(alternative.path, "audio/welcome/sample.bin")), false);
check("Retrying a workspace keeps the assets its agent deleted deleted.");

await assert.rejects(manager.create("../escape", "main", ["audio"]));
await assert.rejects(manager.ensure("session-a", "main", ["../videos"]));
await assert.rejects(manager.ensure("session-a", "main", ["audio, videos"]));
await assert.rejects(manager.create("session-a", "main", ["audio"]));
await assert.rejects(manager.create("session-c", "main", ["missing-folder"]));
assert.equal((await manager.status()).length, 3);
await manager.exclusive(async () => {
  const reopened = new MediaWorkspacesPrototype(root);
  await assert.rejects(reopened.ensure("session-a", "main", []), /busy/);
});
check("Invalid paths, duplicate attachments and concurrent mutations are refused.");

// Temporarily point to an empty local remote. A missing object must remain a failed,
// resumable attachment, never a successful workspace containing only pointer text.
const unavailable = path.join(scratch, "empty-remote.git");
await fs.mkdir(unavailable);
await git(unavailable, ["init", "--bare"]);
await git(manager.repository, ["config", "--local", "lfs.transfer.maxretries", "1"]);
await git(manager.repository, ["remote", "set-url", "origin", unavailable]);
await assert.rejects(manager.create("session-c", "retry", ["videos/trailers"]));
const [failed] = await manager.status("session-c", "retry");
assert.equal(failed.state, "failed");
assert.ok("remainingPointers" in failed && failed.remainingPointers.length === 1);
await git(manager.repository, ["remote", "set-url", "origin", source]);
await manager.ensure("session-c", "retry", []);
const [retried] = await manager.status("session-c", "retry");
assert.equal(retried.state, "ready");
assert.deepEqual(await fs.readFile(path.join(retried.path, "videos/trailers/sample.bin")), video);
check("Failed LFS download is visible and retry hydrates the existing workspace.");

// Fetch a newer source revision while the existing edited workspace stays pinned.
await fs.mkdir(path.join(source, "new-folder"));
await fs.writeFile(path.join(source, "new-folder/readme.txt"), "Only in the new revision.\n");
await git(source, ["add", "."]);
await git(source, ["commit", "-m", "Advance source for future sessions"]);
await manager.refresh();
const fresh = await manager.create("session-d", "main", ["new-folder"]);
assert.notEqual(fresh.baseCommit, first.baseCommit);
assert.equal(await git(first.path, ["rev-parse", "HEAD"]), first.baseCommit);
assert.deepEqual(await fs.readFile(path.join(first.path, "audio/welcome/sample.bin")), edit);
const reopened = new MediaWorkspacesPrototype(root);
assert.equal((await reopened.status()).length, 5);
check("Refresh affects future sessions only; attachments survive reopening the manager.");

// A stop right after the attachment was recorded: the record exists, nothing on disk does.
const registryPath = path.join(root, "PROTOTYPE-registry.json");
const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
registry.attachments.push({
  ...registry.attachments.find((item: { sessionId: string }) => item.sessionId === "session-b"),
  sessionId: "session-e",
  branch: "codex/media/session-e/main",
  path: path.join(root, "sessions", "session-e", "main"),
  checkoutInitialized: false,
  state: "preparing",
});
await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
await manager.ensure("session-e", "main", []);
const stranded = path.join(root, "sessions", "session-e", "main", "images/icons/sample.bin");
assert.deepEqual(await fs.readFile(stranded), image);
// A stop that left the branch but lost the worktree's folder.
await fs.rm(second.path, { recursive: true, force: true });
await manager.ensure("session-b", "main", []);
assert.deepEqual(await fs.readFile(path.join(second.path, "images/icons/sample.bin")), image);
assert.equal(await git(second.path, ["branch", "--show-current"]), second.branch);
check("An attachment interrupted before or after its worktree was added is finished by ensure.");

const kept = gitEnvironment({
  GIT_DIR: "/somewhere/else.git",
  GIT_SSH_COMMAND: "ssh -i /keys/deploy",
  GIT_CONFIG_COUNT: "1",
});
assert.equal(kept.GIT_DIR, undefined);
assert.equal(kept.GIT_SSH_COMMAND, "ssh -i /keys/deploy");
assert.equal(kept.GIT_CONFIG_COUNT, "1");
assert.equal(gitEnvironment({}).GIT_SSH_COMMAND, "ssh -o BatchMode=yes");
check("Git keeps the operator's authentication and drops only repository-locating variables.");

// A folder inside the attachment replaced by a link to one outside it.
const outside = path.join(scratch, "outside");
await fs.mkdir(outside);
await fs.writeFile(
  path.join(outside, "sample.bin"),
  "version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 1\n",
);
await fs.rm(path.join(second.path, "images/icons"), { recursive: true });
await fs.symlink(outside, path.join(second.path, "images/icons"), "junction");
const [linked] = await manager.status("session-b", "main");
assert.ok("remainingPointers" in linked);
assert.deepEqual(linked.remainingPointers, []);
check("Pointer checks do not follow a linked folder out of the attachment.");

console.log(
  JSON.stringify({ prototypeRoot: root, source, attachments: await reopened.status() }, null, 2),
);
console.log("The scratch repository is retained for inspection. No production data was used.");
