import type { ComponentType, ReactNode } from "react";
import { createDeps } from "./module-deps";
import type { UserEventHandler } from "../state/user-events";
import type { WebAppPage } from "./early-frame-page-table";

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
