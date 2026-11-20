/**
 * 封面陈列: the plugin market's shared modules (`components/showcase/`) under the theme being
 * previewed. The generated cover in every hue with every motif, each with a shipped plugin's own
 * icon; the four motifs with the logo on the tile (a plugin without an icon); a cover's states —
 * a picture still on its way (the field in the picture's tone), one that loaded, one that failed
 * (the generated cover takes over); cover cards in their grid: short words, overlong words with
 * the machine they came from, the full foot, a foot without controls, the Web App market's card
 * (its version chip and its bar of text actions), and the placeholder; the selected carousel with three
 * slides, with its thumbnail rail and with its controls alone; and a product page's parts. The
 * public sites' rendering of the same modules is the 公开站点 board's.
 *
 * The picture still on its way never finishes: it is a lazy image held out of layout
 * (library.css), so the browser never fetches it and the cover stays in its loading state.
 */
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  COVER_HUES,
  COVER_MOTIFS,
  Cover,
  CoverCard,
  CoverCardSkeleton,
  EntityCardAction,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  MetaLine,
  ProductColumns,
  ProductFacts,
  ProductGallery,
  ProductHero,
  ProductParts,
  ProductPrompt,
  ProductSection,
  Segmented,
  useShowcaseLayout,
  ShowcaseCarousel,
  ShowcaseGrid,
  StatusMark,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";
import {
  HUE_PLUGINS,
  ICONS_BY_PLUGIN,
  LOGO,
  LeadTile,
  deckPicture,
  plugIcon,
  sampleShots,
  sampleSlides,
  seedFor,
} from "./showcase-samples";

const BASE = import.meta.env.BASE_URL;
const PACKAGE = "@penguinharness/penguin-support";

function Specimen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="m-0 grid gap-1.5">
      {children}
      <figcaption className="lib-caption">{caption}</figcaption>
    </figure>
  );
}

export function ShowcaseBoard() {
  const { state, mode, S } = useGallery();
  const t = S.library.showcase;
  const [layout, setLayout] = useShowcaseLayout("penguin.gallery.showcaseLayout");
  const tag = (words: string) => (
    <Badge key={words} variant="soft">
      {words}
    </Badge>
  );
  const parts = t.parts.map((part, i) => ({
    key: part.name,
    mark: <GlyphIcon d={i === 0 ? ICONS.sparkles : ICONS.appWindow} size={ICON_SIZE.rowLead} />,
    name: part.name,
    kind: part.kind,
    description: part.description,
    ...(part.kind === "Workbench"
      ? {
          action: (
            <Button size="sm" variant="secondary">
              {t.openApp}
            </Button>
          ),
        }
      : {}),
  }));
  return (
    <div className="gf-board">
      <BoardGroup title={t.generated} aside={t.generatedHint}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {COVER_HUES.flatMap((hue) =>
            COVER_MOTIFS.map((motif) => (
              <Specimen key={`${hue}-${motif}`} caption={`${hue} · ${motif}`}>
                <Cover
                  seed={seedFor(motif)}
                  hue={hue}
                  icon={plugIcon(HUE_PLUGINS[hue].svg)}
                  logo={LOGO}
                />
              </Specimen>
            )),
          )}
        </div>
      </BoardGroup>

      <BoardGroup title={t.logoOnly} aside={t.logoOnlyHint}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {COVER_MOTIFS.map((motif) => (
            <Specimen key={motif} caption={motif}>
              <Cover seed={seedFor(motif)} logo={LOGO} />
            </Specimen>
          ))}
        </div>
      </BoardGroup>

      <BoardGroup title={t.states} aside={t.statesHint}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Specimen caption={t.loading}>
            <div className="lib-cover-held">
              <Cover
                image={{ src: `${BASE}showcase-held/cover.webp`, tone: "#745fac" }}
                seed="a2ui"
                hue="violet"
                icon={plugIcon(ICONS_BY_PLUGIN.a2ui)}
                logo={LOGO}
              />
            </div>
          </Specimen>
          <Specimen caption={t.loaded}>
            <Cover
              image={{ src: deckPicture(state.lang), tone: "#eef1ee" }}
              seed="use-bento-slides"
              hue="orange"
              icon={plugIcon(ICONS_BY_PLUGIN.bento)}
              logo={LOGO}
              eager
            />
          </Specimen>
          <Specimen caption={t.fallback}>
            <Cover
              image={{ src: `${BASE}showcase-missing/cover.webp`, tone: "#745fac" }}
              seed="a2ui"
              hue="violet"
              icon={plugIcon(ICONS_BY_PLUGIN.a2ui)}
              logo={LOGO}
              eager
            />
          </Specimen>
        </div>
      </BoardGroup>

      <BoardGroup title={t.cards} aside={t.cardsHint}>
        <div className="mb-3 flex justify-end">
          <Segmented
            cols={2}
            value={layout}
            onChange={setLayout}
            options={[
              { value: "cards", label: t.cardView },
              { value: "list", label: t.listView },
            ]}
          />
        </div>
        <ShowcaseGrid layout={layout}>
          <CoverCard
            cover={
              <Cover seed="goal" hue="green" icon={plugIcon(ICONS_BY_PLUGIN.goal)} logo={LOGO} />
            }
            title={t.shortTitle}
            description={t.shortDescription}
          />
          <CoverCard
            cover={<Cover seed="agent-company" hue="amber" logo={LOGO} />}
            title={t.longTitle}
            titleHint="@penguinharness/agent-company"
            origin={t.origin}
            description={t.longDescription}
          />
          <CoverCard
            // A card that is a container of its own (its controls show their words when it is
            // wide): the grid's phone rule still reads the grid, which names its container.
            className="@container"
            cover={
              <Cover
                seed="penguin-support"
                hue="teal"
                icon={plugIcon(ICONS_BY_PLUGIN.support)}
                logo={LOGO}
              />
            }
            title={t.fullTitle}
            titleHint={PACKAGE}
            description={t.fullDescription}
            tags={[tag(t.tagSelected), tag(t.tagCategory), tag(t.tagBuiltin)]}
            meta={
              <MetaLine>
                <span className="shrink-0 font-mono">v0.2.18</span>
                <StatusMark
                  glyph={ICONS.checkCircle}
                  tone="success"
                  label={t.installed}
                  hint={t.installedHint}
                />
              </MetaLine>
            }
            actions={[
              <EntityCardAction key="quick" glyph={ICONS.paperPlane} label={t.quickStart} />,
              <EntityCardAction key="manage" glyph={ICONS.download} label={t.manage} />,
            ]}
          />
          <CoverCard
            cover={<Cover seed="data-analysis" hue="slate" logo={LOGO} />}
            title={t.plainTitle}
            description={t.plainDescription}
            tags={[tag(t.tagBuiltin)]}
            meta={
              <MetaLine>
                <span className="shrink-0 font-mono">v0.2.18</span>
              </MetaLine>
            }
          />
          <CoverCard
            cover={
              <Cover
                seed="use-bento-slides"
                hue="orange"
                icon={plugIcon(ICONS_BY_PLUGIN.bento)}
                logo={LOGO}
              />
            }
            title={t.barTitle}
            description={t.barDescription}
            version="v0.3.1"
            bar={[
              { key: "install", label: t.barInstall, note: t.barInstallNote },
              { key: "quick", label: t.quickStart, hint: t.barQuickHint, disabled: true },
            ]}
          />
          <CoverCardSkeleton />
        </ShowcaseGrid>
      </BoardGroup>

      <BoardGroup title={t.carousel} aside={t.carouselHint}>
        <ShowcaseCarousel
          slides={sampleSlides(t, state.lang, () => (
            <>
              <Button variant="primary">{t.viewDetails}</Button>
              <Button variant="secondary">{t.quickStart}</Button>
            </>
          ))}
          label={t.carouselLabel}
          eyebrow={t.eyebrow}
          labels={t.carouselLabels}
        />
        <div className="mt-6">
          <Specimen caption={t.carouselControlsCaption}>
            <ShowcaseCarousel
              navigation="controls"
              slides={sampleSlides(t, state.lang, () => (
                <Button variant="primary">{t.viewDetails}</Button>
              ))}
              label={t.carouselLabel}
              eyebrow={t.eyebrow}
              labels={t.carouselLabels}
            />
          </Specimen>
        </div>
      </BoardGroup>

      <BoardGroup title={t.product} aside={t.productHint}>
        <ProductHero
          level={2}
          cover={
            <Cover
              rendition="full"
              seed="penguin-support"
              hue="teal"
              icon={plugIcon(ICONS_BY_PLUGIN.support)}
              logo={LOGO}
              eager
            />
          }
          lead={<LeadTile svg={ICONS_BY_PLUGIN.support} />}
          eyebrow={t.eyebrow}
          title={t.fullTitle}
          subtitleCode={PACKAGE}
          tagline={t.fullDescription}
          tags={[tag(t.tagSelected), tag(t.tagCategory), tag(t.tagBuiltin)]}
          actions={
            <>
              <Button variant="primary">{t.openApp}</Button>
              <Button variant="secondary">{t.quickStart}</Button>
            </>
          }
          facts={
            <MetaLine>
              <span className="shrink-0 font-mono">v0.2.18</span>
              <span>PenguinHarness</span>
              <span>Apache-2.0</span>
            </MetaLine>
          }
        />
        <ProductSection title={t.screenshots} level={3}>
          <ProductGallery
            shots={sampleShots(t, state.lang, mode === "dark")}
            label={t.screenshots}
          />
        </ProductSection>
        <ProductColumns
          aside={
            <ProductFacts
              facts={[
                { label: t.facts.version, value: "0.2.18" },
                { label: t.facts.category, value: t.tagCategory },
                { label: t.facts.author, value: "PenguinHarness" },
                { label: t.facts.license, value: "Apache-2.0" },
                {
                  label: t.facts.package,
                  // A package name breaks after its scope, not inside a word.
                  value: (
                    <span className="font-mono">
                      @penguinharness/
                      <wbr />
                      penguin-support
                    </span>
                  ),
                },
              ]}
            />
          }
        >
          <ProductSection title={t.about} level={3}>
            <p className="m-0 text-sm leading-relaxed">{t.aboutBody}</p>
          </ProductSection>
          <ProductSection title={t.installs} level={3}>
            <ProductParts parts={parts} />
          </ProductSection>
          <ProductSection title={t.quickStart} level={3}>
            <ProductPrompt
              prompt={t.prompt}
              note={t.promptNote}
              action={
                <Button size="sm" variant="primary">
                  {t.send}
                </Button>
              }
            />
          </ProductSection>
        </ProductColumns>
      </BoardGroup>
    </div>
  );
}
