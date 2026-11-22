/**
 * One plugin, as a product page: its cover beside its name, one line, tags and actions; its
 * screenshots when the curation gives it any; then what it does, how to start it, what it
 * installs, its README and its references, beside its package facts and the leaderboards that
 * measured it (an RSI toolkit's algorithm). A plugin without art wears the generated cover and
 * has no Screenshots section; nothing else changes. A plugin the published index lists and this
 * repository does not bundle has only what its index row says — no README, parts or quick start —
 * and its Source is its repository.
 */
import { Link, useParams } from "react-router";
import {
  GitHubIcon,
  ProductColumns,
  ProductFacts,
  ProductGallery,
  ProductHero,
  ProductParts,
  ProductPrompt,
  ProductSection,
  SiteCopyButton,
  SiteGlyph,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { ProductPart, ProductShot } from "@prismshadow/penguin-ui/site";
import { ExternalLink, ExternalLinkScope } from "../../components/external-link";
import { HubTag, HubTile } from "../../components/hub/hub-icon";
import {
  AuthorName,
  CountTitle,
  FRAME,
  HubBack,
  HubMissing,
  HubPending,
  ReferenceList,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { HubMarkdown } from "../../components/hub/hub-markdown";
import { InlineText } from "../../components/hub/inline-text";
import {
  PluginCover,
  pluginIcon,
  PRIMARY_ACTION,
  SECONDARY_ACTION,
} from "../../components/hub/market";
import { DownloadIcon } from "../../components/icons";
import { pluginAssetUrl } from "../../lib/community-assets";
import { useDocumentMeta } from "../../lib/document-meta";
import { formatDay, pick, plainText, titleOf } from "../../lib/hub/text";
import type { PluginDetail } from "../../lib/hub/types";
import { pluginTone } from "../../lib/hub/plugin-hue";
import { S } from "../../lib/strings";

export function PluginPage() {
  const { id = "" } = useParams();
  const plugin = useHubDetail("plugin", id);
  if (plugin === undefined) return <HubPending kind="plugin" />;
  if (plugin === null) return <HubMissing kind="plugin" />;
  return <PluginView plugin={plugin} />;
}

const MARK = "h-4 w-4";

function PluginView({ plugin }: { plugin: PluginDetail }) {
  const { locale } = useSiteLocale();
  const title = titleOf(locale, plugin);
  const short = pick(locale, plugin.short, plugin.shortZh);
  useDocumentMeta(S.hub.pageTitle(title), short);
  const description = pick(locale, plugin.description, plugin.descriptionZh);
  const quickStart = plugin.quickStart;
  const t = S.hub.plugins;
  const category = t.categories[plugin.category] ?? plugin.category;

  const shots: ProductShot[] = (plugin.screenshots ?? []).map((shot) => {
    const caption = locale === "zh" ? (shot.captionZh ?? shot.caption) : shot.caption;
    return {
      src: pluginAssetUrl(shot.src),
      thumb: shot.thumb === undefined ? undefined : pluginAssetUrl(shot.thumb),
      alt: caption ?? title,
      caption,
    };
  });

  const parts: ProductPart[] = [
    ...plugin.skills.map((skill) => ({
      key: `skill:${skill.name}`,
      mark: <SiteGlyph name="sparkle" className={MARK} />,
      name: skill.name,
      kind: t.partKinds.skill,
      description: skill.description
        ? plainText(pick(locale, skill.description, skill.descriptionZh))
        : undefined,
    })),
    ...plugin.hooks.map((point) => ({
      key: `hook:${point}`,
      mark: <SiteGlyph name="fishHook" className={MARK} />,
      name: point,
      kind: t.partKinds.hook,
    })),
    ...plugin.workbenches.map((name) => ({
      key: `workbench:${name}`,
      mark: <SiteGlyph name="appWindow" className={MARK} />,
      name,
      kind: t.partKinds.workbench,
    })),
  ];

  return (
    <ExternalLinkScope>
      <article className={FRAME}>
        <HubBack kind="plugin" />
        <div className="site-ui mt-5">
          <div className="anim-rise">
            <ProductHero
              cover={<PluginCover plugin={plugin} rendition="full" eager />}
              lead={
                <HubTile
                  tone={pluginTone(plugin.id)}
                  icon={pluginIcon(plugin)}
                  glyph="puzzle"
                  size="lg"
                />
              }
              eyebrow={plugin.selected ? t.selected : undefined}
              title={title}
              subtitleCode={plugin.packageName}
              tagline={plainText(short)}
              tags={[
                <HubTag key="category" glyph="tiles">
                  {category}
                </HubTag>,
                <HubTag key="version" glyph="hash">
                  {plugin.version}
                </HubTag>,
                ...(plugin.license
                  ? [
                      <HubTag key="license" glyph="copyright">
                        {plugin.license}
                      </HubTag>,
                    ]
                  : []),
                ...(plugin.skills.length > 0
                  ? [
                      <HubTag key="skills" glyph="sparkle">
                        {t.skillCount(plugin.skills.length)}
                      </HubTag>,
                    ]
                  : []),
                ...(plugin.preinstall
                  ? [
                      <HubTag key="preinstall" glyph="checkCircle">
                        {t.preinstalled}
                      </HubTag>,
                    ]
                  : []),
              ]}
              actions={
                <>
                  <Link to="/download" className={PRIMARY_ACTION}>
                    <DownloadIcon className="h-4 w-4" />
                    {t.getPenguin}
                  </Link>
                  {plugin.archiveUrl && (
                    <ExternalLink href={plugin.archiveUrl} className={SECONDARY_ACTION}>
                      <DownloadIcon aria-hidden className="h-4 w-4" />
                      {t.downloadPlugin}
                    </ExternalLink>
                  )}
                  {plugin.sourceUrl !== undefined && (
                    <ExternalLink href={plugin.sourceUrl} className={SECONDARY_ACTION}>
                      <GitHubIcon aria-hidden className="h-4 w-4" />
                      {t.source}
                    </ExternalLink>
                  )}
                </>
              }
            />
          </div>

          {shots.length > 0 && (
            <ProductSection title={t.screenshots}>
              <ProductGallery shots={shots} label={t.screenshots} />
            </ProductSection>
          )}

          <div className="mt-8">
            <ProductColumns
              aside={
                <>
                  {/* Level with the first section beside it; on a phone it follows them, titled. */}
                  <ProductSection title={S.hub.details} className="mt-0!">
                    <ProductFacts
                      facts={[
                        ...(plugin.author
                          ? [
                              {
                                label: S.hub.meta.author,
                                value: <AuthorName author={plugin.author} />,
                              },
                            ]
                          : []),
                        { label: S.hub.meta.category, value: category },
                        { label: S.hub.meta.version, value: plugin.version },
                        ...(plugin.updated
                          ? [
                              {
                                label: S.hub.meta.updated,
                                value: formatDay(plugin.updated, locale),
                              },
                            ]
                          : []),
                        ...(plugin.license
                          ? [{ label: S.hub.meta.license, value: plugin.license }]
                          : []),
                        { label: S.hub.meta.package, value: plugin.packageName },
                        {
                          label: S.hub.meta.preinstall,
                          value: plugin.preinstall ? S.hub.meta.yes : S.hub.meta.no,
                        },
                      ]}
                    />
                  </ProductSection>
                  {plugin.leaderboards.length > 0 && (
                    <ProductSection title={t.measuredBy}>
                      <ul className="flex flex-col gap-1.5 text-sm">
                        {plugin.leaderboards.map((board) => (
                          <li key={board.id}>
                            <Link
                              to={`/leaderboards/${board.id}`}
                              className="text-brand-700 hover:underline dark:text-brand-300"
                            >
                              {titleOf(locale, board)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </ProductSection>
                  )}
                </>
              }
            >
              {description !== short && (
                <ProductSection title={t.about}>
                  <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">
                    <InlineText>{description}</InlineText>
                  </p>
                </ProductSection>
              )}
              {quickStart && (
                <ProductSection title={t.quickStart}>
                  <ProductPrompt
                    prompt={pick(locale, quickStart.prompt, quickStart.promptZh)}
                    note={
                      quickStart.skills.length > 0 ? (
                        <>
                          {t.quickStartSkills}{" "}
                          <span className="text-gray-700 dark:text-gray-300">
                            {quickStart.skills.join(S.hub.listSeparator)}
                          </span>
                        </>
                      ) : undefined
                    }
                    action={
                      <SiteCopyButton
                        text={pick(locale, quickStart.prompt, quickStart.promptZh)}
                        label={S.copy.copy}
                        announcement={S.copy.copied}
                      />
                    }
                  />
                </ProductSection>
              )}
              {parts.length > 0 && (
                <ProductSection
                  title={<CountTitle label={t.whatItInstalls} count={parts.length} />}
                >
                  <ProductParts parts={parts} />
                </ProductSection>
              )}
              {plugin.readme && plugin.sourceUrl !== undefined && (
                <ProductSection title="README">
                  <HubMarkdown base={`${plugin.sourceUrl}/`}>{plugin.readme}</HubMarkdown>
                </ProductSection>
              )}
              {plugin.references.length > 0 && (
                <ProductSection title={S.hub.references}>
                  <ReferenceList links={plugin.references} />
                </ProductSection>
              )}
            </ProductColumns>
          </div>
        </div>
      </article>
    </ExternalLinkScope>
  );
}
