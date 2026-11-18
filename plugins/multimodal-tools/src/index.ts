import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "multimodal-tools.card",
        title: "Multimodal tools",
        titleZh: "多模态工具",
        descriptionZh: "通过项目绑定的模型搜索与读取网页、生成图像和视频、转写录音和合成语音。",
        shortDescription:
          "Search and read the web, create images and videos, transcribe recordings or synthesize speech.",
        shortDescriptionZh: "搜索和读取网页、生成图像和视频、转写录音或合成语音。",
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
      { id: "multimodal.search", key: "search", title: { en: "Web search", zh: "网页搜索" } },
      { id: "multimodal.fetch", key: "fetch", title: { en: "Fetch a web page", zh: "读取网页" } },
      { id: "multimodal.image", key: "image", title: { en: "Image generation", zh: "图像生成" } },
      { id: "multimodal.video", key: "video", title: { en: "Video generation", zh: "视频生成" } },
      { id: "multimodal.stt", key: "stt", title: { en: "Speech recognition", zh: "语音识别" } },
      { id: "multimodal.tts", key: "tts", title: { en: "Speech synthesis", zh: "语音合成" } },
    ],
  },
})
export class MultimodalToolsPlugin {}
export default { modules: [MultimodalToolsPlugin] } satisfies Plugin;
