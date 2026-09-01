/**
 * Where the embedded server serves the Web App from — pure, no Electron imports, so it
 * unit-tests under plain vitest.
 *
 * A packaged app carries the web build at `<app>/web-dist` (electron-builder.yml maps
 * `../web/dist` there), which is also the first place the server's own default lookup
 * tries — so pinning it explicitly changes nothing in a healthy install. What it buys is
 * failing loudly: a build packed without the web assets, or one whose lookup lands
 * elsewhere, used to open a window on a server that answered 404 to every page and said
 * nothing about why. The shell now names the directory and checks it before the fork.
 *
 * An explicit `PENGUIN_WEB_DIST` still wins, as it does for the server itself: it is the
 * hook for serving a different build against an installed app.
 *
 * A source run pins nothing — `packages/desktop/web-dist` does not exist there, and the
 * server's fallback to `packages/web/dist` is what `pnpm desktop` relies on.
 */
import path from "node:path";

/** The web dist the embedded server should serve, or null to leave it to the server's default. */
export function webDistFor(opts: {
  isPackaged: boolean;
  appPath: string;
  env: NodeJS.ProcessEnv;
}): string | null {
  const explicit = opts.env.PENGUIN_WEB_DIST?.trim();
  if (explicit) return explicit;
  return opts.isPackaged ? path.join(opts.appPath, "web-dist") : null;
}

/** The entry page a usable web dist must contain; the check the shell runs before the fork. */
export function webDistEntry(webDist: string): string {
  return path.join(webDist, "index.html");
}
