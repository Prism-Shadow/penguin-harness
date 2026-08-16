# @prismshadow/penguin-cli

The PenguinHarness command line. Installs the `penguin` command: an interactive REPL, a one-shot task runner, model / vault configuration, and the launcher for the Web service.

```bash
npm install -g @prismshadow/penguin-cli   # requires Node >= 24
```

```bash
penguin web        # start the Web service and open http://127.0.0.1:7376
penguin server     # same service, headless

penguin config model add --model-id deepseek-v4-pro --api-key sk-... --set-default

penguin run -m "Create hello.txt containing Hello, Penguin"    # one Task, then exit
penguin chat                                                   # REPL: /compact, /clear, /exit, Ctrl-C interrupts
penguin chat --resume                                          # resume the latest session
```

Tool calls go through an approval gate — `--approve allow-all` (default) `| deny-all | read-only | always-ask`. Data lives under `~/.penguin/data` (`PENGUIN_HOME` or `--root` override); model credentials come from the Project config or provider env vars (e.g. `DEEPSEEK_API_KEY`).

Prefer a one-line install with a bundled Node runtime? See [Quickstart → CLI and Web App](https://penguin.ooo/docs/quickstart-cli).

## Documentation

- [Quickstart](https://penguin.ooo/docs/quickstart)
- [CLI Reference](https://penguin.ooo/docs/cli)
- [Configuration Reference](https://penguin.ooo/docs/configuration)

## Development

```bash
pnpm penguin <args>                              # run from source (repo root, via tsx)
pnpm --filter @prismshadow/penguin-cli build     # tsup → dist/index.js (the penguin bin)
pnpm --filter @prismshadow/penguin-cli typecheck
pnpm --filter @prismshadow/penguin-cli test
```

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
