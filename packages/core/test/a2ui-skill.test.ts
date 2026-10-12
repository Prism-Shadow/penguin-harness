/**
 * The a2ui plugin as shipped: in the library with its support files; every example in SKILL.md
 * and references/components.md passes the checker it teaches (the documentation is the first
 * test case of the grammar); the numbers the skill quotes are the exported weights; the two data
 * scripts build blocks the catalog accepts; and the committed checker bundle was built from the
 * current a2ui sources.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { A2UI_SCORING, checkMermaid, checkReply, parseA2ui } from "../src/a2ui/index.js";
import { scanFences } from "../src/a2ui/fences.js";
import { libraryPlugin } from "../src/plugins/index.js";
import {
  BUNDLE_PATH,
  HASH_MARKER,
  hashA2uiSources,
  readBundleHash,
} from "../../../scripts/build-a2ui-check.mjs";

const skillDir = path.resolve(import.meta.dirname, "../../../plugins/a2ui/skills/a2ui");
const read = (file: string) => fs.readFile(path.join(skillDir, file), "utf8");

describe("the a2ui plugin", () => {
  it("is in the library, preinstalled, under office productivity, with the skill, its reference, its checker and its data scripts", () => {
    const plugin = libraryPlugin("a2ui");
    expect(plugin).toMatchObject({
      name: "a2ui",
      category: "office-productivity",
      preinstall: true,
    });
    expect(plugin!.skills.map((s) => s.name)).toEqual(["a2ui"]);
    expect(Object.keys(plugin!.skills[0]!.files ?? {}).sort()).toEqual([
      "references/components.md",
      "scripts/check.mjs",
      "scripts/sysinfo.mjs",
      "scripts/weather.mjs",
    ]);
  });

  for (const doc of ["SKILL.md", "references/components.md"]) {
    it(`${doc}: every top-level a2ui and mermaid fence passes without a single issue`, async () => {
      const spans = scanFences(await read(doc)).filter(
        (span) => span.lang === "a2ui" || span.lang === "mermaid",
      );
      if (doc.endsWith("components.md")) expect(spans.length).toBeGreaterThanOrEqual(10);
      for (const span of spans) {
        const source = span.body.join("\n");
        const issues = span.lang === "a2ui" ? parseA2ui(source).issues : checkMermaid(source);
        expect(issues, `${doc} line ${span.startLine}`).toEqual([]);
      }
    });

    it(`${doc}: every \`\`\`\`markdown example reply passes checkReply with a full score`, async () => {
      const examples = scanFences(await read(doc)).filter(
        (span) => span.lang === "markdown" && span.closed,
      );
      if (doc === "SKILL.md") expect(examples.length).toBeGreaterThanOrEqual(5);
      for (const span of examples) {
        const report = checkReply(span.body.join("\n"));
        expect(report.issues, `${doc} line ${span.startLine}`).toEqual([]);
        expect(report.score.total, `${doc} line ${span.startLine}`).toBe(100);
      }
    });
  }

  it("quotes the exported weights and the gate", async () => {
    const skill = await read("SKILL.md");
    expect(skill).toContain(`L2 loses ${A2UI_SCORING.l2PerWarning} per block warning`);
    expect(skill).toContain(`prose loses ${A2UI_SCORING.prosePerWarning} per prose warning`);
    expect(skill).toContain(`a total of ${A2UI_SCORING.passTotal} or more`);
    const reference = await read("references/components.md");
    expect(reference).toContain(`L2 = 100 − ${A2UI_SCORING.l2PerWarning} ×`);
    expect(reference).toContain(`prose = 100 − ${A2UI_SCORING.prosePerWarning} ×`);
    expect(reference).toContain(`total ≥ ${A2UI_SCORING.passTotal}`);
  });
});

/** A skill script: plain ESM with no type declarations, so it is imported by URL and typed here. */
async function importScript<T>(name: string): Promise<T> {
  return (await import(pathToFileURL(path.join(skillDir, "scripts", name)).href)) as T;
}

type Block = Record<string, unknown>;

interface WeatherScript {
  wmoToCondition(code: number, windSpeedKmh?: number): string;
  wwoToCondition(code: number | string, windSpeedKmh?: number): string;
  buildWeatherBlock(
    geo: object,
    forecast: object,
    opts: { days: number; hours: number; unit: "C" | "F"; lang: "zh" | "en" },
  ): Block;
  buildWeatherBlockFromWttr(
    data: object,
    opts: {
      place: string;
      days: number;
      hours: number;
      unit: "C" | "F";
      lang: "zh" | "en";
      now: number;
    },
  ): Block;
}

interface SysinfoScript {
  collectSysinfo(opts: { samples: number; interval: number }): Promise<object>;
  buildMetricsBlock(info: object, opts: { lang: "zh" | "en" }): Block;
}

/** A minimal Open-Meteo answer: Beijing at 14:15 local time, hours from 13:00, three days. */
const FIXTURE_GEO = { name: "Beijing", admin1: "Beijing", country: "China", latitude: 39.9 };
const HOURS = Array.from({ length: 11 }, (_, i) => `2026-10-04T${13 + i}:00`);
const FIXTURE_FORECAST = {
  utc_offset_seconds: 28_800,
  current: {
    time: "2026-10-04T14:15",
    temperature_2m: 18.4,
    relative_humidity_2m: 62,
    apparent_temperature: 17.2,
    is_day: 1,
    weather_code: 2,
    wind_speed_10m: 12.3,
    wind_direction_10m: 45,
  },
  hourly: {
    time: HOURS,
    temperature_2m: HOURS.map((_, i) => 17 + i / 2),
    weather_code: HOURS.map((_, i) => (i < 5 ? 2 : 3)),
    precipitation_probability: HOURS.map((_, i) => (i === 3 ? null : 10 * i)),
    is_day: HOURS.map((_, i) => (i < 6 ? 1 : 0)),
  },
  daily: {
    time: ["2026-10-04", "2026-10-05", "2026-10-06"],
    weather_code: [2, 61, 0],
    temperature_2m_max: [22.1, 19.4, 21],
    temperature_2m_min: [12.2, 11, 10.6],
    precipitation_probability_max: [20, 80, null],
  },
};

/**
 * A minimal wttr.in j1 answer as the service sends it now: strings throughout, and no
 * `localObsDateTime`. Beijing, observed at 11:41 UTC (19:41 local), read at 12:00 UTC.
 */
const FIXTURE_WTTR = {
  current_condition: [
    {
      observation_time: "11:41 AM",
      temp_C: "24",
      FeelsLikeC: "21",
      humidity: "27",
      weatherCode: "149",
      windspeedKmph: "8",
      winddirDegree: "159",
    },
  ],
  nearest_area: [{ areaName: [{ value: "Beijing" }], longitude: "116.388" }],
  weather: [
    {
      date: "2026-10-09",
      maxtempC: "27",
      mintempC: "17",
      astronomy: [{ sunrise: "06:18 AM", sunset: "05:45 PM" }],
      hourly: [
        { time: "1200", tempC: "25", weatherCode: "116", chanceofrain: "0" },
        { time: "2100", tempC: "23", weatherCode: "113", chanceofrain: "9" },
      ],
    },
    {
      date: "2026-10-10",
      maxtempC: "28",
      mintempC: "18",
      astronomy: [{ sunrise: "06:19 AM", sunset: "05:43 PM" }],
      hourly: [
        { time: "0", tempC: "21", weatherCode: "122", chanceofrain: "10" },
        { time: "300", tempC: "19", weatherCode: "296", chanceofrain: "60" },
        { time: "1200", tempC: "26", weatherCode: "113", chanceofrain: "1" },
      ],
    },
  ],
};

describe("the skill's data scripts", () => {
  it("weather.mjs maps WMO codes and turns an Open-Meteo answer into a valid weather block", async () => {
    const weather = await importScript<WeatherScript>("weather.mjs");
    expect([0, 3, 61, 95].map((code) => weather.wmoToCondition(code))).toEqual([
      "clear",
      "cloudy",
      "rain",
      "thunder",
    ]);
    expect(weather.wmoToCondition(1, 60)).toBe("wind");

    const block = weather.buildWeatherBlock(FIXTURE_GEO, FIXTURE_FORECAST, {
      days: 3,
      hours: 6,
      unit: "C",
      lang: "en",
    });
    expect(parseA2ui(JSON.stringify(block)).issues).toEqual([]);
    expect(block).toMatchObject({
      place: "Beijing",
      condition: "partly-cloudy",
      temp: 18,
      windDirection: "NE",
      asOf: "2026-10-04T14:15+08:00",
    });
    expect((block.hourly as Array<{ time: string }>).map((hour) => hour.time)).toEqual([
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
      "19:00",
    ]);
    expect(block.daily).toHaveLength(3);
  });

  it("weather.mjs maps WWO codes and turns a wttr.in answer into a valid weather block", async () => {
    const weather = await importScript<WeatherScript>("weather.mjs");
    expect([113, 122, 296, 389, 999].map((code) => weather.wwoToCondition(code))).toEqual([
      "clear",
      "cloudy",
      "rain",
      "thunder",
      "cloudy",
    ]);
    expect(weather.wwoToCondition("116", 55)).toBe("wind");

    const block = weather.buildWeatherBlockFromWttr(FIXTURE_WTTR, {
      place: "Beijing",
      days: 3,
      hours: 12,
      unit: "C",
      lang: "en",
      now: Date.UTC(2026, 9, 9, 12, 0),
    });
    expect(parseA2ui(JSON.stringify(block)).issues).toEqual([]);
    expect(block).toMatchObject({
      place: "Beijing",
      condition: "fog",
      temp: 24,
      night: true,
      windDirection: "SSE",
      asOf: "2026-10-09T19:41+08:00",
      source: "wttr.in",
    });
    expect((block.hourly as Array<{ time: string }>).map((hour) => hour.time)).toEqual([
      "21:00",
      "00:00",
      "03:00",
    ]);
    expect(block.daily).toHaveLength(2);
  });

  it("sysinfo.mjs takes a snapshot of this machine and builds a metrics block without errors", async () => {
    const sysinfo = await importScript<SysinfoScript>("sysinfo.mjs");
    const info = await sysinfo.collectSysinfo({ samples: 2, interval: 50 });
    const block = sysinfo.buildMetricsBlock(info, { lang: "en" });
    const { issues } = parseA2ui(JSON.stringify(block));
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
  });
});

describe("the bundled checker (scripts/check.mjs)", () => {
  it("was built from the current a2ui sources — run `pnpm build:a2ui-check` and commit when this fails", () => {
    expect(readBundleHash(BUNDLE_PATH), `no "${HASH_MARKER}" header in ${BUNDLE_PATH}`).toBe(
      hashA2uiSources(),
    );
  });

  it("starts with a shebang and the hash header", async () => {
    const head = (await fs.readFile(BUNDLE_PATH, "utf8")).split("\n", 2);
    expect(head[0]).toBe("#!/usr/bin/env node");
    expect(head[1]!.startsWith(HASH_MARKER)).toBe(true);
  });
});
