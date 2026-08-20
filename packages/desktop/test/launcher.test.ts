import { describe, expect, it } from "vitest";
import {
  appImageBootstrapJs,
  appImageWrapperScript,
  CLI_ENTRY_RELPATH,
  cliInstallKind,
  LINUX_EXECUTABLE,
  MAC_EXECUTABLE,
  mergeWindowsUserPath,
  PAYLOAD_CLI_RELPATH,
  payloadLauncherCmd,
  payloadLauncherScript,
  posixLauncherScript,
  WIN_EXECUTABLE,
  windowsLauncherScript,
} from "../src/launcher.js";

describe("posixLauncherScript", () => {
  const script = posixLauncherScript();

  it("is a /bin/sh script that resolves symlinks before locating the runtime", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain('while [ -h "$SOURCE" ]');
    expect(script).toContain("readlink");
  });

  it("targets the bundled CLI entry and both platform runtime locations", () => {
    expect(script).toContain(`CLI_ENTRY="$APP_DIR/${CLI_ENTRY_RELPATH}"`);
    // macOS: resources/app -> ../../MacOS/<executable>; Linux: -> ../../<executableName>.
    expect(script).toContain(`"$APP_DIR/../../MacOS/${MAC_EXECUTABLE}"`);
    expect(script).toContain(`"$APP_DIR/../../${LINUX_EXECUTABLE}"`);
  });

  it("execs as Node and forwards all arguments", () => {
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain('exec "$CANDIDATE" "$CLI_ENTRY" "$@"');
  });

  it("fails with a message when no runtime is found", () => {
    expect(script).toContain("exit 1");
  });
});

describe("windowsLauncherScript", () => {
  const script = windowsLauncherScript();

  it("uses CRLF line endings (cmd.exe is unreliable with bare LF)", () => {
    expect(script).toContain("\r\n");
    expect(script.split("\r\n").join("")).not.toContain("\n");
  });

  it("finds the exe three levels up from bin\\ and the CLI entry in the app dir", () => {
    expect(script).toContain(`"%~dp0..\\..\\..\\${WIN_EXECUTABLE}"`);
    expect(script).toContain(`"%~dp0..\\${CLI_ENTRY_RELPATH.replaceAll("/", "\\")}"`);
  });

  it("runs as Node, forwards arguments and propagates the exit code", () => {
    expect(script).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(script).toContain(" %*");
    expect(script).toContain("exit /b %errorlevel%");
  });
});

describe("appImageWrapperScript", () => {
  const appImage = "/home/user/Apps/penguin-desktop-linux-x86_64.AppImage";
  const script = appImageWrapperScript(appImage);

  it("bakes in the AppImage path and guards against it disappearing", () => {
    expect(script).toContain(`APPIMAGE_PATH='${appImage}'`);
    expect(script).toContain('if [ ! -x "$APPIMAGE_PATH" ]');
  });

  it("invokes the AppImage as Node with the bootstrap and forwards arguments", () => {
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    // The -- is load-bearing: without it Node swallows leading-dash arguments
    // (penguin --help) as its own flags instead of passing them to the CLI.
    expect(script).toContain(`exec "$APPIMAGE_PATH" -e '${appImageBootstrapJs()}' -- "$@"`);
  });

  it("refuses paths containing single quotes (they would break the quoting)", () => {
    expect(() => appImageWrapperScript("/tmp/it's.AppImage")).toThrow(/single quote/);
  });
});

describe("payload launchers (the install image, not the packaged app)", () => {
  const script = payloadLauncherScript();
  const cmd = payloadLauncherCmd();

  it("runs on plain Node, not on Electron: no ELECTRON_RUN_AS_NODE anywhere", () => {
    // This tree is handed to a machine that has no PenguinHarness — an Electron runtime is
    // exactly what it does not have.
    expect(script).not.toContain("ELECTRON_RUN_AS_NODE");
    expect(cmd).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("resolves symlinks, then the CLI entry and web assets inside lib/", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain('while [ -h "$SOURCE" ]');
    expect(script).toContain('export PENGUIN_WEB_DIST="${PENGUIN_WEB_DIST:-$DIR/lib/web}"');
    expect(script).toContain(`exec node "$DIR/lib/${PAYLOAD_CLI_RELPATH}" "$@"`);
  });

  it("prefers a bundled runtime when the payload carries one", () => {
    expect(script).toContain('if [ -x "$DIR/node/bin/node" ]; then');
    expect(script).toContain(`exec "$DIR/node/bin/node" "$DIR/lib/${PAYLOAD_CLI_RELPATH}" "$@"`);
  });

  it("names the entry the CLI actually builds", () => {
    expect(PAYLOAD_CLI_RELPATH).toBe("dist/penguin.js");
    expect(script).not.toContain("dist/index.js");
    expect(cmd).not.toContain("dist\\index.js");
  });

  it("the cmd launcher is CRLF and mirrors the same layout in backslashes", () => {
    expect(cmd.startsWith("@echo off\r\n")).toBe(true);
    expect(cmd.split("\n").every((line) => line === "" || line.endsWith("\r"))).toBe(true);
    expect(cmd).toContain('set "PENGUIN_WEB_DIST=%DIR%\\lib\\web"');
    expect(cmd).toContain('node "%DIR%\\lib\\dist\\penguin.js" %*');
  });
});

describe("appImageBootstrapJs", () => {
  const js = appImageBootstrapJs();

  it("contains no single quotes (embedded in a single-quoted shell string)", () => {
    expect(js).not.toContain("'");
  });

  it("resolves the CLI entry relative to process.execPath and fixes argv", () => {
    expect(js).toContain("process.execPath");
    expect(js).toContain('"resources","app"');
    // Derived from CLI_ENTRY_RELPATH rather than spelled out: this assertion used to pin
    // "index.js", which is what let the AppImage wrapper keep pointing at an entry
    // b77ddea ("two bins, no router") had already renamed.
    expect(js).toContain(
      CLI_ENTRY_RELPATH.split("/")
        .slice(1)
        .map((seg) => `"${seg}"`)
        .join(","),
    );
    // node -e argv is [execPath, ...args]; the CLI slices argv from index 2, so the
    // entry path must be spliced in at index 1.
    expect(js).toContain("process.argv.splice(1,0,cli)");
    expect(js).toContain("import(cli)");
  });

  it("is valid JavaScript", () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("mergeWindowsUserPath", () => {
  const bin = "C:\\Program Files\\PenguinHarness\\resources\\app\\bin";

  it("appends to an existing value with a semicolon", () => {
    expect(mergeWindowsUserPath("C:\\other", bin)).toBe(`C:\\other;${bin}`);
  });

  it("does not double the separator when the value ends with one", () => {
    expect(mergeWindowsUserPath("C:\\other;", bin)).toBe(`C:\\other;${bin}`);
  });

  it("starts a missing or empty value with just the bin dir", () => {
    expect(mergeWindowsUserPath(null, bin)).toBe(bin);
    expect(mergeWindowsUserPath("", bin)).toBe(bin);
    expect(mergeWindowsUserPath("   ", bin)).toBe(bin);
  });

  it("is idempotent: returns null when already present", () => {
    expect(mergeWindowsUserPath(`C:\\other;${bin}`, bin)).toBeNull();
  });

  it("matches case-insensitively and ignores quotes and trailing slashes", () => {
    expect(
      mergeWindowsUserPath(`c:\\program files\\penguinharness\\RESOURCES\\app\\BIN`, bin),
    ).toBeNull();
    expect(mergeWindowsUserPath(`"${bin}"`, bin)).toBeNull();
    expect(mergeWindowsUserPath(`${bin}\\`, bin)).toBeNull();
  });

  it("preserves the existing value verbatim (including %VAR% entries)", () => {
    const current = "%USERPROFILE%\\bin;C:\\tools";
    expect(mergeWindowsUserPath(current, bin)).toBe(`${current};${bin}`);
  });
});

describe("cliInstallKind", () => {
  it("is null for dev runs regardless of platform", () => {
    expect(cliInstallKind({ packaged: false, platform: "darwin", appImagePath: null })).toBeNull();
    expect(cliInstallKind({ packaged: false, platform: "win32", appImagePath: null })).toBeNull();
  });

  it("maps packaged macOS and Windows to their installers", () => {
    expect(cliInstallKind({ packaged: true, platform: "darwin", appImagePath: null })).toBe(
      "darwin",
    );
    expect(cliInstallKind({ packaged: true, platform: "win32", appImagePath: null })).toBe(
      "windows",
    );
  });

  it("on Linux only the AppImage form installs (deb ships /usr/bin/penguin itself)", () => {
    expect(cliInstallKind({ packaged: true, platform: "linux", appImagePath: null })).toBeNull();
    expect(cliInstallKind({ packaged: true, platform: "linux", appImagePath: "" })).toBeNull();
    expect(
      cliInstallKind({ packaged: true, platform: "linux", appImagePath: "/x/y.AppImage" }),
    ).toBe("appimage");
  });
});
