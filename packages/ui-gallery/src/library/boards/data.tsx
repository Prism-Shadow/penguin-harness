/**
 * 数据: the table framed on its own and bare inside a card at the small density, entity cards in a
 * section's grid (and the same grid in a narrow column), the facts line, a detail's fact rows,
 * list rows plain and opening what they name, rows with marks after their title, a list loading
 * and empty, rows whose text runs far past a narrow card (one of them trailed), label/value pairs
 * at both rungs, and a running job's log — all from the package.
 */
import type { ReactNode } from "react";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CollapsibleSection,
  EntityCard,
  EntityCardAction,
  EntityCardGrid,
  FactList,
  FactRow,
  GlyphAction,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  IconButton,
  KeyValue,
  KeyValueRow,
  ListRow,
  LogView,
  MetaLine,
  Pill,
  SettingsList,
  StatusMark,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** Ids, schedules, figures and command output are the same in both languages: data, not copy. */
const SCHEDULES = [
  { name: "daily-digest", period: "0 9 * * *", cost: "$0.42", enabled: true },
  { name: "inbox-triage", period: "*/30 * * * *", cost: "$1.08", enabled: true },
  { name: "weekly-report", period: "0 17 * * 5", cost: "$0.00", enabled: false },
];
const SPEND = ["$12.40", "$8.75", "$3.10"];
const SKILLS = ["pdf", "web-design", "continual-learning"];
/** Memory ids and dates; the second id runs long on purpose, as a title that must truncate. */
const MEMORIES = [
  { id: "local-proxy-noninteractive-shell-bypass", date: "2026-10-15" },
  {
    id: "penguinharness-0215-gemini-fetch-mismatch-inside-the-bundled-server-process-only",
    date: "2026-10-13",
  },
  { id: "verify-patents-and-literature-before-citing", date: "2026-10-15" },
  // A plugin wrote this one: its title carries the plugin's mark (`titleTrail`).
  {
    id: "continual-learning-keep-the-proxy-export-in-every-command",
    date: "2026-10-16",
    plugin: true,
  },
];
/** The cards' plugins: ids and versions are data, the same in both languages. */
const CARD_PLUGINS = [
  { name: "data-analysis", version: "2026.10.04.1" },
  { name: "meeting-notes", version: "2026.09.28.2" },
  { name: "slides", version: "2026.10.01.1" },
  { name: "repository-review-with-team-conventions", version: "2026.08.30.3" },
];
/** A detail's fact rows: the parts of one plugin on an Agent. */
const NOTES_SERVER = {
  name: "notes",
  transport: "http",
  target: "https://mcp.example.com/v1/notes/workspaces/team-handbook/sse",
};
/** The hook packages a list shows: two from plugins (one with two hook points), one of the user's. */
const HOOK_PACKAGES = [
  {
    name: "continual-learning",
    points: ["stop"],
    version: "2026.10.04.1",
    plugin: "Continual learning",
  },
  { name: "goal", points: ["user_prompt", "stop"], version: "2026.09.20.1", plugin: "Goal" },
  { name: "my-lint-reminder", points: ["stop"], version: "", plugin: null },
] as const;

/** A mark of a row's end: a glyph in a tone's ink, its sentence as its name and its hover. */
function Mark({ glyph, sentence }: { glyph: string; sentence: string }) {
  return (
    <span role="img" aria-label={sentence} data-tooltip={sentence} className="inline-flex shrink-0">
      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} className="text-tone-attention-fg" />
    </span>
  );
}
const ROOT = "~/.penguin/data";
const MACHINE_ID = "m_7f3a9c21";
const LOG = [
  "Pulling penguin-harness 0.2.13",
  "Verifying the download",
  "Stopping the server",
  "Starting the server on port 8930",
];

export function DataBoard() {
  const { S } = useGallery();
  const t = S.library.data;

  /**
   * The section's four cards: installed, an update behind (the dot on its button), available with
   * its one worded action, and a title and description longer than any card. `narrow` draws them
   * framed, on their own, as a column of cards outside a section would.
   */
  const cards = (narrow: boolean): ReactNode[] =>
    CARD_PLUGINS.map((plugin, i) => {
      const sample = t.cardSamples[i]!;
      const name = (verb: string) => t.cardActionName(verb, sample.title);
      const manage = (
        <EntityCardAction
          key="manage"
          glyph={ICONS.download}
          label={t.cardManage}
          name={name(t.cardManage)}
          onClick={() => {}}
        />
      );
      const actions: ReactNode[] =
        i === 0
          ? [manage]
          : i === 1
            ? [
                <EntityCardAction
                  key="update"
                  variant="secondary"
                  glyph={ICONS.rotateCw}
                  label={t.cardUpdate}
                  name={name(t.cardUpdate)}
                  dot
                  onClick={() => {}}
                />,
                manage,
              ]
            : i === 2
              ? [
                  <EntityCardAction
                    key="install"
                    glyph={ICONS.download}
                    label={t.cardInstall}
                    name={name(t.cardInstall)}
                    words="always"
                    onClick={() => {}}
                  />,
                ]
              : [
                  <EntityCardAction
                    key="uninstall"
                    variant="danger"
                    glyph={ICONS.trash}
                    label={t.cardUninstall}
                    name={name(t.cardUninstall)}
                    onClick={() => {}}
                  />,
                ];
      const status =
        i === 1
          ? { glyph: ICONS.rotateCw, tone: "attention" as const }
          : i === 2
            ? { glyph: ICONS.download }
            : { glyph: ICONS.checkCircle, tone: "success" as const };
      return (
        <EntityCard
          key={plugin.name}
          {...(narrow ? {} : { framed: false })}
          lead={<AgentAvatar id={plugin.name} size={36} />}
          title={sample.title}
          titleHint={plugin.name}
          description={sample.description}
          meta={[
            <span key="version" className="shrink-0 font-mono">
              v{plugin.version}
            </span>,
            <StatusMark key="status" {...status} label={sample.status} hint={sample.statusHint} />,
            sample.usedBy === "" ? null : (
              <span key="used" className="min-w-0 truncate">
                {sample.usedBy}
              </span>
            ),
          ]}
          tags={[
            <Badge key="category" variant="soft">
              {t.cardTag}
            </Badge>,
            <Badge key="builtin" variant="soft">
              {t.cardBuiltin}
            </Badge>,
          ]}
          actions={actions}
          onOpen={() => {}}
        />
      );
    });

  return (
    <div className="gf-board">
      <BoardGroup title={t.table} aside={t.tableHint}>
        <Table caption={t.caption} tableClassName="min-w-[32rem]">
          <TableHead>
            <TableHeaderCell>{t.columns.name}</TableHeaderCell>
            <TableHeaderCell>{t.columns.status}</TableHeaderCell>
            <TableHeaderCell>{t.columns.period}</TableHeaderCell>
            <TableHeaderCell align="right">{t.columns.cost}</TableHeaderCell>
            <TableHeaderCell />
          </TableHead>
          <TableBody>
            {SCHEDULES.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-mono text-xs">{row.name}</TableCell>
                <TableCell nowrap>
                  <Badge tone={row.enabled ? "success" : "neutral"}>
                    {row.enabled ? t.enabled : t.paused}
                  </Badge>
                </TableCell>
                <TableCell nowrap className="font-mono text-xs text-fg-muted">
                  {row.period}
                </TableCell>
                <TableCell numeric>{row.cost}</TableCell>
                <TableCell align="right" nowrap>
                  <Button size="sm" variant="ghost">
                    {row.enabled ? t.pause : t.enable}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      <BoardGroup title={t.bare}>
        <div className="lib-stack">
          <Card>
            <CardHeader title={t.spendTitle} />
            <Table framed={false} size="sm">
              <TableHead>
                <TableHeaderCell>{t.columns.employee}</TableHeaderCell>
                <TableHeaderCell align="right">{t.columns.cost}</TableHeaderCell>
              </TableHead>
              <TableBody>
                {t.employees.map((employee, i) => (
                  <TableRow key={employee}>
                    <TableCell>{employee}</TableCell>
                    <TableCell numeric>{SPEND[i]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </BoardGroup>
      <BoardGroup title={t.cards} aside={t.cardsHint}>
        <div className="lib-stack lib-stack-wide">
          <CollapsibleSection title={t.cardSection} meta={t.cardCount(CARD_PLUGINS.length)}>
            <EntityCardGrid>{cards(false)}</EntityCardGrid>
          </CollapsibleSection>
          <span className="lib-caption">{t.cardNarrow}</span>
          <div style={{ maxWidth: 360 }}>
            <EntityCardGrid>{cards(true)}</EntityCardGrid>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.metaLine} aside={t.metaLineHint}>
        <div className="lib-stack">
          <MetaLine>
            <span className="shrink-0 font-mono">v2026.10.04.1</span>
            <StatusMark glyph={ICONS.checkCircle} tone="success" label={t.cardSamples[0]!.status} />
            <span className="min-w-0 truncate">{t.cardSamples[0]!.usedBy}</span>
          </MetaLine>
          <div style={{ maxWidth: 280 }}>
            <MetaLine>
              <span className="shrink-0 font-mono">v2026.10.04.1</span>
              <StatusMark
                glyph={ICONS.checkCircle}
                tone="success"
                label={t.cardSamples[0]!.status}
              />
              <span className="min-w-0 truncate">{t.metaLineUsedBy}</span>
            </MetaLine>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.factRows} aside={t.factRowsHint}>
        <div className="lib-stack">
          <FactList label={t.factListLabel}>
            <FactRow glyph={ICONS.fishHook} name="continual-learning" mono>
              <span className="font-mono">2026.10.04.1</span>
            </FactRow>
            <FactRow
              glyph={ICONS.plug}
              name={NOTES_SERVER.name}
              mono
              trailing={
                <>
                  <Mark glyph={ICONS.key} sentence={t.factKeys} />
                  <Mark glyph={ICONS.signIn} sentence={t.factSignIn} />
                </>
              }
            >
              <span className="font-mono">{NOTES_SERVER.transport}</span>
              <span
                className="font-mono"
                data-tooltip={NOTES_SERVER.target}
                data-tooltip-content="code"
              >
                {NOTES_SERVER.target}
              </span>
            </FactRow>
            <FactRow
              glyph={ICONS.anvil}
              name="board"
              mono
              muted
              trailing={
                <Pill tone="attention" tooltip={t.factMissingHint}>
                  {t.factMissing}
                </Pill>
              }
            />
          </FactList>
        </div>
      </BoardGroup>
      <BoardGroup title={t.rows} aside={t.rowsHint}>
        <div className="lib-stack lib-stack-wide">
          <Card padding="none">
            {SKILLS.map((skill, i) => (
              <ListRow
                key={skill}
                leading={<AgentAvatar id={skill} size={32} />}
                title={<span className="font-mono">{skill}</span>}
                description={t.skillDescriptions[i]}
                meta={t.skillMeta}
                trailing={
                  <IconButton label={t.exportSkill(skill)} size="sm" variant="ghost">
                    <GlyphIcon d={ICONS.download} size={ICON_SIZE.inlineGlyph} />
                  </IconButton>
                }
              />
            ))}
          </Card>
          <span className="lib-caption">{t.clickable}</span>
          <Card padding="none" as="section">
            {t.cases.map((title, i) => (
              <ListRow
                key={title}
                title={title}
                description={`case-0${i + 1}`}
                onClick={() => {}}
              />
            ))}
          </Card>
        </div>
      </BoardGroup>
      <BoardGroup title={t.trailRows} aside={t.trailRowsHint}>
        <div className="lib-stack lib-stack-wide">
          <SettingsList label={t.trailListLabel}>
            {HOOK_PACKAGES.map((pkg, i) => (
              <ListRow
                key={pkg.name}
                as="li"
                leading={<AgentAvatar id={pkg.name} size={32} />}
                title={<span className="font-mono">{pkg.name}</span>}
                titleTrail={
                  <>
                    {pkg.plugin !== null && (
                      <GlyphAction
                        glyph={ICONS.puzzle}
                        label={t.trailFromPlugin(pkg.plugin)}
                        onClick={() => {}}
                      />
                    )}
                    {pkg.points.map((point) => (
                      <Badge key={point} variant="outline">
                        {point}
                      </Badge>
                    ))}
                  </>
                }
                description={t.trailDescriptions[i]}
                meta={pkg.version || undefined}
                trailing={
                  <>
                    <IconButton label={t.trailExport(pkg.name)} size="sm" variant="ghost">
                      <GlyphIcon d={ICONS.download} size={ICON_SIZE.iconButton} />
                    </IconButton>
                    <IconButton label={t.trailUninstall(pkg.name)} size="sm" variant="danger">
                      <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                    </IconButton>
                  </>
                }
              />
            ))}
          </SettingsList>
        </div>
      </BoardGroup>
      <BoardGroup title={t.listStates}>
        <div className="lib-row items-start">
          <div className="lib-stack w-72">
            <span className="lib-caption">{t.listLoading}</span>
            <SettingsList label={t.trailListLabel} loading skeletonRows={3}>
              {[]}
            </SettingsList>
          </div>
          <div className="lib-stack w-72">
            <span className="lib-caption">{t.listEmpty}</span>
            <SettingsList label={t.trailListLabel} empty={t.listEmptyText}>
              {[]}
            </SettingsList>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.longRows} aside={t.longRowsHint}>
        <div className="lib-stack">
          <CollapsibleSection title={t.memoryTitle} meta={t.memoryCount(MEMORIES.length)}>
            <ul>
              {MEMORIES.map((memory, i) => (
                <ListRow
                  key={memory.id}
                  as="li"
                  title={<span className="font-mono">{memory.id}</span>}
                  {...(memory.plugin === true
                    ? {
                        titleTrail: (
                          <GlyphAction
                            glyph={ICONS.puzzle}
                            label={t.memoryFromPlugin}
                            onClick={() => {}}
                          />
                        ),
                      }
                    : {})}
                  description={t.memoryDescriptions[i]}
                  meta={<span className="tabular-nums">{memory.date}</span>}
                  trailing={
                    <>
                      <IconButton label={t.viewMemory(memory.id)}>
                        <GlyphIcon d={ICONS.eye} size={ICON_SIZE.iconButton} />
                      </IconButton>
                      <IconButton label={t.editMemory(memory.id)}>
                        <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.iconButton} />
                      </IconButton>
                      <IconButton variant="danger" label={t.deleteMemory(memory.id)}>
                        <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                      </IconButton>
                    </>
                  }
                />
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      </BoardGroup>
      <BoardGroup title={t.keyValue}>
        <div className="lib-row">
          <Card>
            <KeyValue>
              <KeyValueRow label={t.labels.version}>0.2.13</KeyValueRow>
              <KeyValueRow label={t.labels.started}>2026-09-30 09:12</KeyValueRow>
              <KeyValueRow label={t.labels.root} mono>
                {ROOT}
              </KeyValueRow>
              <KeyValueRow label={t.labels.machineId} mono>
                {MACHINE_ID}
              </KeyValueRow>
            </KeyValue>
          </Card>
          <KeyValue size="sm">
            <KeyValueRow label={t.labels.version}>0.2.13</KeyValueRow>
            <KeyValueRow label={t.labels.root} mono>
              {ROOT}
            </KeyValueRow>
          </KeyValue>
        </div>
      </BoardGroup>
      <BoardGroup title={t.log} aside={t.logHint}>
        <div className="lib-stack">
          <LogView lines={LOG} highlightLast label={t.logLabel} maxHeight="sm" />
        </div>
      </BoardGroup>
    </div>
  );
}
