/**
 * The dock tab an organization's conversation previews a cited file in. Clicking a file a reply
 * cites shows it here (`showCitedFile`, then the chat page opens the tab). The tab is offered once
 * a file has been opened, so a conversation that never opens one never lists it, and it shows the
 * file only while the conversation on screen belongs to the organization the file was opened
 * from.
 */
import { useSyncExternalStore } from "react";
import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { DockPanelDefinition } from "../dock/panel-registry";
import { useChatDock } from "../chat/chat-dock-context";
import { CitedFilePreview } from "./cited-file-preview";
import type { CitedFile } from "./cited-file-preview";

export const CITED_FILE_PANEL = "cited-file";

interface Shown {
  projectId: string;
  orgId: string;
  file: CitedFile;
}

let shown: Shown | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts `next` in the tab. Opening the tab is the caller's: the chat page owns the dock. */
export function showCitedFile(next: Shown): void {
  shown = next;
  for (const listener of [...listeners]) listener();
}

function CitedFilePanelBody() {
  const { selected } = useChatDock();
  const current = useSyncExternalStore(subscribe, () => shown);
  if (
    current === null ||
    selected?.projectId !== current.projectId ||
    selected.orgId !== current.orgId
  ) {
    return <EmptyState title={S.company.citedFile.panel} description={S.company.citedFile.empty} />;
  }
  return (
    <CitedFilePreview projectId={current.projectId} orgId={current.orgId} file={current.file} />
  );
}

export const CITED_FILE_DOCK_PANEL: DockPanelDefinition = {
  id: CITED_FILE_PANEL,
  label: () => S.company.citedFile.panel,
  glyph: ICONS.file,
  order: 25,
  offered: () => shown !== null,
  subscribeOffered: subscribe,
  Body: CitedFilePanelBody,
};
