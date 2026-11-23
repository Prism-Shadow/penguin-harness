/** The day's featured plugin is usable while the full searchable directory loads. */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  dayNumber,
  leadIndex,
  ShowcaseCarousel,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { ShowcaseSlide } from "@prismshadow/penguin-ui/site";
import { featured, leads } from "virtual:penguin-plugin-featured";
import { HubTile } from "../../components/hub/hub-icon";
import { PluginCover, pluginIcon, PRIMARY_ACTION, useEntryLink } from "../../components/hub/market";
import { useDocumentMeta } from "../../lib/document-meta";
import { listState } from "../../lib/hub/back";
import { pick, plainText, titleOf } from "../../lib/hub/text";
import type { PluginSummary } from "../../lib/hub/types";
import { pluginTone } from "../../lib/hub/plugin-hue";
import { S } from "../../lib/strings";

const directory = import("./plugin-directory");
type Directory = Awaited<typeof directory>["default"];
const selected = featured as PluginSummary[];

export function PluginsPage() {
  const { locale } = useSiteLocale();
  const location = useLocation();
  const entryLink = useEntryLink();
  useDocumentMeta(S.hub.pageTitle(S.hub.plugins.title), S.hub.plugins.description);
  const [Directory, setDirectory] = useState<Directory | null>(null);
  useEffect(() => {
    let mounted = true;
    void directory.then(({ default: Component }) => {
      if (mounted) setDirectory(() => Component);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const t = S.hub.plugins;
  const slides: ShowcaseSlide[] = selected.map((plugin) => {
    const to = `/plugins/${plugin.id}`;
    const tagline = plainText(pick(locale, plugin.short, plugin.shortZh));
    const description = plainText(pick(locale, plugin.description, plugin.descriptionZh));
    return {
      key: plugin.id,
      cover: <PluginCover plugin={plugin} rendition="full" eager />,
      lead: <HubTile tone={pluginTone(plugin.id)} icon={pluginIcon(plugin)} glyph="puzzle" />,
      title: titleOf(locale, plugin),
      tagline,
      // A card whose one line is its whole description has nothing more to say here.
      description: description !== tagline ? description : undefined,
      ...entryLink(to),
      actions: (
        <Link to={to} state={listState(location)} className={PRIMARY_ACTION}>
          {t.viewDetails}
        </Link>
      ),
    };
  });

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
        {slides.length > 0 && (
          <ShowcaseCarousel
            className="site-ui mb-6"
            navigation="controls"
            slides={slides}
            label={t.selectedPlugins}
            eyebrow={t.selected}
            labels={t.carousel}
            start={leadIndex(slides.length, leads, dayNumber(new Date()))}
          />
        )}
      </div>
      {Directory ? <Directory /> : <div className="min-h-screen" aria-busy="true" />}
    </>
  );
}
