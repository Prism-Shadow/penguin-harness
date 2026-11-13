/**
 * A Workspace group's "Browse files" in the session list (`SessionListModule.rowActions`): the
 * dock's Files panel on that directory. A page already on it — the open conversation's
 * Workspace, or the folder the draft picked, on the same machine — only brings the panel up.
 * Anywhere else lands on a new-chat draft for the folder, the group's "+", whose Files panel is
 * addressed by the directory itself: the dock belongs to the conversation on screen, so a folder
 * another conversation is in has no panel here.
 */
import { S } from "../../lib/strings";
import type { RowAction } from "../../lib/session-row-contributions";
import { docksOnScreen, openPanel } from "./dock-state";
import { dockWorkspace } from "./dock-terminal";

export const browseFilesAction: RowAction = {
  workspaceEntry: {
    id: "browse-files",
    label: () => S.chat.browseWorkspaceFiles,
    icon: "folderOpen",
    run: ({ path, machineId }, host) => {
      const here = dockWorkspace();
      if (docksOnScreen() && here !== null && here.path === path && here.machineId === machineId) {
        openPanel("workspace");
        host.onNavigate?.();
        return;
      }
      host.newChat({ workspace: path, ...(machineId ? { machineId } : {}), browseFiles: true });
    },
  },
};
