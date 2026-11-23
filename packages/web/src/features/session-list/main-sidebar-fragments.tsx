import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { shownRows, type RowMarks, type RowExtensions } from "./row-actions";
import { sessionListDeps } from "./deps";
import { useModuleGates } from "../../lib/module-gate";
/** Main's live list JSX crosses the contribution boundary without moving its state owner. */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export const MainSidebarFragments = createContext<{ sessionList: ReactNode } | null>(null);

export const MainRowExtensions = createContext<{
  rows: RowExtensions;
  marks: (session: SessionInfo) => RowMarks;
} | null>(null);

export function MainSessionListSection() {
  const { rows: contributed, useRowMarks } = sessionListDeps.useDeps();
  const marks = useRowMarks();
  // The entries of a module waiting for its server module come and go with it.
  const gates = useModuleGates();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `gates` is what says the gates moved
  const rows = useMemo(() => shownRows(contributed), [contributed, gates]);
  const fragments = useContext(MainSidebarFragments);
  if (fragments === null) throw new Error("Main session list mounted outside its sidebar owner");
  return (
    <MainRowExtensions.Provider value={{ rows, marks }}>
      {fragments.sessionList}
    </MainRowExtensions.Provider>
  );
}
