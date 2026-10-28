/**
 * Vitest config: node environment, no DOM. Tests drive the app's logic, its stores and the
 * components that render to static markup; e2e/ (Playwright, `test:e2e`) is excluded.
 * Kept separate from vite.config.ts: vitest's bundled vite 5 types conflict with this package's vite 7
 * plugin types, and tests don't need the plugin anyway. CI runs the suite in two halves, one job
 * each (`--shard=1/2`, `--shard=2/2`: scripts/ci-plan.mjs).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
/** The app's socket module, the stand-in a node suite runs in its place, and the app itself. */
const appSource = resolve(here, "src") + sep;
const socketModule = resolve(here, "src/api/socket.ts");
const socketStandIn = resolve(here, "test/socket-stand-in.ts");

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
    const from = resolve(importer.split("?")[0]!);
    if (!from.startsWith(appSource)) return null;
    const wanted = resolve(dirname(from), source);
    if (wanted !== socketModule && `${wanted}.ts` !== socketModule) return null;
    return socketStandIn;
  },
};

export default defineConfig({
  plugins: [socketStandInPlugin],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Every vi.stubGlobal (fetch, localStorage, …) is undone before the next test starts.
    unstubGlobals: true,
    // `vitest run --coverage`: branch and line coverage of the app's own source.
    coverage: { provider: "v8", include: ["src/**"] },
  },
});
