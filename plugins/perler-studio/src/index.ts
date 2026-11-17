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
        id: "perler-studio.card",
        title: "Perler Studio",
        titleZh: "拼豆创作工作台",
        descriptionZh:
          "上传一张图片即可生成拼豆图纸：豆形网格、色号图例、每色颗数、拼板数量与成品尺寸，可导出 PNG、CSV、JSON 与打印页。",
        shortDescription: "Turn a picture into a bead pattern.",
        shortDescriptionZh: "把图片变成拼豆图纸，附色号图例与颗数统计。",
        // TODO: `learning-life` once the category exists (https://github.com/Prism-Shadow/penguin-harness/pull/1580).
        category: "office-productivity",
        icon: "icon.svg",
        // Installed from the library on demand: no Agent gets it at creation.
        preinstall: false,
        quickStart: {
          prompt:
            "In the Perler Studio workbench, make 40 the default pattern size and add a smiley face to the built-in samples. Tell me when to open the Perler Studio tab.",
          promptZh:
            "把拼豆创作工作台的默认图纸尺寸改成 40 格，并在内置示例里加一个笑脸图案。改好后告诉我打开「拼豆创作工作台」标签页。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "perler-studio.workbench.perler-studio",
        name: "perler-studio",
        path: "workbenches/perler-studio",
      },
    ],
  },
})
export class PerlerStudioPlugin {}

export default { modules: [PerlerStudioPlugin] } satisfies Plugin;
