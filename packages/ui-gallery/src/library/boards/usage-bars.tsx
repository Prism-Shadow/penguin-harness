/**
 * The usage bar, on the charts board: a data root split by kind at the page size with its legend
 * of sizes (a sliver of logs and plugins held visible beside gigabytes of Traces), three Projects
 * as list rows at the thin size on one scale (the largest fills its track), and the empty track
 * of a total not measured yet. The parts are identities: palette slots, and the neutral for
 * "other".
 */
import { UsageBar } from "@prismshadow/penguin-ui";
import type { ChartPaint, UsageSegment } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const KINDS = [
  "traces",
  "agentState",
  "workspaces",
  "scratchpads",
  "caches",
  "logs",
  "plugins",
  "other",
] as const;
type Kind = (typeof KINDS)[number];

/** The neutral "other" wears: outside the palette, so it never reads as one more kind. */
const NEUTRAL: ChartPaint = { ink: "text-fg-subtle", swatch: "bg-fg-subtle" };

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** Sizes are data: the same in both languages. */
const ROOT: Record<Kind, number> = {
  traces: 1.6 * GB,
  agentState: 412 * MB,
  workspaces: 1.1 * GB,
  scratchpads: 154.8 * MB,
  caches: 980 * MB,
  logs: 2.1 * MB,
  plugins: 0.6 * MB,
  other: 640 * MB,
};

const PROJECTS: { name: string; bytes: Partial<Record<Kind, number>> }[] = [
  { name: "docs-site", bytes: { traces: 1.1 * GB, workspaces: 820 * MB, caches: 610 * MB } },
  { name: "research", bytes: { traces: 420 * MB, agentState: 300 * MB, scratchpads: 90 * MB } },
  { name: "release-notes", bytes: { traces: 80 * MB, agentState: 112 * MB, caches: 40 * MB } },
];

function size(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function segmentsOf(bytes: Partial<Record<Kind, number>>, names: Record<Kind, string>) {
  return KINDS.map((kind, i): UsageSegment => ({
    key: kind,
    label: names[kind],
    value: bytes[kind] ?? 0,
    paint: kind === "other" ? NEUTRAL : { series: i },
    display: size(bytes[kind] ?? 0),
  }));
}

const sum = (bytes: Partial<Record<Kind, number>>) =>
  Object.values(bytes).reduce((n, v) => n + (v ?? 0), 0);

export function UsageBars() {
  const { S } = useGallery();
  const t = S.library.charts.usageBar;
  const largest = Math.max(...PROJECTS.map((p) => sum(p.bytes)));
  return (
    <BoardGroup title={t.title} aside={t.hint}>
      <div className="lib-stack lib-stack-wide">
        <div className="max-w-2xl space-y-2">
          <p className="text-sm font-medium tabular-nums">{t.used(size(sum(ROOT)))}</p>
          <UsageBar segments={segmentsOf(ROOT, t.kinds)} legend label={t.label} />
        </div>
        <ul className="max-w-2xl divide-y divide-line-muted">
          {PROJECTS.map((project) => (
            <li
              key={project.name}
              className="grid grid-cols-[minmax(0,1fr)_10rem_4.5rem] items-center gap-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">{project.name}</span>
              <UsageBar
                segments={segmentsOf(project.bytes, t.kinds)}
                size="sm"
                max={largest}
                label={project.name}
              />
              <span className="text-right tabular-nums">{size(sum(project.bytes))}</span>
            </li>
          ))}
        </ul>
        <div className="max-w-2xl space-y-2">
          <p className="text-sm text-fg-muted">{t.empty}</p>
          <UsageBar segments={segmentsOf({}, t.kinds)} legend label={t.label} />
        </div>
      </div>
    </BoardGroup>
  );
}
