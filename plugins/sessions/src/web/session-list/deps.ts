/**
 * What the session list module binds into its section (lib/module-deps.tsx): the chat drafts its
 * New chat entries and parked drafts use, and the row extensions other modules contributed.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { createDeps } from "../../lib/module-deps";
import type { ChatDrafts } from "../chat";
import type { RowExtensions, RowMarks } from "./row-actions";

export interface SessionListDeps {
  drafts: ChatDrafts;
  rows: RowExtensions;
  /** Every contributed mark's label for a row (a hook). */
  useRowMarks: () => (s: SessionInfo) => RowMarks;
}

export const sessionListDeps = createDeps<SessionListDeps>();
