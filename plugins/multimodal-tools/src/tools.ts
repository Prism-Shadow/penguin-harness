/**
 * The operations over the host: which model runs one in a Project, its request built and checked,
 * the run started. The CLI commands and the routes both go through here, so an operation behaves
 * the same whichever surface asked for it.
 */
import { routedClientType } from "@prismshadow/mmsp/credentials";
import type { ModelBindings, ModelRef, ModelRequests, ProjectModels } from "./host.js";
import { ToolError } from "./errors.js";
import { DEEPSEEK_TRANSCRIPTION_CLIENT, requireDeepSeekAudio } from "./deepseek-audio.js";
import {
  bindingOf,
  OPERATIONS,
  operationRequest,
  PACKAGE,
  resultOf,
  type Operation,
  type OperationInput,
} from "./operations.js";
import { Polish } from "./polish.js";
import { Runs, type Finished, type RunRecord } from "./runs.js";
import { TEXT_BINDING, textModel } from "./text-model.js";
import { ToolStore } from "./store.js";

/** One operation as `penguin tools list` shows it: the model it runs on in this Project. */
export interface OperationView {
  operation: Operation;
  title: { en: string; zh: string };
  /**
   * `binding`: a `[tools]` key; `vision`: the Project's vision model; `default`: text generation
   * with nothing bound, on the Project's default chat model (text-model.ts).
   */
  via: "binding" | "vision" | "default";
  model?: ModelRef;
}

const VISION_TITLE = { en: "Image understanding (the vision model)", zh: "图片理解（视觉模型）" };

export interface ToolsHost {
  requests: ModelRequests;
  bindings: ModelBindings;
  models: ProjectModels;
  root: string;
}

export class Tools {
  readonly store: ToolStore;
  readonly runs: Runs;
  readonly polish: Polish;

  constructor(private readonly host: ToolsHost) {
    this.store = new ToolStore(host.root);
    this.runs = new Runs(host.requests, this.store);
    this.polish = new Polish(host.requests, host.bindings, host.models, this.store);
  }

  /** The model an operation runs on in a Project; a 409 naming what to set when there is none. */
  async modelFor(projectId: string, op: Operation): Promise<ModelRef> {
    const key = bindingOf(op);
    if (key === undefined) {
      const { visionModel } = await this.host.models.getModels(projectId);
      if (visionModel === undefined) {
        throw new ToolError(
          409,
          "model_unbound",
          "This Project has no vision model: choose one in the model settings to read images.",
        );
      }
      return visionModel;
    }
    const model =
      key === TEXT_BINDING
        ? (await textModel(this.host.bindings, this.host.models, projectId))?.model
        : await this.host.bindings.get(projectId, key);
    if (model === undefined) {
      const title =
        (await this.host.bindings.list(projectId)).find(
          (b) => b.key === key && b.package === PACKAGE,
        )?.title.en ?? key;
      throw new ToolError(
        409,
        "model_unbound",
        key === TEXT_BINDING
          ? `No model is bound to ${title} and this Project has no default chat model: bind one, or set the default chat model, in the model settings.`
          : `No model is bound to ${title} in this Project: bind one in the model settings.`,
      );
    }
    return model;
  }

  /** Builds, checks and starts one run; a 400, 409 or 415 before anything is sent. */
  async start(
    projectId: string,
    sessionId: string | undefined,
    op: Operation,
    input: OperationInput,
  ): Promise<{ record: RunRecord; done: Promise<Finished> }> {
    const { messages, config } = operationRequest(op, input);
    const model = await this.modelFor(projectId, op);
    if (
      op === "s2t" &&
      input.audio !== undefined &&
      (await this.routedClient(projectId, model)) === DEEPSEEK_TRANSCRIPTION_CLIENT
    ) {
      requireDeepSeekAudio(input.audio);
    }
    return this.runs.start({
      projectId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      operation: op,
      result: resultOf(op),
      model,
      messages,
      config,
    });
  }

  /** Every operation with the model it runs on in the Project. */
  async operations(projectId: string): Promise<OperationView[]> {
    const [bindings, table] = await Promise.all([
      this.host.bindings.list(projectId),
      this.host.models.getModels(projectId),
    ]);
    return OPERATIONS.map((operation): OperationView => {
      const key = bindingOf(operation);
      if (key === undefined) {
        return {
          operation,
          title: VISION_TITLE,
          via: "vision",
          ...(table.visionModel !== undefined ? { model: table.visionModel } : {}),
        };
      }
      const binding = bindings.find((b) => b.key === key && b.package === PACKAGE);
      const title = binding?.title ?? { en: key, zh: key };
      if (
        key === TEXT_BINDING &&
        binding?.model === undefined &&
        table.defaultModel !== undefined
      ) {
        return { operation, title, via: "default", model: table.defaultModel };
      }
      return {
        operation,
        title,
        via: "binding",
        ...(binding?.model !== undefined ? { model: binding.model } : {}),
      };
    });
  }

  /** The MMSP client a request to a configured model goes to. */
  private async routedClient(projectId: string, model: ModelRef): Promise<string | null> {
    const row = (await this.host.models.getModels(projectId)).models.find(
      (m) => m.provider === model.provider && m.modelId === model.modelId,
    );
    return routedClientType(model.modelId, row?.effective.clientType ?? null);
  }
}
