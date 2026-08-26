/**
 * The `penguin` launchers, and with them the payload layout every non-Electron install has:
 *
 *     penguin/
 *       bin/{penguin,penguin.cmd}
 *       lib/dist/penguin.js      the CLI entry
 *       web/                     the web assets
 *       node/                    a bundled runtime, optional
 *
 * Three trees are built to that shape and all three take their launchers from here: the
 * release packages (.github/workflows/release.yml, via scripts/write-launchers.mjs), the
 * install image (packages/desktop/scripts/build-install-image.mjs), and what a push leaves
 * on a remote (remote-installer.cjs beside this file). They used to carry a copy each, and
 * the copies disagreed about where `web/` and `node/` sat.
 *
 * CommonJS with no dependencies, because remote-installer.cjs requires it on the far side
 * after both files ride scp there.
 *
 * @param nodeFlags flags for the system-node fallback only — a bundled runtime is the pinned
 *   build and needs none. Node 22 and 23 keep `node:sqlite` behind `--experimental-sqlite`.
 */
"use strict";

/** `bin/penguin`, chmod 755. Resolves through the ~/.local/bin symlink the installers leave. */
function posixLauncher(nodeFlags = []) {
  const flags = nodeFlags.length > 0 ? `${nodeFlags.join(" ")} ` : "";
  return `#!/bin/sh
# penguin launcher (generated from packages/server/src/machines/launcher.cjs).

# This script's real location; readlink -f is not portable to macOS, hence the loop.
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

export PENGUIN_WEB_DIST="\${PENGUIN_WEB_DIST:-$DIR/web}"
if [ -x "$DIR/node/bin/node" ]; then
  exec "$DIR/node/bin/node" "$DIR/lib/dist/penguin.js" "$@"
fi
exec node ${flags}"$DIR/lib/dist/penguin.js" "$@"
`;
}

/**
 * `bin\\penguin.cmd`. Deliberately no `.ps1` sibling: PowerShell prefers `.ps1` on PATH and the
 * default Restricted execution policy would then break the plain `penguin` command, while batch
 * files are exempt. CRLF on purpose — cmd.exe is unreliable with bare LF.
 */
function windowsLauncher(nodeFlags = []) {
  const flags = nodeFlags.length > 0 ? `${nodeFlags.join(" ")} ` : "";
  return [
    "@echo off",
    "rem penguin launcher (generated from packages/server/src/machines/launcher.cjs).",
    "setlocal",
    'set "DIR=%~dp0.."',
    'if not defined PENGUIN_WEB_DIST set "PENGUIN_WEB_DIST=%DIR%\\web"',
    // Only the Windows release package carries MinGit; elsewhere the guard is simply false.
    'if exist "%DIR%\\git\\usr\\bin\\sh.exe" set "PENGUIN_BUNDLED_SHELL=%DIR%\\git\\usr\\bin\\sh.exe"',
    'if exist "%DIR%\\node\\node.exe" (',
    '  "%DIR%\\node\\node.exe" "%DIR%\\lib\\dist\\penguin.js" %*',
    ") else (",
    `  node ${flags}"%DIR%\\lib\\dist\\penguin.js" %*`,
    ")",
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

module.exports = { posixLauncher, windowsLauncher };
