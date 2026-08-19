/**
 * Per-form app identity — pure, no Electron imports, so it unit-tests under plain
 * vitest.
 *
 * A dev (unpackaged) shell must be able to run while an installed release build is
 * running (#292). Electron keys everything that must stay per-instance on the app
 * name: the userData directory holds the Chromium profile and this shell's state
 * files (server-port, preferred-port, cli-install-offered), and the single-instance
 * lock is derived from it — under a shared name a second launch does not open a
 * second app, it quits into the running instance's window. A dev-suffixed name
 * therefore separates the whole set at once (own profile, own sticky port, own
 * instance lock) and doubles as the visible marker of which instance is which (the
 * macOS app menu label follows app.name).
 *
 * The Windows AppUserModelID splits the same way: Windows groups taskbar buttons and
 * routes toast notifications by AUMID, so a dev run must not claim the installed
 * app's identity. (Dev toasts may not render without an installed shortcut carrying
 * the dev AUMID — acceptable for a source run; the release value keeps matching what
 * electron-builder stamps on the installed shortcuts, see electron-builder.yml.)
 *
 * Tripwire for whoever edits main.ts's imports: Electron resolves the userData path
 * once, on the first read, and caches it — so `app.setName()` only relocates anything
 * while nothing has read it yet. ESM evaluates every import before main.ts's first
 * statement, which means a module-scope `app.getPath(…)` anywhere in the import graph
 * would silently pin userData to the package name and undo this whole split. Verified
 * safe today, including updater.ts's eager `electron-updater` construction; keep any
 * new `app.getPath` call inside a function.
 */
import path from "node:path";

export interface AppIdentity {
  /** app.setName() value; Electron derives the default userData directory from it. */
  name: string;
  /** Windows AppUserModelID. The release value must equal electron-builder.yml's appId. */
  appUserModelId: string;
}

/** The identity for this form: release, or dev-suffixed so both can run side by side. */
export function appIdentity(isPackaged: boolean): AppIdentity {
  return isPackaged
    ? { name: "PenguinHarness", appUserModelId: "com.prismshadow.penguinharness" }
    : { name: "PenguinHarness-Dev", appUserModelId: "com.prismshadow.penguinharness.dev" };
}

/**
 * The dev default data root, `~/.penguin/dev-data` — the same convention as the repo's
 * other dev entry points (CONTRIBUTING.md), kept apart from the release/CLI
 * `~/.penguin/data`. Without this split a dev shell launched bare (no PENGUIN_HOME)
 * would find the release install's server.lock on the shared root and attach to the
 * running RELEASE instance — or, with the release idle, spawn its own server over the
 * release's data.
 */
export function devDataRoot(homedir: string): string {
  return path.join(homedir, ".penguin", "dev-data");
}

/**
 * This form's data root, i.e. the precedence rule itself: an explicit `PENGUIN_HOME`
 * always wins; without one a release build shares the CLI's root (design § "桌面端原型 ·
 * 数据根与实例互斥") and a dev run takes the repo's dev root instead of attaching to — or
 * writing into — the release install's data.
 *
 * `releaseRoot` stays a thunk (core's `resolveRoot`) so core remains the single
 * definition point of `~/.penguin/data`; it is only called when there is no explicit
 * value, which is exactly the case where `resolveRoot()` yields that default. Pure, so
 * the rule is unit-tested — it cannot be, inline in main.ts, which imports Electron.
 */
export function desktopDataRoot(opts: {
  envHome: string | undefined;
  isPackaged: boolean;
  homedir: string;
  releaseRoot: () => string;
}): string {
  return opts.envHome ?? (opts.isPackaged ? opts.releaseRoot() : devDataRoot(opts.homedir));
}
