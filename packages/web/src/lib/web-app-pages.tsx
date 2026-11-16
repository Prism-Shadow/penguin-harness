import { createContext, useContext } from "react";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import type { WebAppPage } from "../web-app";
export interface ContributionsValue {
  /** The module plugins' quick starts; none until the server answers. */
  quickStarts: readonly never[];
  refresh: () => Promise<ContributionsResponse | null>;
}

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

/** Every page: the modules' contributions by `order`, then the server's. */
export function useWebAppPages(): readonly WebAppPage[] {
  return usePagesValue().pages;
}

/** The quick starts the server contributes, and the way to ask again. */
export function useContributions(): ContributionsValue {
  return usePagesValue();
}

/**
 * Whether the server's pages may still arrive. The router's catch-all waits on it, so a
 * contributed page opened by its URL is not redirected away before the table holds it.
 */
export function useWebAppPagesPending(): boolean {
  return usePagesValue().pending;
}
