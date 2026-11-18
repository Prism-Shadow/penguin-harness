/**
 * Where the plugins install from, as a settings group: the npm registry `npm install` runs
 * against is declared on `PluginConfigProvider.groups` like any module's settings, drawn on
 * the Settings dialog's Plugins page and stored under `plugin-config:plugin-sources`, so a
 * restart keeps it. The published index's CDN mirrors have their own group
 * (plugin/mirror-settings.ts); this group is what a user — not a deployer — reaches.
 *
 * `PluginSourceSettings` declares the group and applies what is stored to the installer —
 * on boot and after every save (the watch, so an edit lands without a restart). The default
 * is npm's official registry: unset, nothing is passed to npm and its own configuration
 * stands, exactly as before this group existed.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { PluginConfig } from "../plugin/config.js";
import { setNpmRegistry } from "./install.js";

/** The group's name (its contribution id), and what the stored document is keyed by. */
export const PLUGIN_SOURCES_GROUP = "plugin-sources";

/** The registry URL a stored choice names; undefined passes nothing to npm. */
export function npmRegistryOf(value: unknown): string | undefined {
  if (value === "official" || value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && /^https:\/\/[^\s/]+/.test(value)) {
    return value;
  }
  return undefined;
}

@Component({
  contributes: {
    "PluginConfigProvider.groups": [
      {
        // Written out, not named from a constant: a contribution is data the host reads
        // without running the package.
        id: "plugin-sources",
        // Leads the Plugins page (order 0): where plugins are listed and installed from comes
        // first; the index's addresses and the mirrors sit inside this card (order 1–2), and
        // the sandbox's card follows.
        order: 0,
        title: "Plugin Sources",
        titleZh: "插件源",
        description:
          "Where plugins are listed and installed from: the npm registry packages install from, the plugin catalogues this deployment reads, and the mirrors tried when those are unreachable.",
        descriptionZh:
          "列出与安装插件的来源：安装包的 npm registry、本部署读取的插件目录，以及这些地址不可达时尝试的镜像。",
        properties: {
          npmRegistry: {
            type: "enum",
            title: "npm registry",
            titleZh: "npm registry",
            description:
              "Where npm fetches plugin packages and their dependencies from. The official registry is the default; a mirror helps where it is unreachable or slow. A change applies to the next install.",
            descriptionZh:
              "npm 从哪里拉取插件包及其依赖。官方 registry 是默认值；在不可达或缓慢的环境里镜像有帮助。改动对下一次安装生效。",
            // Written out, not spread from a constant: a contribution is data the host reads
            // without running the package.
            options: [
              {
                value: "official",
                title: "npm official (registry.npmjs.org)",
                titleZh: "npm 官方（registry.npmjs.org）",
              },
              {
                value: "https://registry.npmmirror.com",
                title: "npmmirror (China)",
                titleZh: "npmmirror（中国镜像）",
              },
            ],
          },
        },
      },
    ],
  },
})
export class PluginSourceSettings {
  @Use() private readonly pluginConfig!: PluginConfig;

  setup(): void {
    const { pluginConfig } = this;
    const apply = (values: Record<string, unknown>): void => {
      setNpmRegistry(npmRegistryOf(values.npmRegistry));
    };
    apply(pluginConfig.get(PLUGIN_SOURCES_GROUP));
    pluginConfig.watch(PLUGIN_SOURCES_GROUP, apply);
  }
}
