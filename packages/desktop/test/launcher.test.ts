import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adminSymlinkAppleScript,
  appImageBootstrapJs,
  appImageWrapperScript,
  appleScriptString,
  CLI_ENTRY_RELPATH,
  cliInstallKind,
  LAUNCHER_MARKER,
  LINUX_EXECUTABLE,
  MAC_EXECUTABLE,
  mergeWindowsUserPath,
  posixLauncherScript,
  shellQuote,
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

describe("LAUNCHER_MARKER", () => {
  it("appears in every generated launcher", () => {
    // cli-link.ts recognises a `penguin` this app wrote by this text, and skips anything
    // that lacks it. A launcher that stopped carrying it would be classified as somebody
    // else's command and the install would silently stop repairing itself.
    for (const script of [
      posixLauncherScript(),
      windowsLauncherScript(),
      appImageWrapperScript("/home/user/Apps/penguin.AppImage"),
    ]) {
      expect(script).toContain(LAUNCHER_MARKER);
    }
  });
});

describe("shellQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("/Applications/PenguinHarness.app")).toBe(
      "'/Applications/PenguinHarness.app'",
    );
  });

  it("splices embedded single quotes so the word never closes early", () => {
    expect(shellQuote("/Users/anne/Anne's Apps")).toBe(`'/Users/anne/Anne'\\''s Apps'`);
  });

  it("leaves shell metacharacters inert inside the quotes", () => {
    expect(shellQuote('a b;$(id)`x`&|>"')).toBe(`'a b;$(id)\`x\`&|>"'`);
  });
});

describe("appleScriptString", () => {
  it("escapes backslashes and double quotes", () => {
    expect(appleScriptString(`say "hi" \\ bye`)).toBe(`"say \\"hi\\" \\\\ bye"`);
  });
});

describe("adminSymlinkAppleScript", () => {
  const target = "/Applications/PenguinHarness.app/Contents/Resources/app/bin/penguin";
  const link = "/usr/local/bin/penguin";

  /** The shell command osascript would run: the AppleScript literal, unescaped. */
  function shellCommandOf(script: string): string {
    const m = /^do shell script "(.*)" with administrator privileges$/s.exec(script);
    expect(m).not.toBeNull();
    return m![1]!.replace(/\\(.)/g, "$1");
  }

  it("creates the link directory and links the bundled launcher", () => {
    expect(adminSymlinkAppleScript(target, link)).toBe(
      `do shell script "mkdir -p '/usr/local/bin' && ln -sf '${target}' '${link}'"` +
        " with administrator privileges",
    );
  });

  it("keeps an apostrophe in the bundle path inside its shell word", () => {
    // What a user gets by keeping the app in a folder named with an apostrophe — and what
    // an attacker gets to write if the two escapers are not applied, since this command
    // runs with administrator privileges.
    const evil = "/Users/anne/Anne's Apps'; touch /tmp/pwned; '/PenguinHarness.app/bin/penguin";
    const command = shellCommandOf(adminSymlinkAppleScript(evil, link));
    expect(command).toBe(`mkdir -p '/usr/local/bin' && ln -sf ${shellQuote(evil)} '${link}'`);
    // The injected segment survives only as literal text inside the quoted word.
    expect(command).not.toContain("&& touch");
    expect(command).not.toContain("; touch /tmp/pwned; '/PenguinHarness");
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

/**
 * The couplings that make an installed desktop app carry a working `penguin`. They span
 * three files nothing else compares: the constants above, the packaging decisions in
 * electron-builder.yml, and the deb postinst templates. Each is load-bearing at run time
 * and silent at build time — a packed app with no CLI in it builds, signs and ships
 * exactly like one that has it (scripts/verify-packed-cli.mjs checks the produced tree).
 */
describe("packaged CLI", () => {
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = (rel: string): string =>
    fs.readFileSync(path.join(pkgDir, ...rel.split("/")), "utf8");
  const builderConfig = read("electron-builder.yml");
  /** The deb link target, spelled identically by the install and remove templates. */
  const debTarget = "/opt/${sanitizedProductName}/resources/app/bin/penguin";

  it("ships bin/, which is the only reason <app>/bin/penguin exists in an install", () => {
    expect(builderConfig).toContain("- bin/**/*");
  });

  it("keeps asar off — inside an archive there is no bin/penguin to exec", () => {
    expect(builderConfig).toMatch(/^asar: false$/m);
  });

  it("names the runtime the launchers exec", () => {
    // posixLauncherScript and windowsLauncherScript hardcode these three names; they come
    // from productName (macOS bundle executable and the .exe) and linux.executableName.
    expect(builderConfig).toMatch(new RegExp(`^productName: ${MAC_EXECUTABLE}$`, "m"));
    expect(WIN_EXECUTABLE).toBe(`${MAC_EXECUTABLE}.exe`);
    expect(builderConfig).toMatch(new RegExp(`^ {2}executableName: ${LINUX_EXECUTABLE}$`, "m"));
  });

  it("bundles the CLI at the entry the launchers run", () => {
    const entry = CLI_ENTRY_RELPATH.replace(/^dist\//, "").replace(/\.js$/, "");
    expect(read("tsup.config.ts")).toMatch(
      new RegExp(`^\\s*"?${entry}"?: "\\.\\./cli/dist/penguin\\.js",$`, "m"),
    );
  });

  it("deb creates /usr/bin/penguin itself: it is the one form the shell does not install", () => {
    // cliInstallKind returns null for it, so nothing else would ever put the CLI on PATH.
    expect(cliInstallKind({ packaged: true, platform: "linux", appImagePath: null })).toBeNull();
    expect(builderConfig).toMatch(
      /^deb:\n(?: .*\n|#.*\n)*? {2}afterInstall: build\/linux\/after-install\.tpl$/m,
    );
    const afterInstall = read("build/linux/after-install.tpl");
    expect(afterInstall).toContain(`ln -sf '${debTarget}' '/usr/bin/penguin'`);
    // Never over a real file of that name — a CLI installed by install.sh, say.
    expect(afterInstall).toContain(`if [ ! -e '/usr/bin/penguin' ] || [ -L '/usr/bin/penguin' ]`);
  });

  it("deb removes only the link it made", () => {
    expect(builderConfig).toMatch(
      /^deb:\n(?: .*\n|#.*\n)*? {2}afterRemove: build\/linux\/after-remove\.tpl$/m,
    );
    const afterRemove = read("build/linux/after-remove.tpl");
    expect(afterRemove).toContain(`[ "\`readlink '/usr/bin/penguin'\`" = '${debTarget}' ]`);
    expect(afterRemove).toContain("rm -f '/usr/bin/penguin'");
  });
});
