/**
 * What a reader holds of the app window: the page on show, the sidebar folded or not, the open
 * Session, the dock panel, the composer's draft, the prompt they sent and whether the model picker
 * is open. A plain reducer with no React and no DOM, so a test drives it directly and the window
 * (hero/window.tsx) only renders what it says.
 *
 * Nothing here moves on a clock. The one timed thing in the window is the scripted reply, which
 * starts when the reader sends (hero/clock.ts); the state below only records that they did.
 */

/**
 * The pages the window can show, in the sidebar's order: the chat, the five page entries under
 * New chat, and Settings, which the user row at the sidebar's foot opens. The five middle keys are
 * the sidebar's own (`SIDEBAR_NAV` in screens/parts.tsx), so a nav row names its page directly.
 */
export const SHELL_PAGES = [
  "chat",
  "agents",
  "plugins",
  "models",
  "usage",
  "benchmark",
  "settings",
] as const;

export type ShellPage = (typeof SHELL_PAGES)[number];

export interface ShellState {
  page: ShellPage;
  /** The sidebar folded to the icon rail. */
  collapsed: boolean;
  /** Which session row the chat reads, by its place in the list. */
  session: number;
  /** Which dock panel is on top, by its place in the tab row. */
  panel: number;
  /** What the composer holds. */
  draft: string;
  /** The last prompt the reader sent; the transcript shows it in place of the story's own. */
  sent: string | null;
  /** The model picker open over the composer. */
  picker: boolean;
}

export type ShellAction =
  | { type: "page"; page: ShellPage }
  | { type: "session"; index: number }
  | { type: "collapse"; collapsed: boolean }
  | { type: "panel"; index: number }
  | { type: "write"; draft: string }
  | { type: "send"; prompt: string }
  | { type: "picker"; open: boolean };

/** The window as it opens: the chat on the first Session, the sidebar pinned, nothing typed. */
export const SHELL_START: ShellState = {
  page: "chat",
  collapsed: false,
  session: 0,
  panel: 0,
  draft: "",
  sent: null,
  picker: false,
};

/** A place in a list from a click: a whole number, and a miss (-1 from `findIndex`) is no move. */
const place = (index: number): number | null =>
  Number.isFinite(index) && index >= 0 ? Math.trunc(index) : null;

/**
 * One reader move. A move that changes nothing returns the same object, so a repeated click does
 * not re-render the window. Leaving the chat, opening a Session and sending all close the picker,
 * since it hangs off the composer they take the reader away from.
 */
export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "page":
      if (state.page === action.page && !state.picker) return state;
      return { ...state, page: action.page, picker: false };
    case "session": {
      const index = place(action.index);
      if (index === null) return state;
      if (state.page === "chat" && state.session === index && !state.picker) return state;
      return { ...state, page: "chat", session: index, picker: false };
    }
    case "collapse":
      return state.collapsed === action.collapsed
        ? state
        : { ...state, collapsed: action.collapsed };
    case "panel": {
      const index = place(action.index);
      return index === null || index === state.panel ? state : { ...state, panel: index };
    }
    case "write":
      return state.draft === action.draft ? state : { ...state, draft: action.draft };
    case "send": {
      const text = action.prompt.trim();
      if (text === "") return state;
      // A prompt goes to the Task the composer belongs to — the first Session — whichever row
      // the reader was reading.
      return { ...state, page: "chat", session: 0, draft: "", sent: text, picker: false };
    }
    case "picker":
      if (action.open && state.page !== "chat") return state;
      return state.picker === action.open ? state : { ...state, picker: action.open };
  }
}
