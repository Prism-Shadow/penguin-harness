/**
 * The dock tab an organization's conversation previews a cited file in (`DockModule.panels`, kind
 * `cited-file`). Clicking a file a reply cites shows it here and opens the tab
 * (`ConversationCitedFiles`, which the chat page wraps the conversation's stream in). The tab is
 * offered once a file has been opened, so a conversation that never opens one never lists it, and
 * it shows the file only while the conversation on screen belongs to the organization the file was
 * opened from.
 */
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { useChatSession } from "../../lib/chat-session";
import { S } from "../../lib/strings";
import { openPanel, type DockPanelDefinition } from "../dock";
import { CitedFilePreview, type CitedFile } from "./cited-file-preview";
import { CitedFileOpenerProvider, type OpenCitedFile } from "./path-capsule";

const CITED_FILE_PANEL = "cited-file";

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

function show(next: Shown): void {
  shown = next;
  for (const listener of [...listeners]) listener();
  openPanel(CITED_FILE_PANEL);
}

/**
 * Makes the file capsules of a conversation open in the tab when the conversation belongs to an
 * organization (`orgId`); outside one they copy, as they would without this.
 */
export function ConversationCitedFiles({
  projectId,
  orgId,
  children,
}: {
  projectId: string | null;
  orgId: string | undefined;
  children: ReactNode;
}) {
  const open = useMemo<OpenCitedFile | null>(
    () =>
      projectId === null || orgId === undefined ? null : (file) => show({ projectId, orgId, file }),
    [projectId, orgId],
  );
  return <CitedFileOpenerProvider open={open}>{children}</CitedFileOpenerProvider>;
}

function CitedFilePanelBody() {
  const { selected } = useChatSession();
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

export const citedFilePanelDefinition: DockPanelDefinition = {
  id: CITED_FILE_PANEL,
  label: () => S.company.citedFile.panel,
  glyph: ICONS.file,
  order: 25,
  offered: () => shown !== null,
  subscribeOffered: subscribe,
  Body: CitedFilePanelBody,
};
