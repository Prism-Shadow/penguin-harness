/**
 * Per-file serialization for the file-writing tools (edit_file / write_file).
 *
 * Both tools are a read-modify-write: stat the file, read its content, compute the new
 * content, replace it with a temp file + rename. The rename makes the replacement itself
 * indivisible, but nothing guards the sequence around it — and the engine runs a turn's
 * approved tool calls concurrently, as do subagents sharing this process. Two edits of one
 * file therefore both read the original bytes, both compute from them, and the later rename
 * wins: one edit is silently lost while both calls report success. A process-wide mutex
 * keyed by the file turns the whole read-modify-write into one critical section, so a later
 * writer reads what the earlier one landed, and an `old_string` the earlier edit removed
 * fails to match instead of overwriting it.
 *
 * The scope is this process only. No OS-level file lock is taken, so another process writing
 * the same file — a separate CLI run, an editor, the user's own shell — is not serialized
 * against these tools; there the atomic rename remains the whole guarantee, and a reader
 * sees the old bytes or the new ones but never a mix. Reads are not locked for the same
 * reason.
 */
import path from "node:path";
import { realpath } from "node:fs/promises";

/**
 * One key's queue: the promise a newly arriving caller waits behind, and how many callers
 * have entered it without leaving yet — the holder plus everyone queued. The count is what
 * says when the entry can go: it reaches zero only once nobody is inside the critical
 * section and nobody is waiting to be, which a settled tail alone would not tell us.
 */
interface LockChain {
  tail: Promise<void>;
  callers: number;
}

const chains = new Map<string, LockChain>();

/**
 * The mutex key for an already-resolved path: its real path, so every name for one file
 * folds onto one key — a symlink and the file it points at, a path crossing a linked
 * directory, `a/../a/x.txt` and `a/x.txt`.
 *
 * A path that does not exist yet keys on its real directory plus the name it will take, so a
 * `write_file` that creates the file and an `edit_file` that follows share one key. A
 * resolution failure is absorbed rather than raised: a lock key is no place to report an
 * errno — the tool's own stat, read or write reports it, in the wording the model reads — so
 * an unresolvable path (a link cycle, an unreadable directory) keys on itself. The worst
 * case is a key nothing else shares, which is exactly the unserialized behaviour that
 * preceded the lock.
 */
export async function fileLockKey(resolvedPath: string): Promise<string> {
  try {
    return await realpath(resolvedPath);
  } catch {
    // Nothing there yet (ENOENT/ENOTDIR), or a path that cannot be resolved at all.
  }
  const dir = path.dirname(resolvedPath);
  const base = path.basename(resolvedPath);
  try {
    return path.join(await realpath(dir), base);
  } catch {
    return path.join(path.resolve(dir), base);
  }
}

/** The rejection a queued caller gets when its signal fires before its turn arrives. */
function abortError(): Error {
  // Named the way Node's own aborted fs calls name it, which is what the tools classify on.
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/**
 * Waits for `ahead` to drain, or rejects as soon as `signal` fires.
 *
 * `ahead` is settled with `resolve` on both outcomes: a predecessor's failure is its own
 * caller's business and must not deny the next caller its turn.
 */
async function waitForTurn(ahead: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) {
    await ahead;
    return;
  }
  if (signal.aborted) throw abortError();
  let onAbort: () => void = () => undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = (): void => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      void ahead.then(resolve, resolve);
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Runs `fn` with exclusive hold of `key`, callers served in arrival order.
 *
 * A caller whose `signal` fires while it is still queued rejects with an `AbortError` and
 * never runs `fn` — its slot collapses and the callers behind it move up. A rejection from
 * `fn` propagates to its own caller and nothing else: the queue is released from a `finally`
 * and the next caller runs regardless. The key's entry is removed once the last caller in
 * its queue is done, so a long-lived process does not accumulate one entry per file it has
 * ever written.
 */
export async function withFileLock<T>(
  key: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let chain = chains.get(key);
  if (chain === undefined) {
    chain = { tail: Promise.resolve(), callers: 0 };
    chains.set(key, chain);
  }
  chain.callers += 1;
  const ahead = chain.tail;
  let finish: () => void = () => undefined;
  const turn = new Promise<void>((resolve) => {
    finish = resolve;
  });
  // The new tail: everything already queued, then this call's own turn. `turn` only ever
  // resolves, so the chain cannot carry a rejection into the callers behind it.
  chain.tail = ahead.then(() => turn);
  const held = chain;
  const leave = (): void => {
    // Releases this call's turn first, so a caller that gave up while queued hands its place
    // straight to the one behind it.
    finish();
    held.callers -= 1;
    if (held.callers === 0 && chains.get(key) === held) chains.delete(key);
  };
  try {
    await waitForTurn(ahead, signal);
  } catch (err) {
    leave();
    throw err;
  }
  try {
    return await fn();
  } finally {
    leave();
  }
}

/** Keys with a live queue — the no-growth property, observable for the test that pins it. */
export function pendingFileLocks(): number {
  return chains.size;
}
