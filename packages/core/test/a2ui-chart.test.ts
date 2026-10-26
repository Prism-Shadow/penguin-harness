/**
 * The `chart` block (a2ui/chart.ts), read through parseA2ui and printed through
 * toFallbackMarkdown — the two doors every renderer, the CLI and the checker go through.
 *
 * - Given a valid block of each of the seven kinds, it round-trips to its spec with no issue.
 * - Given a gauge, its `item` obeys every metrics-item rule, and the gauge prints the same line a
 *   one-item metrics block prints.
 * - Given a field its kind does not read (series on a gauge, stacked on a pie, categories or
 *   values on a scatter), it warns `ignored_field`, keeps the spec, and leaves the field out.
 * - Given each L1 mistake, the error names it at its path and the spec is withheld.
 * - Given more than a warn mark (series, categories, slices, points), it warns and keeps the spec.
 * - As text: up to 20 rows print one row per category or bin with every series' value; more
 *   print one summary line per series; a pie prints each slice's share; a scatter series prints
 *   its extents; zh words; an `asOf` adds the "As of" foot.
 * - seriesExtent skips the gaps, and has nothing to say about a series with no reading.
 */
import { describe, expect, it } from "vitest";
import { parseA2ui, seriesExtent, toFallbackMarkdown } from "../src/a2ui/index.js";

const parse = (value: unknown) => parseA2ui(JSON.stringify(value));
const errorPaths = (value: unknown) =>
  parse(value)
    .issues.filter((issue) => issue.level === "error")
    .map((issue) => [issue.code, issue.path]);
const warnings = (value: unknown) =>
  parse(value)
    .issues.filter((issue) => issue.level === "warning")
    .map((issue) => [issue.code, issue.path]);
const fence = (spec: unknown) => `\`\`\`a2ui\n${JSON.stringify(spec)}\n\`\`\``;
// Sunday 2026-10-04, 06:05 UTC.
const at = { now: new Date("2026-10-04T06:05:00Z"), timeZone: "UTC" };
const text = (spec: unknown, lang: "en" | "zh" = "en") =>
  toFallbackMarkdown(fence(spec), { lang, ...at });

const line = {
  type: "chart",
  kind: "line",
  title: "p95 latency",
  categories: ["00:00", "06:00", "12:00", "18:00"],
  series: [{ label: "p95", values: [180, 210, null, 190] }],
  xLabel: "Hour",
  yLabel: "Latency",
  yUnit: "ms",
  min: 100,
  decimals: 0,
  asOf: "2026-10-04T06:00:00Z",
};
const area = {
  type: "chart",
  kind: "area",
  categories: ["Q1", "Q2", "Q3"],
  series: [
    { label: "Cache read", values: [40, 52, 61] },
    { label: "Output", values: [12, 15, 9] },
  ],
  yUnit: "M tokens",
  stacked: true,
};
const bar = {
  type: "chart",
  kind: "bar",
  title: "Build time",
  categories: ["Mon", "Tue", "Wed"],
  series: [
    { label: "main", values: [120, null, 98] },
    { label: "dev", values: [130, 110, 101] },
  ],
  yUnit: "s",
  horizontal: true,
};
const pie = {
  type: "chart",
  kind: "pie",
  title: "Lines by kind",
  categories: ["Docs", "Code", "Tests"],
  series: [{ label: "Lines", values: [1240, 2010, 10] }],
  donut: true,
};
const scatter = {
  type: "chart",
  kind: "scatter",
  series: [
    {
      label: "Requests",
      points: [
        [1, 120],
        [4, 140],
        [2, 98],
      ],
    },
  ],
  xLabel: "Size",
  xUnit: "KB",
  yUnit: "ms",
};
const histogram = {
  type: "chart",
  kind: "histogram",
  edges: [0, 10, 20, 50],
  series: [{ label: "Requests", values: [12, 30, 4] }],
  xUnit: "ms",
};
const disk = {
  label: "Disk",
  value: 320,
  max: 512,
  kind: "used",
  unit: "GB",
  warn: 300,
  danger: 480,
};
const gauge = { type: "chart", kind: "gauge", item: disk };

describe("parseA2ui: chart", () => {
  it.each([
    ["line", line],
    ["area", area],
    ["bar", bar],
    ["pie", pie],
    ["scatter", scatter],
    ["histogram", histogram],
    ["gauge", gauge],
  ])("a valid %s chart round-trips to its spec with no issue", (_kind, input) => {
    const result = parse(input);
    expect(result.issues).toEqual([]);
    expect(result.spec).toEqual(input);
  });

  it("a gauge's item obeys every metrics-item rule", () => {
    const quota = { label: "Quota", value: 1240, kind: "remaining" };
    expect(errorPaths({ ...gauge, item: quota })).toEqual([["missing_field", "item.max"]]);
    expect(
      errorPaths({ ...gauge, item: { ...quota, max: 5000, warn: 250, danger: 1000 } }),
    ).toEqual([["range_invalid", "item.warn"]]);
    expect(errorPaths({ ...gauge, item: { value: 3 } })).toEqual([["missing_field", "item.label"]]);
    expect(errorPaths({ type: "chart", kind: "gauge", value: 37 })).toEqual([
      ["missing_field", "item"],
    ]);
  });

  it("a field the kind does not read warns, and the spec leaves it out", () => {
    const loose = { ...gauge, series: line.series, min: 0 };
    expect(warnings(loose)).toEqual([
      ["ignored_field", "series"],
      ["ignored_field", "min"],
    ]);
    expect(parse(loose).spec).toEqual(gauge);

    const stackedPie = { ...pie, stacked: true, xLabel: "Kind" };
    expect(warnings(stackedPie)).toEqual([
      ["ignored_field", "xLabel"],
      ["ignored_field", "stacked"],
    ]);
    expect(parse(stackedPie).spec).toEqual(pie);

    const scatterWithValues = {
      ...scatter,
      categories: ["a"],
      series: [{ ...scatter.series[0], values: [1] }],
    };
    expect(warnings(scatterWithValues)).toEqual([
      ["ignored_field", "categories"],
      ["ignored_field", "series[0].values"],
    ]);
    expect(parse(scatterWithValues).spec).toEqual(scatter);
  });

  it.each([
    ["a kind outside the seven", { ...bar, kind: "radar" }, [["invalid_enum", "kind"]]],
    [
      "a series with fewer values than categories",
      { ...line, series: [{ label: "p95", values: [1, 2, 3] }] },
      [["length_mismatch", "series[0].values"]],
    ],
    [
      "a histogram with fewer counts than bins",
      { ...histogram, series: [{ label: "Requests", values: [12, 30] }] },
      [["length_mismatch", "series[0].values"]],
    ],
    [
      "bin edges that do not go strictly up",
      { ...histogram, edges: [0, 10, 10, 50] },
      [["range_invalid", "edges[2]"]],
    ],
    [
      "a pie whose slices are all 0",
      { ...pie, series: [{ label: "Lines", values: [0, 0, 0] }] },
      [["range_invalid", "series[0].values"]],
    ],
    [
      "a negative slice",
      { ...pie, series: [{ label: "Lines", values: [-1, 2, 3] }] },
      [["range_invalid", "series[0].values[0]"]],
    ],
    [
      "a gap in a pie",
      { ...pie, series: [{ label: "Lines", values: [1, null, 3] }] },
      [["wrong_type", "series[0].values[1]"]],
    ],
    [
      "two slices with one name",
      { ...pie, categories: ["Docs", "Docs", "Tests"] },
      [["duplicate_label", "categories[1]"]],
    ],
    [
      "two series on a pie",
      { ...pie, series: [pie.series[0], { label: "Words", values: [1, 2, 3] }] },
      [["count_out_of_range", "series"]],
    ],
    [
      "two series with one label",
      { ...bar, series: [bar.series[0], { ...bar.series[1], label: "main" }] },
      [["duplicate_label", "series[1].label"]],
    ],
    [
      "a negative value in a stacked chart",
      { ...area, series: [{ label: "Cache read", values: [40, -5, 61] }] },
      [["range_invalid", "series[0].values[1]"]],
    ],
    [
      "a point that is not [x, y]",
      { ...scatter, series: [{ label: "Requests", points: [[1, 2], [3]] }] },
      [["wrong_type", "series[0].points[1]"]],
    ],
    ["a min not below max", { ...line, min: 300, max: 200 }, [["range_invalid", "min"]]],
    [
      "a bar chart without categories",
      { ...bar, categories: undefined },
      [["missing_field", "categories"]],
    ],
    [
      "an empty category",
      { ...bar, categories: ["Mon", " ", "Wed"] },
      [["empty_string", "categories[1]"]],
    ],
  ])("rejects %s and withholds the spec", (_case, input, expected) => {
    expect(errorPaths(input)).toEqual(expected);
    expect(parse(input).spec).toBeUndefined();
  });

  it("warns past the marks and keeps the spec: series > 4, categories > 24, slices > 6, points > 200", () => {
    const series = Array.from({ length: 5 }, (_, i) => ({ label: `S${i}`, values: [1, 2, 3] }));
    const categories = Array.from({ length: 25 }, (_, i) => `D${i + 1}`);
    const slices = Array.from({ length: 7 }, (_, i) => `Slice ${i + 1}`);
    const points = Array.from({ length: 201 }, (_, i) => [i, i * 2]);
    const cases: [unknown, string, string][] = [
      [{ ...area, series }, "chart_many_series", "series"],
      [
        { ...line, categories, series: [{ label: "p95", values: categories.map(() => 1) }] },
        "chart_many_categories",
        "categories",
      ],
      [
        { ...pie, categories: slices, series: [{ label: "Lines", values: slices.map(() => 1) }] },
        "pie_many_slices",
        "categories",
      ],
      [
        { ...scatter, series: [{ label: "Requests", points }] },
        "scatter_many_points",
        "series[0].points",
      ],
    ];
    for (const [input, code, path] of cases) {
      expect(warnings(input)).toEqual([[code, path]]);
      expect(parse(input).spec).toBeDefined();
    }
  });
});

describe("toFallbackMarkdown: chart", () => {
  it("up to 20 categories print one row each, with every series' value and a word for a gap", () => {
    expect(text(bar)).toBe(
      [
        "**Build time**",
        "",
        "- Mon: main 120 s · dev 130 s",
        "- Tue: main no reading · dev 110 s",
        "- Wed: main 98 s · dev 101 s",
      ].join("\n"),
    );
    expect(text(bar, "zh")).toBe(
      [
        "**Build time**",
        "",
        "- Mon：main 120 s · dev 130 s",
        "- Tue：main 无读数 · dev 110 s",
        "- Wed：main 98 s · dev 101 s",
      ].join("\n"),
    );
  });

  it("a single series prints its values alone, and an `asOf` adds the time it was read", () => {
    expect(text(line)).toBe(
      [
        "**p95 latency**",
        "",
        "- 00:00: 180 ms",
        "- 06:00: 210 ms",
        "- 12:00: no reading",
        "- 18:00: 190 ms",
        "",
        "As of 06:00",
      ].join("\n"),
    );
  });

  it("more than 20 categories print one line per series: first to last, the range and the count", () => {
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    const long = {
      type: "chart",
      kind: "line",
      categories: hours,
      series: [
        { label: "p95", values: hours.map((_, i) => (i === 5 ? null : 100 + i)) },
        { label: "p50", values: hours.map(() => null) },
      ],
      yUnit: "ms",
    };
    expect(text(long)).toBe(
      ["- p95: 100 → 123 ms (min 100, max 123, 23 points)", "- p50: no reading"].join("\n"),
    );
    expect(text(long, "zh")).toBe(
      ["- p95：100 → 123 ms（最低 100，最高 123，23 个点）", "- p50：无读数"].join("\n"),
    );
  });

  it("a histogram prints a row per bin, named by its edges", () => {
    expect(text(histogram)).toBe(["- 0–10 ms: 12", "- 10–20 ms: 30", "- 20–50 ms: 4"].join("\n"));
  });

  it("a pie prints each slice with its share, and a sliver as under 1 %", () => {
    expect(text(pie)).toBe(
      [
        "**Lines by kind**",
        "",
        "- Docs: 1,240 (38%)",
        "- Code: 2,010 (62%)",
        "- Tests: 10 (<1%)",
      ].join("\n"),
    );
    expect(text({ ...pie, yUnit: "lines" }, "zh")).toContain("- Docs：1,240 lines（38%）");
  });

  it("a scatter series prints its count and the extent on each axis, named by the axis label", () => {
    expect(text(scatter)).toBe("- Requests: 3 points · Size 1–4 KB · y 98–140 ms");
  });

  it("a gauge prints the very line a one-item metrics block prints for the same reading", () => {
    const metrics = { type: "metrics", items: [disk] };
    expect(text(gauge)).toBe(text(metrics));
    expect(text(gauge)).toBe("- Disk: 320 GB — 320 / 512 GB used — warning");
    expect(text(gauge, "zh")).toBe(text(metrics, "zh"));
  });
});

describe("seriesExtent", () => {
  it("reads first, last, min, max and count over the readings, skipping the gaps", () => {
    expect(seriesExtent([null, 4, 9, null, 2])).toEqual({
      min: 2,
      max: 9,
      first: 4,
      last: 2,
      count: 3,
    });
  });

  it("has nothing to say about a series with no reading", () => {
    expect(seriesExtent([])).toBeUndefined();
    expect(seriesExtent([null, null])).toBeUndefined();
  });
});
