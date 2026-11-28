/**
 * The Workspace module's public face: the Files panel's browser, the read-only directory browser
 * beside it, the Workspace picker every create form opens, and the provider that turns a reply's
 * file links into jumps to that browser.
 */
export { WorkspaceBrowser } from "./workspace-browser";
export { DirBrowser } from "./dir-browser";
export { WorkspaceSelect, pillClass } from "./workspace-select";
export { WorkspaceLinksProvider } from "./workspace-links";
export { WorkspaceModule } from "./module";
