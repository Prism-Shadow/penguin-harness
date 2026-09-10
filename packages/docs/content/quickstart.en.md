---
title: Quickstart
description: Three routes — desktop app, CLI, or SDK — pick one to install PenguinHarness and run your first Task.
---

PenguinHarness has four ways in. They run the same engine; they differ only in how you meet it. Pick the one that fits you — each route's page carries you all the way to a first Task:

| Route | Best for | Terminal needed? |
| --- | --- | --- |
| [Desktop app](/quickstart-desktop) | Using PenguinHarness as a product, straight away | No — and it installs the `penguin` command for you |
| [CLI and Web App](/quickstart-cli) | Servers and remote machines, or wanting the `penguin` command | Once, to install |
| [Docker](/quickstart-docker) | A server you deploy rather than install — one container, one volume | Once, to start it |
| [SDK](/quickstart-sdk) | Embedding the engine in your own TypeScript program | Yes |

If you are unsure, take the [desktop app](/quickstart-desktop): it has the fewest steps, and moving to another route later costs you nothing. The macOS and Windows installers are signed, so only a downloaded Linux AppImage needs anything before the first launch — that page carries it.

## What they all share

- **One data root**: `~/.penguin/data` (`%USERPROFILE%\.penguin\data` on Windows; `/data` inside the container). Agents, model configuration and past Sessions live there, so the routes that share a machine can be mixed freely — a model configured in the desktop app is immediately usable from the CLI and the SDK.
- **One server at a time**: a data root only ever runs one server process. If a CLI-started instance is already up from `penguin web`, the desktop app attaches to it instead of starting a second one.
- **One interface**: the desktop app and `penguin web` open the same Web App; the former just embeds the server and skips the login.

## Before you start

PenguinHarness ships with no built-in model credentials, so a model must be configured before your first Task — an API key for one Provider is enough. Each route's page covers that step.

A model is always referenced as a `(provider, model_id)` pair — the Provider is never inferred from the model id. See [Models & Providers](/models) for the built-in groups.

## Next steps

- [Desktop app](/quickstart-desktop): a double-click install that opens already signed in.
- [CLI and Web App](/quickstart-cli): one line installs `penguin`; includes the full installation reference.
- [Docker](/quickstart-docker): the official image, for a server you reach over the network.
- [SDK](/quickstart-sdk): create Agents and Sessions from your own program.
