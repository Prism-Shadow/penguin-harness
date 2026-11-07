/**
 * What the shell binds into its root component (lib/module-deps.tsx): the page table, the
 * session providers, the layers and the user event handlers. Kept apart
 * from module.ts so the router and the sidebar can read it without importing the module class,
 * which only the composition root does.
 */
import type { ComponentType, ReactNode } from "react";
import { createDeps } from "../lib/module-deps";
import type { UserEventHandler } from "../state/user-events";
import type { WebAppPage } from "./page-table";

/** A contributed provider of the signed-in session. */
export interface WebAppSessionProvider {
  id: string;
  Component: ComponentType<{ children: ReactNode }>;
}

/** A contributed layer: an overlay or a headless runtime, mounted once beside every page. */
export interface WebAppLayer {
  id: string;
  Component: ComponentType;
}

export interface WebAppDeps {
  pages: readonly WebAppPage[];
  /** Outermost first. */
  sessionProviders: readonly WebAppSessionProvider[];
  layers: readonly WebAppLayer[];
  /** In dispatch order; the session list hands them every event it does not keep. */
  userEvents: readonly UserEventHandler[];
}

export const webAppDeps = createDeps<WebAppDeps>();
