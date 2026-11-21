/**
 * A disclosure held by the list a row sits in rather than by the row. A list that can show another
 * page in a row's place, or open every row at once, keeps each row's open state itself and hands
 * it down here; `DisclosureRow` reads it in place of its own state, and calls `toggle` when the
 * reader presses the row.
 *
 * The list also says why a row is open. A row the reader opened asked for its body; a row a list
 * opened by policy (every row open by default, or all rows revealed for a search) did not. Content
 * that is expensive to show in full, such as a value a history window carried folded, reads
 * `useDisclosureRequested` and only fetches when the reader asked.
 */
import { createContext, useContext } from "react";

export interface DisclosureControl {
  /** The row's body is shown. */
  open: boolean;
  /** The reader opened this row, rather than the list opening it by policy. */
  requested: boolean;
  /** The reader pressed the row. */
  toggle: () => void;
}

export const DisclosureControlContext = createContext<DisclosureControl | null>(null);

/** Inside a row's body: whether the reader opened that row. A row that holds its own state was. */
export const DisclosureRequested = createContext(true);

export function useDisclosureRequested(): boolean {
  return useContext(DisclosureRequested);
}
