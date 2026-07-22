/**
 * Default PenguinHarness server port — the single source of truth shared by the CLI
 * (`penguin server` / `penguin web`) and the server, which previously each hardcoded
 * the number. It is a fallback only: the `--port` flag and the PORT environment
 * variable override it at runtime.
 */

/** Default main server / Web UI port; deliberately avoids common defaults like 3000/8080. */
export const DEFAULT_SERVER_PORT = 7364;
