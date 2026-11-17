/**
 * The plugin index's sources, as a settings group: which `index.json` documents this
 * deployment reads, declared on `PluginConfigProvider.groups` like any module's settings,
 * drawn on the Settings dialog's Plugins page and stored under `plugin-config:plugin-index`,
 * so a save applies without a restart. The list is the whole configuration — no switch. The
 * release's published index sits on it by default (the declaration's default, read while
 * nothing is saved), and an emptied list reads the packages that ship with this server only,
 * no outbound request.
 *
 * The readers live where the listing and the install face already are: `IndexSources`
 * answers the ordered URL list per read, `PluginRegistryRoutes` and `InstalledPluginRoutes`
 * call it per request, and their per-URL caches make the actual fetches once per TTL.
 */
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import { PluginConfig } from "./config.js";

/** The group's name (its contribution id), the key its document is stored under. */
export const PLUGIN_INDEX_GROUP = "plugin-index";

@Interface()
export abstract class IndexSources {
  /** The configured source URLs in the order written; empty = builtin entries only. */
  abstract urls(): string[];
}

/** The sources one stored document answers: the list, in the order written; empty = none. */
export function indexUrlsOf(doc: Record<string, unknown>): string[] {
  const list = doc.sources;
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
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
          "The plugin catalogues this deployment lists and installs from: one index.json document per address, tried in the order written, the earlier address winning a package a later one also lists. The published index this release ships with is on the list by default; an emptied list reads the packages that ship with this server only, and no outbound request.",
        descriptionZh:
          "本部署列出与安装插件时读取的目录：每个地址一份 index.json，按书写顺序尝试，同一插件由更靠前的地址提供。随本版本发布的索引默认在列表里；清空列表则只列随本服务器内置的插件，且不发出任何网络请求。",
        properties: {
          sources: {
            type: "list",
            title: "Index addresses",
            titleZh: "索引地址",
            description:
              "The index.json documents to read, tried in the order written. The published index this release ships with is listed by default; remove it or add addresses as the deployment needs, or empty the list to read the shipped packages alone.",
            descriptionZh:
              "要读取的 index.json 地址，按书写顺序尝试。随本版本发布的索引默认在列表中：按部署需要删除或追加地址，或清空列表只读内置插件。",
            hint: "One http(s) URL per line.",
            hintZh: "每行一个 http(s) 地址。",
            default: [
              "https://github.com/Prism-Shadow/penguin-extensions/releases/download/nightly/index.json",
            ],
            pattern: "^https?://\\S+$",
            patternErrorMessage: "must be an http(s) URL",
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
