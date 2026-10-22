/**
 * A chart block: one basic chart drawn from the data the model gave — a line or an area through
 * categories, bars (grouped, stacked or horizontal), a pie or a donut, a scatter of points, a
 * histogram's bins — or, for a gauge, its one reading as the metrics block's tile, so a lone
 * reading and a tile on a dashboard are the same thing.
 *
 * The block only maps the spec onto the basic charts (chart-model.ts) and sets them on the
 * widget surface; how a bar, a line or a slice looks is the chart's and the theme's. A chart
 * draws at the width its surface has, measured as it is laid out, and at a fixed width before
 * that (a static render, a test), so it is never blank. Its picture is named by a summary that
 * reads the data out in words; the title, when the model gave one, heads the surface.
 */
import type { A2uiChart } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import { BarChart } from "../../charts/cartesian/bar-chart";
import { HBarChart } from "../../charts/cartesian/hbar-chart";
import type { HBarRow } from "../../charts/cartesian/hbar-chart";
import { LineChart } from "../../charts/cartesian/line-chart";
import { useChartWidth } from "../../charts/chart-frame/chart-frame";
import { PieChart } from "../../charts/pie-chart/pie-chart";
import { ScatterChart } from "../../charts/scatter-chart/scatter-chart";
import { chartModel, chartSummary } from "./chart-model";
import type { ChartModel } from "./chart-model";
import { MetricTile } from "./metrics-block";
import { WidgetSurface } from "./widget";

/** The width a plot draws at before its surface is measured (a static render). */
const FALLBACK_WIDTH = 320;

type PlotModel = Extract<ChartModel, { draw: "bar" | "line" | "scatter" }>;

/** A plot across the surface's width: bars, a line or an area, a scatter. */
function Plot({ model, label }: { model: PlotModel; label: string }) {
  const [frame, measured] = useChartWidth();
  const width = measured > 0 ? measured : FALLBACK_WIDTH;
  const captions = model.captions !== undefined ? { captions: model.captions } : {};
  const bounds = {
    ...(model.min !== undefined ? { min: model.min } : {}),
    ...(model.max !== undefined ? { max: model.max } : {}),
  };
  return (
    <div ref={frame} className="w-full min-w-0">
      {model.draw === "bar" ? (
        <BarChart
          categories={model.categories}
          series={model.series}
          width={width}
          stacked={model.stacked}
          flush={model.flush}
          fmtValue={model.fmtValue}
          label={label}
          {...bounds}
          {...captions}
        />
      ) : model.draw === "line" ? (
        <LineChart
          categories={model.categories}
          series={model.series}
          width={width}
          area={model.area}
          stacked={model.stacked}
          fmtValue={model.fmtValue}
          label={label}
          {...bounds}
          {...captions}
        />
      ) : (
        <ScatterChart
          series={model.series}
          width={width}
          fmtX={model.fmtX}
          fmtY={model.fmtY}
          label={label}
          {...bounds}
          {...captions}
        />
      )}
    </div>
  );
}

/**
 * Horizontal bars on one scale. Grouped, each reading is a row: a category's rows follow one
 * another, the category named on the first and each row's series said to a screen reader. Stacked,
 * each category is one row of segments, its total after it. Either way the series' colours are
 * named by the legend the chart draws under the rows, and a stack's segments answer the pointer.
 */
function HBars({ model, label }: { model: Extract<ChartModel, { draw: "hbar" }>; label: string }) {
  const several = model.series.length > 1;
  const rows: HBarRow[] = model.rows.map((row) => {
    if (row.kind === "stack") return { label: row.category, stack: row.stack, value: row.value };
    const series = model.series[row.series]?.label ?? "";
    return {
      label: several ? (
        <>
          {row.first ? row.category : ""}
          <span className="sr-only">{row.first ? ` · ${series}` : series}</span>
        </>
      ) : (
        row.category
      ),
      from: row.from,
      to: row.to,
      value: row.value,
      series: row.series,
    };
  });
  return (
    <HBarChart
      rows={rows}
      min={model.min}
      max={model.max}
      series={model.series}
      fmtValue={model.fmtValue}
      label={label}
    />
  );
}

export function ChartBlock({ spec }: { spec: A2uiChart }) {
  const strings = useUiStrings().a2ui;
  const lang = strings.lang;
  const model = chartModel(spec, lang);
  const summary = chartSummary(spec, strings);
  return (
    <WidgetSurface
      kind="chart"
      // A gauge's summary is its title or its reading's name; a plot's picture has its own.
      label={model.draw === "gauge" ? summary : (spec.title ?? strings.chartKind[spec.kind])}
      // One reading, or a pie and its legend, sits in a box sized to it rather than at the left
      // of a wide empty one.
      fit={model.draw === "gauge" || model.draw === "pie"}
      {...(spec.title !== undefined ? { title: spec.title } : {})}
      {...(spec.asOf !== undefined ? { asOf: spec.asOf } : {})}
    >
      {model.draw === "gauge" ? (
        model.metric !== undefined && (
          <MetricTile metric={model.metric} lone lang={lang} strings={strings} />
        )
      ) : model.draw === "pie" ? (
        <PieChart
          slices={model.slices}
          donut={model.donut}
          fmtValue={model.fmtValue}
          label={summary}
        />
      ) : model.draw === "hbar" ? (
        <HBars model={model} label={summary} />
      ) : (
        <Plot model={model} label={summary} />
      )}
    </WidgetSurface>
  );
}
