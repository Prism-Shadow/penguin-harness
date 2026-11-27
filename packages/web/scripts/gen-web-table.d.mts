/** Types of gen-web-table.mjs, for the suite that drives it. */
export interface PluginWebSource {
  /** The package's name. */
  name: string;
  /** What the generated list imports: `<name>/web`. */
  specifier: string;
  /** The tsconfig its web modules are read through. */
  tsconfig: string;
  /** Whether the package is a library package (`library/<domain>`): its half boots from
   * web-root's children, so it never joins the generated list. */
  library: boolean;
}

export function pluginWebEntries(
  webDir: string,
  options?: { pluginsDir?: string | null },
): PluginWebSource[];

export function separateProjects(entries: readonly PluginWebSource[]): PluginWebSource[];

export function pluginWebModuleSource(entries: readonly PluginWebSource[]): string;

export function writePluginWebModules(
  webDir: string,
  options?: { pluginsDir?: string | null },
): PluginWebSource[];
