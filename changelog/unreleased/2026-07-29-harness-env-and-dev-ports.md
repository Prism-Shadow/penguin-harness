# Tooling: harness environment variables no longer leak into Agent commands

Agent-spawned commands now start from a host environment with PenguinHarness-owned server variables removed, and the development backend moves off the installed server's default port so local app work is less likely to talk to the wrong process.

## Child command environment

`exec_command` and `input_command` build their child process environment through the command session manager. That path now deletes `PORT`, `HOST`, `PENGUIN_CLI_ENTRY`, and `PENGUIN_WEB_DIST` from the inherited host environment before applying the Agent vault and command-hardening defaults.

The change keeps the harness's own listen address and internal launch paths out of programs an Agent starts. A generated Vite, Next.js, Express, or similar dev server can therefore choose its own port instead of inheriting the port that PenguinHarness itself is using. When an Agent really does need to force a command's `PORT`, the vault still applies after the host strip, so that explicit per-Agent value wins.

## Development ports

The repository's development backend now defaults to `7368`, leaving the installed server and Web UI on the packaged default `7364`. The Web package's Vite proxy points at that development backend by default, while `PENGUIN_API_PROXY` can still override the whole proxy target and `PORT` can still move the backend/proxy pair together for local experiments.

The port allocation table in core documents the local development ports alongside the installed default, and the development docs now call out the split so developers can tell which process their browser is reaching.
