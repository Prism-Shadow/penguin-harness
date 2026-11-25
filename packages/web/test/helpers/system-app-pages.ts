/**
 * System apps, Benchmark routes, the App Center and Agents pages: read from the features' own module declarations, the way the booted app's table is, so a
 * test sees exactly the apps those modules contribute. Each page draws nothing.
 */
import { moduleMetaOf, type Contributed, type ModuleClass } from "@prismshadow/penguin-core/kernel";
import { pageTableOf, type WebAppPage } from "../../src/web-app/page-table";
import { AgentsModule } from "../../src/features/agents/module";
import { AppCenterModule } from "../../src/features/app-center/module";
import { BenchmarkModule } from "../@prismshadow/penguin-library-observability/web/benchmark/module";
import { MachinesModule } from "../../src/features/machines/module";
import { ModelsModule } from "../../src/features/models/module";
import { PluginsModule } from "@prismshadow/penguin-library-plugin/web";
import { UsageModule } from "../@prismshadow/penguin-library-observability/web/usage/module";

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
