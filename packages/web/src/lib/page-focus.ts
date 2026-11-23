import { createContext, useContext } from "react";

/** The visible page that owns the window's commands, title and conversation tools. */
export const PaneFocus = createContext(true);
export const usePaneFocus = () => useContext(PaneFocus);

export const PageIdentity = createContext<import("./page-layout").OpenPage | undefined>(undefined);
