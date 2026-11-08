/**
 * The composition root: the one file that lists the module classes, the web app's counterpart
 * of the server's platform.ts. `bootWeb()` boots the tree once, before the first render
 * (main.tsx), and hands back the shell's root component — the routed app with every module's
 * contributions bound in.
 *
 * The manifests and interfaces come from `ifaces.json`, which scripts/gen-ifaces.mjs generates
 * from this package's sources (`pnpm gen:ifaces`; not committed). The tree parks nothing and
 * claims no live resource, so its resource registry is an empty one. Booting does no network
 * and takes a few milliseconds; the kernel and its arktype dependency are a fixed cost in the
 * entry bundle.
 */
import type { ComponentType } from "react";
import {
  bootModules,
  Module,
  moduleDefOf,
  type IfaceTable,
  type ManifestTable,
  type Resources,
} from "@prismshadow/penguin-core/kernel";

import table from "./ifaces.json";
import { WebAppModule, type WebApp } from "./web-app/module";

import type { AppRouterProps } from "./web-app/router";
import { SessionsModule } from "./state/sessions.module";
import { ChatModule } from "./features/chat/module";
import { AgentsModule } from "./features/agents/module";
import { ModelsModule } from "./features/models/module";
import { PluginsModule } from "./features/plugins/module";
import { MachinesModule } from "./features/machines/module";
import { UsageModule } from "./features/usage/module";
import { BenchmarkModule } from "./features/benchmark/module";
import { TerminalModule } from "./features/terminal/module";
import { WorkbenchesModule } from "./features/workbenches/module";
import { CompanyModule } from "./features/company/module";
import { BuiltinBrowserModule } from "./features/builtin-browser/module";
import { PaletteModule } from "./features/palette/module";
import { SettingsModule } from "./features/settings/module";
import { SchedulesModule } from "./features/schedules/module";

@Module({
  children: [
    WebAppModule,
    SessionsModule,
    ChatModule,
    AgentsModule,
    ModelsModule,
    PluginsModule,
    MachinesModule,
    UsageModule,
    BenchmarkModule,
    TerminalModule,
    WorkbenchesModule,
    CompanyModule,
    BuiltinBrowserModule,
    PaletteModule,
    SettingsModule,
    SchedulesModule,
  ],
})
export class WebRoot {}

const NO_RESOURCES: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

/** Boots the module tree and returns the component the app mounts. */
export async function bootWeb(): Promise<ComponentType<AppRouterProps>> {
  const tree = await bootModules(
    moduleDefOf(WebRoot, { manifests: table.modules as unknown as ManifestTable }),
    { ifaces: table as unknown as IfaceTable, resources: NO_RESOURCES },
  );
  return tree.api<WebApp>("WebAppModule", "webApp").Root;
}
