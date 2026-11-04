/**
 * The charts page's basic charts: each chart drawn from data on fixed demo values, so the themes'
 * chart styles compare — bars grouped and stacked, a histogram, horizontal bars by value, by range
 * and stacked, a line with a gap, a stacked area, a bare line that traces in, a scatter of two
 * series, a pie and a donut, and gauges at rest, past the attention mark and past the danger mark.
 *
 * Every chart is given the width its box measures, the way an A2UI block gives it; each input is
 * built once (module level, or memoized on the dictionary), since a chart keeps effects keyed on
 * its data.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  BarChart,
  Gauge,
  HBarChart,
  LineChart,
  niceDomain,
  PieChart,
  ScatterChart,
  useChartWidth,
} from "@prismshadow/penguin-ui";
import type {
  CartesianSeries,
  HBarRow,
  HBarSeries,
  PieSlice,
  ScatterSeries,
  ToneName,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const ms = (v: number) => `${v} ms`;
const gb = (v: number) => `${v} GB`;
const degrees = (v: number) => `${v}°`;
const count = (v: number) => String(v);

/** The p50 and p95 latency of each day of a week, ms. */
const P50 = [120, 98, 143, 160, 151, 72, 64];
const P95 = [310, 280, 365, 402, 388, 190, 170];

/** Build minutes per runner over five weeks. */
const RUNNERS = [
  { label: "Linux", values: [42, 51, 38, 60, 57] },
  { label: "macOS", values: [18, 22, 25, 21, 30] },
  { label: "Windows", values: [30, 28, 35, 41, 33] },
] as const;

/** Response times in 50 ms bins up to 500 ms, and how many requests fell in each. */
const BIN_EDGES = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const BINS = BIN_EDGES.slice(1).map((edge, i) => `${BIN_EDGES[i]}–${edge}`);
const BIN_COUNTS = [4, 18, 42, 61, 38, 22, 11, 6, 3, 1];

/** Three disks, one fine, one past the attention mark and one past the danger mark. */
const DISKS: readonly HBarRow[] = [
  { label: "/", to: 41, value: "41 / 100 GB" },
  { label: "/data", to: 86, value: "431 / 500 GB", tone: "attention" },
  { label: "/backup", to: 96, value: "1.92 / 2 TB", tone: "danger" },
];

/** Each region's traffic, read and written, GB: one row each, the two stacked end to end. */
const REGIONS = [
  { name: "eu-west", read: 420, write: 120 },
  { name: "us-east", read: 610, write: 240 },
  { name: "ap-south", read: 180, write: 60 },
] as const;
const TRAFFIC: readonly HBarRow[] = REGIONS.map((region) => ({
  label: region.name,
  stack: [region.read, region.write],
  value: gb(region.read + region.write),
}));
const TRAFFIC_MAX = niceDomain(
  [REGIONS.map((region) => region.read), REGIONS.map((region) => region.write)],
  { stacked: true },
).max;

/** Five days' lows and highs, °, with the chance of rain. */
const DAYS = [
  { low: 12, high: 21, rain: 10 },
  { low: 10, high: 19, rain: 40 },
  { low: 8, high: 15, rain: 80 },
  { low: 11, high: 18, rain: 20 },
  { low: 14, high: 24, rain: 0 },
] as const;
const DAY_LOW = Math.min(...DAYS.map((d) => d.low));
const DAY_HIGH = Math.max(...DAYS.map((d) => d.high));

/** Eight hours of p95 latency for two services; the api missed its 13:00 reading. */
const HOURS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
const SERVICES: CartesianSeries[] = [
  { label: "api", values: [182, 190, 240, 228, null, 205, 260, 248] },
  { label: "web", values: [120, 128, 150, 162, 171, 140, 155, 149] },
];

/** Memory per process over the same hours, GB. */
const PROCESSES: CartesianSeries[] = [
  { label: "postgres", values: [3.2, 3.4, 3.9, 4.1, 4.0, 4.4, 4.6, 4.5] },
  { label: "node", values: [1.8, 2.1, 2.6, 2.4, 2.9, 3.1, 2.7, 2.8] },
  { label: "redis", values: [0.6, 0.6, 0.7, 0.8, 0.8, 0.9, 0.9, 1.0] },
];

/** Twelve hours of temperature, the way an hourly forecast hands them over. */
const FORECAST_HOURS = Array.from({ length: 12 }, (_, i) => `${String(9 + i).padStart(2, "0")}:00`);
const FORECAST: CartesianSeries[] = [
  {
    label: "",
    values: [14, 15, 17, 19, 21, 22, 22, 21, 19, 17, 16, 15],
    paint: { ink: "text-accent" },
  },
];

/** Two services' responses: size (KB) against latency (ms), a fixed scatter of each. */
const RESPONSES: readonly (readonly [number, number])[][] = [
  [
    [12, 110],
    [18, 128],
    [24, 142],
    [31, 150],
    [36, 171],
    [44, 182],
    [52, 205],
    [58, 214],
    [66, 238],
    [72, 246],
    [81, 262],
    [90, 281],
  ],
  [
    [8, 60],
    [14, 74],
    [20, 81],
    [27, 98],
    [33, 96],
    [41, 118],
    [47, 121],
    [55, 139],
    [63, 142],
    [70, 160],
    [78, 171],
    [86, 188],
  ],
];
const SERVICE_NAMES = ["api", "web"];
const kb = (v: number) => `${v} KB`;

/** What a storage volume holds, GB. */
const STORAGE_GB = [412, 268, 96, 31];

/** Three readings out of a whole: fine, past the attention mark, past the danger mark. */
const GAUGES: readonly { value: number; tone?: ToneName }[] = [
  { value: 37 },
  { value: 86, tone: "attention" },
  { value: 96, tone: "danger" },
];

/** A chart's box: it measures its width and hands it to the chart once known. */
function Measured({ children }: { children: (width: number) => ReactNode }) {
  const [ref, width] = useChartWidth();
  return (
    <div className="lib-box p-3">
      <div ref={ref} className="min-w-0">
        {width > 0 && children(width)}
      </div>
    </div>
  );
}

export function BasicCharts() {
  const { S } = useGallery();
  const t = S.library.charts.basic;
  const latency = useMemo<CartesianSeries[]>(
    () => [
      { label: "p50", values: P50 },
      { label: "p95", values: P95 },
    ],
    [],
  );
  const runners = useMemo<CartesianSeries[]>(
    () => RUNNERS.map((runner) => ({ label: runner.label, values: runner.values })),
    [],
  );
  const bins = useMemo<CartesianSeries[]>(() => [{ label: t.requests, values: BIN_COUNTS }], [t]);
  const days = useMemo<HBarRow[]>(
    () =>
      DAYS.map((day, i) => ({
        label: t.days[i] ?? "",
        from: day.low,
        to: day.high,
        aside: <span className="text-xs text-fg-muted tabular-nums">{`${day.rain}%`}</span>,
        value: `${day.low}° / ${day.high}°`,
        paint: { ink: "text-fg-subtle", swatch: "bg-fg-subtle" },
      })),
    [t],
  );
  const responses = useMemo<ScatterSeries[]>(
    () => RESPONSES.map((points, i) => ({ label: SERVICE_NAMES[i] ?? "", points })),
    [],
  );
  const storage = useMemo<PieSlice[]>(
    () => STORAGE_GB.map((value, i) => ({ label: t.storage[i] ?? "", value })),
    [t],
  );
  const traffic = useMemo<HBarSeries[]>(() => [{ label: t.read }, { label: t.write }], [t]);
  return (
    <>
      <BoardGroup title={t.bar} aside={t.barHint}>
        <Measured>
          {(width) => (
            <BarChart
              categories={t.days}
              series={latency}
              width={width}
              fmtValue={ms}
              label={t.latencyLabel}
              captions={{ y: t.latency }}
            />
          )}
        </Measured>
      </BoardGroup>
      <BoardGroup title={t.stacked} aside={t.stackedHint}>
        <Measured>
          {(width) => (
            <BarChart
              categories={t.weeks}
              series={runners}
              width={width}
              stacked
              fmtValue={t.minutes}
              label={t.buildLabel}
              captions={{ y: t.buildTime }}
            />
          )}
        </Measured>
      </BoardGroup>
      <BoardGroup title={t.histogram} aside={t.histogramHint}>
        <Measured>
          {(width) => (
            <BarChart
              categories={BINS}
              series={bins}
              width={width}
              flush
              fmtValue={count}
              label={t.histogramLabel}
              captions={{ x: t.responseTime, y: t.requests }}
            />
          )}
        </Measured>
      </BoardGroup>
      <BoardGroup title={t.hbar} aside={t.hbarHint}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="lib-box p-3">
            <HBarChart rows={DISKS} max={100} label={t.diskLabel} />
          </div>
          <div className="lib-box p-3">
            <HBarChart rows={days} min={DAY_LOW} max={DAY_HIGH} label={t.temperatureLabel} />
          </div>
          <div className="lib-box p-3 md:col-span-2">
            <HBarChart
              rows={TRAFFIC}
              max={TRAFFIC_MAX}
              series={traffic}
              fmtValue={gb}
              label={t.trafficLabel}
            />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.line} aside={t.lineHint}>
        <Measured>
          {(width) => (
            <LineChart
              categories={HOURS}
              series={SERVICES}
              width={width}
              fmtValue={ms}
              label={t.serviceLabel}
              captions={{ x: t.hour, y: t.latency }}
            />
          )}
        </Measured>
      </BoardGroup>
      <BoardGroup title={t.area} aside={t.areaHint}>
        <Measured>
          {(width) => (
            <LineChart
              categories={HOURS}
              series={PROCESSES}
              width={width}
              area
              stacked
              fmtValue={gb}
              label={t.memoryLabel}
              captions={{ y: t.memory }}
            />
          )}
        </Measured>
      </BoardGroup>
      <BoardGroup title={t.bare} aside={t.bareHint}>
        <Measured>
          {(width) => (
            <LineChart
              categories={FORECAST_HOURS}
              series={FORECAST}
              width={width}
              frame="bare"
              area
              pointLabels
              drawIn
              minSpan={6}
              fmtValue={degrees}
              label={t.forecastLabel}
            />
          )}
        </Measured>
      </BoardGroup>
      <BoardGroup title={t.scatter} aside={t.scatterHint}>
        <Measured>
          {(width) => (
            <ScatterChart
              series={responses}
              width={width}
              fmtX={kb}
              fmtY={ms}
              label={t.scatterLabel}
              captions={{ x: t.payload, y: t.latency }}
            />
          )}
        </Measured>
      </BoardGroup>
      <BoardGroup title={t.pie} aside={t.pieHint}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="lib-box p-3">
            <PieChart slices={storage} fmtValue={gb} label={t.storageLabel} />
          </div>
          <div className="lib-box p-3">
            <PieChart slices={storage} donut fmtValue={gb} label={t.storageLabel} />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.gauge} aside={t.gaugeHint}>
        <div className="grid gap-3 sm:grid-cols-3">
          {GAUGES.map((reading, i) => (
            <div key={i} className="lib-box flex flex-col gap-1 p-3">
              <span className="text-xs text-fg-muted">{t.gauges[i]}</span>
              <Gauge
                value={reading.value}
                max={100}
                figure={String(reading.value)}
                unit="%"
                label={t.gauges[i] ?? ""}
                {...(reading.tone !== undefined ? { tone: reading.tone } : {})}
              />
            </div>
          ))}
        </div>
      </BoardGroup>
    </>
  );
}
