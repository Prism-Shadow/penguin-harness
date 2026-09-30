/**
 * 数据: the table framed on its own and bare inside a card at the small density, list rows plain
 * and opening what they name, label/value pairs at both rungs, and a running job's log — all from
 * the package.
 */
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  CardHeader,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  IconButton,
  KeyValue,
  KeyValueRow,
  ListRow,
  LogView,
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
