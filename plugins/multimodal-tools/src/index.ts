/**
 * @penguinharness/multimodal-tools — the Project's models as tools an Agent and the Web App call:
 * text generation, image understanding, web search, page fetching, image, video and speech
 * generation, and speech recognition, plus transcript editing for dictation.
 *
 * A plugin package over three platform primitives, nothing of it in the platform:
 *
 *   ToolModelBindingsProvider.bindings   one binding per operation (a `[tools]` key of the
 *                                        Project config), each judging which models can serve it
 *                                        (accepts.ts); image understanding reads the vision model
 *   ProjectModelRequests                 every model request, with its usage recorded under the
 *                                        purpose `@penguinharness/multimodal-tools:<operation>`
 *   PluginCliCommandsProvider.commands   `penguin tools …`, member commands with file exchange
 *                                        (cli.ts), which the Skill teaches an Agent
 *   HttpModule.routes                    the Web App's routes (routes.ts)
 *
 * Results belong to Sessions and live in the Project directory (store.ts), swept once their
 * Session is gone. Installing the plugin on an Agent brings its server module along (PRFC-0031).
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type { CliCommandCode } from "@prismshadow/penguin-core/cli";
import type { Hono } from "hono";
import { bindingCode, type BindingCode } from "./accepts.js";
import { cancelCommand, listCommand, operationCommand, statusCommand } from "./cli.js";
import {
  DataRoot,
  ModelBindings,
  ModelRequests,
  ProjectAccess,
  ProjectModels,
  SessionLookup,
} from "./host.js";
import { toolRoutes, type RouteEnv } from "./routes.js";
import { busySessions } from "./runs.js";
import { ToolStore } from "./store.js";
import { Tools } from "./tools.js";

/** How often the folders of Sessions that are gone are removed. */
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * The card, the Skill, the bindings, and the sweep of the folders whose Session is gone (at boot
 * and once a day).
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "multimodal-tools.card",
        title: "Multimodal tools",
        titleZh: "多模态工具",
        descriptionZh:
          "用项目绑定的模型生成文字、理解图片、搜索与读取网页、生成图像、视频和语音，以及转写录音；Agent 经 penguin tools 使用，生成的文件随会话保存。",
        shortDescription:
          "Generate text, read images, search and read the web, create images, video and speech, or transcribe recordings with the Project's models.",
        shortDescriptionZh:
          "用项目的模型生成文字、理解图片、搜索和读取网页、生成图像视频和语音或转写录音。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: true,
        quickStart: {
          prompt: "Create a square illustration of a penguin reading under a desk lamp.",
          promptZh: "生成一张方形插画，画一只在台灯下读书的企鹅。",
          skills: ["multimodal-tools"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "multimodal-tools.skill.main",
        name: "multimodal-tools",
        path: "skills/multimodal-tools",
      },
    ],
    "PluginLibraryModule.workbenches": [
      { id: "multimodal-tools.workbench.images", name: "images", path: "workbenches/images" },
    ],
    "ToolModelBindingsProvider.bindings": [
      {
        id: "multimodal-tools.binding.t2t",
        key: "t2t",
        title: { en: "Text generation", zh: "文本生成" },
      },
      {
        id: "multimodal-tools.binding.search",
        key: "search",
        title: { en: "Web search", zh: "网页搜索" },
      },
      {
        id: "multimodal-tools.binding.fetch",
        key: "fetch",
        title: { en: "Fetch a web page", zh: "读取网页" },
      },
      {
        id: "multimodal-tools.binding.t2i",
        key: "t2i",
        title: { en: "Image generation", zh: "图像生成" },
      },
      {
        id: "multimodal-tools.binding.t2v",
        key: "t2v",
        title: { en: "Video generation", zh: "视频生成" },
      },
      {
        id: "multimodal-tools.binding.t2s",
        key: "t2s",
        title: { en: "Speech synthesis", zh: "语音合成" },
      },
      {
        id: "multimodal-tools.binding.s2t",
        key: "s2t",
        title: { en: "Speech recognition", zh: "语音识别" },
      },
    ],
  },
})
export class MultimodalTools {
  @Use() private readonly root!: DataRoot;
  @Use() private readonly sessions!: SessionLookup;
  @Bind("multimodal-tools.binding.t2t") t2tBinding!: BindingCode;
  @Bind("multimodal-tools.binding.search") searchBinding!: BindingCode;
  @Bind("multimodal-tools.binding.fetch") fetchBinding!: BindingCode;
  @Bind("multimodal-tools.binding.t2i") t2iBinding!: BindingCode;
  @Bind("multimodal-tools.binding.t2v") t2vBinding!: BindingCode;
  @Bind("multimodal-tools.binding.t2s") t2sBinding!: BindingCode;
  @Bind("multimodal-tools.binding.s2t") s2tBinding!: BindingCode;

  setup(ctx: ClassCtx) {
    this.t2tBinding = bindingCode("t2t");
    this.searchBinding = bindingCode("search");
    this.fetchBinding = bindingCode("fetch");
    this.t2iBinding = bindingCode("t2i");
    this.t2vBinding = bindingCode("t2v");
    this.t2sBinding = bindingCode("t2s");
    this.s2tBinding = bindingCode("s2t");
    const { root } = this.root;
    const sessions = this.sessions;
    const sweep = () => {
      // A Session still running a tool keeps its folder until the next sweep.
      void sweepGone(root, sessions).catch((err: unknown) => {
        console.error(
          `[multimodal-tools] sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    };
    sweep();
    const timer = setInterval(sweep, SWEEP_EVERY_MS);
    timer.unref();
    ctx.effect(() => clearInterval(timer));
  }
}

/** Removes the stored results of every Session that no longer exists in its Project. */
async function sweepGone(root: string, sessions: SessionLookup): Promise<void> {
  await new ToolStore(root).sweep(
    (projectId, sessionId) => sessions.findById(sessionId)?.projectId === projectId,
    busySessions(),
  );
}

/** `penguin tools …`: one member command per operation, and list, status and cancel. */
@Component({
  contributes: {
    "PluginCliCommandsProvider.commands": [
      {
        id: "multimodal-tools.cli.t2t",
        key: "tools.t2t",
        summary: {
          en: "Generate text with the Project's text generation model",
          zh: "用项目的文本生成模型生成文字",
        },
        access: "member",
      },
      {
        id: "multimodal-tools.cli.i2t",
        key: "tools.i2t",
        summary: {
          en: "Read a local image with the Project's vision model",
          zh: "用项目的视觉模型读取本地图片",
        },
        access: "member",
        files: { read: ["--image"] },
      },
      {
        id: "multimodal-tools.cli.search",
        key: "tools.search",
        summary: {
          en: "Search the web with the Project's search model",
          zh: "用项目的搜索模型搜索网页",
        },
        access: "member",
      },
      {
        id: "multimodal-tools.cli.fetch",
        key: "tools.fetch",
        summary: {
          en: "Fetch a web page with the Project's fetch model",
          zh: "用项目的网页读取模型读取网页",
        },
        access: "member",
      },
      {
        id: "multimodal-tools.cli.t2i",
        key: "tools.t2i",
        summary: {
          en: "Generate an image with the Project's image model",
          zh: "用项目的图像模型生成图片",
        },
        access: "member",
        files: { write: "--out" },
      },
      {
        id: "multimodal-tools.cli.t2v",
        key: "tools.t2v",
        summary: {
          en: "Generate a video with the Project's video model",
          zh: "用项目的视频模型生成视频",
        },
        access: "member",
        files: { write: "--out" },
      },
      {
        id: "multimodal-tools.cli.t2s",
        key: "tools.t2s",
        summary: {
          en: "Synthesize speech with the Project's speech model",
          zh: "用项目的语音合成模型合成语音",
        },
        access: "member",
        files: { write: "--out" },
      },
      {
        id: "multimodal-tools.cli.s2t",
        key: "tools.s2t",
        summary: {
          en: "Transcribe a local recording with the Project's speech recognition model",
          zh: "用项目的语音识别模型转写本地录音",
        },
        access: "member",
        files: { read: ["--audio"] },
      },
      {
        id: "multimodal-tools.cli.list",
        key: "tools.list",
        summary: {
          en: "List the tools and the model each runs on in this Project",
          zh: "列出各工具及其在本项目中使用的模型",
        },
        access: "member",
      },
      {
        id: "multimodal-tools.cli.status",
        key: "tools.status",
        summary: {
          en: "Show a run of this Session, and save its files",
          zh: "查看本会话的任务，并保存其文件",
        },
        access: "member",
        files: { write: "--out" },
      },
      {
        id: "multimodal-tools.cli.cancel",
        key: "tools.cancel",
        summary: { en: "Stop a run of this Session", zh: "停止本会话的任务" },
        access: "member",
      },
    ],
  },
})
export class MultimodalToolCommands {
  @Use() private readonly requests!: ModelRequests;
  @Use() private readonly bindings!: ModelBindings;
  @Use() private readonly models!: ProjectModels;
  @Use() private readonly root!: DataRoot;
  @Bind("multimodal-tools.cli.t2t") t2tCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.i2t") i2tCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.search") searchCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.fetch") fetchCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.t2i") t2iCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.t2v") t2vCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.t2s") t2sCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.s2t") s2tCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.list") listCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.status") statusCli!: CliCommandCode;
  @Bind("multimodal-tools.cli.cancel") cancelCli!: CliCommandCode;

  setup() {
    const tools = new Tools({
      requests: this.requests,
      bindings: this.bindings,
      models: this.models,
      root: this.root.root,
    });
    const get = () => tools;
    this.t2tCli = operationCommand(get, "t2t");
    this.i2tCli = operationCommand(get, "i2t");
    this.searchCli = operationCommand(get, "search");
    this.fetchCli = operationCommand(get, "fetch");
    this.t2iCli = operationCommand(get, "t2i");
    this.t2vCli = operationCommand(get, "t2v");
    this.t2sCli = operationCommand(get, "t2s");
    this.s2tCli = operationCommand(get, "s2t");
    this.listCli = listCommand(get);
    this.statusCli = statusCommand(get);
    this.cancelCli = cancelCommand(get);
  }
}

/** The Web App's routes: runs, a Session's generated files, transcript editing. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "multimodal-tools.routes",
        prefix: "/api/projects/:projectId/multimodal-tools",
        auth: "user",
        order: 300,
      },
    ],
  },
})
export class MultimodalToolRoutes {
  @Use() private readonly requests!: ModelRequests;
  @Use() private readonly bindings!: ModelBindings;
  @Use() private readonly models!: ProjectModels;
  @Use() private readonly root!: DataRoot;
  @Use() private readonly access!: ProjectAccess;
  @Use() private readonly sessions!: SessionLookup;
  @Bind("multimodal-tools.routes") routes!: Hono<RouteEnv>;

  setup() {
    const tools = new Tools({
      requests: this.requests,
      bindings: this.bindings,
      models: this.models,
      root: this.root.root,
    });
    this.routes = toolRoutes({ tools: () => tools, access: this.access, sessions: this.sessions });
  }
}

const plugin: Plugin = { modules: [MultimodalTools, MultimodalToolCommands, MultimodalToolRoutes] };
export default plugin;
