import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "model-development.card",
        title: "Model Development",
        titleZh: "模型开发",
        descriptionZh:
          "在自己的硬件上做模型开发：用 LlamaFactory 微调、用 Ollama 运行本地模型、用 vLLM 部署服务。",
        shortDescription: "Fine-tune, run and serve models locally.",
        shortDescriptionZh: "本地微调、运行与部署模型。",
        category: "ai-app-development",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Check whether Ollama is installed on this machine. If it is, list the local models and show a request to one of them through the OpenAI-compatible endpoint. Do not pull any model without asking me.",
          promptZh:
            "检查这台机器上是否装了 Ollama。如果装了，列出本地模型，并演示通过 OpenAI 兼容端点向其中一个发请求。未经我同意不要拉取任何模型。",
          skills: ["ollama"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "model-development.skill.llamafactory",
        name: "llamafactory",
        path: "skills/llamafactory",
      },
      { id: "model-development.skill.ollama", name: "ollama", path: "skills/ollama" },
      { id: "model-development.skill.vllm", name: "vllm", path: "skills/vllm" },
    ],
  },
})
export class ModelDevelopmentPlugin {}

export default { modules: [ModelDevelopmentPlugin] } satisfies Plugin;
