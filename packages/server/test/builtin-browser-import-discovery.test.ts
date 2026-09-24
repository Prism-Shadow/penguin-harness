/**
 * System browser discovery (builtin-browser/import): which profiles each platform's layout
 * yields, their display names from `Local State` / `profiles.ini`, the fallbacks when those
 * files are missing, the single-profile layout (Opera), and the duplicate installs of Linux
 * packagings (a snap beside a deb), where the copy written most recently wins.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listImportSources,
  readHistory,
  ImportSourceNotFoundError,
} from "../src/builtin-browser/import/index.js";
import {
  FakeMachine,
  writeChromiumCookies,
  writeChromiumHistory,
  writeFile,
  writeFirefoxCookies,
  writeFirefoxPlaces,
  writeLocalState,
  writeProfilesIni,
  nowSeconds,
} from "./builtin-browser-import-fixtures.js";

let machine: FakeMachine;
afterEach(() => machine.cleanup());

const cookieStore = (dir: string) =>
  writeChromiumCookies(path.join(dir, "Network", "Cookies"), [
    { host: ".a.com", name: "a", value: "1" },
  ]);
const historyStore = (dir: string) =>
  writeChromiumHistory(path.join(dir, "History"), [
    { url: "https://a.com/", visitedAt: nowSeconds() },
  ]);

describe("listImportSources on macOS", () => {
  it("names Chrome's profiles from Local State and lists only those holding a store", () => {
    machine = new FakeMachine("darwin");
    const chrome = machine.path("Library", "Application Support", "Google", "Chrome");
    writeLocalState(chrome, {
      names: { Default: "Work", "Profile 2": "Personal", "../x": "evil" },
    });
    cookieStore(path.join(chrome, "Default"));
    historyStore(path.join(chrome, "Default"));
    historyStore(path.join(chrome, "Profile 2"));
    fs.mkdirSync(path.join(chrome, "Profile 3"), { recursive: true }); // no stores
    historyStore(path.join(chrome, "System Profile")); // never a user profile

    expect(listImportSources(machine.env())).toEqual([
      {
        id: "chrome:Default",
        browser: "chrome",
        browserName: "Chrome",
        profile: "Default",
        profileName: "Work",
        hasCookies: true,
        hasHistory: true,
      },
      {
        id: "chrome:Profile 2",
        browser: "chrome",
        browserName: "Chrome",
        profile: "Profile 2",
        profileName: "Personal",
        hasCookies: false,
        hasHistory: true,
      },
    ]);
  });

  it("falls back to the profile directories without Local State, and reads the legacy Cookies path", () => {
    machine = new FakeMachine("darwin");
    const brave = machine.path("Library", "Application Support", "BraveSoftware", "Brave-Browser");
    writeChromiumCookies(path.join(brave, "Profile 10", "Cookies"), [
      { host: "a.com", name: "a", value: "1" },
    ]);
    historyStore(path.join(brave, "Profile 9"));
    historyStore(path.join(brave, "Default"));
    const sources = listImportSources(machine.env());
    expect(sources.map((s) => s.id)).toEqual([
      "brave:Default",
      "brave:Profile 9",
      "brave:Profile 10",
    ]);
    expect(sources[2]).toMatchObject({ profileName: "Profile 10", hasCookies: true });
  });

  it("lists Arc and Firefox, the install's default Firefox profile first", () => {
    machine = new FakeMachine("darwin");
    historyStore(machine.path("Library", "Application Support", "Arc", "User Data", "Default"));
    const firefox = machine.path("Library", "Application Support", "Firefox");
    writeProfilesIni(firefox, [
      { name: "default-release", path: "Profiles/ab12cd34.default-release" },
      { name: "default", path: "Profiles/zz99yy88.default" },
    ]);
    writeFirefoxPlaces(path.join(firefox, "Profiles", "zz99yy88.default", "places.sqlite"), []);
    writeFirefoxCookies(
      path.join(firefox, "Profiles", "ab12cd34.default-release", "cookies.sqlite"),
      [],
    );
    const sources = listImportSources(machine.env());
    expect(sources.map((s) => [s.id, s.profileName, s.hasCookies, s.hasHistory])).toEqual([
      ["arc:Default", "Default", false, true],
      ["firefox:ab12cd34.default-release", "default-release", true, false],
      ["firefox:zz99yy88.default", "default", false, true],
    ]);
  });

  it("finds nothing on a machine without browsers", () => {
    machine = new FakeMachine("darwin");
    expect(listImportSources(machine.env())).toEqual([]);
  });
});

describe("listImportSources on Linux", () => {
  it("honours XDG_CONFIG_HOME", () => {
    machine = new FakeMachine("linux");
    machine.vars.XDG_CONFIG_HOME = machine.path("xdg");
    historyStore(machine.path("xdg", "google-chrome", "Default"));
    historyStore(machine.path(".config", "google-chrome", "Profile 1")); // not the config home
    expect(listImportSources(machine.env()).map((s) => s.id)).toEqual(["chrome:Default"]);
  });

  it("keeps the most recently written copy when a snap and a deb install hold the same profile", async () => {
    machine = new FakeMachine("linux");
    const old = new Date(Date.now() - 7 * 86_400_000);
    const visit = (url: string) => [{ url, visitedAt: nowSeconds() }];
    // Chromium: the deb's copy is stale, the snap's is in use.
    const deb = machine.path(".config", "chromium", "Default", "History");
    writeChromiumHistory(deb, visit("https://deb.example/"));
    fs.utimesSync(deb, old, old);
    writeChromiumHistory(
      machine.path("snap", "chromium", "common", "chromium", "Default", "History"),
      visit("https://snap.example/"),
    );
    // Firefox: the other way round.
    const firefoxDeb = machine.path(".mozilla", "firefox");
    const firefoxSnap = machine.path("snap", "firefox", "common", ".mozilla", "firefox");
    for (const [root, url] of [
      [firefoxDeb, "https://deb.example/"],
      [firefoxSnap, "https://snap.example/"],
    ] as const) {
      writeProfilesIni(root, [{ name: "default-release", path: "x1.default-release" }]);
      writeFirefoxPlaces(path.join(root, "x1.default-release", "places.sqlite"), visit(url));
    }
    fs.utimesSync(path.join(firefoxSnap, "x1.default-release", "places.sqlite"), old, old);

    const env = machine.env();
    const sources = listImportSources(env);
    expect(sources.map((s) => s.id)).toEqual(["chromium:Default", "firefox:x1.default-release"]);
    const urls = async (i: number) =>
      (await readHistory(sources[i]!, env)).entries.map((e) => e.url);
    expect(await urls(0)).toEqual(["https://snap.example/"]);
    expect(await urls(1)).toEqual(["https://deb.example/"]);
  });
});

describe("listImportSources on Windows", () => {
  it("reads Local AppData for Chrome and Edge, Roaming for Opera's single-profile layout and Firefox", () => {
    machine = new FakeMachine("win32");
    const local = machine.vars.LOCALAPPDATA!;
    const roaming = machine.vars.APPDATA!;
    cookieStore(path.join(local, "Google", "Chrome", "User Data", "Default"));
    historyStore(path.join(local, "Microsoft", "Edge", "User Data", "Profile 1"));
    // Opera: the user-data directory is the profile.
    cookieStore(path.join(roaming, "Opera Software", "Opera Stable"));
    // Firefox: an absolute profile path (IsRelative=0).
    const elsewhere = path.join(machine.root, "D", "ff-profile");
    writeProfilesIni(path.join(roaming, "Mozilla", "Firefox"), [
      { name: "work", path: elsewhere, relative: false },
    ]);
    writeFirefoxCookies(path.join(elsewhere, "cookies.sqlite"), []);

    expect(listImportSources(machine.env()).map((s) => [s.id, s.browserName])).toEqual([
      ["chrome:Default", "Chrome"],
      ["edge:Profile 1", "Microsoft Edge"],
      ["opera:Default", "Opera"],
      ["firefox:ff-profile", "Firefox"],
    ]);
  });

  it("finds nothing when LOCALAPPDATA and APPDATA are unset", () => {
    machine = new FakeMachine("win32");
    cookieStore(path.join(machine.vars.LOCALAPPDATA!, "Google", "Chrome", "User Data", "Default"));
    delete machine.vars.LOCALAPPDATA;
    delete machine.vars.APPDATA;
    expect(listImportSources(machine.env())).toEqual([]);
  });
});

describe("resolving a source", () => {
  it("rejects a source discovery does not list, whatever its fields say", async () => {
    machine = new FakeMachine("darwin");
    writeFile(machine.path("x"), "");
    await expect(
      readHistory(
        {
          id: "chrome:../../x",
          browser: "chrome",
          browserName: "Chrome",
          profile: "../../x",
          profileName: "x",
          hasCookies: true,
          hasHistory: true,
        },
        machine.env(),
      ),
    ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
  });
});
