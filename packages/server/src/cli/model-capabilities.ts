import type { DatabaseSync } from "node:sqlite";
import { modelOperation, type ToolModelKey, effectivePluginTable } from "@prismshadow/penguin-core";
import { Interface, Module, Provide, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { AvailableCapability, ModelOperation as Capability } from "../api/capabilities.js";
import { MachinesRepo } from "../db/repos/machines.js";
import type { Db, Hmr } from "../hmr/capabilities.js";
import { ProjectConfigStore } from "../mechanisms/projects.js";
import { pluginHostFrom } from "../plugin/host.js";

@Interface()
export abstract class ModelCapabilities {
  abstract list(projectId: string): Promise<AvailableCapability<Capability>[]>;
}

/** Data-only slot: declaring an MMSP operation never gives the package model credentials. */
export interface ModelCapabilitiesSlots {
  capabilities: { key: ToolModelKey | Capability; title: { en: string; zh: string } };
}

@Module()
export class ModelCapabilitiesProvider {
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly db!: Db;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Provide() modelCapabilities!: ModelCapabilities;
  setup({ contributions }: ClassCtx) {
    const machineId = new MachinesRepo(this.db as unknown as DatabaseSync).ownId();
    this.modelCapabilities = {
      list: async (projectId) => {
        const enabled = effectivePluginTable(
          await this.projectConfig.getPluginTables(projectId),
          machineId,
        );
        // Like plugin CLI commands, attribute the current generation's contributions to their
        // loaded modules at request time. The process loads the union of all Projects' packages.
        const entries = pluginHostFrom(this.hmr.resources).entries();
        const available = new Map<Capability, AvailableCapability<Capability>>();
        for (const specifier of Object.keys(enabled)) {
          const entry = entries.get(specifier);
          if (!entry) continue;
          const names = new Set(entry.modules.map((m) => m.manifest.name));
          for (const c of contributions.capabilities ?? []) {
            if (!names.has(c.from)) continue;
            const key = typeof c.data.key === "string" ? modelOperation(c.data.key) : undefined;
            const title = c.data.title as AvailableCapability["title"] | undefined;
            if (
              !key ||
              typeof title?.en !== "string" ||
              !title.en.trim() ||
              typeof title.zh !== "string" ||
              !title.zh.trim()
            )
              continue;
            if (!available.has(key))
              available.set(key, {
                key,
                title: { en: title.en, zh: title.zh },
                package: specifier,
              });
          }
        }
        return [...available.values()];
      },
    };
  }
}
