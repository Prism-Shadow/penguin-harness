/**
 * One plugin: what it does, how to start it, what it ships and its README, each in its own panel,
 * with its package facts beside them and its references last.
 */
import { useParams } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { HubTag, HubTile } from "../../components/hub/hub-icon";
import {
  AuthorName,
  CountTitle,
  HubDetail,
  HubMissing,
  HubPanel,
  HubPending,
  HubReferences,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { HubMarkdown } from "../../components/hub/hub-markdown";
import { InlineText } from "../../components/hub/inline-text";
import { useDocumentMeta } from "../../lib/document-meta";
import { pick, titleOf } from "../../lib/hub/text";
import type { PluginDetail } from "../../lib/hub/types";
import { categoryTone, KIND_TONE } from "../../lib/hub/tones";
import { S } from "../../lib/strings";

const TONE = KIND_TONE.plugin;

export function PluginPage() {
  const { id = "" } = useParams();
  const plugin = useHubDetail("plugin", id);
  if (plugin === undefined) return <HubPending />;
  if (plugin === null) return <HubMissing listHref="/plugins" />;
  return <PluginView plugin={plugin} />;
}

function PluginView({ plugin }: { plugin: PluginDetail }) {
  const { locale } = useSiteLocale();
  const title = titleOf(locale, plugin);
  const short = pick(locale, plugin.short, plugin.shortZh);
  useDocumentMeta(S.hub.pageTitle(title), short);
  const description = pick(locale, plugin.description, plugin.descriptionZh);
  const quickStart = plugin.quickStart;
  const t = S.hub.plugins;
  return (
    <HubDetail
      lead={
        <HubTile tone={categoryTone(plugin.category)} src={plugin.icon} glyph="puzzle" size="lg" />
      }
      title={title}
      subtitle={short}
      tags={
        <>
          <HubTag tone={categoryTone(plugin.category)} glyph="tiles">
            {t.categories[plugin.category] ?? plugin.category}
          </HubTag>
          <HubTag glyph="hash">{plugin.version}</HubTag>
          {plugin.license && <HubTag glyph="copyright">{plugin.license}</HubTag>}
          {plugin.skills.length > 0 && (
            <HubTag glyph="sparkle">{t.skillCount(plugin.skills.length)}</HubTag>
          )}
          {plugin.preinstall && (
            <HubTag tone="emerald" glyph="checkCircle">
              {t.preinstalled}
            </HubTag>
          )}
        </>
      }
      sourceUrl={plugin.sourceUrl}
      facts={[
        ...(plugin.author
          ? [{ label: S.hub.meta.author, value: <AuthorName author={plugin.author} /> }]
          : []),
        { label: S.hub.meta.category, value: t.categories[plugin.category] ?? plugin.category },
        { label: S.hub.meta.version, value: plugin.version },
        ...(plugin.license ? [{ label: S.hub.meta.license, value: plugin.license }] : []),
        { label: S.hub.meta.package, value: plugin.packageName },
        {
          label: S.hub.meta.preinstall,
          value: plugin.preinstall ? S.hub.meta.yes : S.hub.meta.no,
        },
      ]}
    >
      {description !== short && (
        <HubPanel title={t.about} glyph="bookOpen" tone={TONE}>
          <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">
            <InlineText>{description}</InlineText>
          </p>
        </HubPanel>
      )}
      {quickStart && (
        <HubPanel title={t.quickStart} glyph="zap" tone={TONE}>
          <p className="text-sm leading-7 whitespace-pre-line text-gray-700 dark:text-gray-300">
            <InlineText>{pick(locale, quickStart.prompt, quickStart.promptZh)}</InlineText>
          </p>
          {quickStart.skills.length > 0 && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {t.quickStartSkills}{" "}
              <span className="text-gray-700 dark:text-gray-300">
                {quickStart.skills.join(S.hub.listSeparator)}
              </span>
            </p>
          )}
        </HubPanel>
      )}
      {plugin.skills.length > 0 && (
        <HubPanel
          title={<CountTitle label={t.skills} count={plugin.skills.length} />}
          glyph="sparkle"
          tone={TONE}
          flush
        >
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {plugin.skills.map((skill) => {
              const text = skill.description
                ? pick(locale, skill.description, skill.descriptionZh)
                : undefined;
              return (
                <li key={skill.name} className="px-4 py-3 text-sm leading-6 sm:px-5">
                  <span className="font-medium">{skill.name}</span>
                  {text && (
                    <p className="text-gray-600 dark:text-gray-400">
                      <InlineText>{text}</InlineText>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </HubPanel>
      )}
      {(plugin.hooks.length > 0 || plugin.workbenches.length > 0) && (
        <HubPanel title={t.extensions} glyph="plug" tone={TONE} flush>
          <dl className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {plugin.hooks.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <dt className="w-24 shrink-0 text-gray-500 dark:text-gray-400">{t.hooks}</dt>
                <dd>{plugin.hooks.join(S.hub.listSeparator)}</dd>
              </div>
            )}
            {plugin.workbenches.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <dt className="w-24 shrink-0 text-gray-500 dark:text-gray-400">{t.workbenches}</dt>
                <dd>{plugin.workbenches.join(S.hub.listSeparator)}</dd>
              </div>
            )}
          </dl>
        </HubPanel>
      )}
      {plugin.readme && (
        <HubPanel title="README" glyph="file" tone={TONE}>
          <HubMarkdown base={`${plugin.sourceUrl}/`}>{plugin.readme}</HubMarkdown>
        </HubPanel>
      )}
      <HubReferences links={plugin.references} />
    </HubDetail>
  );
}
