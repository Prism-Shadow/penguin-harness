/** Types of gen-web-table.mjs, for the suite that drives it. */
export interface PluginWebSource {
  /** The package's name. */
  name: string;
  /** What the generated list imports: `<name>/web`. */
  specifier: string;
  /** The tsconfig its web modules are read through. */
  tsconfig: string;
}

export function pluginWebEntries(
  webDir: string,
  options?: { pluginsDir?: string | null },
): PluginWebSource[];

export function pluginWebModuleSource(entries: readonly PluginWebSource[]): string;

export function writePluginWebModules(
  webDir: string,
  options?: { pluginsDir?: string | null },
): PluginWebSource[];
