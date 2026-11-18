import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "multimodal-tools.card",
        title: "Multimodal tools",
        titleZh: "多模态工具",
        descriptionZh:
          "通过项目绑定的模型生成文字、理解图片、搜索与读取网页、生成图像和视频、转写录音和合成语音。",
        shortDescription:
          "Generate text, understand images, search and read the web, create images and videos, transcribe recordings or synthesize speech.",
        shortDescriptionZh:
          "生成文字、理解图片、搜索和读取网页、生成图像和视频、转写录音或合成语音。",
        category: "utilities",
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
    "ModelCapabilitiesProvider.capabilities": [
      { id: "multimodal.t2t", key: "t2t", title: { en: "Text generation", zh: "文本生成" } },
      { id: "multimodal.i2t", key: "i2t", title: { en: "Image understanding", zh: "图片理解" } },
      { id: "multimodal.search", key: "search", title: { en: "Web search", zh: "网页搜索" } },
      { id: "multimodal.fetch", key: "fetch", title: { en: "Fetch a web page", zh: "读取网页" } },
      { id: "multimodal.t2i", key: "t2i", title: { en: "Image generation", zh: "图像生成" } },
      { id: "multimodal.t2v", key: "t2v", title: { en: "Video generation", zh: "视频生成" } },
      { id: "multimodal.s2t", key: "s2t", title: { en: "Speech recognition", zh: "语音识别" } },
      { id: "multimodal.t2s", key: "t2s", title: { en: "Speech synthesis", zh: "语音合成" } },
    ],
  },
})
export class MultimodalToolsPlugin {}
export default { modules: [MultimodalToolsPlugin] } satisfies Plugin;
