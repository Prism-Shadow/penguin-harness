/**
 * Temp roots for the server suite, and who removes them: whoever creates one. Every root
 * `makeTempRoot()` hands out is recorded here, and `setup-temp-roots.ts` (a vitest setup file,
 * so it runs for every test file) removes all of them once the file's tests are done.
 *
 * The ownership sits at the creation point rather than in each test because a per-test `rm`
 * is easy to miss and hard to audit: a root passed to `createTestApp({ config: { root } })`
 * outlives `cleanup()`, which removes only the root `createTestApp` made itself, and a test
 * whose assertion throws before its inline `rm` skips it. Tests that remove a root earlier
 * still may — the sweep uses `force` and ignores what is already gone.
 *
 * The registry is module state, and `isolate: false` shares this module across the files a
 * worker runs; files inside a worker run one at a time, so each file's sweep takes exactly
 * the roots created since the previous one.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const created = new Set<string>();

export async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-server-test-"));
  created.add(root);
  return root;
}

/** The roots created and not yet swept (what the next sweep will remove). */
export function pendingTempRoots(): string[] {
  return [...created];
}

/** Removes every root created so far. */
export async function removeTempRoots(): Promise<void> {
  const roots = [...created];
  created.clear();
  // maxRetries for the same ci-windows reason createTestApp's cleanup documents: handles from
  // the file's just-closed SQLite databases and trace writers can still be releasing.
  await Promise.all(
    roots.map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    ),
  );
}
