---
title: Quickstart
description: Pick one of four routes, the desktop app, the CLI and Web App, Docker, or the SDK, to install PenguinHarness and run your first Task.
---

PenguinHarness has four ways in: the desktop app, the CLI and Web App, Docker, and the SDK. They run the same engine and differ only in how you meet it. Pick the route that fits you; each route's page takes you all the way to a first Task.

## Before you begin

PenguinHarness ships with no built-in model credentials, so you configure a model before your first Task. An API key for one provider is enough, and each route's page covers this step.

A model is always referenced as a `(provider, model_id)` pair; the provider is never inferred from the model id. See [Models & Providers](/models) for the built-in groups.

## Choose a route

| Route | Best for | Terminal needed? |
| --- | --- | --- |
| [Desktop app](/quickstart-desktop) | Using PenguinHarness as a product, straight away | No, and it installs the `penguin` command for you |
| [CLI and Web App](/quickstart-cli) | Servers and remote machines, or wanting the `penguin` command | Once, to install |
| [Docker](/quickstart-docker) | A server you deploy rather than install, with one container and one volume | Once, to start it |
| [SDK](/quickstart-sdk) | Embedding the engine in your own TypeScript program | Yes |

If you are unsure, take the [desktop app](/quickstart-desktop). It has the fewest steps, and moving to another route later costs you nothing. The macOS and Windows installers are signed, so only a downloaded Linux AppImage needs a step before its first launch, which the desktop app page covers.

## What all routes share

- **One data root**: `~/.penguin/data` (`%USERPROFILE%\.penguin\data` on Windows; `/data` inside the container). Agents, model configuration and past Sessions live there, so routes on the same machine can be mixed freely: a model configured in the desktop app is immediately usable from the CLI and the SDK.
- **One server at a time**: a data root only ever runs one server process. If you already started one with `penguin web`, the desktop app attaches to it instead of starting a second one.
- **One interface**: the desktop app and `penguin web` open the same Web App. The desktop app embeds the server and skips the login.

## Next steps

- [Desktop app](/quickstart-desktop): a double-click install that opens already signed in.
- [CLI and Web App](/quickstart-cli): one line installs `penguin`, with the full installation reference.
- [Docker](/quickstart-docker): the official image, for a server you reach over the network.
- [SDK](/quickstart-sdk): create agents and Sessions from your own program.
- [Key concepts](/concepts): the terms used throughout these docs.
