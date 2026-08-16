/**
 * The installer that runs ON the remote machine, under the Node runtime that was just
 * unpacked next to it. One script for Linux, macOS and Windows — the reason the whole push
 * stopped depending on `install.sh`: a POSIX shell script cannot install anything on a
 * Windows host, and re-implementing it per shell is exactly the platform-specific behavior
 * this design avoids. Everything below is plain Node with no dependencies.
 *
 * It is invoked as `<runtime>/node <scratch>/remote-installer.cjs`, with no arguments: the job
 * is read from `job.json` beside this file, so nothing has to survive a shell's quoting rules.
 *
 * What it does, in order, mirroring what install.sh does locally:
 *   1. unpack the image into a staging directory next to the final one;
 *   2. move the runtime in as `lib/runtime`, so the install carries its own Node;
 *   3. write the launchers (`bin/penguin`, `bin/penguin.cmd`);
 *   4. smoke-test the staged tree by running `penguin --version` with that runtime;
 *   5. swap: current program directory aside, staged one in, delete the old one;
 *   6. on any failure after the swap started, put the previous one back.
 *
 * The data directory (`~/.penguin/data`) is never touched, and nothing outside the program
 * directory is written except the POSIX convenience symlink in `~/.local/bin`.
 */
"use strict";
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const here = __dirname;
const job = JSON.parse(fs.readFileSync(path.join(here, "job.json"), "utf8"));
const isWindows = process.platform === "win32";
const log = (line) => process.stdout.write(`${line}\n`);

// --- the pack reader (mirror of packages/desktop/src/remote/pack.ts) ------------------------
function unpack(packPath, destDir) {
  const raw = zlib.gunzipSync(fs.readFileSync(packPath));
  const headerLength = raw.readUInt32BE(0);
  const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString("utf8"));
  if (header.schemaVersion !== 1)
    throw new Error(`unsupported pack schema ${header.schemaVersion}`);
  let offset = 4 + headerLength;
  for (const entry of header.entries) {
    const target = path.join(destDir, ...entry.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, raw.subarray(offset, offset + entry.size));
    if ((entry.mode & 0o111) !== 0 && !isWindows) fs.chmodSync(target, 0o755);
    offset += entry.size;
  }
}

// --- launchers ------------------------------------------------------------------------------
// They resolve their own directory, prefer the bundled runtime at lib/runtime, and fall back
// to a system node — so an install stays usable if the runtime is ever removed.
function posixLauncher() {
  return `#!/bin/sh
# penguin launcher (written by the PenguinHarness remote installer).
SOURCE=$0
while [ -h "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)
  SOURCE=$(readlink "$SOURCE")
  case $SOURCE in
    /*) ;;
    *) SOURCE="$DIR/$SOURCE" ;;
  esac
done
DIR=$(dirname "$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)")
export PENGUIN_WEB_DIST="\${PENGUIN_WEB_DIST:-$DIR/lib/web}"
if [ -x "$DIR/lib/runtime/bin/node" ]; then
  exec "$DIR/lib/runtime/bin/node" "$DIR/lib/dist/penguin.js" "$@"
fi
exec node "$DIR/lib/dist/penguin.js" "$@"
`;
}

function windowsLauncher() {
  return [
    "@echo off",
    "rem penguin launcher (written by the PenguinHarness remote installer).",
    "setlocal",
    'set "DIR=%~dp0.."',
    'if not defined PENGUIN_WEB_DIST set "PENGUIN_WEB_DIST=%DIR%\\lib\\web"',
    'if exist "%DIR%\\lib\\runtime\\node.exe" (',
    '  "%DIR%\\lib\\runtime\\node.exe" "%DIR%\\lib\\dist\\penguin.js" %*',
    ") else (",
    '  node "%DIR%\\lib\\dist\\penguin.js" %*',
    ")",
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

// --- install ---------------------------------------------------------------------------------
/**
 * Where the program goes, decided here rather than by the sender: this script runs ON the
 * target, so `process.platform` and the real environment are right in front of it —
 * %LOCALAPPDATA%\penguin on Windows, $XDG_DATA_HOME/penguin (default ~/.local/share)
 * elsewhere. Nothing about the remote's paths has to be guessed from the other side.
 */
function programDirFor() {
  if (isWindows) {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "penguin");
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "penguin");
}

const programDir = programDirFor();
const staging = `${programDir}.staging-${process.pid}`;
const previous = `${programDir}.previous-${process.pid}`;
let swapped = false;

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

try {
  log("Unpacking…");
  cleanup(staging);
  fs.mkdirSync(staging, { recursive: true });
  // The pack's root is the `penguin/` directory of the image; its contents become the
  // program directory itself.
  unpack(path.join(here, job.packName), path.join(staging, "__image"));
  const image = path.join(staging, "__image", "penguin");
  for (const entry of fs.readdirSync(image)) {
    fs.renameSync(path.join(image, entry), path.join(staging, entry));
  }
  fs.rmSync(path.join(staging, "__image"), { recursive: true, force: true });

  // A runtime only travelled if this machine had no usable Node of its own; when it did,
  // job.runtimeDirName is null and the install simply uses it (the launchers fall back to a
  // system `node`, and the smoke test below runs on the one executing this script).
  if (job.runtimeDirName) {
    log("Placing the runtime…");
    // Unpacked beside this script by the bootstrap; move it under lib/ so the install owns
    // it and nothing else on that machine is involved in running penguin.
    fs.mkdirSync(path.join(staging, "lib"), { recursive: true });
    fs.renameSync(path.join(here, job.runtimeDirName), path.join(staging, "lib", "runtime"));
  }

  const binDir = path.join(staging, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "penguin"), posixLauncher(), { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, "penguin.cmd"), windowsLauncher());
  if (!isWindows) fs.chmodSync(path.join(binDir, "penguin"), 0o755);

  log("Checking the staged install…");
  // The bundled runtime when there is one, otherwise the node already running this script —
  // which is exactly the node the launcher will fall back to.
  const nodeBin = job.runtimeDirName
    ? path.join(staging, "lib", "runtime", ...(isWindows ? ["node.exe"] : ["bin", "node"]))
    : process.execPath;
  const check = cp.spawnSync(
    nodeBin,
    [path.join(staging, "lib", "dist", "penguin.js"), "--version"],
    {
      encoding: "utf8",
    },
  );
  if (check.status !== 0) {
    throw new Error(
      `the staged install does not run: ${(check.stderr || check.error?.message || "").trim()}`,
    );
  }
  const version = (check.stdout || "").trim();

  log("Swapping into place…");
  cleanup(previous);
  if (fs.existsSync(programDir)) {
    fs.renameSync(programDir, previous);
    swapped = true;
  }
  fs.mkdirSync(path.dirname(programDir), { recursive: true });
  fs.renameSync(staging, programDir);
  cleanup(previous);

  // POSIX convenience only: put `penguin` on PATH the way the local installer does. Windows
  // needs a user PATH edit, which is not ours to make on someone else's machine.
  if (!isWindows) {
    try {
      const localBin = path.join(os.homedir(), ".local", "bin");
      fs.mkdirSync(localBin, { recursive: true });
      const link = path.join(localBin, "penguin");
      fs.rmSync(link, { force: true });
      fs.symlinkSync(path.join(programDir, "bin", "penguin"), link);
    } catch (err) {
      log(`note: could not link ~/.local/bin/penguin (${String(err)})`);
    }
  }

  log(
    `PenguinHarness ${version} installed to ${programDir}` +
      (job.runtimeDirName ? " (with its own Node runtime)" : " (using this machine's Node)"),
  );
  process.exit(0);
} catch (err) {
  if (swapped && fs.existsSync(previous)) {
    cleanup(programDir);
    try {
      fs.renameSync(previous, programDir);
      log("The previous installation was restored.");
    } catch (restoreErr) {
      log(`error: the previous installation is left at ${previous} (${String(restoreErr)})`);
    }
  }
  cleanup(staging);
  process.stderr.write(`${String(err && err.message ? err.message : err)}\n`);
  process.exit(1);
}
