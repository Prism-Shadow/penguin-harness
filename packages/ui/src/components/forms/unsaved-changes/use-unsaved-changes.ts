/**
 * The hooks a typed form adopts to join the unsaved-changes registry (`unsaved-changes.ts`):
 *
 * - {@link useFormDraft} holds a form's draft against the value it was loaded from, says whether
 *   it is dirty, and registers the form while it is;
 * - {@link useUnsavedChanges} registers a dirtiness the caller computes itself;
 * - {@link useGuardedClose} turns a dialog's `onClose` into one that asks first while its forms
 *   hold unsaved edits.
 *
 * A route change asks through the app's router blocker and a page unload through the host's
 * `beforeunload`; neither needs anything from the form beyond being registered.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { clearUnsaved, guardLeave, markUnsaved, sameDraft } from "./unsaved-changes";

export interface UnsavedChangesOptions {
  /** The surface the edits belong to (see `unsaved-changes.ts`); none = only a route change or unload leaves it. */
  scope?: string;
  /** What 「放弃修改」 runs: the form's reset. Leave it out only for a form the leave unmounts. */
  discard?: () => void;
}

/**
 * Holds a registry entry while `dirty` is true. The entry follows `dirty` and `scope` only: a new
 * `discard` arrow on every render is read through a ref, so it does not churn the registry.
 */
export function useUnsavedChanges(dirty: boolean, options: UnsavedChangesOptions = {}): void {
  const discardRef = useRef(options.discard);
  discardRef.current = options.discard;
  const scope = options.scope ?? null;
  useEffect(() => {
    if (!dirty) return;
    const id = markUnsaved(scope, () => discardRef.current?.());
    return () => clearUnsaved(id);
  }, [dirty, scope]);
}

export interface FormDraftOptions<T> {
  /**
   * The surface the form belongs to. Forms that one leave abandons together share it (every page
   * of the Settings dialog is `"settings"`). Without one the form gets a scope of its own, which
   * is what a record dialog wants: its close asks about its own form and nothing else.
   */
  scope?: string;
  /**
   * The value a Save would send, from a draft: trimmed text, parsed numbers, defaults dropped.
   * Dirty compares the normalised draft with the normalised baseline, so typing the stored value
   * back is clean. Without it the draft itself is compared.
   */
  normalize?: (value: T) => unknown;
}

export interface FormDraft<T> {
  /** What the controls show and edit. */
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  /** Merges fields into an object draft. */
  patch: (partial: Partial<T>) => void;
  /** The stored value the draft is compared with. */
  baseline: T;
  /** The draft differs from the baseline. A Save is offered only then. */
  dirty: boolean;
  /** Back to the baseline: the page's Reset, and what 「放弃修改」 runs. */
  reset: () => void;
  /** A successful save: the server's answer becomes both the baseline and the draft. */
  adopt: (next: T) => void;
  /** The scope the form registered under: pass it to `useGuardedClose`. */
  scope: string;
}

interface DraftState<T> {
  draft: T;
  baseline: T;
  /** The last `initial` this form was handed, to tell a reload from a re-render. */
  seen: T;
}

/**
 * A typed form's draft against its baseline. `initial` is the loaded value: when it changes — a
 * hydration, a poll, another surface saving the same record — a clean draft follows it, and a
 * dirty one keeps the user's text while only the baseline moves. (Compared by value, so a caller
 * may build `initial` afresh on every render.) A failed save changes nothing: the baseline did
 * not move, so the draft stays dirty.
 */
export function useFormDraft<T>(initial: T, options: FormDraftOptions<T> = {}): FormDraft<T> {
  const ownScope = useId();
  const scope = options.scope ?? `form${ownScope}`;
  const [state, setState] = useState<DraftState<T>>(() => ({
    draft: initial,
    baseline: initial,
    seen: initial,
  }));
  const normalize = options.normalize ?? ((value: T) => value);

  // A changed `initial` is adopted during render rather than in an effect, so no frame ever
  // shows the old baseline next to the new one (React re-renders this component at once).
  let current = state;
  if (!sameDraft(initial, state.seen)) {
    const clean = sameDraft(normalize(state.draft), normalize(state.baseline));
    current = { draft: clean ? initial : state.draft, baseline: initial, seen: initial };
    setState(current);
  }
  const dirty = !sameDraft(normalize(current.draft), normalize(current.baseline));

  const setDraft = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setState((s) => ({
      ...s,
      draft: typeof action === "function" ? (action as (prev: T) => T)(s.draft) : action,
    }));
  }, []);
  const patch = useCallback((partial: Partial<T>) => {
    setState((s) => ({ ...s, draft: Object.assign({}, s.draft, partial) }));
  }, []);
  const reset = useCallback(() => {
    setState((s) => ({ ...s, draft: s.baseline }));
  }, []);
  // `seen` stays: it tracks the caller's `initial`, and a caller that never reloads after a save
  // must not have its old `initial` read as a reload over the adopted answer.
  const adopt = useCallback((next: T) => {
    setState((s) => ({ ...s, draft: next, baseline: next }));
  }, []);

  useUnsavedChanges(dirty, { scope, discard: reset });

  return {
    draft: current.draft,
    setDraft,
    patch,
    baseline: current.baseline,
    dirty,
    reset,
    adopt,
    scope,
  };
}

/**
 * A dialog's close through the guard. Pass the result as the dialog's `onClose` (Modal,
 * PagedDialog, Drawer, Sheet) **and** to its Cancel button: Esc, the ×, a scrim click and Cancel
 * all arrive there. While a form in `scope` holds unsaved edits it asks first; on "discard" the
 * forms reset and `onClose` runs, on "keep editing" nothing happens. After a successful save call
 * the raw `onClose` — nothing is dirty by then anyway.
 */
export function useGuardedClose(onClose: () => void, scope: string): () => void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  return useCallback(() => {
    void guardLeave(() => onCloseRef.current(), scope);
  }, [scope]);
}
