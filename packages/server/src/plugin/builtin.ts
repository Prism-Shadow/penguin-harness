/**
 * Built in on this server (PRFC-0031): the package resolves from a prefix the running build
 * ships, and its table only adds modules (`replaces` empty). A same-named package under
 * `<root>/plugins` resolves first and shadows it, so it is not built in, whoever published it.
 * Read from the package's table alone: nothing is imported.
 */
import { readPluginDeclaration, type PluginBase } from "./loader.js";

export async function isBuiltin(pkg: string, bases: readonly PluginBase[]): Promise<boolean> {
  const declared = await readPluginDeclaration(pkg, bases);
  return (
    !("error" in declared) &&
    declared.builtin &&
    declared.modules.length > 0 &&
    declared.replaces.length === 0
  );
}
