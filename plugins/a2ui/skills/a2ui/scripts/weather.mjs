#!/usr/bin/env node
/**
 * Prints the weather at a place as an a2ui `weather` block to paste into a reply, read from
 * Open-Meteo, which needs no key: `node weather.mjs <place> [--days N] [--hours N] [--unit C|F]
 * [--lang zh|en|auto] [--json]`. The place is geocoded first (a Chinese name works), then the
 * forecast is read in the place's own time zone, so every hour and date in the block is local to
 * the place and `asOf` carries its UTC offset. Exit codes: 0 printed, 1 no such place or the
 * request failed, 2 usage.
 *
 * Plain ESM on Node builtins and the global fetch: the skill directory is installed on its own,
 * so this file imports neither core nor the checker. The builders are exported and the CLI runs
 * only when this file is the entry point, so a test can feed them a fixture and validate the
 * block with the catalog's own parser.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const USAGE = `usage: node weather.mjs <place> [--days N] [--hours N] [--unit C|F] [--lang zh|en|auto] [--json]

Reads the current weather and the forecast at a place from Open-Meteo (no key) and prints an a2ui
weather block to paste into the reply. The matched place goes to stderr: check it is the one meant.
  --days    days of forecast, 0-7 (default 5; fewer than 2 prints no daily rows)
  --hours   hours ahead, 0-24 (default 12; every hour up to 12, every 2 hours beyond)
  --unit    C or F (default C)
  --lang    zh or en for the place name and the wind direction; auto (default) picks zh for a
            place written in Chinese, Japanese or Korean script
  --json    print the bare JSON object instead of the fence
exit code: 0 printed · 1 no such place, or the request failed · 2 usage`;

const SOURCE = "Open-Meteo";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 10_000;
const CHECK_HINT = "Run check.mjs on the whole reply before sending.";
const PROXY_HINT = "Behind a proxy, set NODE_USE_ENV_PROXY=1.";
/** The catalog's limit on `place`, in code points. */
const PLACE_MAX = 60;
/** A dry sky with wind at or above this speed (km/h, a near gale) reads as "wind". */
const WINDY_KMH = 50;
const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

const CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "is_day",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
];
const HOURLY_FIELDS = ["temperature_2m", "weather_code", "precipitation_probability", "is_day"];
const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
];

/** Open-Meteo's `weather_code` values (WMO interpretation codes) by the catalog's condition. */
const WMO_CODES = {
  clear: [0],
  "partly-cloudy": [1, 2],
  cloudy: [3],
  fog: [45, 48],
  drizzle: [51, 53, 55],
  sleet: [56, 57, 66, 67],
  rain: [61, 63, 80, 81],
  "heavy-rain": [65, 82],
  snow: [71, 73, 75, 77, 85, 86],
  thunder: [95, 96, 99],
};
const CONDITION_BY_CODE = new Map();
for (const [condition, codes] of Object.entries(WMO_CODES)) {
  for (const code of codes) CONDITION_BY_CODE.set(code, condition);
}
const DRY = new Set(["clear", "partly-cloudy", "cloudy"]);

const COMPASS_EN = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");
const COMPASS_ZH = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const pad = (n) => String(n).padStart(2, "0");

/** Cuts a string to `max` code points, the unit the catalog's limits count. */
function clip(text, max) {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
}

/**
 * The catalog condition of a WMO weather code; an unknown code reads as "cloudy". A dry sky
 * (clear, partly cloudy or overcast) with wind at or above a near gale reads as "wind".
 */
export function wmoToCondition(code, windSpeedKmh = 0) {
  const condition = CONDITION_BY_CODE.get(code) ?? "cloudy";
  return DRY.has(condition) && windSpeedKmh >= WINDY_KMH ? "wind" : condition;
}

/** The compass point the wind blows from: 16 points in English ("NNE"), 8 in Chinese (东北). */
export function windDirectionName(degrees, lang) {
  const turn = ((degrees % 360) + 360) % 360;
  return lang === "zh"
    ? COMPASS_ZH[Math.round(turn / 45) % 8]
    : COMPASS_EN[Math.round(turn / 22.5) % 16];
}

/** Open-Meteo's local `current.time` ("2026-10-04T14:15") with the place's UTC offset appended. */
function asOfOf(time, offsetSeconds) {
  if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time)) return undefined;
  if (!isNumber(offsetSeconds)) return undefined;
  const minutes = Math.round(Math.abs(offsetSeconds) / 60);
  const sign = offsetSeconds < 0 ? "-" : "+";
  return `${time.slice(0, 16)}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The hours from the current one on: every hour up to 12 hours ahead, every 2 hours beyond. */
function hourlyEntries(forecast, hours) {
  const hourly = forecast.hourly;
  const now = forecast.current?.time;
  if (hours <= 0 || !Array.isArray(hourly?.time) || typeof now !== "string") return [];
  const thisHour = now.slice(0, 13);
  const start = hourly.time.findIndex((time) => String(time).slice(0, 13) >= thisHour);
  if (start === -1) return [];
  const step = hours <= 12 ? 1 : 2;
  const entries = [];
  for (let ahead = 0; ahead < hours; ahead += step) {
    const i = start + ahead;
    const time = hourly.time[i];
    const temp = hourly.temperature_2m?.[i];
    if (typeof time !== "string" || !isNumber(temp)) break;
    const entry = { time: time.slice(11, 16), temp: Math.round(temp) };
    const code = hourly.weather_code?.[i];
    if (isNumber(code)) entry.condition = wmoToCondition(code);
    const precip = hourly.precipitation_probability?.[i];
    if (isNumber(precip)) entry.precip = Math.round(precip);
    if (hourly.is_day?.[i] === 0) entry.night = true;
    entries.push(entry);
  }
  return entries;
}

/** The first `days` days, today included; a day with a missing reading is left out. */
function dailyEntries(forecast, days) {
  const daily = forecast.daily;
  if (!Array.isArray(daily?.time)) return [];
  const entries = [];
  for (let i = 0; i < Math.min(days, 7, daily.time.length); i++) {
    const high = daily.temperature_2m_max?.[i];
    const low = daily.temperature_2m_min?.[i];
    const code = daily.weather_code?.[i];
    if (!isNumber(high) || !isNumber(low) || !isNumber(code)) continue;
    const entry = {
      date: String(daily.time[i]).slice(0, 10),
      high: Math.round(high),
      low: Math.round(low),
      condition: wmoToCondition(code),
    };
    const precip = daily.precipitation_probability_max?.[i];
    if (isNumber(precip)) entry.precip = Math.round(precip);
    entries.push(entry);
  }
  return entries;
}

/**
 * The a2ui weather block for a geocoding result and an Open-Meteo forecast with the fields
 * `fetchWeather` requests. Temperatures, humidity and wind are rounded to whole numbers, wind
 * stays in km/h (the API's unit whatever the temperature unit), and a field the API returned null
 * for is left out. Throws when the current temperature or weather code is missing: the block
 * cannot stand without them, and guessing them is what the block must never do.
 */
export function buildWeatherBlock(
  geo,
  forecast,
  { days = 5, hours = 12, unit = "C", lang = "en" } = {},
) {
  const current = forecast.current ?? {};
  if (!isNumber(current.temperature_2m) || !isNumber(current.weather_code)) {
    throw new Error(`${SOURCE} returned no current conditions for ${geo.name}.`);
  }
  const wind = isNumber(current.wind_speed_10m) ? current.wind_speed_10m : undefined;
  const block = {
    type: "weather",
    place: clip(String(geo.name), PLACE_MAX),
    condition: wmoToCondition(current.weather_code, wind ?? 0),
    temp: Math.round(current.temperature_2m),
    unit: unit === "F" ? "F" : "C",
  };
  if (current.is_day === 0) block.night = true;
  const setRounded = (key, value) => {
    if (isNumber(value)) block[key] = Math.round(value);
  };
  setRounded("high", forecast.daily?.temperature_2m_max?.[0]);
  setRounded("low", forecast.daily?.temperature_2m_min?.[0]);
  setRounded("feelsLike", current.apparent_temperature);
  setRounded("humidity", current.relative_humidity_2m);
  if (wind !== undefined) {
    block.windSpeed = Math.round(wind);
    block.windUnit = "km/h";
    if (isNumber(current.wind_direction_10m)) {
      block.windDirection = windDirectionName(current.wind_direction_10m, lang);
    }
  }
  const hourly = hourlyEntries(forecast, Math.min(hours, 24));
  if (hourly.length >= 2) block.hourly = hourly;
  const daily = dailyEntries(forecast, days);
  if (daily.length >= 2) block.daily = daily;
  const asOf = asOfOf(current.time, forecast.utc_offset_seconds);
  if (asOf !== undefined) block.asOf = asOf;
  block.source = SOURCE;
  return block;
}

/** Not reaching the service, as opposed to an answer it gave: only this earns the proxy hint. */
class NetworkError extends Error {}

const messageOf = (err) => (err instanceof Error ? err.message : String(err));

/** GETs `base` with `params` (array values joined with commas) and returns the parsed JSON body. */
async function getJson(base, params) {
  const query = Object.entries(params)
    .map(([key, value]) => {
      const text = Array.isArray(value) ? value.join(",") : String(value);
      return `${key}=${encodeURIComponent(text).replace(/%2C/g, ",")}`;
    })
    .join("&");
  let response;
  let body;
  try {
    response = await fetch(`${base}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    body = await response.json();
  } catch (err) {
    if (response !== undefined && err instanceof SyntaxError) {
      throw new Error(`${SOURCE} answered ${response.status} with a body that is not JSON.`);
    }
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    throw new NetworkError(`Could not reach ${new URL(base).host}: ${messageOf(cause)}`);
  }
  if (!response.ok) {
    throw new Error(
      `${SOURCE} answered ${response.status}: ${body?.reason ?? response.statusText}`,
    );
  }
  return body;
}

/**
 * Geocodes `place` and reads its forecast from Open-Meteo, then builds the block. `lang: "auto"`
 * picks zh for a place written in CJK script. `log`, when given, receives one line naming the
 * place the geocoder matched, so a caller can tell one Springfield from another.
 */
export async function fetchWeather(
  place,
  { days = 5, hours = 12, unit = "C", lang = "auto", log } = {},
) {
  const language = lang === "auto" ? (CJK.test(place) ? "zh" : "en") : lang;
  const found = await getJson(GEOCODING_URL, { name: place, count: 1, language, format: "json" });
  const geo = Array.isArray(found.results) ? found.results[0] : undefined;
  if (geo === undefined) {
    throw new Error(`No place named "${place}" on ${SOURCE}; try the city name alone.`);
  }
  const where = [geo.name, geo.admin1, geo.country].filter(Boolean).join(", ");
  log?.(`Place: ${where} (${geo.latitude}, ${geo.longitude})`);
  const forecast = await getJson(FORECAST_URL, {
    latitude: geo.latitude,
    longitude: geo.longitude,
    current: CURRENT_FIELDS,
    hourly: HOURLY_FIELDS,
    daily: DAILY_FIELDS,
    timezone: "auto",
    // Two days at least, so the next hours run on past midnight.
    forecast_days: Math.max(days, hours > 0 ? 2 : 1),
    temperature_unit: unit === "F" ? "fahrenheit" : "celsius",
  });
  return buildWeatherBlock(geo, forecast, { days, hours, unit, lang: language });
}

const isObject = (value) => value !== null && typeof value === "object";

/** One value on one line, with a space after each comma and inside the braces. */
function inline(value) {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  const fields = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
  return `{ ${fields.join(", ")} }`;
}

/** The block as the skill writes one: a key per line, each entry of a list on a line of its own. */
function formatBlock(block) {
  const lines = Object.entries(block)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const head = `  ${JSON.stringify(key)}: `;
      if (!Array.isArray(value) || !value.some(isObject)) return head + inline(value);
      return `${head}[\n${value.map((item) => `    ${inline(item)}`).join(",\n")}\n  ]`;
    });
  return `{\n${lines.join(",\n")}\n}`;
}

/** The fence to paste: the block's JSON inside an a2ui fence. */
const toFence = (block) => "```a2ui\n" + formatBlock(block) + "\n```";

function intOption(name, text, fallback, min, max) {
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max} (got "${text}")`);
  }
  return n;
}

/** The options of a command line; throws with a message on a usage error. */
function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      days: { type: "string" },
      hours: { type: "string" },
      unit: { type: "string" },
      lang: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { help: true };
  // An unquoted "New York" arrives as two words.
  const place = positionals.join(" ").trim();
  if (place === "") throw new Error("name a place, for example: node weather.mjs Beijing");
  const unit = (values.unit ?? "C").toUpperCase();
  if (unit !== "C" && unit !== "F") throw new Error(`--unit must be C or F (got "${values.unit}")`);
  const lang = values.lang ?? "auto";
  if (lang !== "zh" && lang !== "en" && lang !== "auto") {
    throw new Error(`--lang must be zh, en or auto (got "${lang}")`);
  }
  return {
    place,
    days: intOption("--days", values.days, 5, 0, 7),
    hours: intOption("--hours", values.hours, 12, 0, 24),
    unit,
    lang,
    json: values.json === true,
  };
}

async function main(argv) {
  let args;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(`${messageOf(err)}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    const block = await fetchWeather(args.place, { ...args, log: (line) => console.error(line) });
    console.log(args.json ? JSON.stringify(block, null, 2) : toFence(block));
    console.error(CHECK_HINT);
    return 0;
  } catch (err) {
    console.error(messageOf(err));
    if (err instanceof NetworkError) console.error(PROXY_HINT);
    return 1;
  }
}

const entry = process.argv[1] !== undefined ? path.resolve(process.argv[1]) : "";
if (entry !== "" && entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
