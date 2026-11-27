/**
 * The tool-model bindings assembly. The vocabulary, the interface and the binding logic moved to
 * the model domain package (@prismshadow/penguin-library-model/tool-model-bindings,
 * services+http+cli restack S13) — they speak only library vocabulary: the bindings over a
 * structural config port, the slot's types and the declaration validation. This file keeps the
 * assembly: the Provider reads the declarations off the kernel slot, attributes them to the
 * packages of the server's plugin host, and hands the service the Project config store, the
 * access checks, the machines and the Project events (server-owned mechanisms); it re-exports
 * the moved shapes for the server's own import paths.
 */
import { Hono } from "hono";
import { Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  Access,
  ProjectConfigStore,
  ProjectEvents,
} from "@prismshadow/penguin-library-project";
import type { AppEnv } from "../auth/middleware.js";
import type { Hmr } from "../hmr/capabilities.js";
import type { Machines } from "../machines/service.js";
import { pluginHostFrom } from "../plugin/host.js";
import { toolModelBindingRoutes } from "../http/routes/tool-model-bindings.js";
import {
  ToolModelBindings,
  toolModelBindingsOver,
  validBindings,
} from "@prismshadow/penguin-library-model/tool-model-bindings";
import type {
  Collected,
  DeclaredBinding,
  ToolModelBindingCode,
  ToolModelBindingTitle,
} from "@prismshadow/penguin-library-model/tool-model-bindings";

export {
  ToolModelBindings,
  toolModelBindingsOver,
  validBindings,
} from "@prismshadow/penguin-library-model/tool-model-bindings";
export type {
  Collected,
  DeclaredBinding,
  ToolModelBindingCode,
  ToolModelBindingData,
  ToolModelBindingsConfig,
  ToolModelBindingsSlots,
  ToolModelBindingTitle,
  ToolModelCandidate,
  ToolModelTestRequest,
  ToolModelTestSubject,
} from "@prismshadow/penguin-library-model/tool-model-bindings";

/**
 * Owns the slot; provides the interface and serves it at `/api/projects/:projectId/models/
 * tool-bindings`. The declarations are read off the slot at boot; each call attributes them to
 * the packages of the plugin host as it is then (the host registers its plugins when the
 * generation commits, after this tree booted).
 */
@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "ToolModelBindingsProvider.routes",
        prefix: "/api/projects/:projectId/models/tool-bindings",
        auth: "user",
        // Before the models group (100), whose prefix is this one's parent.
        order: 99,
      },
    ],
  },
})
export class ToolModelBindingsProvider {
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly access!: Access;
  @Use() private readonly machines!: Machines;
  @Use() private readonly projectEvents!: ProjectEvents;
  @Provide() toolModelBindings!: ToolModelBindings;
  @Bind("ToolModelBindingsProvider.routes") routes!: Hono<AppEnv>;

  setup({ contributions }: ClassCtx) {
    // The kernel checked each entry against the slot's data type at boot, and resolved every
    // code half by its id.
    const collected: Collected[] = (contributions.bindings ?? []).map((c) => ({
      id: c.id,
      from: c.from,
      key: c.data.key as string,
      title: c.data.title as unknown as ToolModelBindingTitle,
      code: c.code as ToolModelBindingCode,
    }));
    const declared = (): DeclaredBinding[] => {
      const packageOf = new Map<string, string>();
      for (const entry of pluginHostFrom(this.hmr.resources).entries().values()) {
        for (const module of entry.modules) packageOf.set(module.manifest.name, entry.specifier);
      }
      return validBindings(
        collected,
        (module) => packageOf.get(module),
        (line) => console.warn(line),
      );
    };
    this.toolModelBindings = toolModelBindingsOver(this.projectConfig, declared);
    this.routes = toolModelBindingRoutes({
      bindings: this.toolModelBindings,
      access: this.access,
      changed: (projectId) => {
        this.projectEvents.notifyProjectUsers(projectId, {
          type: "tool_bindings_changed",
          projectId,
        });
        // The machines this Project uses run its tools against their own copy of the table.
        void this.machines.syncConfigEverywhere(projectId);
      },
    });
  }
}
