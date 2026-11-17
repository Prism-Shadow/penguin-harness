/**
 * The download area, as one settings group: the card on the Settings dialog's Plugins page
 * that gathers everything about where plugins come from — the npm registry the installer
 * runs against, the index.json documents this deployment reads, and the CDN mirrors tried
 * after each source's own URL. Declared on `PluginConfigProvider.groups` like any module's
 * settings; it holds no fields of its own — the three sections on the card are the groups
 * that name it their `parent` (source-settings, index-config, mirror-settings), each drawn
 * under its own title and saved under its own key (`plugin-config:plugin-sources`,
 * `plugin-config:plugin-index`, `plugin-config:plugin-mirrors`), so a document saved before
 * this card existed reads exactly as it did. The card sits ahead of everything else on the
 * page (order 0).
 *
 * The parent itself is never saved: a save writes one section's key, the way any child of a
 * card is saved.
 */
import { Component } from "@prismshadow/penguin-core/kernel";

/** The group's name (its contribution id), the card the three sections draw inside. */
export const DOWNLOAD_AREA_GROUP = "download-area";

@Component({
  contributes: {
    "PluginConfigProvider.groups": [
      {
        // Written out, not named from a constant: a contribution is data the host reads
        // without running the package.
        id: DOWNLOAD_AREA_GROUP,
        // Ahead of everything on the Plugins page: where plugins come from is the page's
        // first question; the sandbox's group and the rest follow.
        order: 0,
        title: "Download Area",
        titleZh: "下载区",
        description:
          "Where plugins come from: the npm registry packages install from, the plugin catalogues this deployment lists and installs from, and the mirrors tried when those are unreachable. Each section below saves separately.",
        descriptionZh:
          "插件从哪里来：安装包的 npm registry、本部署读取与安装插件的目录，以及这些地址不可达时尝试的镜像。下面各节分开保存。",
        properties: {},
      },
    ],
  },
})
export class DownloadAreaSettings {}
