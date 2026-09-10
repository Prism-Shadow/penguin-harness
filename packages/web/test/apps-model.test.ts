/**
 * apps-model.ts unit tests: the status segment and search box over the registered apps, the
 * meta line's host, and the "registered N ago" age that keeps counting past a week.
 */
import { describe, expect, it } from "vitest";
import {
  APP_KIND_ICONS,
  APP_STATUS_BADGE,
  APP_STATUS_FILTERS,
  appHost,
  filterApps,
  relativeAge,
} from "../src/features/apps/apps-model";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const apps = [
  {
    id: "todo-app",
    name: "Todo",
    description: "Node + React",
    url: "http://localhost:3000",
    status: "running" as const,
  },
  { id: "api", name: "Bookmarks API", status: "stopped" as const },
  { id: "cli-tool", name: "Reporter", description: "CSV to charts", status: "unknown" as const },
];

describe("filterApps", () => {
  it("the status segment narrows by status; 'all' keeps everything", () => {
    expect(filterApps(apps, "", "all").map((a) => a.id)).toEqual(["todo-app", "api", "cli-tool"]);
    expect(filterApps(apps, "", "stopped").map((a) => a.id)).toEqual(["api"]);
    expect(filterApps(apps, "", "unknown").map((a) => a.id)).toEqual(["cli-tool"]);
  });

  it("the search box matches name, id, description and URL, case-insensitively, and combines with the segment", () => {
    expect(filterApps(apps, "BOOK", "all").map((a) => a.id)).toEqual(["api"]);
    expect(filterApps(apps, "cli-", "all").map((a) => a.id)).toEqual(["cli-tool"]);
    expect(filterApps(apps, "charts", "all").map((a) => a.id)).toEqual(["cli-tool"]);
    expect(filterApps(apps, "localhost:3000", "all").map((a) => a.id)).toEqual(["todo-app"]);
    expect(filterApps(apps, "localhost:3000", "stopped")).toEqual([]);
    expect(filterApps(apps, "   ", "all")).toHaveLength(3);
  });
});

describe("filter, status and kind tables", () => {
  it("every segment value has a label in both dictionaries, every status a badge tone, every kind a glyph", () => {
    expect([...APP_STATUS_FILTERS]).toEqual(["all", "running", "stopped", "unknown"]);
    for (const dict of [zh, en]) {
      for (const status of ["running", "stopped", "unknown"]) {
        expect(dict.apps.statusNames[status]).toBeTruthy();
      }
      for (const kind of ["web", "api", "cli", "other"]) {
        expect(dict.apps.kindNames[kind]).toBeTruthy();
      }
    }
    expect(Object.keys(APP_STATUS_BADGE).sort()).toEqual(["running", "stopped", "unknown"]);
    expect(Object.keys(APP_KIND_ICONS).sort()).toEqual(["api", "cli", "other", "web"]);
  });
});

describe("appHost", () => {
  it("shows the host and port of a URL, and an unparsable value as written", () => {
    expect(appHost("http://localhost:3000/dashboard")).toBe("localhost:3000");
    expect(appHost("https://app.example.com")).toBe("app.example.com");
    expect(appHost("not a url")).toBe("not a url");
  });
});

describe("relativeAge", () => {
  const now = Date.parse("2026-09-02T12:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("steps through minutes, hours, days, weeks, months and years in both languages", () => {
    const cases: Array<[number, string, string]> = [
      [30_000, "刚刚", "just now"],
      [MIN, "1 分钟前", "1 minute ago"],
      [5 * MIN, "5 分钟前", "5 minutes ago"],
      [3 * HOUR, "3 小时前", "3 hours ago"],
      [DAY, "1 天前", "1 day ago"],
      [6 * DAY, "6 天前", "6 days ago"],
      [14 * DAY, "2 周前", "2 weeks ago"],
      [29 * DAY, "4 周前", "4 weeks ago"],
      [45 * DAY, "1 个月前", "1 month ago"],
      // The last day before a year still counts in months: rounding it up to years would
      // floor to zero.
      [364 * DAY, "12 个月前", "12 months ago"],
      [400 * DAY, "1 年前", "1 year ago"],
    ];
    for (const [ago, zhText, enText] of cases) {
      expect(relativeAge(at(ago), "zh", now)).toBe(zhText);
      expect(relativeAge(at(ago), "en", now)).toBe(enText);
    }
  });

  it("a future time reads as just now; an unparsable value is shown as written", () => {
    expect(relativeAge(new Date(now + HOUR).toISOString(), "en", now)).toBe("just now");
    expect(relativeAge("garbage", "zh", now)).toBe("garbage");
  });
});
