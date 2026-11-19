/**
 * The settings domain as a library package: the Settings and UiPrefsStore mechanisms
 * (the contracts a node requires), the attachment size arithmetic those settings govern,
 * the theme packs an admin imports, the account's keyboard-shortcut overrides, the
 * desktop shell relay, and the repos that store them. One package, no server
 * dependencies — packages/server imports these; nothing here imports the server.
 *
 * The repos depend on the Db capability from @prismshadow/penguin-library-db: the
 * database, its schema and migrations live there, and every domain's repo takes the
 * handle as an injected capability.
 *
 * Subpaths:
 * - `.` — the two mechanism contracts (Settings, UiPrefsStore).
 * - `./attachment-limits` — the one place every attachment size number is defined.
 * - `./plugin-module-requests` — the PluginModuleRequests mechanism and its row (PRFC-0031).
 * - `./plugin-module-preinstalls` — the PluginModulePreinstalls mechanism (PRFC-0030).
 * - `./theme-store` — the installed theme packs under the data root.
 * - `./keybindings` — the bounds on the account's keyboard-shortcut overrides.
 * - `./desktop-service` — the desktop shell's token check and its shell↔web relays.
 * - `./desktop-update-port` — the message-port wiring between server and shell.
 * - `./types` — the domain's API vocabulary.
 * - `./repos` (and per-file) — the storing components, wired by the server's platform.
 */
export { Settings, UiPrefsStore } from "./setting.js";
export { PluginModuleRequests } from "./plugin-module-requests.js";
export type { PluginModuleRequestRow, PluginModuleVia } from "./plugin-module-requests.js";
export { PluginModulePreinstalls } from "./plugin-module-preinstalls.js";
export { ThemeStore } from "./theme-store.js";
export type { ThemeStoreDeps } from "./theme-store.js";
export {
  KEYBINDINGS_SECTION_MAX,
  KEYBINDINGS_ID_MAX,
  KEYBINDINGS_CHORD_MAX,
  KEYBINDINGS_BYTES_MAX,
  validateKeybindings,
} from "./keybindings.js";
export { DesktopService } from "./desktop-service.js";
export type { UpdaterCommand, FolderAccessSender } from "./desktop-service.js";
export {
  FOLDER_ACCESS_TIMEOUT_MS,
  parseUpdaterStatusMessage,
  parseHostCommandsMessage,
  parseTrayStatusMessage,
  parseFolderAccessResultMessage,
  shellPortOf,
  wireShellUpdatePort,
} from "./desktop-update-port.js";
export type { ShellPort, ShellFrames } from "./desktop-update-port.js";
export type { WebFiles } from "./types.js";
export type {
  ThemePackMode,
  ThemePackBase,
  ThemePackSwatch,
  ThemePackAccentPreset,
  ThemePackDto,
  ThemePacksResponse,
  ThemePackImportResponse,
  ThemePackErrorCode,
  ThemeInvalidDetails,
  StoredKeybindings,
  DesktopUpdateStatus,
  DesktopUpdateStatusResponse,
  DesktopUpdaterStatusMessage,
  DesktopUpdaterCommandMessage,
  DesktopTrayLocale,
  DesktopTrayStatus,
  DesktopTrayPatch,
  DesktopTrayStatusResponse,
  DesktopTrayStatusMessage,
  DesktopTrayCommandMessage,
  DesktopFolderAccessResult,
  DesktopFolderAccessMessage,
  DesktopFolderAccessResultMessage,
  DirAccessResponse,
  DesktopPrivacyPane,
  DesktopOpenPrivacySettingsMessage,
  DesktopOpenWindowMessage,
  HostCommandsResponse,
} from "./types.js";
export { HOST_COMMANDS, LEGACY_HOST_COMMANDS } from "./types.js";
export type {
  HostCommand,
  HostCommandOffer,
  HostCommandsMessage,
  HostCommandMessage,
} from "./types.js";
