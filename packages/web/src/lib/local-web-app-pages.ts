/** Same merged-page context and readers; original provider/store/fetch stay owned by WebApp. */
import { createContext, useContext } from "react";
import type { WebAppPage } from "./local-page-table";
export interface WebAppPagesValue extends ContributionsValue {
  pages: readonly WebAppPage[];
  pending: boolean;
}

export const PagesContext = createContext<WebAppPagesValue | null>(null);

function usePagesValue(): WebAppPagesValue {
  const value = useContext(PagesContext);
  if (value === null) throw new Error("rendered outside WebApp's page table");
  return value;
}

export function useWebAppPages(): readonly WebAppPage[] {
  return usePagesValue().pages;
}

export function useWebAppPagesPending(): boolean {
  return usePagesValue().pending;
}
