/**
 * Place discovery for the Workspace picker's sidebar: the parsers for what each platform
 * reports, the decisions they feed, and the fallbacks when a report never comes. Every
 * platform call goes through a fake effects object, so each case runs wherever this suite
 * runs; the real machine is asked through the dirs route in dirs.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  conventionallyHiddenNames,
  createPlaceDiscovery,
  darwinLocations,
  discoverPlaces,
  parseMounts,
  parseWindowsReport,
  windowsHiddenNames,
  windowsLocations,
  type ExecOutcome,
  type PlaceDirent,
  type PlaceEffects,
} from "../src/services/dir-places.js";

const errno = (code: string) => Object.assign(new Error(code), { code });

/** A machine with nothing on it; each case overrides the calls it is about. */
function fakeEffects(over: Partial<PlaceEffects> & Pick<PlaceEffects, "platform">): PlaceEffects {
  return {
    homedir: "/home/me",
    env: {},
    readFile: async () => {
      throw errno("ENOENT");
    },
    readdir: async () => [],
    readlink: async () => {
      throw errno("EINVAL");
    },
    isDirectory: async () => false,
    exec: async () => ({
      stdout: Buffer.alloc(0),
      code: null,
      timedOut: false,
      failed: "not on this machine",
    }),
    ...over,
  };
}

const exited = (stdout: Buffer, code = 0): ExecOutcome => ({ stdout, code, timedOut: false });
const killed = (stdout: Buffer): ExecOutcome => ({ stdout, code: null, timedOut: true });
/** What `cmd /u` writes: UTF-16LE, CRLF, no BOM. */
const cmdOutput = (text: string) => Buffer.from(text, "utf16le");
const dirent = (name: string, kind: "dir" | "link"): PlaceDirent => ({
  name,
  isDirectory: () => kind === "dir",
  isSymbolicLink: () => kind === "link",
});

describe("parseMounts", () => {
  it("keeps the browsable mounts, decoded and in order, and none of the plumbing", () => {
    const text = [
      "sysfs /sys sysfs rw 0 0",
      "/dev/sda1 / ext4 rw 0 0",
      "/dev/sdb1 /media/me/My\\040USB vfat rw 0 0",
      "C:\\134 /mnt/c 9p rw,aname=drvfs 0 0",
      "D: /mnt/d drvfs rw 0 0",
      "//nas/media /mnt/nas cifs rw 0 0",
      "/dev/sdc1 /mnt/data ext4 rw 0 0",
      "/dev/sdc2 /mnt/data/sub ext4 rw 0 0",
      "tmpfs /mnt/wsl tmpfs rw 0 0",
      "none /mnt/wslg tmpfs rw 0 0",
      "/dev/sdd1 /mnt/wsl/docker-desktop ext4 rw 0 0",
      "tmpfs /run/media tmpfs rw 0 0",
      "/dev/sde1 /home/me/mnt ext4 rw 0 0",
      // A systemd automount: the trigger, then the real filesystem at the same point.
      "systemd-1 /mnt/auto autofs rw 0 0",
      "//nas/share /mnt/auto nfs4 rw 0 0",
    ].join("\n");
    expect(parseMounts(text)).toEqual([
      { path: "/media/me/My USB", kind: "removable", label: "My USB" },
      { path: "/mnt/auto", kind: "network", label: "auto" },
      { path: "/mnt/c", kind: "drive", label: "C:" },
      { path: "/mnt/d", kind: "drive", label: "D:" },
      { path: "/mnt/data", kind: "volume", label: "data" },
      { path: "/mnt/nas", kind: "network", label: "nas" },
    ]);
  });
});

describe("Linux standard folders", () => {
  it("follows user-dirs.dirs: localized names, $HOME expanded, the home value disabling a folder", async () => {
    const existing = new Set([
      "/home/me/桌面",
      "/home/me/下载",
      "/home/me/Pictures",
      "/home/me/Documents",
    ]);
    const effects = fakeEffects({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/home/me/.cfg" },
      readFile: async (file) => {
        if (file === "/proc/self/mounts") return "/dev/sda1 / ext4 rw 0 0\n";
        expect(file).toBe("/home/me/.cfg/user-dirs.dirs");
        return [
          "# This file is written by xdg-user-dirs-update",
          'XDG_DESKTOP_DIR="$HOME/桌面"',
          'XDG_DOWNLOAD_DIR="$HOME/下载"',
          'XDG_DOCUMENTS_DIR="$HOME/"',
          'XDG_PICTURES_DIR="$HOME/图片"',
          'XDG_MUSIC_DIR="$HOME/音乐"',
        ].join("\n");
      },
      isDirectory: async (file) => existing.has(file),
    });
    const places = await discoverPlaces(effects);
    // Documents is disabled although ~/Documents exists; Pictures is configured to a folder
    // that does not exist, and the configured value wins over the English one that does.
    expect(places.standardFolders).toEqual({
      desktop: "/home/me/桌面",
      downloads: "/home/me/下载",
    });
    expect(places.locations[0]).toEqual({ path: "/", kind: "root" });
  });

  it("falls back to the English names that exist when there is no file", async () => {
    const effects = fakeEffects({
      platform: "linux",
      isDirectory: async (file) => file === "/home/me/Downloads",
    });
    expect((await discoverPlaces(effects)).standardFolders).toEqual({
      downloads: "/home/me/Downloads",
    });
  });
});

describe("Windows drive report", () => {
  it("maps each JSON line, or an array of them, to a location and skips what is not the report", () => {
    const text = [
      "Windows PowerShell wrote this line itself",
      '{"drive":"C:\\\\","type":3,"label":"Windows"}',
      '{"drive":"D:\\\\","type":3,"label":null}',
      '[{"drive":"E:\\\\","type":2,"label":"U 盘"},{"drive":"F:\\\\","type":5,"label":null}]',
      '{"drive":"Z:\\\\","type":4,"share":"\\\\\\\\nas\\\\media"}',
      '{"drive":"C:\\\\","type":3,"label":"Windows"}',
      '{"folders":{"desktop":"C:\\\\Users\\\\me\\\\OneDrive\\\\Desktop","pictures":""}}',
      '{"drive":"G:\\\\","type":3,"la',
    ].join("\r\n");
    const report = parseWindowsReport(text);
    expect(report.folders).toEqual({ desktop: "C:\\Users\\me\\OneDrive\\Desktop" });
    expect(windowsLocations(report.drives)).toEqual([
      { path: "C:\\", kind: "drive", label: "Windows" },
      { path: "D:\\", kind: "drive" },
      { path: "E:\\", kind: "removable", label: "U 盘" },
      { path: "F:\\", kind: "optical" },
      { path: "Z:\\", kind: "network", label: "\\\\nas\\media" },
    ]);
  });

  it("keeps what PowerShell printed before its deadline", async () => {
    const effects = fakeEffects({
      platform: "win32",
      homedir: "C:\\Users\\me",
      exec: async (file) => {
        expect(file).toBe("powershell.exe");
        return killed(
          Buffer.from('{"drive":"C:\\\\","type":3,"label":"Windows"}\n{"drive":"D:\\\\","ty'),
        );
      },
    });
    const places = await discoverPlaces(effects);
    expect(places.locations).toEqual([{ path: "C:\\", kind: "drive", label: "Windows" }]);
    // The folders line never came: unanswered, not "none", so the picker may find them by name.
    expect(places.standardFolders).toBeUndefined();
  });

  it("probes the letters through cmd when PowerShell said nothing, and knows the system drive when even that fails", async () => {
    const calls: string[] = [];
    const probing = fakeEffects({
      platform: "win32",
      homedir: "C:\\Users\\me",
      env: { ComSpec: "C:\\Windows\\system32\\cmd.exe", SystemRoot: "C:\\Windows" },
      exec: async (file, args) => {
        calls.push(file);
        if (file.endsWith("powershell.exe")) {
          return { stdout: Buffer.alloc(0), code: null, timedOut: false, failed: "spawn ENOENT" };
        }
        expect(args[3]).toMatch(/^for %d in \(A B C .* Z\) do @if exist %d:\\ echo %d:$/);
        // Killed while a dead mapping held the loop at E: the letters before it stand.
        return killed(cmdOutput("C:\r\nD:\r\nE"));
      },
    });
    expect((await discoverPlaces(probing)).locations).toEqual([
      { path: "C:\\", kind: "drive" },
      { path: "D:\\", kind: "drive" },
    ]);
    expect(calls).toEqual([
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "C:\\Windows\\system32\\cmd.exe",
    ]);

    const blind = fakeEffects({
      platform: "win32",
      homedir: "D:\\Users\\me",
      env: { SystemDrive: "C:" },
    });
    expect((await discoverPlaces(blind)).locations).toEqual([
      { path: "C:\\", kind: "drive" },
      { path: "D:\\", kind: "drive" },
    ]);
  });
});

describe("windowsHiddenNames", () => {
  it("reads dir /a:h /b as UTF-16LE, the directory quoted on the command line", async () => {
    const calls: string[][] = [];
    const effects = fakeEffects({
      platform: "win32",
      exec: async (file, args, opts) => {
        calls.push([file, ...args]);
        expect(opts.verbatim).toBe(true);
        return exited(cmdOutput("AppData\r\n桌面\r\nNTUSER.DAT\r\n"));
      },
    });
    const names = ["AppData", "桌面", "Documents", "NTUSER.DAT"];
    const hidden = await windowsHiddenNames("C:\\Users\\我", names, effects);
    expect([...hidden].sort()).toEqual(["AppData", "NTUSER.DAT", "桌面"]);
    expect(calls).toEqual([["cmd.exe", "/d", "/u", "/c", "dir", "/a:h", "/b", '"C:\\Users\\我"']]);
  });

  it("treats exit 1 with nothing printed as no hidden entries, and anything worse as unknown", async () => {
    const none = fakeEffects({ platform: "win32", exec: async () => exited(Buffer.alloc(0), 1) });
    expect(await windowsHiddenNames("C:\\ws", ["AppData", "src"], none)).toEqual(new Set());

    const late = fakeEffects({ platform: "win32", exec: async () => killed(Buffer.alloc(0)) });
    expect(
      await windowsHiddenNames("C:\\", ["$Recycle.Bin", "Users", "pagefile.sys"], late),
    ).toEqual(new Set(["$Recycle.Bin", "pagefile.sys"]));
    // The `$` rule holds in a drive root only; elsewhere the curated names alone apply.
    expect(
      conventionallyHiddenNames("C:\\Users\\me", ["$money", "ntuser.dat.LOG1", "AppData", "src"]),
    ).toEqual(new Set(["ntuser.dat.LOG1", "AppData"]));
  });
});

describe("darwinLocations", () => {
  it("lists the startup disk first by its link, then the other volumes, and nothing hidden", async () => {
    const effects = fakeEffects({
      platform: "darwin",
      readdir: async (dir) => {
        expect(dir).toBe("/Volumes");
        return [
          dirent("USB", "dir"),
          dirent("Macintosh HD", "link"),
          dirent(".timemachine", "dir"),
          dirent("com.apple.TimeMachine.localsnapshots", "dir"),
          dirent("Backup", "link"),
          dirent("NAS", "dir"),
        ];
      },
      readlink: async (file) =>
        file === "/Volumes/Macintosh HD" ? "/" : "/System/Volumes/Data/Backups",
    });
    expect(await darwinLocations(effects)).toEqual([
      { path: "/", kind: "volume", label: "Macintosh HD" },
      { path: "/Volumes/NAS", kind: "volume", label: "NAS" },
      { path: "/Volumes/USB", kind: "volume", label: "USB" },
    ]);
    // Without the link the root still leads, unnamed.
    expect(await darwinLocations(fakeEffects({ platform: "darwin" }))).toEqual([
      { path: "/", kind: "volume" },
    ]);
  });
});

describe("createPlaceDiscovery", () => {
  it("shares one run between concurrent callers and keeps it until the TTL passes", async () => {
    let runs = 0;
    let clock = 1_000;
    const effects = fakeEffects({
      platform: "linux",
      readFile: async (file) => {
        if (file !== "/proc/self/mounts") throw errno("ENOENT");
        runs += 1;
        return "/dev/sda1 / ext4 rw 0 0\n";
      },
    });
    const discovery = createPlaceDiscovery(effects, { ttlMs: 100, now: () => clock });
    const [a, b] = await Promise.all([discovery.discover(), discovery.discover()]);
    expect(a).toBe(b);
    expect(runs).toBe(1);
    clock += 50;
    expect(await discovery.discover()).toBe(a);
    clock += 60;
    expect(await discovery.discover()).not.toBe(a);
    expect(runs).toBe(2);
  });
});
