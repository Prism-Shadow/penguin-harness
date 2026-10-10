/**
 * The unsaved-changes registry: every typed form whose edits are not saved yet registers here
 * while it is dirty, and every way of leaving it asks here first. One registry and one prompt for
 * the whole app, so a route change, a dialog's close, a rail switch and a page unload all ask the
 * same question in the same card, and a leave the user confirms discards every affected draft
 * before it goes ahead.
 *
 * Framework-free — a vanilla store, like the toasts' — so the rules are checkable without a DOM.
 * The React side is `use-unsaved-changes.ts`; the card and the unload listener are
 * `UnsavedChangesHost`, mounted once at the app root.
 *
 * **Scope.** A surface whose forms can be left while the page stays (a dialog's close, the
 * Settings dialog's rail) registers its forms under a scope name and asks about that scope
 * alone: closing a dialog must not discard a draft on the page beneath it. A route change and a
 * page unload ask about every form.
 */
import { createStore } from "zustand/vanilla";

/** One dirty form. */
export interface UnsavedEntry {
  id: symbol;
  /** The surface the edits belong to; `null` is a form that only a route change or an unload leaves. */
  scope: string | null;
  /** Drops the edits (the form's reset); run once the user has chosen to discard them. */
  discard: (() => void) | null;
}

export interface UnsavedState {
  entries: readonly UnsavedEntry[];
  /** The discard prompt is on screen, waiting for an answer. */
  asking: boolean;
}

/** The dirty forms and whether the prompt is up. Written only through the functions below. */
export const unsavedStore = createStore<UnsavedState>(() => ({ entries: [], asking: false }));

const inScope = (entry: UnsavedEntry, scope: string | undefined): boolean =>
  scope === undefined || entry.scope === scope;

/** Registers one dirty form; the handle is what {@link clearUnsaved} takes. */
export function markUnsaved(scope: string | null, discard: (() => void) | null): symbol {
  const id = Symbol("unsaved");
  unsavedStore.setState((s) => ({ entries: [...s.entries, { id, scope, discard }] }));
  return id;
}

/** Forgets one form: it was saved, reset or unmounted. A handle already gone is a no-op. */
export function clearUnsaved(id: symbol): void {
  const { entries } = unsavedStore.getState();
  if (!entries.some((e) => e.id === id)) return;
  unsavedStore.setState({ entries: entries.filter((e) => e.id !== id) });
}

/** Whether any form holds unsaved edits — in `scope` when one is named, anywhere otherwise. */
export function hasUnsaved(scope?: string): boolean {
  return unsavedStore.getState().entries.some((e) => inScope(e, scope));
}

/**
 * Discards every matching form: the entries go first, synchronously, then each form's own reset
 * runs. A leave that follows therefore finds nothing dirty, so a route blocker consulted by the
 * navigation the leave starts does not ask a second time.
 */
export function discardUnsaved(scope?: string): void {
  const { entries } = unsavedStore.getState();
  const dropped = entries.filter((e) => inScope(e, scope));
  if (dropped.length === 0) return;
  unsavedStore.setState({ entries: entries.filter((e) => !inScope(e, scope)) });
  for (const entry of dropped) entry.discard?.();
}

/** The question on screen, shared by every caller that asks while it is up. */
let pending: { answer: Promise<boolean>; settle: (ok: boolean) => void } | null = null;
/** Mounted hosts, the ones that can draw the card. */
let hosts = 0;

/**
 * Registers a mounted {@link UnsavedChangesHost}; the returned function unregisters it. When the
 * last host goes while a question is open, the question is answered "keep editing" — nothing is
 * left waiting on a card that can no longer be shown.
 */
export function registerUnsavedHost(): () => void {
  hosts += 1;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    hosts -= 1;
    if (hosts === 0) answerDiscard(false);
  };
}

/**
 * Opens the discard prompt and resolves with the answer: `true` to discard, `false` to keep
 * editing. A call while the prompt is already up shares that answer, so two leaves racing never
 * show two cards. With no host mounted there is nobody to ask, and the answer is `true`: a leave
 * that silently never happened would strand the user on a surface they asked to leave.
 */
export function confirmDiscard(): Promise<boolean> {
  if (pending !== null) return pending.answer;
  if (hosts === 0) return Promise.resolve(true);
  let settle: (ok: boolean) => void = () => {};
  const answer = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  pending = { answer, settle };
  unsavedStore.setState({ asking: true });
  return answer;
}

/** The host's reply to the open prompt. With no prompt open, nothing happens. */
export function answerDiscard(ok: boolean): void {
  const question = pending;
  if (question === null) return;
  pending = null;
  unsavedStore.setState({ asking: false });
  question.settle(ok);
}

/**
 * The leave every path but a route change takes (a dialog's close, a rail or tab switch, a
 * picker that replaces a form): with nothing dirty in `scope`, `action` runs at once; otherwise
 * the prompt asks, and on "discard" every dirty form in `scope` is reset before `action` runs.
 * "Keep editing" runs nothing. Resolves with whether the leave happened; `action` runs at most
 * once per call.
 */
export async function guardLeave(action: () => void, scope?: string): Promise<boolean> {
  if (!hasUnsaved(scope)) {
    action();
    return true;
  }
  if (!(await confirmDiscard())) return false;
  discardUnsaved(scope);
  action();
  return true;
}

/**
 * Whether two form values are the same value: primitives by `Object.is`, arrays element by
 * element, sets by membership, plain objects key by key with a missing key equal to an
 * `undefined` one. What `useFormDraft` compares a draft with its baseline by, so a draft typed back
 * to the stored value is clean again.
 */
export function sameDraft(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, i) => sameDraft(value, b[i]));
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    return [...a].every((value) => b.has(value));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => sameDraft(left[key], right[key]));
}

/** The slice of `window` the unload guard needs. */
export type UnloadTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Keeps a `beforeunload` listener on `target` for exactly as long as any form is dirty, so a
 * reload, a tab close or a desktop window close asks first. The browser draws its own prompt
 * with its own words; a page cannot put text in it. Returns the function that stops watching.
 */
export function watchUnload(target: UnloadTarget): () => void {
  const onBeforeUnload = (event: Event): void => {
    event.preventDefault();
    // The legacy half of the same request, which some browsers still read.
    (event as unknown as { returnValue: string }).returnValue = "";
  };
  let installed = false;
  const sync = (): void => {
    const dirty = unsavedStore.getState().entries.length > 0;
    if (dirty === installed) return;
    installed = dirty;
    if (dirty) target.addEventListener("beforeunload", onBeforeUnload);
    else target.removeEventListener("beforeunload", onBeforeUnload);
  };
  sync();
  const unsubscribe = unsavedStore.subscribe(sync);
  return () => {
    unsubscribe();
    if (installed) target.removeEventListener("beforeunload", onBeforeUnload);
    installed = false;
  };
}
