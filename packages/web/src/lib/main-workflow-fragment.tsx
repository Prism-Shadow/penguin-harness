/** The main chat owner keeps the workflow hook and callbacks unchanged across the slot. */
import { createContext, useContext, type ReactNode } from "react";

export const MainWorkflowFragment = createContext<ReactNode>(null);
export function MainWorkbenchSessionTab() {
  return <>{useContext(MainWorkflowFragment)}</>;
}
