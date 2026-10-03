/**
 * Which component draws each A2UI block type.
 *
 * The four built-ins are here from module load. `registerA2uiRenderer` is the door anything else
 * comes in by — a host that wants its own choice, a plugin that brings a type the grammar has
 * learned — and a registration takes precedence over the built-in of the same type until it is
 * unregistered, when the built-in is back. A block reads the registry when it renders and
 * re-renders when it changes, so a renderer registered late still reaches blocks already on
 * screen.
 *
 * The registry draws, it does not admit: a block reaches a renderer only after the grammar has
 * parsed and validated it, so a renderer never sees a spec the catalog does not allow.
 */
import { useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import type { A2uiSpec } from "@prismshadow/penguin-core/a2ui";
import { CalloutBlock } from "./callout-block";
import { ChoiceBlock } from "./choice-block";
import { FormBlock } from "./form-block";
import { StepsBlock } from "./steps-block";

/** A block type the grammar knows. */
export type A2uiBlockType = A2uiSpec["type"];

/** The spec of one block type. */
export type A2uiSpecOf<T extends A2uiBlockType> = Extract<A2uiSpec, { type: T }>;

/** What draws a block: a component taking its validated spec. */
export type A2uiRenderer<S = A2uiSpec> = ComponentType<{ spec: S }>;

const BUILT_IN: { readonly [T in A2uiBlockType]: A2uiRenderer<A2uiSpecOf<T>> } = {
  choice: ChoiceBlock,
  form: FormBlock,
  steps: StepsBlock,
  callout: CalloutBlock,
};

// Keyed by string so a type the grammar adds later can be registered before this file names it.
const registered = new Map<string, A2uiRenderer<never>>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/**
 * Draws blocks of `type` with `component` instead of the built-in (or as the first renderer of a
 * type with none). Returns the unregister function; an unregister that a later registration of
 * the same type has replaced does nothing, so it cannot take the newer renderer down with it.
 */
export function registerA2uiRenderer<T extends A2uiBlockType>(
  type: T,
  component: A2uiRenderer<A2uiSpecOf<T>>,
): () => void;
export function registerA2uiRenderer(type: string, component: A2uiRenderer<never>): () => void;
// The implementation takes `unknown`: a renderer typed for one spec is not assignable to one typed
// for every spec, and the two overloads above are what callers see.
export function registerA2uiRenderer(type: string, component: unknown): () => void {
  registered.set(type, component as A2uiRenderer<never>);
  notify();
  return () => {
    if (registered.get(type) !== component) return;
    registered.delete(type);
    notify();
  };
}

/** The renderer for a block type: a registered one, else the built-in, else none. */
export function a2uiRendererFor(type: string): A2uiRenderer | undefined {
  const component =
    registered.get(type) ??
    (Object.hasOwn(BUILT_IN, type) ? BUILT_IN[type as A2uiBlockType] : undefined);
  return component as A2uiRenderer | undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => version;

/** The renderer for a block type, re-read whenever the registry changes. */
export function useA2uiRenderer(type: string): A2uiRenderer | undefined {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return a2uiRendererFor(type);
}
