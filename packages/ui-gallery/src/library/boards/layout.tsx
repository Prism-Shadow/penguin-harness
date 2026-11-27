/**
 * 布局: a page frame with its header (the display title and its "?", the line under it, the way
 * back and the actions), the card padded and flush, the ruled section, the collapsible section
 * open and folded, the entity header, the navigation list at both densities, an app window's
 * title bar with all three controls, with close alone and with the app's pages to switch between,
 * the sidebar's app list in each of its rows' states, and the dock's start page as tiles at a
 * dock's width and as rows across a bottom band — all from the package.
 */
import { useState } from "react";
import {
  AgentAvatar,
  APP_ROW_ICON_PX,
  AppRow,
  AppShell,
  AppWindowBar,
  Badge,
  Button,
  Card,
  CardHeader,
  CollapsibleSection,
  CopyButton,
  Count,
  DockPicker,
  EntityHeader,
  GlyphAppIcon,
  GlyphIcon,
  GroupHeader,
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
  Rail,
  RailItem,
  RuledSection,
  Segmented,
  SidebarAccountButton,
  SidebarFrame,
  SidebarNavArea,
  SidebarSwitcherButton,
  Text,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/**
 * The start page's choices, as a conversation's right dock offers them: the App Center, then the
 * panels by their order. A Session tool wears the art the App Center gives it.
 */
const LAUNCH = [
  { key: "appCenter", glyph: ICONS.tiles },
  { key: "agents", glyph: ICONS.robotPair },
  { key: "terminal", glyph: ICONS.terminalWindow, art: "session-tools-terminal" },
  { key: "files", glyph: ICONS.folder, art: "session-tools-workspace" },
  { key: "memory", glyph: ICONS.brain },
  { key: "trace", glyph: ICONS.eye },
  { key: "remote", glyph: ICONS.paperPlane },
  { key: "schedules", glyph: ICONS.alarmClock },
  { key: "browser", glyph: ICONS.globe, art: "session-tools-builtin-browser" },
] as const;

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
  const [shellWidth, setShellWidth] = useState<number | null>(null);
  const [shellFolded, setShellFolded] = useState(false);
  const [windowPage, setWindowPage] = useState("0");
  const [appsOpen, setAppsOpen] = useState(true);
  const [frontApp, setFrontApp] = useState<string | null>("notes");
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
          media={<AgentAvatar id={AGENT_ID} size={40} />}
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
      <BoardGroup title={t.window} aside={t.windowHint}>
        <div className="lib-stack lib-stack-wide">
          <span className="lib-caption">{t.windowFull}</span>
          <div className="lib-box">
            <AppWindowBar
              icon={<GlyphIcon d={ICONS.appWindow} size={ICON_SIZE.sectionMark} />}
              title={t.windowTitle}
              labels={{
                minimize: t.windowMinimize,
                fullScreen: t.windowFullScreen,
                close: t.windowClose,
              }}
              onMinimize={() => {}}
              onFullScreen={() => {}}
              onClose={() => {}}
            />
            <Text variant="caption" className="block px-3 py-6 text-center">
              {t.windowBody}
            </Text>
          </div>
          <span className="lib-caption">{t.windowCloseOnly}</span>
          <div className="lib-box">
            <AppWindowBar
              icon={<GlyphIcon d={ICONS.appWindow} size={ICON_SIZE.sectionMark} />}
              title={t.windowTitle}
              labels={{
                minimize: t.windowMinimize,
                fullScreen: t.windowFullScreen,
                close: t.windowClose,
              }}
              onClose={() => {}}
            />
          </div>
          <span className="lib-caption">{t.windowPages}</span>
          <div className="lib-box">
            <AppWindowBar
              icon={<GlyphIcon d={ICONS.appWindow} size={ICON_SIZE.sectionMark} />}
              title={t.windowTitle}
              controls={
                <div className="shrink-0">
                  <Segmented
                    options={t.windowPageNames.map((label, i) => ({ value: String(i), label }))}
                    value={windowPage}
                    onChange={setWindowPage}
                    cols={3}
                  />
                </div>
              }
              labels={{
                minimize: t.windowMinimize,
                fullScreen: t.windowFullScreen,
                close: t.windowClose,
              }}
              onMinimize={() => {}}
              onFullScreen={() => {}}
              onClose={() => {}}
            />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.apps} aside={t.appsHint}>
        <div className="lib-box" data-narrow>
          <div className="bg-surface-muted p-2">
            <GroupHeader
              open={appsOpen}
              onToggle={() => setAppsOpen(!appsOpen)}
              glyph={ICONS.tiles}
              label={t.appsGroup}
              uppercase
              actions={
                <IconButton variant="ghost" size="sm" label={t.appsManage}>
                  <GlyphIcon d={ICONS.gear} size={ICON_SIZE.groupHeaderAction} />
                </IconButton>
              }
            />
            {appsOpen && (
              <ul aria-label={t.appsGroup} className="space-y-px">
                {(
                  [
                    { key: "board", glyph: ICONS.tiles, build: "ready", running: false },
                    { key: "notes", glyph: ICONS.penLine, build: "ready", running: true },
                    { key: "build", glyph: ICONS.chip, build: "building", running: false },
                    { key: "broken", glyph: ICONS.alarmClock, build: "failed", running: false },
                  ] as const
                ).map((app) => {
                  const state = app.running
                    ? t.appsRunning
                    : app.build === "building"
                      ? t.appsBuilding
                      : app.build === "failed"
                        ? t.appsFailed
                        : null;
                  const name = t.appsRows[app.key];
                  const label = state === null ? undefined : `${name} · ${state}`;
                  return (
                    <AppRow
                      key={app.key}
                      appKey={app.key}
                      icon={<GlyphAppIcon d={app.glyph} size={APP_ROW_ICON_PX} />}
                      name={name}
                      {...(label !== undefined ? { label, hint: label } : {})}
                      active={frontApp === app.key}
                      running={app.running}
                      build={app.build}
                      menuActions={[
                        {
                          id: frontApp === app.key ? "minimize" : "restore",
                          label: frontApp === app.key ? t.appsMinimize : t.appsRestore,
                          glyph: frontApp === app.key ? ICONS.minus : ICONS.appWindow,
                          onSelect: () => setFrontApp(frontApp === app.key ? null : app.key),
                        },
                        {
                          id: "settings",
                          label: t.appsSettings,
                          glyph: ICONS.gear,
                          onSelect: () => {},
                        },
                      ]}
                      moreLabel={t.appsMore}
                      onOpen={() => setFrontApp(app.key)}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.launch} aside={t.launchHint}>
        <div className="lib-stack lib-stack-wide">
          {([false, true] as const).map((band) => (
            <div key={String(band)} className="lib-stack lib-stack-wide">
              <span className="lib-caption">{band ? t.launchBand : t.launchDock}</span>
              <div
                className="lib-box flex"
                style={band ? { height: "11rem" } : { width: "22rem", maxWidth: "100%" }}
              >
                <DockPicker
                  horizontal={band}
                  label={t.launchLabel}
                  choices={LAUNCH.map((choice) => ({
                    key: choice.key,
                    name: t.launchNames[choice.key],
                    icon: (size) => (
                      <GlyphAppIcon
                        {...("art" in choice ? { appKey: choice.art } : {})}
                        d={choice.glyph}
                        size={size}
                      />
                    ),
                    ...(choice.key === "terminal"
                      ? { hint: `${t.launchNames.terminal} (${t.launchShortcut})` }
                      : {}),
                    onLaunch: () => {},
                  }))}
                />
              </div>
            </div>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.nav} aside={t.navHint}>
        <div className="lib-stack lib-stack-wide">
          <span className="lib-caption">{t.navRail}</span>
          <div className="lib-box" data-narrow>
            <NavList label={t.navLabel} className="p-3">
              {/* The list's primary action heads its rows: a row like the rest in most themes,
                  the hero button where a pack draws one. */}
              <NavRow primary label={t.navPrimary} glyph={ICONS.penLine} />
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
      <BoardGroup title={t.shell} aside={t.shellHint}>
        {/* The app window as the Web App lays it out: the pinned sidebar's end edge drags its
            width (and steps it with the arrow keys once focused), a double click puts back the
            theme's width, and folding to the rail and out again keeps the width dragged. */}
        <div className="lib-box" style={{ height: 360 }}>
          <AppShell
            navCollapsed={shellFolded}
            navResize={{ width: shellWidth, label: t.shellResize, onChange: setShellWidth }}
            nav={
              shellFolded ? (
                <Rail
                  head={
                    <RailItem
                      label={t.shellUnfold}
                      glyph={ICONS.chevronRightPipe}
                      className="shrink-0"
                      onClick={() => setShellFolded(false)}
                    />
                  }
                >
                  {NAV_PAGES.slice(0, 3).map((page) => (
                    <RailItem
                      key={page.key}
                      label={t.navRows[page.key]}
                      glyph={page.glyph}
                      active={navPage === page.key}
                      onClick={() => setNavPage(page.key)}
                    />
                  ))}
                </Rail>
              ) : (
                <SidebarFrame
                  switcher={<SidebarSwitcherButton label={t.shellProject} onClick={() => {}} />}
                  collapse={{ label: t.shellFold, onClick: () => setShellFolded(true) }}
                  pinned={
                    <SidebarNavArea>
                      {NAV_PAGES.slice(0, 3).map((page) => (
                        <NavRow
                          key={page.key}
                          surface="muted"
                          label={t.navRows[page.key]}
                          glyph={page.glyph}
                          active={navPage === page.key}
                          onClick={() => setNavPage(page.key)}
                        />
                      ))}
                    </SidebarNavArea>
                  }
                  account={
                    <SidebarAccountButton
                      avatar={<AgentAvatar id={AGENT_ID} size={24} />}
                      name={t.entityName}
                      expanded={false}
                      onClick={() => {}}
                    />
                  }
                />
              )
            }
          >
            <Text variant="caption" className="block px-3 py-6 text-center">
              {t.shellBody}
            </Text>
          </AppShell>
        </div>
      </BoardGroup>
    </div>
  );
}
