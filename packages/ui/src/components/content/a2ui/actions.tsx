/**
 * What an A2UI block may do on the page it renders in: whether its controls work at all, how a
 * pick reaches the composer, and which language the filled text is written in.
 *
 * The blocks render inside Markdown, several components below whatever owns the conversation, so
 * these arrive through context rather than props. The default is inert — `interactive: false`, a
 * `fill` that does nothing — because most places a reply renders (an older turn, a Trace, a
 * subagent's transcript, the gallery) must show a question without letting anyone answer it. The
 * host opts in for the one reply that is waiting for an answer.
 *
 * A pick never sends anything: `fill` puts plain text in the composer, the person may edit it,
 * and the model reads it next turn as an ordinary user message.
 */
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

export interface A2uiActions {
  /** The controls work. Off, a choice or a form shows its options with every control disabled. */
  interactive: boolean;
  /** Puts the answer in the composer; the host decides what happens to text already typed there. */
  fill: (text: string) => void;
  /** The language the filled text is written in (its list separator, its "label: answer" colon). */
  lang: "zh" | "en";
  /**
   * Moves focus to the composer, for a choice's "Other…": the person writes their own answer
   * there. Without it the control is still drawn, and pressing it does nothing.
   */
  focus?: () => void;
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
