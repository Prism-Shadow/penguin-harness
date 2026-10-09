#!/usr/bin/env node
/**
 * Prints the weather at a place as an a2ui `weather` block to paste into a reply: `node
 * weather.mjs <place> [--days N] [--hours N] [--unit C|F] [--lang zh|en|auto]
 * [--source auto|open-meteo|wttr] [--json]`. Two services answer, and neither needs a key:
 *
 * - Open-Meteo, asked first. The place is geocoded (a Chinese name works), then the forecast is
 *   read in the place's own time zone: every hour and date in the block is local to the place and
 *   `asOf` carries its UTC offset.
 * - wttr.in, the fallback when Open-Meteo fails (unreachable, an error status, a timeout, or no
 *   such place). One request returns the current conditions and 3 days in 3-hour steps, local to
 *   the place; the UTC offset is worked out from the answer (see `wttrClock`).
 *
 * `--source auto` (the default) tries them in that order and fails only when both do;
 * `open-meteo` or `wttr` asks that one alone. The block's `source` and the stderr line naming the
 * matched place say which one answered. Exit codes: 0 printed, 1 no such place or every request
 * failed, 2 usage.
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

export const USAGE = `usage: node weather.mjs <place> [--days N] [--hours N] [--unit C|F] [--lang zh|en|auto] [--source auto|open-meteo|wttr] [--json]

Reads the current weather and the forecast at a place and prints an a2ui weather block to paste
into the reply. Open-Meteo answers first; when it fails, wttr.in answers instead (neither needs a
key). The matched place and the source that answered go to stderr: check it is the place meant.
  --days    days of forecast, 0-7 (default 5; fewer than 2 prints no daily rows; wttr.in has 3)
  --hours   hours ahead, 0-24 (default 12; every hour up to 12, every 2 hours beyond; wttr.in
            has one reading every 3 hours)
  --unit    C or F (default C)
  --lang    zh or en for the place name and the wind direction; auto (default) picks zh for a
            place written in Chinese, Japanese or Korean script
  --source  auto (default) tries Open-Meteo, then wttr.in; open-meteo or wttr asks that one only
  --json    print the bare JSON object instead of the fence
exit code: 0 printed · 1 no such place, or every request failed · 2 usage`;

const OPEN_METEO = "Open-Meteo";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const WTTR = "wttr.in";
const WTTR_URL = "https://wttr.in/";
/** wttr.in picks its output by user agent; a curl-like one keeps every answer plain. */
const WTTR_HEADERS = { "User-Agent": "curl/8" };
const SOURCES = ["auto", "open-meteo", "wttr"];
const TIMEOUT_MS = 10_000;
const CHECK_HINT = "Run check.mjs on the whole reply before sending.";
const PROXY_HINT = "Behind a proxy, set NODE_USE_ENV_PROXY=1.";
/** The catalog's limit on `place`, in code points. */
const PLACE_MAX = 60;
/** The hours the block shows at most before the catalog warns. */
const HOURLY_MAX = 12;
/** A dry sky with wind at or above this speed (km/h, a near gale) reads as "wind". */
const WINDY_KMH = 50;
const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

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

/**
 * wttr.in's `weatherCode` values (World Weather Online condition codes) by the catalog's
 * condition. 149 ("Smoky haze") is not in WWO's published table, but wttr.in sends it and draws
 * it with the mist icon of 143.
 */
const WWO_CODES = {
  clear: [113],
  "partly-cloudy": [116],
  cloudy: [119, 122],
  fog: [143, 149, 248, 260],
  drizzle: [185, 263, 266, 281, 284],
  rain: [176, 293, 296, 299, 302, 353, 356],
  "heavy-rain": [305, 308, 359],
  sleet: [182, 311, 314, 317, 320, 350, 362, 365, 374, 377],
  snow: [179, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371],
  thunder: [200, 386, 389, 392, 395],
};

/** A code → condition lookup from a table of codes by condition. */
function conditionMap(table) {
  const map = new Map();
  for (const [condition, codes] of Object.entries(table)) {
    for (const code of codes) map.set(code, condition);
  }
  return map;
}
const CONDITION_BY_WMO = conditionMap(WMO_CODES);
const CONDITION_BY_WWO = conditionMap(WWO_CODES);
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
 * The condition `code` stands for in `map`; an unknown code reads as "cloudy". A dry sky (clear,
 * partly cloudy or overcast) with wind at or above a near gale reads as "wind".
 */
function conditionOf(map, code, windSpeedKmh) {
  const condition = map.get(code) ?? "cloudy";
  return DRY.has(condition) && windSpeedKmh >= WINDY_KMH ? "wind" : condition;
}

/** The catalog condition of a WMO weather code (Open-Meteo's `weather_code`). */
export function wmoToCondition(code, windSpeedKmh = 0) {
  return conditionOf(CONDITION_BY_WMO, code, windSpeedKmh);
}

/** The catalog condition of a World Weather Online code (wttr.in's `weatherCode`, a string). */
export function wwoToCondition(code, windSpeedKmh = 0) {
  return conditionOf(CONDITION_BY_WWO, Number(code), windSpeedKmh);
}

/** The compass point the wind blows from: 16 points in English ("NNE"), 8 in Chinese (东北). */
export function windDirectionName(degrees, lang) {
  const turn = ((degrees % 360) + 360) % 360;
  return lang === "zh"
    ? COMPASS_ZH[Math.round(turn / 45) % 8]
    : COMPASS_EN[Math.round(turn / 22.5) % 16];
}

/** A UTC offset in minutes as ISO 8601 writes it: "+08:00", "-03:30". */
function offsetText(minutes) {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Open-Meteo's local `current.time` ("2026-10-04T14:15") with the place's UTC offset appended. */
function asOfOf(time, offsetSeconds) {
  if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time)) return undefined;
  if (!isNumber(offsetSeconds)) return undefined;
  return `${time.slice(0, 16)}${offsetText(Math.round(offsetSeconds / 60))}`;
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
    throw new Error(`${OPEN_METEO} returned no current conditions for ${geo.name}.`);
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
  block.source = OPEN_METEO;
  return block;
}

/*
 * wttr.in's `format=j1` answer: every value is a string ("24", "06:12 AM"), a missing reading is
 * an empty string, and times are local to the place except `observation_time`, which is UTC.
 */

/** A number wttr.in sent as a string; undefined for an empty or non-numeric field. */
function wttrNumber(value) {
  if (isNumber(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Minutes after midnight of a 12-hour time ("06:12 AM"); undefined for "No sunrise" and such. */
function clockMinutes(text) {
  const m = /^(\d{1,2}):(\d{2}) ?([AP]M)$/i.exec(String(text ?? "").trim());
  if (m === null) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  return (hour % 12) * 60 + minute + (m[3].toUpperCase() === "PM" ? 720 : 0);
}

/** Minutes after midnight of an hourly slot's `time`: "0", "300", … "2100". */
function slotMinutes(text) {
  if (!/^\d{1,4}$/.test(String(text ?? ""))) return undefined;
  const hour = Math.floor(Number(text) / 100);
  const minute = Number(text) % 100;
  return hour < 24 && minute < 60 ? hour * 60 + minute : undefined;
}

const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Days since 1970-01-01 of a "YYYY-MM-DD" date; undefined for anything else. */
function dayNumber(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (m === null) return undefined;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

const dateOf = (day) => new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

/** How far the sun runs ahead of the clock on a day, in minutes (NOAA's approximation). */
function equationOfTime(day) {
  const newYear = Date.UTC(new Date(day * MS_PER_DAY).getUTCFullYear(), 0, 1) / MS_PER_DAY;
  const g = (2 * Math.PI * (day - newYear)) / 365;
  const sum =
    0.000075 +
    0.001868 * Math.cos(g) -
    0.032077 * Math.sin(g) -
    0.014615 * Math.cos(2 * g) -
    0.040849 * Math.sin(2 * g);
  return 229.18 * sum;
}

/**
 * The UTC offset, on the 15-minute grid, that `diff` minutes stands for. A difference of two
 * clock times is known only up to whole days: of `diff` and `diff` ± 1 day, the candidate nearest
 * the longitude's solar offset (4 minutes a degree) wins.
 */
function nearestOffset(diff, longitude) {
  const solar = longitude === undefined ? 0 : longitude * 4;
  let best;
  for (const candidate of [diff - MINUTES_PER_DAY, diff, diff + MINUTES_PER_DAY]) {
    const offset = Math.round(candidate / 15) * 15;
    if (offset < -720 || offset > 840) continue;
    if (best === undefined || Math.abs(offset - solar) < Math.abs(best - solar)) best = offset;
  }
  return best;
}

/**
 * The place's UTC offset and the local day and time of wttr.in's current observation, in
 * minutes. With `localObsDateTime` ("2026-10-04 02:30 PM") the offset is its difference from the
 * UTC `observation_time`. wttr.in stopped sending that field (missing in October 2026); without it
 * the offset comes from the sun: today's solar noon on the local clock (midway between sunrise
 * and sunset) minus solar noon in UTC at the area's longitude; the observation's UTC time is
 * then dated by `now`. The longitude settles which whole day a difference stands for, which
 * misdates the few islands that keep their clocks across the date line (Samoa, Tonga, the Line
 * Islands). Undefined when neither way works, as in a polar night.
 */
function wttrClock(data, now) {
  const utc = clockMinutes(data.current_condition?.[0]?.observation_time);
  if (utc === undefined) return undefined;
  const longitude = wttrNumber(data.nearest_area?.[0]?.longitude);
  const local = /^(\S+) (.+)$/.exec(String(data.current_condition[0].localObsDateTime ?? ""));
  const localDay = dayNumber(local?.[1]);
  const localMinutes = clockMinutes(local?.[2]);
  if (localDay !== undefined && localMinutes !== undefined) {
    const offset = nearestOffset(localMinutes - utc, longitude);
    if (offset !== undefined) return { offset, day: localDay, minutes: localMinutes };
  }
  const today = data.weather?.[0];
  const day = dayNumber(today?.date);
  const sunrise = clockMinutes(today?.astronomy?.[0]?.sunrise);
  const sunset = clockMinutes(today?.astronomy?.[0]?.sunset);
  if (day === undefined || longitude === undefined || sunrise === undefined) return undefined;
  if (sunset === undefined || sunset <= sunrise || !isNumber(now)) return undefined;
  const utcNoon = 720 - 4 * longitude - equationOfTime(day);
  const offset = nearestOffset((sunrise + sunset) / 2 - utcNoon, longitude);
  if (offset === undefined) return undefined;
  // The observation's UTC time of day, on whichever day puts it nearest to now.
  const nowMinute = Math.floor(now / 60_000);
  let observed = Math.floor(nowMinute / MINUTES_PER_DAY) * MINUTES_PER_DAY + utc;
  if (observed - nowMinute > 720) observed -= MINUTES_PER_DAY;
  else if (nowMinute - observed > 720) observed += MINUTES_PER_DAY;
  const at = observed + offset;
  return {
    offset,
    day: Math.floor(at / MINUTES_PER_DAY),
    minutes: ((at % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
  };
}

/** Whether a local time is before sunrise or after sunset on a wttr.in day; undefined unknown. */
function isNight(day, minutes) {
  const sunrise = clockMinutes(day?.astronomy?.[0]?.sunrise);
  const sunset = clockMinutes(day?.astronomy?.[0]?.sunset);
  if (sunrise === undefined || sunset === undefined) return undefined;
  return minutes < sunrise || minutes >= sunset;
}

/** The larger of a slot's chances of rain and of snow, 0–100; undefined when it has neither. */
function slotPrecip(slot) {
  const chances = [slot?.chanceofrain, slot?.chanceofsnow]
    .map(wttrNumber)
    .filter((n) => n !== undefined && n >= 0 && n <= 100);
  return chances.length > 0 ? Math.round(Math.max(...chances)) : undefined;
}

/** The slots from the current hour on, less than `hours` ahead and never more than 12. */
function wttrHourly(weather, clock, hours, unit) {
  if (clock === undefined || hours <= 0) return [];
  const from = clock.day * MINUTES_PER_DAY + Math.floor(clock.minutes / 60) * 60;
  const entries = [];
  for (const day of weather) {
    const dayStart = dayNumber(day?.date);
    if (dayStart === undefined || !Array.isArray(day.hourly)) continue;
    for (const slot of day.hourly) {
      const minutes = slotMinutes(slot?.time);
      const temp = wttrNumber(slot?.[`temp${unit}`]);
      if (minutes === undefined || temp === undefined) continue;
      const ahead = dayStart * MINUTES_PER_DAY + minutes - from;
      if (ahead < 0 || ahead >= hours * 60) continue;
      const entry = { time: hhmm(minutes), temp: Math.round(temp) };
      const code = wttrNumber(slot.weatherCode);
      if (code !== undefined) entry.condition = wwoToCondition(code);
      const precip = slotPrecip(slot);
      if (precip !== undefined) entry.precip = precip;
      if (isNight(day, minutes) === true) entry.night = true;
      entries.push(entry);
      if (entries.length === HOURLY_MAX) return entries;
    }
  }
  return entries;
}

/** The slot with a weather code nearest to noon; undefined when no slot has one. */
function noonSlot(slots) {
  let best;
  let bestDistance = Infinity;
  for (const slot of slots) {
    const minutes = slotMinutes(slot?.time);
    if (minutes === undefined || wttrNumber(slot.weatherCode) === undefined) continue;
    const distance = Math.abs(minutes - 720);
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The first `days` days, today included: the condition of the slot nearest noon and the highest
 * chance of rain or snow. A day with a missing reading is left out.
 */
function wttrDaily(weather, days, unit) {
  const entries = [];
  for (const day of weather.slice(0, Math.min(days, 7))) {
    const high = wttrNumber(day?.[`maxtemp${unit}`]);
    const low = wttrNumber(day?.[`mintemp${unit}`]);
    const slots = Array.isArray(day?.hourly) ? day.hourly : [];
    const noon = noonSlot(slots);
    if (dayNumber(day?.date) === undefined || high === undefined || low === undefined) continue;
    if (noon === undefined) continue;
    const entry = {
      date: day.date,
      high: Math.round(high),
      low: Math.round(low),
      condition: wwoToCondition(noon.weatherCode),
    };
    const chances = slots.map(slotPrecip).filter((n) => n !== undefined);
    if (chances.length > 0) entry.precip = Math.max(...chances);
    entries.push(entry);
  }
  return entries;
}

/**
 * The a2ui weather block for a wttr.in `format=j1` answer, the same shape `buildWeatherBlock`
 * makes. `place` is the place as the user typed it: a CJK name stands as typed under `lang: "zh"`,
 * any other takes wttr.in's name for the area. `now` (epoch milliseconds) dates the observation
 * when wttr.in leaves out its local time. Hours come in wttr.in's 3-hour steps; days are at most
 * the 3 it forecasts. Throws when the current temperature or weather code is missing.
 */
export function buildWeatherBlockFromWttr(
  data,
  { place = "", days = 5, hours = 12, unit = "C", lang = "en", now = Date.now() } = {},
) {
  const tempUnit = unit === "F" ? "F" : "C";
  const typed = String(place).trim();
  const area = data?.nearest_area?.[0]?.areaName?.[0]?.value;
  const areaName = typeof area === "string" ? area.trim() : "";
  const name = (lang === "zh" && CJK.test(typed)) || areaName === "" ? typed : areaName;
  const current = data?.current_condition?.[0] ?? {};
  const temp = wttrNumber(current[`temp_${tempUnit}`]);
  const code = wttrNumber(current.weatherCode);
  if (name === "" || temp === undefined || code === undefined) {
    throw new Error(`${WTTR} returned no current conditions for ${name || "that place"}.`);
  }
  const weather = Array.isArray(data.weather) ? data.weather : [];
  const clock = wttrClock(data, now);
  const speed = wttrNumber(current.windspeedKmph);
  const wind = speed !== undefined && speed >= 0 ? speed : undefined;
  const block = {
    type: "weather",
    place: clip(name, PLACE_MAX),
    condition: wwoToCondition(code, wind ?? 0),
    temp: Math.round(temp),
    unit: tempUnit,
  };
  if (clock !== undefined) {
    const today = weather.find((day) => dayNumber(day?.date) === clock.day) ?? weather[0];
    if (isNight(today, clock.minutes) === true) block.night = true;
  }
  const setRounded = (key, value, min = -Infinity, max = Infinity) => {
    const n = wttrNumber(value);
    if (n !== undefined && n >= min && n <= max) block[key] = Math.round(n);
  };
  setRounded("high", weather[0]?.[`maxtemp${tempUnit}`]);
  setRounded("low", weather[0]?.[`mintemp${tempUnit}`]);
  setRounded("feelsLike", current[`FeelsLike${tempUnit}`]);
  setRounded("humidity", current.humidity, 0, 100);
  if (wind !== undefined) {
    block.windSpeed = Math.round(wind);
    block.windUnit = "km/h";
    const degrees = wttrNumber(current.winddirDegree);
    if (degrees !== undefined) block.windDirection = windDirectionName(degrees, lang);
  }
  const hourly = wttrHourly(weather, clock, Math.min(hours, 24), tempUnit);
  if (hourly.length >= 2) block.hourly = hourly;
  const daily = wttrDaily(weather, days, tempUnit);
  if (daily.length >= 2) block.daily = daily;
  if (clock !== undefined) {
    block.asOf = `${dateOf(clock.day)}T${hhmm(clock.minutes)}${offsetText(clock.offset)}`;
  }
  block.source = WTTR;
  return block;
}

/**
 * An error in one line. A connection failure often arrives as an AggregateError (one refusal per
 * address) whose message is empty, so the code says what happened instead.
 */
const messageOf = (err) => {
  if (!(err instanceof Error)) return String(err);
  return err.message || err.code || err.errors?.[0]?.code || err.name;
};

/** Not reaching the service, as opposed to an answer it gave: only this earns the proxy hint. */
class NetworkError extends Error {}

/** An answer with an error status; the status lets a caller read a 404 as "no such place". */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Both sources failed; `failures` pairs each source with its error, one line each. */
class SourcesFailed extends Error {
  constructor(failures) {
    const names = failures.map(([source]) => source).join(" and ");
    const reasons = failures.map(([source, err]) => `${source}: ${messageOf(err)}`);
    super([`${names} both failed.`, ...reasons].join("\n"));
    this.failures = failures;
  }
}

/**
 * GETs `base` with `params` (array values joined with commas) and returns the parsed JSON object.
 * `source` names the service in the error messages.
 */
async function getJson(source, base, params, headers = {}) {
  const query = Object.entries(params)
    .map(([key, value]) => {
      const text = Array.isArray(value) ? value.join(",") : String(value);
      return `${key}=${encodeURIComponent(text).replace(/%2C/g, ",")}`;
    })
    .join("&");
  let response;
  let text;
  try {
    response = await fetch(`${base}?${query}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text();
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    throw new NetworkError(`Could not reach ${new URL(base).host}: ${messageOf(cause)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const reason = body?.reason ?? response.statusText;
    throw new HttpError(response.status, `${source} answered ${response.status}: ${reason}`);
  }
  if (body === null || typeof body !== "object") {
    const head = clip(text.trim().split("\n", 1)[0], 80);
    throw new Error(`${source} answered ${response.status} with a non-JSON body: "${head}"`);
  }
  return body;
}

/**
 * Geocodes `place` and reads its forecast from Open-Meteo, then builds the block. `log`, when
 * given, receives one line naming the place the geocoder matched, so a caller can tell one
 * Springfield from another.
 */
async function fetchOpenMeteo(place, { days, hours, unit, lang, log }) {
  const found = await getJson(OPEN_METEO, GEOCODING_URL, {
    name: place,
    count: 1,
    language: lang,
    format: "json",
  });
  const geo = Array.isArray(found.results) ? found.results[0] : undefined;
  if (geo === undefined) {
    throw new Error(`No place named "${place}" on ${OPEN_METEO}; try the city name alone.`);
  }
  const where = [geo.name, geo.admin1, geo.country].filter(Boolean).join(", ");
  log?.(`Place (${OPEN_METEO}): ${where} (${geo.latitude}, ${geo.longitude})`);
  const forecast = await getJson(OPEN_METEO, FORECAST_URL, {
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
  return buildWeatherBlock(geo, forecast, { days, hours, unit, lang });
}

/**
 * Reads the weather at `place` from wttr.in, which geocodes the name itself, then builds the
 * block. `log` receives the line naming the area wttr.in matched.
 */
async function fetchWttr(place, { days, hours, unit, lang, log }) {
  const base = WTTR_URL + encodeURIComponent(place);
  let data;
  try {
    data = await getJson(WTTR, base, { format: "j1", lang }, WTTR_HEADERS);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 404) throw err;
    throw new Error(`No place named "${place}" on ${WTTR}; try the city name alone.`);
  }
  const area = data.nearest_area?.[0];
  const field = (key) => area?.[key]?.[0]?.value;
  const where = [field("areaName"), field("region"), field("country")].filter(Boolean).join(", ");
  const at = area?.latitude && area?.longitude ? ` (${area.latitude}, ${area.longitude})` : "";
  log?.(`Place (${WTTR}): ${where || place}${at}`);
  return buildWeatherBlockFromWttr(data, { place, days, hours, unit, lang });
}

/**
 * Reads the weather at `place` and builds the block. `source: "auto"` asks Open-Meteo first and
 * wttr.in when Open-Meteo fails for any reason, and throws only when both fail, with both
 * reasons; "open-meteo" or "wttr" asks that one alone. `lang: "auto"` picks zh for a place
 * written in CJK script. `log`, when given, receives the line naming the place each source
 * matched and the line saying Open-Meteo failed.
 */
export async function fetchWeather(
  place,
  { days = 5, hours = 12, unit = "C", lang = "auto", source = "auto", log } = {},
) {
  const language = lang === "auto" ? (CJK.test(place) ? "zh" : "en") : lang;
  const options = { days, hours, unit, lang: language, log };
  if (source === "open-meteo") return fetchOpenMeteo(place, options);
  if (source === "wttr") return fetchWttr(place, options);
  try {
    return await fetchOpenMeteo(place, options);
  } catch (first) {
    log?.(`${OPEN_METEO} failed, trying ${WTTR}: ${messageOf(first)}`);
    try {
      return await fetchWttr(place, options);
    } catch (second) {
      throw new SourcesFailed([
        [OPEN_METEO, first],
        [WTTR, second],
      ]);
    }
  }
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
      source: { type: "string" },
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
  const source = (values.source ?? "auto").toLowerCase();
  if (!SOURCES.includes(source)) {
    throw new Error(`--source must be auto, open-meteo or wttr (got "${values.source}")`);
  }
  return {
    place,
    days: intOption("--days", values.days, 5, 0, 7),
    hours: intOption("--hours", values.hours, 12, 0, 24),
    unit,
    lang,
    source,
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
    const errors = err instanceof SourcesFailed ? err.failures.map(([, e]) => e) : [err];
    if (errors.some((e) => e instanceof NetworkError)) console.error(PROXY_HINT);
    return 1;
  }
}

const entry = process.argv[1] !== undefined ? path.resolve(process.argv[1]) : "";
if (entry !== "" && entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
