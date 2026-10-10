/**
 * An A2UI block's answers in progress, kept across a reload or a visit elsewhere: a form's
 * fields, a multi-select choice's ticks. A single pick fills the composer at once, so it has
 * nothing to keep.
 *
 * Where the answers live is the host's: the actions carry a store (`drafts`) and the
 * conversation's scope (`draftScope`), and this module names the entry and decides when to read
 * and write it. The key is the scope and a hash of the block's source, so the same question in
 * the same conversation finds its answers again after the transcript is rebuilt, wherever its
 * reply now sits.
 *
 * Only the open question keeps a draft: a read-only block (an older reply, a Trace) neither reads
 * nor writes one, and nor does a host that hands no store (the gallery). The entry is read when
 * the block mounts, or when it becomes the open question, and the caller's `restore` checks it
 * against the block as it stands, so an entry that no longer fits yields what still does and
 * never an error. Each change writes the entry
 * again, and a change back to nothing removes it. A fill leaves it in place: the answers stay on
 * screen as the reader left them, and the host's store ages them out.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useA2uiActions } from "./actions";
import type { A2uiDrafts } from "./actions";

/**
 * The block's half of its draft key: FNV-1a (32-bit) over the fence's body, in base 36. Short,
 * and the same for the same source on every load.
 */
export function blockHash(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The hash of the block being drawn, set by the dispatcher (a2ui-block.tsx); null outside one. */
export const A2uiBlockKey = createContext<string | null>(null);

/** What the store holds under `key`; undefined when there is no entry, or the store fails. */
function loadDraft(drafts: A2uiDrafts | undefined, key: string | null): unknown {
  if (drafts === undefined || key === null) return undefined;
  try {
    return drafts.load(key);
  } catch {
    return undefined;
  }
}

/**
 * A block's answer state, read from and written to its draft entry while the block is the open
 * question, and the function that changes it (from the state before). `restore` turns what the
 * store holds (undefined for nothing) into a state the block can show, and must accept any
 * value. `persist` turns a state into what is stored, or null when there is nothing to keep; it
 * is an effect dependency, so pass a module-level function.
 */
export function useA2uiDraft<T>(
  restore: (saved: unknown) => T,
  persist: (state: T) => unknown,
): [T, (change: (previous: T) => T) => void] {
  const { interactive, drafts, draftScope } = useA2uiActions();
  const block = useContext(A2uiBlockKey);
  const key =
    interactive && drafts !== undefined && draftScope !== undefined && block !== null
      ? `${draftScope}:${block}`
      : null;
  const [held, setHeld] = useState(() => ({ key, state: restore(loadDraft(drafts, key)) }));
  // A block that becomes the open question after it mounted reads its entry then. Losing the
  // question (the reader sent something) keeps the answers on screen as they are.
  if (key !== null && key !== held.key) {
    setHeld({ key, state: restore(loadDraft(drafts, key)) });
  }

  const update = useCallback(
    (change: (previous: T) => T) =>
      setHeld((current) => ({ key: current.key, state: change(current.state) })),
    [],
  );

  // The entry as last read or written, so a render that changed nothing writes nothing.
  const written = useRef<{ key: string; json: string | null } | null>(null);
  const state = held.state;
  useEffect(() => {
    if (key === null || drafts === undefined) return;
    const value = persist(state);
    const json = value === null || value === undefined ? null : JSON.stringify(value);
    const last = written.current;
    written.current = { key, json };
    // The first look at an entry is what was just read from it: nothing has changed yet.
    if (last === null || last.key !== key || last.json === json) return;
    try {
      if (json === null) drafts.clear(key);
      else drafts.save(key, value);
    } catch {
      // The store refused: the answers stay on screen, they are just not kept.
    }
  }, [key, drafts, state, persist]);

  return [state, update];
}
