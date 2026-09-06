# @prismshadow/penguin-plugin-test

Integration testing for PenguinHarness plugins, the way `@vscode/test-electron` tests a VS Code extension: start the **real** host with the plugin under development installed, then run the tests against it.

The host is the server (`@prismshadow/penguin-server`'s built entry), started as a child process on a scratch data root whose `plugins.json` lists the plugin. What a test exercises is the path a deployment takes — the loader resolves the package, reads its manifests, pairs them with its code, and boots its modules into the platform tree. Nothing is assembled in-process, nothing in the host is mocked.

```ts
import { startHarness, waitFor } from "@prismshadow/penguin-plugin-test";

const harness = await startHarness({
  plugins: [new URL("..", import.meta.url).pathname], // this package's directory; its `main` must be built
  env: { PENGUIN_CLAUDE_BIN: fakeClaude },             // anything the server process should see
});
try {
  const api = await harness.login();                    // the seeded admin
  const { plugins } = await api.get("/api/plugins/installed");
  const { session } = await api.post("/api/projects/default_project/agents/default_agent/sessions", {
    surface: "claude-code",
  });
  const opened = await api.post(`/api/sessions/${session.sessionId}/surface`, { prompt: "hello" });
  const terminal = api.terminal(opened.view.terminalId);
  await waitFor(terminal.capture, (lines) => lines.join("\n").includes("hello"));
} finally {
  await harness.stop();
}
```

## API

- `startHarness(options)` → `Harness`. `plugins` names package directories (absolute; the built `main` is what `plugins.json` lists) or specifiers the server resolves on its own. `env` reaches the server process; `webDist` serves a built Web App for browser-level tests; `root` pins the data root (a temporary one is removed by `stop()`, unless `keepRoot`).
- `Harness`: `baseUrl`, `port`, `root`, `admin`, `plugins` (as listed), `login()` / `loginAs(userId, password)` → `HarnessApi`, `installedPlugins()`, `output()` (the server's lines), `stop()`.
- `HarnessApi`: `get` / `post` / `put` / `patch` / `delete` (JSON in and out, non-2xx throws `HarnessApiError` with the status and body), `request` (the raw `Response`), and `terminal(id)` with `info()`, `capture()` (the screen's lines) and `keys(text)`.
- `waitFor(read, until, { timeoutMs, intervalMs, what })` polls a read until it satisfies a predicate.

## Requirements

`@prismshadow/penguin-server` built (`pnpm --filter @prismshadow/penguin-server build`), and the plugin built. The seeded admin's password is fixed for every harness (`DEFAULT_ADMIN_PASSWORD`), the published plugin index is off, and each harness takes a free port.

This is a development dependency: no build of the harness ships it.
