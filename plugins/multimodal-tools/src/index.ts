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
          "通过项目绑定的模型搜索、读网页、生成图像或视频、识别和合成语音；在图像工作室预览会话生成的图片。",
        shortDescription:
          "Project search, media generation and speech tools, with an Image Studio.",
        shortDescriptionZh: "使用项目的搜索、媒体和语音模型，打开图像工作室查看作品。",
        category: "utilities",
        icon: "icon.svg",
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
  },
})
export class MultimodalToolsPlugin {}
export default { modules: [MultimodalToolsPlugin] } satisfies Plugin;
