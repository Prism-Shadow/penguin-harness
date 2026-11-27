/**
 * Vitest config: node environment, no DOM. Tests drive the app's logic, its stores and the
 * components that render to static markup; e2e/ (Playwright, `test:e2e`) is excluded.
 * Kept separate from vite.config.ts: vitest's bundled vite 5 types conflict with this package's vite 7
 * plugin types, and tests don't need the plugin anyway. CI runs the suite in two halves, one job
 * each (`--shard=1/2`, `--shard=2/2`: scripts/ci-plan.mjs).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * A path in vite's spelling: forward slashes on every OS. vite hands `resolveId` its importers
 * that way (`C:/…/src/api/client.ts` on Windows), while node:path answers with backslashes
 * there, so the two are compared only after both are spelled alike — compared raw, no importer
 * on Windows ever looked like the app's, and every suite ran without its socket. `comparable`
 * also reads a drive letter in either case, as Windows does.
 */
const slashed = (path: string): string => path.replaceAll("\\", "/");
const comparable = (path: string): string =>
  slashed(path).replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase());
const here = dirname(fileURLToPath(import.meta.url));
/** The app's socket module, the stand-in a node suite runs in its place, and the app itself. */
const appSource = `${comparable(resolve(here, "src"))}/`;
const socketModule = comparable(resolve(here, "src/api/socket.ts"));
const socketStandIn = slashed(resolve(here, "test/socket-stand-in.ts"));

/**
 * The app has one transport for its API calls now: everything but the runtime's own paths is a
 * call on `apiSocket` (src/api/client.ts), and the socket queues a call it cannot send yet. Off
 * a page there is no socket to be had — Node has no WebSocket — so the app's own imports of its
 * socket module are pointed at test/socket-stand-in.ts: the real module, with a socket a node
 * host can have. Only the app's imports: a test file still imports `src/api/socket` itself, so
 * api-socket.test.ts drives the real client, and a suite that wants to stand in for the socket
 * mocks `test/socket-stand-in` — one module, one seam.
 */
const socketStandInPlugin: Plugin = {
  name: "socket-stand-in",
  enforce: "pre",
  resolveId(source, importer) {
    if (importer === undefined) return null;
    const from = comparable(resolve(importer.split("?")[0]!));
    if (!from.startsWith(appSource)) return null;
    const wanted = comparable(resolve(dirname(from), source));
    if (wanted !== socketModule && `${wanted}.ts` !== socketModule) return null;
    return socketStandIn;
  },
};

export default defineConfig({
  plugins: [socketStandInPlugin],
  // The session domain's web half (library/session/src/web) sits outside the tsconfig whose
  // `jsx` setting covers the app's own sources, and vite/esbuild would lower its JSX with the
  // classic runtime there. Every suite transform gets the automatic runtime instead, whatever
  // root the file sits under.
  esbuild: { jsx: "automatic" },
  // The session domain's web half resolves through the same two face specifiers the app's
  // build aliases (vite.config.ts): the suite imports the moved sources by the face's deep
  // paths, and the moved sources consume the app through src/internal.ts.
  resolve: {
    alias: [
      {
        find: /^@prismshadow\/penguin-library-session\/web$/,
        replacement: `${resolve(here, "../../library/session/src/web")}/index.ts`,
      },
      {
        find: /^@prismshadow\/penguin-library-session\/web\/(.*)$/,
        replacement: `${resolve(here, "../../library/session/src/web")}/$1`,
      },
      {
        find: /^@prismshadow\/penguin-web\/internal$/,
        replacement: resolve(here, "src/internal.ts"),
      },
      {
        find: /^@prismshadow\/penguin-web\/internal-hub$/,
        replacement: resolve(here, "src/internal-hub.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    // The scroll-driven component tests simulate a run of animation frames over a tall trace;
    // under a loaded CI runner (the import pass alone can take minutes) the default 5 s has let
    // a passing test time out. A larger deadline changes nothing for passing tests.
    testTimeout: 15_000,
    include: ["test/**/*.test.ts", "src/features/*/test/**/*.test.ts"],
    // Every vi.stubGlobal (fetch, localStorage, …) is undone before the next test starts.
    unstubGlobals: true,
    // `vitest run --coverage`: branch and line coverage of the app's own source, and of the
    // session domain's web half the app compiles in.
    coverage: { provider: "v8", include: ["src/**", "../../library/session/src/web/**"] },
  },
});
