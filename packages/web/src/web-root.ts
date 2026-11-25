import { MainSidebarBadgesModule } from "./features/models/main-sidebar-badges.module";
/**
 * The composition root: the one file that lists the module classes, the web app's counterpart
 * of the server's platform.ts. `bootWeb()` boots the tree once, before the first render
 * (main.tsx), and hands back WebApp's root component — the routed app with every module's
 * contributions bound in. The shipped plugins' web halves boot beside the app's own modules as
 * further children of the root (plugin-web.gen.ts, the list scripts/gen-web-table.mjs writes
 * from this package's dependencies), after the app has handed its implementations to the face
 * they import (web-app/plugin-host.ts).
 *
 * The manifests and interfaces come from `ifaces.json`, which the same script generates from
 * this package's sources and those web halves together (`pnpm gen:ifaces`; neither file is
 * committed). The tree parks nothing and claims no live resource, so its resource registry is an
 * empty one. Booting does no network and takes a few milliseconds; the kernel and its arktype
 * dependency are a fixed cost in the entry bundle.
 */
import "./web-app/plugin-host";
import type { ComponentType } from "react";
import {
  bootModules,
  Module,
  moduleDefOf,
  type IfaceTable,
  type ManifestTable,
  type ModuleClass,
  type ModuleDef,
  type Resources,
} from "@prismshadow/penguin-core/kernel";

import table from "./ifaces.json";
import { pluginWebModules, type PluginWebEntry } from "./plugin-web.gen";
import { WebAppModule, type WebApp } from "./web-app/module";

import { SidebarModule } from "./web-app/sidebar/module";
import type { AppRouterProps } from "./web-app/router";
import { SessionsModule } from "./state/sessions.module";
import { ChatModule } from "./features/chat/module";
import { AgentsModule } from "./features/agents/module";
import { AppCenterModule } from "./features/app-center/module";
import { ModelsModule } from "./features/models/module";
import { PluginsModule } from "./features/plugins/module";
import { MachinesModule } from "./features/machines/module";
import { BenchmarkModule, UsageModule } from "@prismshadow/penguin-library-observability/web";
import { TerminalModule } from "./features/terminal/module";
import { WorkbenchesModule } from "./features/workbenches/module";
import { CompanyModule } from "./features/company/module";
import { SettingsModule } from "@prismshadow/penguin-library-setting/web";
import { SchedulesModule } from "./features/schedules/module";
import { SessionListModule } from "./features/session-list/module";
import { ProjectsModule } from "./features/projects/module";
import { MessagingModule } from "./features/messaging/module";
import { DockModule } from "./features/dock/module";
import { WorkspaceModule } from "./features/workspace/module";
import { TracesModule } from "./features/traces/module";
import { AudioModule } from "./features/audio/module";

@Module({
  children: [
    WebAppModule,
    SidebarModule,
    MainSidebarBadgesModule,
    SessionsModule,
    ChatModule,
    AgentsModule,
    AppCenterModule,
    ModelsModule,
    PluginsModule,
    MachinesModule,
    UsageModule,
    BenchmarkModule,
    TerminalModule,
    WorkbenchesModule,
    CompanyModule,
    SettingsModule,
    SchedulesModule,
    SessionListModule,
    ProjectsModule,
    MessagingModule,
    DockModule,
    WorkspaceModule,
    TracesModule,
    AudioModule,
  ],
})
export class WebRoot {}

const NO_RESOURCES: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

/**
 * The tree `bootWeb()` boots: the app's own modules and, as further children of the root, every
 * module of every listed plugin web half, each checked against the one generated table. A suite
 * passes `instances`, pre-built nodes standing in for their classes (its doubles), and `manifests`,
 * the test table (test/ifaces.json) when it boots a module of its own.
 */
export function webRootDef(
  plugins: readonly PluginWebEntry[] = pluginWebModules,
  options: { instances?: ReadonlyMap<ModuleClass, object>; manifests?: ManifestTable } = {},
): ModuleDef {
  const manifests = options.manifests ?? (table.modules as unknown as ManifestTable);
  return moduleDefOf(WebRoot, {
    manifests,
    ...(options.instances !== undefined ? { instances: options.instances } : {}),
    extra: plugins.flatMap((entry) =>
      entry.plugin.modules.map((cls) => moduleDefOf(cls, { manifests })),
    ),
  });
}

/** Boots the module tree and returns the component the app mounts. */
export async function bootWeb(
  plugins: readonly PluginWebEntry[] = pluginWebModules,
): Promise<ComponentType<AppRouterProps>> {
  const tree = await bootModules(webRootDef(plugins), {
    ifaces: table as unknown as IfaceTable,
    resources: NO_RESOURCES,
  });
  return tree.api<WebApp>("WebAppModule", "webApp").Root;
}
