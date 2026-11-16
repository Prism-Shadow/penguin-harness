import { mainPanelDefinition as mainPanelworkspace } from "./main-dock-panel";
/** The Workspace files: the dock's Files panel (workspace-panel.tsx). */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { WorkspacePanel } from "./workspace-panel";

@Module({
  contributes: {
    "DockModule.panels": [
      {
        id: "workspace.panel",
        kind: "workspace",
        title: "Files",
        titleZh: "文件浏览",
        icon: "folder",
        order: 20,
      },
    ],
  },
})
export class WorkspaceModule {
  @Bind("workspace.panel") panel = { mainDefinitions: [mainPanelworkspace] };
}
