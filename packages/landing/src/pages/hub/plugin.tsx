/** One plugin: what it does, how to start it, what it ships, and its package facts. */
import { useParams } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { HubIcon } from "../../components/hub/hub-icon";
import {
  AuthorName,
  HubDetail,
  HubMissing,
  HubPending,
  HubSection,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { HubMarkdown } from "../../components/hub/hub-markdown";
import { InlineText } from "../../components/hub/inline-text";
import { ExternalLink } from "../../components/external-link";
import { useDocumentMeta } from "../../lib/document-meta";
import { pick, titleOf } from "../../lib/hub/text";
import type { PluginDetail } from "../../lib/hub/types";
import { S } from "../../lib/strings";

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
  return (
    <HubDetail
      lead={<HubIcon src={plugin.icon} size="lg" />}
      title={title}
      subtitle={short}
      sourceUrl={plugin.sourceUrl}
      facts={[
        ...(plugin.author
          ? [{ label: S.hub.meta.author, value: <AuthorName author={plugin.author} /> }]
          : []),
        {
          label: S.hub.meta.category,
          value: S.hub.plugins.categories[plugin.category] ?? plugin.category,
        },
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
        <HubSection title={S.hub.plugins.about}>
          <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">
            <InlineText>{description}</InlineText>
          </p>
        </HubSection>
      )}
      {quickStart && (
        <HubSection title={S.hub.plugins.quickStart}>
          <p className="text-sm leading-7 whitespace-pre-line text-gray-700 dark:text-gray-300">
            <InlineText>{pick(locale, quickStart.prompt, quickStart.promptZh)}</InlineText>
          </p>
          {quickStart.skills.length > 0 && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {S.hub.plugins.quickStartSkills}{" "}
              <span className="text-gray-700 dark:text-gray-300">
                {quickStart.skills.join(", ")}
              </span>
            </p>
          )}
        </HubSection>
      )}
      {plugin.skills.length > 0 && (
        <HubSection title={S.hub.plugins.skills}>
          <ul className="flex flex-col gap-3">
            {plugin.skills.map((skill) => {
              const text = skill.description
                ? pick(locale, skill.description, skill.descriptionZh)
                : undefined;
              return (
                <li key={skill.name} className="text-sm leading-6">
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
        </HubSection>
      )}
      {plugin.hooks.length > 0 && (
        <HubSection title={S.hub.plugins.hooks}>
          <p className="text-sm text-gray-700 dark:text-gray-300">{plugin.hooks.join(", ")}</p>
        </HubSection>
      )}
      {plugin.workbenches.length > 0 && (
        <HubSection title={S.hub.plugins.workbenches}>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {plugin.workbenches.join(", ")}
          </p>
        </HubSection>
      )}
      {plugin.references.length > 0 && (
        <HubSection title={S.hub.references}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {plugin.references.map((href) => (
              <li key={href} className="[overflow-wrap:anywhere]">
                <ExternalLink
                  href={href}
                  className="text-brand-700 hover:underline dark:text-brand-300"
                >
                  {href}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </HubSection>
      )}
      {plugin.readme && (
        <HubSection title="README">
          <HubMarkdown base={`${plugin.sourceUrl}/`}>{plugin.readme}</HubMarkdown>
        </HubSection>
      )}
    </HubDetail>
  );
}
