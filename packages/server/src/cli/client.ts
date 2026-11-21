/**
 * Moved to the CLI face (`@prismshadow/penguin-library-cli/client`), where a shipped plugin's CLI
 * module reaches it without importing this package. Re-exported here so this package's commands
 * keep their import path.
 */
export * from "@prismshadow/penguin-library-cli/client";
