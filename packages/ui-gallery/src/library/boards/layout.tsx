/**
 * 布局: a page frame with its header (the display title and its "?", the line under it, the way
 * back and the actions), the card padded and flush, the ruled section, the collapsible section
 * open and folded, the entity header, and the navigation list at both densities — all from the
 * package.
 */
import { useState } from "react";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CollapsibleSection,
  CopyButton,
  Count,
  EntityHeader,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  IconButton,
  Input,
  ListRow,
  NavList,
  NavRow,
  PageFrame,
  PageHeader,
  ProviderLogo,
  RuledSection,
  Text,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** Model ids are the same in both languages: they are data, not copy. */
const MODELS = ["gpt-5.4", "gpt-5.4-mini", "o4-mini"];
const AGENT_ID = "code-reviewer";

/** The rail's pages and their glyphs; the last one has nowhere to go yet. */
const NAV_PAGES = [
  { key: "overview", glyph: ICONS.gear },
  { key: "models", glyph: ICONS.chip },
  { key: "schedules", glyph: ICONS.alarmClock },
  { key: "vault", glyph: ICONS.key },
  { key: "billing", glyph: ICONS.dollarCircle },
] as const;
type NavPage = (typeof NAV_PAGES)[number]["key"];

export function LayoutBoard() {
  const { S } = useGallery();
  const t = S.library.layout;
  const [query, setQuery] = useState("");
  const [groupOpen, setGroupOpen] = useState(true);
  const [navPage, setNavPage] = useState<NavPage>("overview");
  return (
    <div className="gf-board">
      <BoardGroup title={t.page} aside={t.pageHint}>
        <div className="lib-box">
          <PageFrame width="full">
            <PageHeader
              title={t.pageTitle}
              info={t.pageInfo}
              description={t.pageDescription}
              back={{ label: t.back, onClick: () => {} }}
              actions={
                <>
                  <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
                    <Input
                      size="sm"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t.search}
                      aria-label={t.search}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    leading={<GlyphIcon d={ICONS.plus} size={ICON_SIZE.inlineGlyph} />}
                  >
                    {t.create}
                  </Button>
                </>
              }
            />
            <Text variant="caption">{t.pageBody}</Text>
          </PageFrame>
        </div>
      </BoardGroup>
      <BoardGroup title={t.cards}>
        <div className="lib-stack lib-stack-wide">
          <span className="lib-caption">{t.padded}</span>
          <Card>
            <CardHeader
              title={t.cardTitle}
              info={t.cardInfo}
              actions={
                <Button size="xs" variant="ghost">
                  {t.cardAction}
                </Button>
              }
            />
            <p className="text-lg font-semibold tabular-nums">{t.cardValue}</p>
            <Text variant="caption">{t.cardBody}</Text>
          </Card>
          <span className="lib-caption">{t.flush}</span>
          <Card padding="none">
            <CardHeader title={t.flushTitle} description={t.flushDescription} />
            {t.flushRows.map((row) => (
              <ListRow key={row} title={row} />
            ))}
          </Card>
        </div>
      </BoardGroup>
      <BoardGroup title={t.ruled}>
        <RuledSection
          title={t.ruledTitle}
          info={t.ruledInfo}
          count={3}
          actions={
            <Button size="xs" variant="ghost">
              {t.ruledAction}
            </Button>
          }
        >
          <Text variant="small" className="text-fg-muted">
            {t.ruledBody}
          </Text>
        </RuledSection>
      </BoardGroup>
      <BoardGroup title={t.collapsible} aside={t.collapsibleHint}>
        <div className="lib-stack lib-stack-wide">
          <CollapsibleSection
            title={t.providerName}
            leading={<ProviderLogo provider="openai" className="size-5" />}
            meta={t.modelCount(MODELS.length)}
            open={groupOpen}
            onOpenChange={setGroupOpen}
            actions={
              <IconButton label={t.addModel} size="sm" variant="ghost">
                <GlyphIcon d={ICONS.plus} size={ICON_SIZE.inlineGlyph} />
              </IconButton>
            }
          >
            {MODELS.map((model) => (
              <ListRow key={model} title={model} />
            ))}
          </CollapsibleSection>
          <CollapsibleSection title={t.foldedTitle} meta={t.modelCount(0)} defaultOpen={false}>
            <p className="px-3 py-2 text-xs text-fg-subtle">{t.foldedBody}</p>
          </CollapsibleSection>
        </div>
      </BoardGroup>
      <BoardGroup title={t.entity}>
        <EntityHeader
          media={<AgentAvatar id={AGENT_ID} name={t.entityName} size={40} />}
          name={t.entityName}
          meta={
            <>
              <span className="font-mono">{AGENT_ID}</span>
              <CopyButton text={AGENT_ID} label={t.copyId} size="sm" />
            </>
          }
          description={t.entityDescription}
          actions={
            <Button size="sm" variant="primary">
              {t.entityAction}
            </Button>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {t.entityTags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </EntityHeader>
      </BoardGroup>
      <BoardGroup title={t.nav} aside={t.navHint}>
        <div className="lib-stack lib-stack-wide">
          <span className="lib-caption">{t.navRail}</span>
          <div className="lib-box" data-narrow>
            <NavList label={t.navLabel} className="p-3">
              {NAV_PAGES.map((page) => (
                <NavRow
                  key={page.key}
                  label={t.navRows[page.key]}
                  glyph={page.glyph}
                  active={navPage === page.key}
                  disabled={page.key === "billing"}
                  badge={page.key === "schedules" ? <Count n={3} /> : undefined}
                  onClick={() => setNavPage(page.key)}
                />
              ))}
            </NavList>
          </div>
          <span className="lib-caption">{t.navDense}</span>
          <div className="lib-box" data-narrow>
            <NavList label={t.navDense} className="p-2">
              {NAV_PAGES.slice(0, 3).map((page) => (
                <NavRow
                  key={page.key}
                  density="sm"
                  label={t.navRows[page.key]}
                  glyph={page.glyph}
                  active={navPage === page.key}
                  onClick={() => setNavPage(page.key)}
                />
              ))}
            </NavList>
          </div>
        </div>
      </BoardGroup>
    </div>
  );
}
