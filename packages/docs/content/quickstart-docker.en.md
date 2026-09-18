---
title: Docker
description: Run the official PenguinHarness image, with one container and one volume serving the full Web App on port 7364.
---

The official image runs the same server that `penguin server` starts, with the Web App inside it. One container and one volume are the whole deployment, which makes Docker the shortest route onto a machine that is not your laptop.

## Before you begin

- Docker on the machine that will run PenguinHarness. The examples below cover both Docker Compose and `docker run`.
- An API key for one model provider.

## Start the container

Use either tab: save the compose file, or run the commands.

```yaml tab="compose.yaml"
services:
  penguin:
    image: hiyouga/penguinharness:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:7364:7364"
    volumes:
      - penguin-data:/data
    stop_grace_period: 30s

volumes:
  penguin-data:
```

```bash tab="docker run"
docker volume create penguin-data
docker run -d --name penguin \
  -p 127.0.0.1:7364:7364 \
  -v penguin-data:/data \
  --restart unless-stopped \
  hiyouga/penguinharness:latest
```

With the compose file saved in the current directory, start it with `docker compose up -d`. Either way, the Web App is then at `http://localhost:7364` on the machine running Docker.

### Reach it from another machine

Both examples publish the port on the loopback interface of the machine running Docker, so a fresh deployment is not reachable from anywhere else. To use it from another machine, forward the port over ssh: `ssh -L 7364:127.0.0.1:7364 <host>`.

Exposing it to a network is a deliberate step. Publish the port on all interfaces instead: `-p 7364:7364` or `-p 0.0.0.0:7364:7364` with `docker run`, or `"7364:7364"` in compose. Preferably put it behind a reverse proxy that terminates TLS; see [Run behind a reverse proxy](#run-behind-a-reverse-proxy).

Inside its own network namespace, the container always listens on `0.0.0.0`, which is what makes a published port work at all. The address in `-p` sets the host's side.

## Sign in for the first time

A fresh data root has no password. Until one is set, the server prints a sign-in link in a framed notice every time it starts. Read it from the container's log:

```bash
docker compose logs penguin        # or: docker logs penguin
```

The notice looks like this:

```
+----------------------------------------------------------------------------------------------+
|   This server has no admin password yet. Open this link to claim it:                         |
|                                                                                              |
|     http://localhost:7364/api/auth/claim?token=GSiEDYM8MbsrqtMj7ofq7klUyXcfQNwt3oUriUHiBI8   |
|                                                                                              |
|   The link lasts 30 days or until a password is set; restarting prints a fresh one.          |
+----------------------------------------------------------------------------------------------+
```

The `localhost` in that URL is the server's view of itself. With the loopback publish above it is also yours, so open the link as it is on the machine running Docker. If you published the container to a network, replace `localhost` with the host you reach it on. Either way, keep the whole `?token=...`.

The link signs you in as `admin`, and you set a password. A new link is minted on every start, so a restart invalidates the one you have and prints a fresh one.

### Set the password in advance

If reading a link from a log does not suit your setup, pin the password instead. Do this before the first start:

```yaml
environment:
  PENGUIN_SEED_ADMIN_PASSWORD: "choose-something-long"
```

The server then creates the built-in `admin` with that password (at least 8 characters) and prints no notice. The variable applies only while no user exists, which means the first boot of an empty data root. Adding it to a data root that has already been claimed changes nothing, and neither does changing it later.

## Configure a model

PenguinHarness ships with no model credentials. Add a model on the **Models** page of the Web App, or with the CLI inside the container:

```bash
docker compose exec -u penguin penguin \
  penguin config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
```

Keep `-u penguin` in the command. `docker exec` runs as root by default, so files it writes into `/data` would belong to root, while the server runs as uid 1000.

See [Models & Providers](/models) for the built-in groups.

## Run your first Task

In the Web App's sidebar, click **New chat**, then send a first message, such as "Create hello.txt containing Hello, Penguin". The agent's commands run inside the container; [What the agent can reach](#what-the-agent-can-reach) explains how to give it a directory from the host. [Conversations](/chat) covers the chat page in full.

## Choose an image tag

The image is published as:

```
hiyouga/penguinharness
```

It has two kinds of tag:

- `latest` follows `main`: every push rebuilds it.
- `X.Y.Z` is a release, built from that tag's own source.

There is no `main-<sha>`, `X.Y` or `stable` tag, so nothing moves under a second name. Every tag is a multi-platform manifest covering `linux/amd64` and `linux/arm64`, so the same reference works on an x86 VPS and an arm64 one alike. The examples on this page use `latest`. Pin a version for a deployment that should move only when a release ships.

## What is in the image

| Item | Details |
| --- | --- |
| Base | Ubuntu 24.04 with the official Node.js runtime, at the version the release tarballs bundle |
| Command | `penguin server`, on `0.0.0.0:7364` |
| Data root | `/data`, declared as a volume. It holds model configuration, Sessions, Traces and the SQLite database |
| Process user | `penguin`, uid/gid 1000. The entrypoint starts as root only to take ownership of the data root, then drops to that user |
| Healthcheck | `GET /api/install` every 30s |
| Tools | `git`, `curl` and the standard Ubuntu userland, for the commands an agent runs |

### What the agent can reach

Everything the agent's `exec_command` runs happens inside this container, on its filesystem and its network. That is the isolation boundary, and also the limit: an agent can reach whatever the container can reach, and nothing else.

To give the agent a Workspace, mount a directory, for example `-v /srv/project:/srv/project`. The mount must be writable by uid 1000.

### Add tools to the image

The image carries no compiler and no language runtime besides Node. `apt-get install` inside the container works for a one-off, but the package is gone after the next `docker pull`. For anything you depend on, build a derived image:

```dockerfile
FROM hiyouga/penguinharness:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*
USER penguin
```

The runtime image deliberately has no C/C++ toolchain: the toolchain lives in a build stage that is thrown away.

## Environment variables

These are the variables a container deployment touches. The full list is in the [Configuration Reference](/configuration).

| Variable | In this image |
| --- | --- |
| `PENGUIN_HOME` | `/data`. Change it only if you also move the volume |
| `HOST` | `0.0.0.0`, inside the container's own network namespace. `-p` decides the host side, and the examples keep it on loopback |
| `PORT` | `7364`. Changing it moves the healthcheck with it |
| `PENGUIN_SEED_ADMIN_PASSWORD` | Pins the initial admin password, on the first boot only. See [Set the password in advance](#set-the-password-in-advance) |
| `PENGUIN_TRUST_PROXY` | Set to `1` behind a reverse proxy that terminates TLS, so session cookies are marked `Secure` |
| `PENGUIN_PREVIEW_ORIGIN` | A second hostname routed to the same container, for Workspace HTML previews |
| `PENGUIN_UPDATE_CHECK` | `off` turns off the automatic release check. Model requests, remote-control connections, key authorization and the proxy test still go out |

### Run behind a reverse proxy

Publish the container on loopback, terminate TLS in front of it, and set `PENGUIN_TRUST_PROXY=1`. The proxy must set or strip `x-forwarded-proto` itself. That header comes from the caller, which is exactly why the server ignores it until you tell it otherwise. If you leave `PENGUIN_TRUST_PROXY` unset on an HTTPS deployment, session cookies are issued without the `Secure` flag.

### Serve Workspace previews

Previews of the HTML a Task produces are served from a separate origin when there is one. On a non-loopback bind there is no loopback counterpart to derive, so previews fall back to a same-origin sandbox, where cookies, `localStorage` and third-party embeds do not work. To get the isolated previews back, point `PENGUIN_PREVIEW_ORIGIN` at a second hostname routed to the same container. It must differ by hostname, not just by port.

## Upgrade the container

Pull a newer tag and recreate the container. The data root is on the volume and carries over:

```bash
docker compose pull && docker compose up -d
```

> [!WARNING]
> Do not update from inside the container. The update dialog reports that this install cannot update itself, and anything `penguin update` installs there is lost when the container is recreated.

Stopping is graceful. On `SIGTERM` the server interrupts running Tasks, waits for them to wrap up, then closes the database. An idle server stops in well under a second, and a busy one can take several seconds, which is why the compose example raises Docker's 10-second grace period.

## Reset a forgotten admin password

Stop the server first, because a data root only ever has one writer. Then reset the password and start the server again:

```bash
docker compose stop penguin
docker compose run --rm penguin penguin server reset-admin-password
docker compose start penguin
```

The reset needs no other authorization: the data root is the authorization, and anyone who can run this command already has the database. The `admin` account returns to the unclaimed state and its login sessions are revoked. Sign in again with the first-login link from the log, as in [Sign in for the first time](#sign-in-for-the-first-time).

## Next steps

- [Web App](/web-app): use PenguinHarness from the browser.
- [Update PenguinHarness](/updates): check your version and upgrade.
- [Security Model](/security): who can do what, and on the strength of which proof.
- [Configuration Reference](/configuration): every environment variable and config field.
