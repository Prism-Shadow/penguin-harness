/**
 * Server modules behind a system app: the ones that cannot be stopped.
 *
 * A server module declares the system app it provides as data, `SystemAppModule.apps` `{ app }`,
 * where `app` is the key of the page it contributes for that app. A package that declares one, is
 * built in and whose card says `preinstall: true` in so many words (plugin/preinstall.ts) is
 * LOCKED on this server: the system Agent's apps are never stopped, whoever provides them.
 *   - An administrator's stop answers 409 `system_app_module_locked` (services/plugin-modules.ts).
 *   - A write of a Project's plugin tables that would take it out of what this server runs for
 *     that Project answers the same 409 and writes nothing (services/plugin-tables.ts). Another
 *     machine's own table is that machine's to judge: its build decides what is locked there.
 *   - Every boot of a generation lists it again in this server's own table of each Project that
 *     lacks it (services/system-app-relist.ts), so a removal by hand does not stick, unlike any
 *     other preinstalled module's.
 * The Web App's safe mode takes no server contributions, so the app is absent there; that is the
 * one way to run without it. A module that fails to load is a fault, reported like any plugin's.
 *
 * Read from the package's `ifaces.json` alone: nothing is imported, so the rule holds for a module
 * that is not loaded, yet or any more.
 */
import {
  isValidId,
  readPluginTable,
  slotEntries,
  type PluginTable,
} from "@prismshadow/penguin-core";
import { Interface, Module, Provide, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import { resolvePluginPackage, type PluginBase } from "./loader.js";
import { isPreinstalled, preinstalledModules, type PreinstalledModule } from "./preinstall.js";

/** One system app a server module provides. */
export interface SystemAppData {
  /** The app's id: the key of the page the module contributes for it. */
  app: string;
}

/** A `SystemAppModule.apps` contribution as the running App holds it: `from` names its module. */
export type SystemAppContribution = SystemAppData & { id: string; from: string };

/** SystemApps: the system apps the running modules declare, which SystemAppModule provides. */
@Interface()
export abstract class SystemApps {
  /** Every declared system app, in module order. */
  abstract apps(): SystemAppContribution[];
}

export interface SystemAppsSlots {
  /** A system app the contributing module provides (SystemAppData says what each field means). */
  apps: SystemAppData;
}

@Module()
export class SystemAppModule {
  @Provide() systemApps!: SystemApps;
  setup({ contributions }: ClassCtx) {
    // The kernel checked each contribution's data against its slot's type at boot.
    const apps = (contributions.apps ?? []).map(
      (c) => ({ ...c.data, id: c.id, from: c.from }) as SystemAppContribution,
    );
    this.systemApps = { apps: () => apps };
  }
}

/** The slot key a package's table declares its system apps under. */
export const SYSTEM_APPS_SLOT = "SystemAppModule.apps";

/** The apps a package's table declares; an entry whose `app` is no id declares nothing. */
export function declaredSystemApps(table: PluginTable): string[] {
  return slotEntries(table, SYSTEM_APPS_SLOT)
    .map(({ entry }) => entry.app)
    .filter((app): app is string => typeof app === "string" && isValidId(app));
}

/** Whether `pkg` is a module behind a system app on this server (see the header). */
export async function isSystemAppModule(
  pkg: string,
  bases: readonly PluginBase[],
): Promise<boolean> {
  if (!(await isPreinstalled(pkg, bases))) return false;
  const found = resolvePluginPackage(pkg, bases);
  if (found === null) return false;
  try {
    const table = readPluginTable(found.dir);
    return table !== null && declaredSystemApps(table).length > 0;
  } catch {
    // A table that will not read declares nothing; the loader says why when it loads it.
    return false;
  }
}

/** Every module behind a system app this server's build ships. */
export async function systemAppModules(
  bases: readonly PluginBase[],
): Promise<PreinstalledModule[]> {
  const out: PreinstalledModule[] = [];
  for (const module of await preinstalledModules(bases)) {
    if (await isSystemAppModule(module.package, bases)) out.push(module);
  }
  return out;
}
