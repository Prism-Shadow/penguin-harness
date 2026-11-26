/**
 * What the shell binds into its root component (lib/module-deps.tsx): the page table, the
 * session providers, the layers, the user event handlers, the sidebar the layout mounts and the
 * chat drafts its New chat command opens. Kept apart
 * from module.ts so the router and the sidebar can read it without importing the module class,
 * which only the composition root does.
 */
import type { ComponentType, ReactNode } from "react";
import { createDeps } from "../lib/module-deps";
import type { UserEventHandler } from "../state/user-events";
import type { ChatDrafts } from "../features/chat";
import type { WebAppPage } from "./page-table";
import type { Sidebar } from "./sidebar/iface";

/** A contributed provider of the signed-in session. */
export interface WebAppSessionProvider {
  id: string;
  Component: ComponentType<{ children: ReactNode }>;
}

/**
 * A contributed layer, mounted once: an overlay or a headless runtime beside the columns
 * (`"shell"`), or surfaces over the page area that outlive the page (`"page"`).
 */
export interface WebAppLayer {
  id: string;
  Component: ComponentType;
  area: "shell" | "page";
}

export interface WebAppDeps {
  pages: readonly WebAppPage[];
  /** Outermost first. */
  sessionProviders: readonly WebAppSessionProvider[];
  layers: readonly WebAppLayer[];
  /** In dispatch order; the session list hands them every event it does not keep. */
  userEvents: readonly UserEventHandler[];
  sidebar: Sidebar;
  drafts: ChatDrafts;
}

export const webAppDeps = createDeps<WebAppDeps>();
