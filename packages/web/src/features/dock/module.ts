/**
 * The dock: the layer that keeps its scope on the conversation on screen (dock-scope.tsx), and a
 * Workspace group's "Browse files" in the session list (browse-files.ts).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { DockScope } from "./dock-scope";
import { browseFilesAction } from "./browse-files";

@Module({
  contributes: {
    // Last of the layers: the layout's own effect it replaces ran after every layer's.
    "WebAppModule.layers": [{ id: "dock.scope", order: 50 }],
    "SessionListModule.rowActions": [{ id: "dock.browse-files", order: 10 }],
  },
})
export class DockModule {
  @Bind("dock.scope") scope = DockScope;
  @Bind("dock.browse-files") browseFiles = browseFilesAction;
}
