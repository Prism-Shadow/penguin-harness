/**
 * What an A2UI block may do on the page it renders in: whether its controls work at all, how a
 * pick reaches the composer, which language the filled text is written in, and where answers in
 * progress are kept.
 *
 * The blocks render inside Markdown, several components below whatever owns the conversation, so
 * these arrive through context rather than props. The default is inert — `interactive: false`, a
 * `fill` that does nothing, no drafts — because most places a reply renders (an older turn, a
 * Trace, a subagent's transcript, the gallery) must show a question without letting anyone
 * answer it. The host opts in for the one reply that is waiting for an answer.
 *
 * A pick never sends anything: `fill` puts plain text in the composer, the person may edit it,
 * and the model reads it next turn as an ordinary user message.
 */
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

/**
 * The host's store for answers in progress (draft.ts names the entries and decides when to read
 * and write them). A block checks whatever `load` returns before using it, so the store may hand
 * back anything; a call that throws costs the draft, never the block.
 */
export interface A2uiDrafts {
  /** What was last saved under `key`, or undefined when nothing is. */
  load(key: string): unknown;
  /** Replaces what is saved under `key`; `state` is plain JSON. */
  save(key: string, state: unknown): void;
  /** Removes what is saved under `key`. */
  clear(key: string): void;
}

export interface A2uiActions {
  /** The controls work. Off, a choice or a form shows its options with every control disabled. */
  interactive: boolean;
  /**
   * Puts the answer in the composer; the host decides what happens to text already typed there.
   * An empty text empties it: a choice's "Other…", whose answer the person writes themselves.
   */
  fill: (text: string) => void;
  /** The language the filled text is written in (its list separator, its "label: answer" colon). */
  lang: "zh" | "en";
  /**
   * Keeps an open form's answers, and an open multi-select's ticks, across a reload. Without it
   * (or without a `draftScope`) they last as long as the block stays mounted.
   */
  drafts?: A2uiDrafts;
  /**
   * The conversation the answers belong to: every draft key is `<draftScope>:<block hash>`, the
   * hash taken over the block's source, so a scope must stay the same across a reload.
   */
  draftScope?: string;
}

const noop = () => {};

/** Read-only: what a block gets where no provider is mounted. */
export const DEFAULT_A2UI_ACTIONS: A2uiActions = { interactive: false, fill: noop, lang: "en" };

const A2uiActionsContext = createContext<A2uiActions>(DEFAULT_A2UI_ACTIONS);

/**
 * Hands the blocks below their actions. A new value re-renders every block under it, memoised
 * Markdown included, so pass one that keeps its identity while its fields do.
 */
export function A2uiActionsProvider({
  value,
  children,
}: {
  value: A2uiActions;
  children?: ReactNode;
}): ReactElement {
  return <A2uiActionsContext.Provider value={value}>{children}</A2uiActionsContext.Provider>;
}

/** The nearest provider's actions, or the inert default. */
export function useA2uiActions(): A2uiActions {
  return useContext(A2uiActionsContext);
}
