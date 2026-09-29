/**
 * `/s/<surface>` — one surface's page: the surface list on the left, the content column — the
 * group's eyebrow, the title, the description, the app framed on the surface's route (one frame
 * per theme when comparing), then where the surface is in the app and the fonts the frame is
 * set in — and "on this page" on the right.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { useCallback, useState } from "react";
import type { FontReadout } from "../app/fonts";
import { formatFontReadout } from "../app/fonts";
import { surfaceById } from "../app/surfaces";
import type { SurfaceId } from "../app/surfaces";
import { ThemeFrames, useFrameSrc } from "../chrome/app-frame";
import { useCopy } from "../chrome/copy";
import { Breadcrumb } from "../chrome/crumb";
import { ChromeIcon } from "../chrome/icons";
import { Site } from "../chrome/site";
import { OnThisPage } from "../chrome/toc";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { absoluteUrl } from "../lib/location";
import { pageState, surfacePath } from "../lib/routes";
import { comparesSurface, formatGalleryQuery, withSurfaceCompare } from "../lib/url-state";
import { useScrollSpy } from "../lib/use-scroll-spy";
import { useText } from "../preview";
import { useGallery } from "../state";

export function SurfacePage({ id }: { id: SurfaceId }) {
  const { S, state, update } = useGallery();
  const text = useText();
  const [copied, copy] = useCopy();
  const [epoch, setEpoch] = useState(0);
  const [fonts, setFonts] = useState<FontReadout | null>(null);
  const onFonts = useCallback((readout: FontReadout | null) => setFonts(readout), []);
  const surface = surfaceById(id)!;
  const { title, description, how } = text.surface(id);
  const compare = comparesSurface(state, id);
  const standalone = useFrameSrc(surface, state.theme);
  const active = useScrollSpy(["app", "where", "fonts"]);
  const crumb = formatBreadcrumb({
    theme: text.theme(state.theme),
    page: title,
    size: state.size,
    ...text.qualifiers(),
  });
  const link = () => {
    const pinned = compare ? withSurfaceCompare(pageState(state), id, true) : pageState(state);
    return absoluteUrl(`${surfacePath(id)}${formatGalleryQuery(pinned)}`);
  };
  const toc = [
    { id: "app", title: S.home.app },
    { id: "where", title: S.frame.how },
    { id: "fonts", title: S.readout.label },
  ];

  return (
    <Site
      page="surfaces"
      activeId={id}
      nav
      wide={compare}
      toc={<OnThisPage items={toc} activeId={active} />}
    >
      <article className="g-doc">
        <header className="g-doc-head">
          <p className="g-eyebrow">{text.surfaceGroup(surface.group)}</p>
          <h1 className="g-h1">{title}</h1>
          <p className="g-lead">{description}</p>
        </header>

        <section id="app" className="g-section">
          <div className="g-toolbar">
            <button
              type="button"
              className="g-tool g-tool-primary"
              onClick={() => setEpoch((current) => current + 1)}
            >
              <ChromeIcon name="restart" size={13} />
              <span>{S.frame.reload}</span>
            </button>
            <a className="g-tool" href={standalone} target="_blank" rel="noreferrer">
              <ChromeIcon name="external" size={14} />
              <span>{S.frame.open}</span>
            </a>
            <button
              type="button"
              className="g-tool"
              aria-pressed={compare}
              onClick={() => update((s) => withSurfaceCompare(s, id, !compare))}
            >
              <ChromeIcon name="columns" size={14} />
              <span>{compare ? S.frame.compareOn : S.frame.compare}</span>
            </button>
            <button
              type="button"
              className="g-tool g-tool-icon"
              title={S.section.copyLink}
              aria-label={S.section.copyLink}
              onClick={() => copy("link", link())}
            >
              <ChromeIcon name={copied === "link" ? "check" : "link"} size={14} />
            </button>
            <Breadcrumb text={crumb} />
          </div>
          <div className="g-frame" data-framed>
            <ThemeFrames
              surface={surface}
              themes={compare ? THEME_IDS : [state.theme]}
              eager
              reloadKey={epoch}
              onFonts={onFonts}
            />
          </div>
        </section>

        <section id="where" className="g-section">
          <h2 className="g-h2">{S.frame.how}</h2>
          <p className="g-section-lead">{how}</p>
          <p className="g-section-meta">
            {S.frame.route} <code>{surface.route}</code>
            {surface.signedOut && <> · {S.frame.signedOut}</>}
          </p>
        </section>

        <section id="fonts" className="g-section">
          <h2 className="g-h2">{S.readout.label}</h2>
          <p className="g-section-lead g-readout-line">
            {fonts ? formatFontReadout(fonts, S.readout) : S.readout.pending}
          </p>
        </section>
      </article>
    </Site>
  );
}
