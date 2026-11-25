/**
 * The page workspace's context object, its value type and the hook that reads it.
 *
 * Kept apart from the provider on purpose: this module must import nothing at runtime but
 * `react`. A context is identified by the object `createContext` returns, so every evaluation of
 * the module that calls it mints a different context. Under the dev server a module is evaluated
 * again whenever it or anything it imports is edited, and a consumer still holding the previous
 * evaluation then reads `null` from under a mounted provider. With no local runtime imports,
 * only an edit to this file can evaluate it again.
 */
import { createContext, useContext } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import type { OpenPage, PageLayout } from "./page-layout";

export interface SessionLocation {
  projectId: string;
  machineId: string | null;
  session?: SessionInfo;
}

export interface Workspace {
  /** Router address, including the conversation that hosts a docked directory. */
  address: string;
  scope: number;
  accountScope: number;
  layout: PageLayout;
  current: OpenPage | null;
  pageForDrag(id: string): OpenPage | undefined;
  resumeDraft(): boolean;
  openBesideSession(sessionId: string, page: OpenPage, source?: SessionLocation): void;
  focus(page: OpenPage): void;
  openPage(page: OpenPage): void;
  canDockRunningApp(session: OpenPage, app: OpenPage): boolean;
  dockRunningApp(session: OpenPage, app: OpenPage): void;
  close(id: string): void;
  minimize(id: string): void;
  fullScreen(page: OpenPage): void;
  /** The page occupying the full shell, with its original component still mounted. */
  exitFullScreen?: () => void;
  reorder(id: string, before: string): void;
  openAppCenterBesideSession(sessionId: string, source?: SessionLocation): void;
  openFromAppCenter(page: OpenPage, replace?: boolean): boolean;
  separate(page: OpenPage): void;
}

export const PageWorkspaceContext = createContext<Workspace | null>(null);
export const usePageWorkspace = () => useContext(PageWorkspaceContext);
