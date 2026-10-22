/**
 * The system-resource board: one machine's readings as a snapshot, built from the basic charts —
 * a tile per reading (CPU, memory, swap, load, uptime: the metrics block's tile, with its gauge,
 * bar and history), the disks as horizontal bars on one percent scale, and the network's received
 * and sent rates as a line chart over its last readings.
 *
 * The model gives the readings, not the judgement: the marks that colour them are fixed in the
 * grammar (resourcesTiles, resolveResources), the same ones the text fallback prints by, so a
 * tile, a disk's bar and the plain-text line always agree. The host names the board; the head
 * says when it was read.
 */
import {
  formatNumber,
  formatValue,
  resolveResources,
  resourcesTiles,
} from "@prismshadow/penguin-core/a2ui";
import type { A2uiResources, A2uiResourcesNetwork } from "@prismshadow/penguin-core/a2ui";
import type { ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { HBarChart } from "../../charts/cartesian/hbar-chart";
import { LineChart } from "../../charts/cartesian/line-chart";
import { useChartWidth } from "../../charts/chart-frame/chart-frame";
import type { ChartPaint } from "../../charts/marks/marks";
import { chartSummary } from "./chart-model";
import { MetricTile } from "./metrics-block";
import { WidgetSurface } from "./widget";

/** A calm disk's bar: the accent, as a calm tile's gauge is. */
const CALM: ChartPaint = { ink: "text-accent", swatch: "bg-accent" };

/** A disk's figures in the ink of its tone, as a tile's number takes it. */
const TONE_INK = {
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
} as const;

/** The network chart's height, px: a trend beside the tiles, not a chart of its own. */
const NETWORK_H = 120;
/** The width the network chart draws at before it is measured (a static render). */
const FALLBACK_WIDTH = 320;

/** A part of the board under its quiet name. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-fg-muted">{title}</div>
      {children}
    </div>
  );
}

/** The received and sent rates, oldest first, as two series of a line chart. */
function Network({ network, strings }: { network: A2uiResourcesNetwork; strings: A2uiStrings }) {
  const [frame, measured] = useChartWidth();
  const width = measured > 0 ? measured : FALLBACK_WIDTH;
  const lang = strings.lang;
  const series = [
    { label: strings.received, values: network.rx },
    { label: strings.sent, values: network.tx },
  ];
  // The readings carry no times, only an order: the plot prints no category axis and keeps no
  // band for one, and the caption under it says how many readings it spans, oldest at the left.
  const categories = network.rx.map(() => "");
  const summary = chartSummary(
    {
      type: "chart",
      kind: "line",
      title: strings.network,
      categories,
      series,
      yUnit: network.unit,
    },
    strings,
  );
  return (
    <div ref={frame} className="w-full min-w-0">
      <LineChart
        categories={categories}
        series={series}
        width={width}
        height={NETWORK_H}
        fmtValue={(v) => formatValue(v, network.unit, lang)}
        label={summary}
        captions={{ x: strings.lastReadings(network.rx.length) }}
      />
    </div>
  );
}

export function ResourcesBlock({ spec }: { spec: A2uiResources }) {
  const strings = useUiStrings().a2ui;
  const lang = strings.lang;
  const tiles = resourcesTiles(spec, lang);
  const { disks } = resolveResources(spec);
  return (
    <WidgetSurface
      kind="resources"
      label={spec.host ?? strings.resources}
      {...(spec.host !== undefined ? { title: spec.host } : {})}
      {...(spec.asOf !== undefined ? { asOf: spec.asOf } : {})}
    >
      <div className="flex flex-col gap-3">
        {tiles.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
            {tiles.map(({ key, metric }) => (
              <MetricTile
                key={key}
                metric={{ label: strings[key], ...metric }}
                lone={tiles.length === 1}
                lang={lang}
                strings={strings}
              />
            ))}
          </div>
        )}
        {disks.length > 0 && (
          <Section title={strings.disk}>
            <HBarChart
              rows={disks.map((disk) => ({
                label: disk.path,
                to: disk.share * 100,
                value: (
                  <span className={disk.tone !== undefined ? TONE_INK[disk.tone] : ""}>
                    {`${formatNumber(disk.used, lang)} / ${formatValue(disk.total, disk.unit, lang)}`}
                  </span>
                ),
                ...(disk.tone !== undefined ? { tone: disk.tone } : { paint: CALM }),
              }))}
              max={100}
              label={strings.disk}
            />
          </Section>
        )}
        {spec.network !== undefined && (
          <Section title={strings.network}>
            <Network network={spec.network} strings={strings} />
          </Section>
        )}
      </div>
    </WidgetSurface>
  );
}
