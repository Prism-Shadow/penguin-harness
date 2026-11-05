/** Absolute paths the package's suites read from. */
import { fileURLToPath } from "node:url";

/** `packages/ui/`, with a trailing separator. */
export const PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));
/** `packages/ui/src/`. */
export const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
/** The monorepo root. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
/** `packages/web/`, whose index.html carries the inline copy of the boot script. */
export const WEB_DIR = fileURLToPath(new URL("../../../web/", import.meta.url));
