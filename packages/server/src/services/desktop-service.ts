/**
 * The desktop-shell service moved to the setting domain library (services+http+cli restack
 * S5); this re-export keeps the server's import paths (hmr/capabilities.ts and the routes)
 * reading the same class from one place.
 */
export {
  DesktopService,
  type FolderAccessSender,
  type UpdaterCommand,
} from "@prismshadow/penguin-library-setting/desktop-service";
