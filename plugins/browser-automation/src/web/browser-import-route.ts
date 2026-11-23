/**
 * The user's Chrome extension as a route for the built-in browser's import, as the import dialog
 * and its copy both name it: listed (`connected`), not paired, paired but not connected, or `off`
 * — switched off by an admin, or not offered by this server.
 */
export type ImportExtensionRoute = "connected" | "not_paired" | "disconnected" | "off";
