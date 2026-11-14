/**
 * The plugin index's sources, as a settings group: which `index.json` documents this
 * deployment reads, declared on `PluginConfigProvider.groups` like any module's settings,
 * drawn on the Settings dialog's Plugins page and stored under `plugin-config:plugin-index`,
 * so a save applies without a restart. With nothing saved the deployment reads the published
 * index beside the builtin entries — the behavior a source list, including the empty one
 * (builtin entries only, the switch-off reading), is written over.
 *
 * The readers live where the listing and the install face already are: `IndexSources`
 * answers the ordered URL list per read, `PluginRegistryRoutes` and `InstalledPluginRoutes`
 * call it per request, and their per-URL caches make the actual fetches once per TTL.
 */
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import { PluginConfig } from "./config.js";
import { NIGHTLY_INDEX_URL } from "./registry.js";

/** The group's name (its contribution id), the key its document is stored under. */
export const PLUGIN_INDEX_GROUP = "plugin-index";

@Interface()
export abstract class IndexSources {
  /** The configured source URLs in the order written; empty = builtin entries only. */
  abstract urls(): string[];
}

/** The sources one stored document answers: the switch, then the list. */
export function indexUrlsOf(doc: Record<string, unknown>): string[] {
  if (doc.published === false) return [];
  const list = doc.sources;
  if (!Array.isArray(list) || list.length === 0) return [NIGHTLY_INDEX_URL];
  return list.filter((v): v is string => typeof v === "string");
}

/** Declares the group the Settings dialog draws; nothing reads it here. */
@Component({
  contributes: {
    "PluginConfigProvider.groups": [
      {
        id: "plugin-index",
        title: "Plugin index",
        titleZh: "插件索引",
        description:
          "The plugin catalogues this deployment lists and installs from: one index.json document per address, tried in the order written, the earlier address winning a package a later one also lists. Clearing every address lists the packages that ship with this server only; the integrity hash an entry is installed by comes from the entry itself, so adding an address adds no way around it.",
        descriptionZh:
          "本部署列出与安装插件时读取的目录：每个地址一份 index.json，按书写顺序尝试，同一插件由更靠前的地址提供。清空全部地址则只列出随本服务器内置的插件；安装校验用的是条目自带的完整性哈希，添加地址不产生绕过它的路径。",
        switch: "published",
        properties: {
          published: {
            type: "boolean",
            title: "Read published indexes",
            titleZh: "读取已发布的索引",
            description:
              "Whether anything beyond the packages that ship with this server lists at all. On: the addresses below — without one, the published index this release ships with. Off: the shipped packages alone, and no outbound request.",
            descriptionZh:
              "是否在本部署列出内置插件以外的来源。打开：读下方地址；未填地址时读随本版本发布的索引。关闭：只列内置插件，不发出任何网络请求。",
            default: true,
          },
          sources: {
            type: "list",
            advanced: true,
            title: "Index addresses",
            titleZh: "索引地址",
            description:
              "The index.json documents to read, tried in the order written. Leave empty to read the published index this release ships with.",
            descriptionZh:
              "要读取的 index.json 地址，按书写顺序尝试。留空则读取随本版本发布的索引。",
            hint: "One https URL per line.",
            hintZh: "每行一个 https 地址。",
            pattern: "^https://\\S+$",
            patternErrorMessage: "must be an https URL",
          },
        },
      },
    ],
  },
})
export class PluginIndexSettings {}

/** The `IndexSources` reader: the group read per call, so a save answers the next read at once. */
@Component()
export class StoredIndexSources implements IndexSources {
  @Use() private readonly pluginConfig!: PluginConfig;
  urls(): string[] {
    return indexUrlsOf(this.pluginConfig.get(PLUGIN_INDEX_GROUP));
  }
}
