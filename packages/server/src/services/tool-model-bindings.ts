/**
 * Tool-model bindings: which configured model a plugin's tool uses in a Project — the
 * `ToolModelBindingsProvider.bindings` slot, the `ToolModelBindings` interface over it, and the
 * module that owns both.
 *
 * A plugin declares a binding the way it contributes anything: the `contributes` entry is the
 * data half (the `[tools]` key and its name per language), and the `@Bind(entry.id)` field the
 * code half — `accepts(model)`, which models can serve it. The Project's choice is one line of
 * `.project_config.toml`'s `[tools]` table, an open table core reads no key of; the platform keeps
 * it valid (a renamed model is followed, a removed one unbinds) and hands it to the machines with
 * the models. Which bindings exist, and what each one means, is the declaring plugin's.
 *
 * A declaration is dropped, with a warning naming it, when no loaded plugin package is behind its
 * module, when its key is not a binding key, or when an earlier one in load order already
 * declared the key: a key is one line of the file, so it has one name and one rule.
 *
 * A code half may also name its connection test: the request the models page's "Test connection"
 * sends a model the binding accepts, since a tool model refuses the chat probe (a speech
 * recognizer takes no text). Which request a model gets is the first declaring binding's, in load
 * order, that accepts it; a model no such binding accepts gets the chat probe.
 */
import { Hono } from "hono";
import { Bind, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Slot } from "@prismshadow/penguin-core/kernel";
import type {
  Access,
  ProjectConfigStore,
  ProjectEvents,
} from "@prismshadow/penguin-library-project";
import type { ToolModelBindingView } from "@prismshadow/penguin-library-model";
import type { ModelRefDto } from "@prismshadow/penguin-library-agent-api";
import type { ProjectModelRequest } from "@prismshadow/penguin-core";
import type { AppEnv } from "../auth/middleware.js";
import type { Hmr } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { Machines } from "../machines/service.js";
import { pluginHostFrom } from "../plugin/host.js";
import { toolModelBindingRoutes } from "../http/routes/tool-model-bindings.js";
import { modelModalities } from "./model-modalities.js";
import { toolBindingKeyFault } from "./tool-binding-key.js";

/** A binding's name, one per language — what the picker is labelled with. */
export interface ToolModelBindingTitle {
  en: string;
  zh: string;
}

/** The data half of one binding: the slot's data type. */
export interface ToolModelBindingData {
  /** The `[tools]` key: lowercase `[a-z][a-z0-9-]*`, at most 32 characters. */
  key: string;
  title: ToolModelBindingTitle;
}

/** A configured model as a binding's `accepts` sees it. */
export interface ToolModelCandidate {
  provider: string;
  modelId: string;
  /** The MMSP client the row runs on (its own, else its group's); absent when neither sets one. */
  clientType?: string;
  /** The row's `vision` annotation; absent = supported. */
  vision?: boolean;
  /**
   * The MMSP client a request to the row goes to: `clientType`, else the one its id's family routes
   * to (`openai-image`, `google-official` …); absent when MMSP cannot route it.
   */
  client?: string;
  /** What MMSP's registry says the model takes on that client (`Text`, `Image`, `Audio` …); absent when unlisted. */
  input?: string[];
  /** What MMSP's registry says the model returns on that client (`Text`, `Image`, `Web` …); absent when unlisted. */
  output?: string[];
}

/** A connection test request: the messages and config sent, and how long the test waits between events. */
export type ToolModelTestRequest = Pick<
  ProjectModelRequest,
  "messages" | "config" | "idleTimeoutMs"
>;

/** A model as the connection test names it: the draft's pair, its client type and its vision mark. */
export type ToolModelTestSubject = Pick<
  ToolModelCandidate,
  "provider" | "modelId" | "clientType" | "vision"
>;

/** The code half one binding binds. */
export interface ToolModelBindingCode {
  /** Whether a configured model can serve this binding: what the picker offers and a write takes. */
  accepts(model: ToolModelCandidate): boolean;
  /**
   * The cheapest request a model this binding accepts takes, which the connection test sends it.
   * Absent: such a model is tested with the chat probe (a short text prompt).
   */
  testRequest?(): ToolModelTestRequest;
}

export interface ToolModelBindingsSlots {
  /** A binding: its key and name here, its `accepts` bound by the contributor. */
  bindings: Slot<ToolModelBindingData, ToolModelBindingCode>;
}

/** What a plugin reads and the routes serve: the declared bindings and a Project's choices. */
@Interface()
export abstract class ToolModelBindings {
  /** Every declared binding, in load order, with this Project's model and its candidates. */
  abstract list(projectId: string): Promise<ToolModelBindingView[]>;
  /**
   * The model bound to `key` in this Project, or undefined: none is, or the one bound is no
   * longer configured. Reads the file's entry whether or not a loaded plugin declares the key.
   */
  abstract get(projectId: string, key: string): Promise<ModelRefDto | undefined>;
  /**
   * Binds a declared key, or with null unbinds it, and answers the list. An undeclared key is a
   * 404 `unknown_binding`; a model the Project does not configure a 400; one the binding does
   * not accept a 400 `model_not_accepted`.
   */
  abstract set(
    projectId: string,
    key: string,
    model: ModelRefDto | null,
  ): Promise<ToolModelBindingView[]>;
  /**
   * The request the connection test sends this model: the test request of the first binding, in
   * load order, that declares one and accepts the model; undefined when none does (the chat probe).
   * The model need not be configured yet — a draft is tested before it is saved.
   */
  abstract testRequest(model: ToolModelTestSubject): ToolModelTestRequest | undefined;
}

/** One declaration as the provider keeps it: attributed to its package, validated. */
export interface DeclaredBinding {
  readonly key: string;
  readonly title: ToolModelBindingTitle;
  readonly package: string;
  readonly code: ToolModelBindingCode;
}

/** A contribution as the slot delivered it, before it is attributed to a package. */
interface Collected {
  readonly id: string;
  readonly from: string;
  readonly key: string;
  readonly title: ToolModelBindingTitle;
  readonly code: ToolModelBindingCode;
}

/** Attributes each declaration to its package and drops what cannot stand (see the module comment). */
export function validBindings(
  collected: readonly Collected[],
  packageOf: (module: string) => string | undefined,
  warn: (line: string) => void,
): DeclaredBinding[] {
  const kept: DeclaredBinding[] = [];
  for (const c of collected) {
    const pkg = packageOf(c.from);
    const earlier = kept.find((b) => b.key === c.key);
    const why =
      pkg === undefined
        ? `module '${c.from}' declares a tool-model binding but no loaded plugin package is behind it`
        : (toolBindingKeyFault(c.key) ??
          (earlier !== undefined ? `'${earlier.package}' already declares '${c.key}'` : null));
    if (why !== null) {
      warn(`[tool-model-bindings] '${c.from}' contribution '${c.id}' skipped: ${why}`);
      continue;
    }
    kept.push({ key: c.key, title: c.title, package: pkg!, code: c.code });
  }
  return kept;
}

/** Whether a binding accepts a model; a code half that throws accepts nothing. */
function accepts(binding: DeclaredBinding, model: ToolModelCandidate): boolean {
  try {
    return binding.code.accepts(model) === true;
  } catch (err) {
    console.warn(
      `[tool-model-bindings] '${binding.package}' binding '${binding.key}' failed to judge a model: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** A binding's test request; a code half that throws declares none for this call. */
function testRequestOf(binding: DeclaredBinding): ToolModelTestRequest | undefined {
  try {
    return binding.code.testRequest?.();
  } catch (err) {
    console.warn(
      `[tool-model-bindings] '${binding.package}' binding '${binding.key}' failed to build its test request: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/** The bindings over a Project config store, for a list of declarations read per call. */
export function toolModelBindingsOver(
  projectConfig: Pick<ProjectConfigStore, "getModels" | "getToolModels" | "setToolModel">,
  declared: () => DeclaredBinding[],
): ToolModelBindings {
  const candidatesOf = async (projectId: string): Promise<ToolModelCandidate[]> =>
    (await projectConfig.getModels(projectId)).models.map((info) => ({
      provider: info.provider,
      modelId: info.modelId,
      ...(info.effective.clientType !== undefined ? { clientType: info.effective.clientType } : {}),
      ...(info.vision !== undefined ? { vision: info.vision } : {}),
      ...modelModalities(info.modelId, info.effective.clientType),
    }));
  const list = async (projectId: string): Promise<ToolModelBindingView[]> => {
    const bindings = declared();
    if (bindings.length === 0) return [];
    const [models, bound] = await Promise.all([
      candidatesOf(projectId),
      projectConfig.getToolModels(projectId),
    ]);
    return bindings.map((binding) => {
      const model = bound[binding.key];
      return {
        key: binding.key,
        title: binding.title,
        package: binding.package,
        ...(model !== undefined ? { model } : {}),
        candidates: models
          .filter((candidate) => accepts(binding, candidate))
          .map(({ provider, modelId }) => ({ provider, modelId })),
      };
    });
  };
  return {
    list,
    get: async (projectId, key) => (await projectConfig.getToolModels(projectId))[key],
    set: async (projectId, key, model) => {
      const binding = declared().find((b) => b.key === key);
      if (binding === undefined) {
        throw new HttpError(
          404,
          "unknown_binding",
          `No enabled plugin declares the tool-model binding '${key.slice(0, 64)}'.`,
        );
      }
      if (model !== null) {
        const candidate = (await candidatesOf(projectId)).find(
          (m) => m.provider === model.provider && m.modelId === model.modelId,
        );
        if (candidate !== undefined && !accepts(binding, candidate)) {
          throw new HttpError(
            400,
            "model_not_accepted",
            `The binding '${key}' does not accept the model (provider=${model.provider}, model_id=${model.modelId}).`,
          );
        }
        // A model that is not configured at all is the store's 400, written in its words.
      }
      await projectConfig.setToolModel(projectId, key, model);
      return list(projectId);
    },
    testRequest: (model) => {
      const candidate: ToolModelCandidate = {
        ...model,
        ...modelModalities(model.modelId, model.clientType),
      };
      for (const binding of declared()) {
        if (binding.code.testRequest === undefined || !accepts(binding, candidate)) continue;
        const request = testRequestOf(binding);
        if (request !== undefined) return request;
      }
      return undefined;
    },
  };
}

import { endpointOf } from "../http/app.js";

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
        id: "model.toolBindings.list",
        method: "GET",
        prefix: "/api/projects/:projectId/models/tool-bindings",
        auth: "user",
        role: "model.read",
        // Before the models group (100), whose prefix is this one's parent.
        order: 99,
      },
      {
        id: "model.toolBindings.update",
        method: "PATCH",
        prefix: "/api/projects/:projectId/models/tool-bindings",
        auth: "user",
        role: "model.maintain",
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
  @Bind("model.toolBindings.list") listRoute!: Hono<AppEnv>;
  @Bind("model.toolBindings.update") updateRoute!: Hono<AppEnv>;

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
    const group = toolModelBindingRoutes({
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
    this.listRoute = endpointOf(group, "GET", "/");
    this.updateRoute = endpointOf(group, "PATCH", "/");
  }
}
