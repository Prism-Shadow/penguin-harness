/**
 * System apps, Benchmark routes, the App Center and Agents pages: read from the features' own module declarations, the way the booted app's table is, so a
 * test sees exactly the apps those modules contribute. Each page draws nothing.
 */
import { moduleMetaOf, type Contributed, type ModuleClass } from "@prismshadow/penguin-core/kernel";
import { pageTableOf, type WebAppPage } from "../../src/web-app/page-table";
import { AgentsModule } from "@prismshadow/penguin-library-agent/web/agents/module";
import { AppCenterModule } from "../../src/features/app-center/module";
import { BenchmarkModule } from "../../src/features/benchmark/module";
import { MachinesModule } from "../../src/features/machines/module";
import { ModelsModule } from "@prismshadow/penguin-library-model/web/models/module";
import { PluginsModule } from "../../src/features/plugins/module";
import { UsageModule } from "../../src/features/usage/module";

/** The pages the given modules contribute, as the shell's table holds them. */
export function pagesOf(...modules: ModuleClass[]): readonly WebAppPage[] {
  const contributions: Contributed[] = modules.flatMap((module) => {
    const meta = moduleMetaOf(module);
    return (meta.contributes?.["WebAppModule.pages"] ?? []).map((data) => ({
      id: data.id,
      from: meta.name,
      data,
      code: () => null,
    }));
  });
  return pageTableOf(contributions);
}

export const SYSTEM_APP_PAGES = pagesOf(
  AgentsModule,
  AppCenterModule,
  ModelsModule,
  PluginsModule,
  MachinesModule,
  UsageModule,
  BenchmarkModule,
);
