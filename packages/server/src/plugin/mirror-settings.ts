/**
 * The published index's CDN mirrors, as a settings group: which third-party mirrors the
 * two fetches of the plugin chain (the index document and the release assets npm installs)
 * try after the source's own URL. Declared on `PluginConfigProvider.groups` like any
 * module's settings, drawn on the Settings dialog's Plugins page and stored under
 * `plugin-config:plugin-mirrors`, so a restart keeps it — and a change lands without a
 * restart (the watch).
 *
 * The group offers the mirrors this build knows, not a rule editor: each choice names a
 * service that serves GitHub content or npm packages over its own domain, and the built-in
 * rules (see `MIRROR_RULES`) map the two fetches' URLs onto the chosen service's shape.
 * A mirror changes only where bytes come from — the index document and every release asset
 * are verified exactly as the canonical source's are, and the install verifies npm's
 * record against the entry's sha512 after the fact — so an untrustworthy mirror costs a
 * failed fetch, not tampered bytes on disk.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { PluginConfig } from "./config.js";
import type { PluginProxyRule } from "./registry.js";

/** The group's name (its contribution id), and what the stored document is keyed by. */
export const PLUGIN_MIRRORS_GROUP = "plugin-mirrors";

/**
 * The rules the built-in mirrors run as, in try order: each mirror's rules follow the
 * mirror's own order, and a mirror a user turns off contributes nothing. The rules ride
 * the same gates as any configured rule (`rewriteRuleRisk` at apply), so a pattern that
 * could pin a match never reaches a fetch.
 */
export const MIRROR_RULES: readonly (readonly PluginProxyRule[])[] = [
  // npm registry mirror: the packages npm fetches — and the release tarballs the index's
  // npm channels install — served from npmmirror's own domain, byte-identical to the
  // official registry (verified against the registry's published sha512).
  [
    {
      kind: "rewrite",
      match: "^https:\\/\\/registry\\.npmjs\\.org\\/(.+)$",
      rewrite: "https://registry.npmmirror.com/$1",
    },
  ],
  // GitHub release assets and repository files through jsDelivr's multi-CDN (Cloudflare,
  // Fastly and Gcore behind one origin): files a release tag carries, not the release
  // assets themselves — npm's registry mirror above is what serves the npm-published
  // tarballs the channels install.
  [
    {
      kind: "rewrite",
      match: "^https:\\/\\/raw\\.githubusercontent\\.com\\/([^/]+)\\/([^/]+)\\/(.*)$",
      rewrite: "https://fastly.jsdelivr.net/gh/$1/$2@$3",
    },
  ],
  // GitHub content through a Cloudflare-fronted community proxy, for the deployment
  // domains jsDelivr does not serve (release assets among them). Bytes are not promised
  // to match the canonical ones — the post-install check refuses what does not, and the
  // walk moves to the next address.
  [
    {
      kind: "rewrite",
      match: "^https:\\/\\/github\\.com\\/(.+)$",
      rewrite: "https://gh-proxy.com/https://github.com/$1",
    },
  ],
];

/** The mirror ids the group's enum names, in try order; the ids MIRROR_RULES is keyed by. */
export type MirrorId = "npm-registry" | "github-raw" | "github-proxy";

/** The same ids, as a value: what mirrorRulesOf filters against and indexes MIRROR_RULES by. */
export const MIRROR_IDS: readonly MirrorId[] = ["npm-registry", "github-raw", "github-proxy"];

/** The rule table the two fetches read, as the last apply left it. */
let activeRules: readonly PluginProxyRule[] = [];

/** What the two fetches try after the source's own URL; empty — the default — is none. */
export function indexMirrorRules(): readonly PluginProxyRule[] {
  return activeRules;
}

/** The settings group applies (or clears) the rule table the fetches read. */
export function setIndexMirrors(rules: readonly PluginProxyRule[]): void {
  activeRules = rules;
}

/**
 * What a stored choice runs as: the chosen mirrors' rules, in the order the choice names
 * them (a list of ids). An unknown id, a non-array or a non-string entry contributes
 * nothing — the group's own declaration is what the page draws, so a value outside it is
 * a stale document, not a configuration to honor.
 */
export function mirrorRulesOf(value: unknown): readonly PluginProxyRule[] {
  if (!Array.isArray(value)) return [];
  const chosen = value.filter((id): id is MirrorId =>
    (["npm-registry", "github-raw", "github-proxy"] as const).includes(id as MirrorId),
  );
  const rules = chosen.flatMap((id) => MIRROR_RULES[MIRROR_IDS.indexOf(id)] ?? []);
  return rules;
}

@Component({
  contributes: {
    "PluginConfigProvider.groups": [
      {
        // Written out, not named from a constant: a contribution is data the host reads
        // without running the package.
        id: "plugin-mirrors",
        // Drawn inside the Plugin Sources card (source-settings.ts), after the plugin-index
        // field: one card on screen, saved under its own key (`plugin-config:plugin-mirrors`).
        parent: "plugin-sources",
        order: 2,
        properties: {
          mirrors: {
            type: "list",
            title: "Plugin mirrors",
            titleZh: "插件镜像",
            description:
              "The mirrors to try after each source's own URL when GitHub or the npm registry is unreachable, in order: the npm registry mirror serves npm packages and the index's npm-published tarballs; the GitHub mirrors serve the published index and its release assets. Everything a mirror serves is verified against the entry's sha512, just like the canonical source. Empty (the default) tries the source's own URL only.",
            descriptionZh:
              "GitHub 或 npm registry 不可达时，在每个源地址之后按顺序尝试的镜像：npm registry 镜像供给 npm 包与索引发布到 npm 的 tarball；GitHub 镜像供给发布索引与其 release 资产。镜像供给的一切同样按条目的 sha512 核验。留空（默认）只走源自己的地址。",
            default: [],
            // The page draws one picker per entry from these choices (items.options); the
            // server still holds a list of ids and `mirrorRulesOf` filters what it reads.
            items: {
              options: [
                {
                  value: "npm-registry",
                  title: "npm registry mirror (npmmirror)",
                  titleZh: "npm registry 镜像（npmmirror）",
                },
                {
                  value: "github-raw",
                  title: "GitHub raw via jsDelivr (fastly)",
                  titleZh: "GitHub raw 经 jsDelivr（fastly）",
                },
                {
                  value: "github-proxy",
                  title: "GitHub proxy (gh-proxy.com)",
                  titleZh: "GitHub 代理（gh-proxy.com）",
                },
              ],
            },
            // The ids the group knows; the page draws them as the choices a line can be.
            maxItems: 3,
          },
        },
      },
    ],
  },
})
export class PluginMirrorSettings {
  @Use() private readonly pluginConfig!: PluginConfig;

  setup(): void {
    const { pluginConfig } = this;
    const apply = (values: Record<string, unknown>): void => {
      setIndexMirrors(mirrorRulesOf(values.mirrors));
    };
    apply(pluginConfig.get(PLUGIN_MIRRORS_GROUP));
    pluginConfig.watch(PLUGIN_MIRRORS_GROUP, apply);
  }
}
