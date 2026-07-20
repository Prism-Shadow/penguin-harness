---
title: Installation
description: Install PenguinHarness via the install script, npm, or from source.
---

## Requirements

- Linux / macOS (x64 or arm64): the install script ships platform tarballs with an official Node.js runtime bundled — no local Node needed.
- Other platforms, or installing via npm / from source: system Node.js >= 24.

## Script install (recommended)

On Linux / macOS:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

The script downloads the matching `penguin-{linux,darwin}-{x64,arm64}.tar.gz`, which bundles an official Node.js runtime. Other platforms do **not** fall back automatically: the script exits and asks you to install Node.js >= 24 and re-run with `--universal`, which selects the runtime-less `penguin-universal.tar.gz`.

Verify the install:

```bash
penguin -v
```

### Install location and options

| Item | Details |
| --- | --- |
| Install dir | `~/.penguin` by default; override with the `PENGUIN_INSTALL_DIR` env var |
| Command entry | A symlink `~/.local/bin/penguin` is created (the script warns if `~/.local/bin` is not on PATH) |
| Version pin | `PENGUIN_VERSION=vX.Y.Z` env var, or the `--version vX.Y.Z` script flag; defaults to the latest Release |
| Integrity check | Downloads are sha256-verified when the Release ships checksum assets |
| Upgrade | Re-run the install script; files are swapped atomically |

Script flags are passed as `curl ... | sh -s -- --universal`.

### Data directory

The data directory defaults to `~/.penguin/data` — under the install home `~/.penguin`, but never modified by install or upgrade — and is overridable with the `PENGUIN_HOME` env var. Model configuration, Session records, and other data are preserved across upgrades.

## npm install

Requires system Node.js >= 24:

```bash
npm install -g @prismshadow/penguin-cli
```

The npm package is `@prismshadow/penguin-cli`; the installed command is `penguin`. Web UI assets ship inside the `@prismshadow/penguin-server` package, so this single install yields a working `penguin web`.

## From source

Requires Node.js >= 24 and pnpm:

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

After the build, run `pnpm penguin <args>` inside the repo as the dev runner, or use the globally linked `penguin` command.

## Published npm packages

| Package | Description |
| --- | --- |
| `@prismshadow/penguin-cli` | Command-line tool providing the `penguin` command |
| `@prismshadow/penguin-core` | SDK for creating Agents and Sessions programmatically |
| `@prismshadow/penguin-server` | Web service, including the Web UI assets |
| `@prismshadow/penguin-skills` | Skill collection |

All packages are published under the Apache-2.0 license.

## Next steps

- [Quickstart](/quickstart): configure a model and run your first Task.
- [CLI Reference](/cli): the full list of commands and options.
