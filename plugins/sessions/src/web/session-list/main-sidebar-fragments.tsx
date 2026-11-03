import type { SessionInfo } from "@prismshadow/penguin-server/api";
import type { RowMarks, RowExtensions } from "./row-actions";
import { sessionListDeps } from "./deps";
/** Main's live list JSX crosses the contribution boundary without moving its state owner. */
import { createContext, useContext, type ReactNode } from "react";

export const MainSidebarFragments = createContext<{ sessionList: ReactNode } | null>(null);

export const MainRowExtensions = createContext<{
  rows: RowExtensions;
  marks: (session: SessionInfo) => RowMarks;
} | null>(null);

export function MainSessionListSection() {
  const { rows, useRowMarks } = sessionListDeps.useDeps();
  const marks = useRowMarks();
  const fragments = useContext(MainSidebarFragments);
  if (fragments === null) throw new Error("Main session list mounted outside its sidebar owner");
  return (
    <MainRowExtensions.Provider value={{ rows, marks }}>
      {fragments.sessionList}
    </MainRowExtensions.Provider>
  );
}
