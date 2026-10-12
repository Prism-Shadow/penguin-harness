/**
 * The A2UI widgets (src/components/content/a2ui): weather, clock, countdown and metrics, each on
 * the shared widget surface and registered as the built-in renderer of its type.
 *
 * Static markup only, at an instant pinned with fake timers: the live widgets read the time as
 * they render, so the figures a test asserts are the ones that instant shows. Ticking, the
 * in-view observer and the animations run in a browser.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  A2uiClock,
  A2uiCountdown,
  A2uiMetric,
  A2uiWeather,
} from "@prismshadow/penguin-core/a2ui";
import { ClockBlock } from "../src/components/content/a2ui/clock-block";
import { CountdownBlock } from "../src/components/content/a2ui/countdown-block";
import { MetricsBlock } from "../src/components/content/a2ui/metrics-block";
import { a2uiRendererFor } from "../src/components/content/a2ui/registry";
import { WeatherBlock } from "../src/components/content/a2ui/weather-block";
import { renderStatic } from "../src/testing";

/** 14:05:09 in Shanghai on Sunday 2026-10-04. */
const AT = Date.UTC(2026, 9, 4, 6, 5, 9);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the widgets' registry", () => {
  it("draws the four widget types with their built-ins", () => {
    expect(a2uiRendererFor("weather")).toBe(WeatherBlock);
    expect(a2uiRendererFor("clock")).toBe(ClockBlock);
    expect(a2uiRendererFor("countdown")).toBe(CountdownBlock);
    expect(a2uiRendererFor("metrics")).toBe(MetricsBlock);
  });
});

describe("WeatherBlock", () => {
  const WEATHER: A2uiWeather = {
    type: "weather",
    place: "Beijing",
    condition: "partly-cloudy",
    temp: 18,
    high: 22,
    low: 12,
    feelsLike: 17,
    humidity: 62,
    windSpeed: 12,
    windDirection: "NE",
    hourly: [
      { time: "14:00", temp: 18, condition: "partly-cloudy" },
      { time: "15:00", temp: 19, condition: "cloudy" },
      { time: "16:00", temp: 17, condition: "rain", precip: 60 },
    ],
    daily: [
      { date: "2026-10-04", high: 22, low: 12, condition: "partly-cloudy", precip: 20 },
      { date: "2026-10-05", high: 19, low: 11, condition: "rain", precip: 80 },
    ],
    asOf: "2026-10-04T14:05+08:00",
    source: "Open-Meteo",
  };

  it("names the place, the condition and the temperature, and draws the condition", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 14, 10));
    const html = renderStatic(createElement(WeatherBlock, { spec: WEATHER }));
    expect(html).toContain('data-widget="weather"');
    expect(html).toContain('role="group" aria-label="Beijing, Partly cloudy, 18°C"');
    expect(html).toMatch(/<svg[^>]*data-art="true"[^>]*role="img" aria-label="Partly cloudy"/);
    expect(html).toContain(">18°<");
    expect(html).toContain("Feels like");
    expect(html).toContain("12 km/h NE");
    expect(html).toContain("As of ");
    expect(html).toContain("Source: Open-Meteo");
  });

  it("draws the next hours as a chart, and the coming days as rows from today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 14, 10));
    const html = renderStatic(createElement(WeatherBlock, { spec: WEATHER }));
    expect(html).toMatch(/<svg[^>]*role="img" aria-label="Next hours: 14:00 18°, 15:00 19°/);
    expect(html).toContain("ui-chart");
    expect(html).toContain('data-condition="cloudy"');
    expect(html).toContain("Today");
    expect(html).toContain("Mon");
    expect(html).toContain("80%");
    // The forecast's small drawings hold still: only the large one carries loops.
    const still = html.match(/<svg[^>]*data-condition="rain"[\s\S]*?<\/svg>/g) ?? [];
    expect(still.length).toBeGreaterThan(0);
    for (const art of still) expect(art).not.toContain("data-anim");
  });
});

describe("ClockBlock", () => {
  it("shows a zone's time in a <time>, at the instant it renders", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT);
    const spec: A2uiClock = {
      type: "clock",
      zones: [{ zone: "Asia/Shanghai", label: "Beijing" }],
      hourCycle: "24",
    };
    const html = renderStatic(createElement(ClockBlock, { spec }));
    expect(html).toContain('data-widget="clock"');
    // Attribute names in HTML are case-insensitive: `datetime` matches however it is spelled.
    expect(html).toMatch(/<time datetime="2026-10-04T06:05:09.000Z"[^>]*>14:05<\/time>/i);
    expect(html).toContain("Beijing");
  });

  it("lays several zones out as tiles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT);
    const spec: A2uiClock = {
      type: "clock",
      zones: [{ zone: "local" }, { zone: "America/New_York" }, { zone: "Europe/London" }],
    };
    const html = renderStatic(createElement(ClockBlock, { spec }));
    expect(html.match(/data-tile=/g)?.length).toBe(3);
    expect(html).toContain("Local time");
    expect(html).toContain("New York");
  });

  it("leaves the dial's seconds hand off under reduced motion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT);
    const spec: A2uiClock = { type: "clock", style: "analog" };
    expect(renderStatic(createElement(ClockBlock, { spec }))).toContain('data-hand="second"');
    // The gallery's switch on the root, as a browser would answer it.
    const motion = (name: string) => (name === "data-motion" ? "reduced" : null);
    vi.stubGlobal("document", { documentElement: { getAttribute: motion } });
    const still = renderStatic(createElement(ClockBlock, { spec }));
    expect(still).toContain('data-hand="minute"');
    expect(still).not.toContain('data-hand="second"');
  });
});

describe("CountdownBlock", () => {
  const after = (seconds: number) => new Date(AT + seconds * 1000).toISOString();

  it("counts hours, minutes and seconds on the last day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT);
    const spec: A2uiCountdown = {
      type: "countdown",
      to: after(3 * 3600 + 4 * 60 + 12),
      label: "Launch",
    };
    const html = renderStatic(createElement(CountdownBlock, { spec }));
    expect(html).toContain('aria-label="Launch"');
    expect(html).toMatch(/>03<[\s\S]*>hours<[\s\S]*>04<[\s\S]*>min<[\s\S]*>12<[\s\S]*>sec</);
    expect(html).toMatch(/<time datetime="[^"]+"/i);
  });

  it("says the moment came once it has, in the model's words or the default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT);
    const past: A2uiCountdown = { type: "countdown", to: after(-60), label: "Launch" };
    expect(renderStatic(createElement(CountdownBlock, { spec: past }))).toContain("Time&#x27;s up");
    const named = renderStatic(
      createElement(CountdownBlock, { spec: { ...past, doneLabel: "Launched" } }),
    );
    expect(named).toContain('aria-label="Launch, Launched"');
    expect(named).toContain("text-tone-done-fg");
    expect(named).not.toContain("data-figure");
  });
});

describe("MetricsBlock", () => {
  const metrics = (...items: A2uiMetric[]) =>
    renderStatic(
      createElement(MetricsBlock, {
        spec: { type: "metrics", items, asOf: "2026-10-04T14:05+08:00" },
      }),
    );
  /** The class of the first figure in the markup. */
  const figureClass = (html: string) => html.match(/data-figure="true" class="([^"]*)"/)?.[1];

  it("makes a reading out of a whole a meter, with a ring, and a history a sparkline", () => {
    const html = metrics({ label: "CPU", value: 37, max: 100, unit: "%", history: [20, 30, 37] });
    expect(html).toContain('data-widget="metrics"');
    expect(html).toContain('role="meter" aria-label="CPU" aria-valuemin="0" aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="37" aria-valuetext="37%"');
    expect(html).toContain('data-part="grid"'); // the ring's track
    expect(html).toContain('data-tooltip="CPU"'); // the sparkline
    expect(figureClass(html)).not.toMatch(/text-tone-/);
  });

  it("inks a reading past its danger mark along the way `worse` reads", () => {
    const high = metrics({ label: "CPU", value: 97, max: 100, unit: "%", warn: 80, danger: 95 });
    expect(figureClass(high)).toContain("text-tone-danger-fg");
    const low = metrics({
      label: "Quota",
      kind: "remaining",
      value: 200,
      max: 5000,
      warn: 1000,
      danger: 250,
    });
    expect(figureClass(low)).toContain("text-tone-danger-fg");
    const fine = metrics({ label: "Quota", kind: "remaining", value: 4000, max: 5000, warn: 1000 });
    expect(figureClass(fine)).not.toMatch(/text-tone-/);
  });

  it("draws a job's progress as a bar, done once complete", () => {
    const running = metrics({ label: "Upload", kind: "progress", value: 63, max: 100, unit: "%" });
    expect(running).toContain('role="progressbar" aria-label="Upload"');
    const done = metrics({ label: "Tasks", kind: "progress", value: 12, max: 12 });
    expect(figureClass(done)).toContain("text-tone-done-fg");
    expect(done).toContain(">Done<");
  });
});
