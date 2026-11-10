/**
 * A built-in pack can do nothing an imported pack may not (PRFC-0026).
 *
 * - Given each built-in pack as the build carries it (the folder the Vite plugin emits), in the
 *   form its export takes, when it is checked by the validator an import goes through, under this
 *   build's theme API and token names, it is accepted.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinExportFiles, validateThemePack } from "@prismshadow/penguin-theme-pack";
import { THEME_API, TOKEN_NAMES } from "../src/tokens";
import { builtinPackIds, builtinThemesDir, packFolderFiles } from "../src/vite-plugin";

const contract = { api: THEME_API, tokens: new Set<string>(TOKEN_NAMES) };

describe("the built-in packs, exported", () => {
  it.each(builtinPackIds())("%s passes the validator an import goes through", async (id) => {
    const files = builtinExportFiles(id, packFolderFiles(join(builtinThemesDir(), id)));
    await expect(validateThemePack(files, contract)).resolves.toMatchObject({ manifest: { id } });
  });
});
