---
title: Docker
description: Run the official PenguinHarness image — one container, one volume, the full Web App on port 7364.
---

The official image runs the same server `penguin server` starts, with the Web App inside it. One container and one volume are the whole deployment, which makes it the shortest route onto a machine that is not your laptop.

```
ghcr.io/prism-shadow/penguin-harness
```

Tags are `X.Y.Z` and `X.Y`, plus `latest` for the current release. Each tag is a multi-platform manifest covering `linux/amd64` and `linux/arm64`, so the same reference serves an x86 VPS and an arm64 one alike.

## Run it

```yaml tab="compose.yaml"
services:
  penguin:
    image: ghcr.io/prism-shadow/penguin-harness:latest
    restart: unless-stopped
    ports:
      - "7364:7364"
    volumes:
      - penguin-data:/data
    stop_grace_period: 30s

volumes:
  penguin-data:
```

```bash tab="docker run"
docker volume create penguin-data
docker run -d --name penguin \
  -p 7364:7364 \
  -v penguin-data:/data \
  --restart unless-stopped \
  ghcr.io/prism-shadow/penguin-harness:latest
```

With the compose file saved next to you, `docker compose up -d` starts it. Either way the Web App is then at `http://<host>:7364`.

The container listens on `0.0.0.0` inside its own network namespace, so `-p 7364:7364` is what decides who can reach it. `-p 127.0.0.1:7364:7364` keeps it on the host's loopback, for a machine you reach over ssh or put behind a reverse proxy.

## First sign-in

A fresh data root has no password. The server prints a sign-in link in a framed notice on every start until one is set — read it out of the container's log:

```bash
docker compose logs penguin        # or: docker logs penguin
```

```
+--------------------------------------------------------------------+
|   This server has no admin password yet. Open this link to claim:   |
|                                                                     |
|     http://localhost:7364/api/auth/claim?token=...                  |
|                                                                     |
|   The link works until a password is set, and changes on restart.   |
+--------------------------------------------------------------------+
```

The `localhost` in that URL is the server's own view of itself; replace it with the host you actually reach the container on, keep the whole `?token=...`, and open it. You land signed in as `admin` and set a password. The link is re-minted on every start, so a restart invalidates the one you were looking at and prints a fresh one.

If reading a link out of a log does not suit your setup, pin the password instead — but do it **before the first start**:

```yaml
environment:
  PENGUIN_SEED_ADMIN_PASSWORD: "choose-something-long"
```

It seeds the built-in `admin` with that password (8 characters minimum) and suppresses the notice. It applies **only while no user exists**, which is the first boot of an empty data root: adding it to a data root that has already been claimed changes nothing, and neither does changing it later.

## Configure a model

PenguinHarness ships with no model credentials. Use the **Models** page in the Web App, or the CLI inside the container:

```bash
docker compose exec -u penguin penguin \
  penguin config model add --provider deepseek --model-id deepseek-v4-flash-vision-exp --api-key sk-... --set-default
```

The `-u penguin` matters: `docker exec` runs as root by default, and files it writes into `/data` would then be owned by root while the server runs as uid 1000. See [Models & Providers](/models) for the built-in groups.

## What is in the image

| | |
| --- | --- |
| Base | Ubuntu 24.04 with the official Node.js runtime, matching the version the release tarballs bundle |
| Command | `penguin server`, on `0.0.0.0:7364` |
| Data root | `/data`, declared as a volume — model configuration, Sessions, Traces and the SQLite database |
| Process user | `penguin`, uid/gid 1000; the entrypoint starts as root only to take ownership of the data root, then drops |
| Healthcheck | `GET /api/install` every 30s |
| Tools | `git`, `curl` and the standard Ubuntu userland, for the commands an agent runs |

Everything the agent's `exec_command` runs happens **inside this container**, on its filesystem and its network. That is the isolation boundary and also the limit: an agent can reach whatever the container can reach, and nothing else. Give it a Workspace by mounting a directory (`-v /srv/project:/srv/project`), and remember the mount needs to be writable by uid 1000.

The image carries no compiler and no language runtimes beyond Node. `apt-get install` inside the container works for a one-off, but it is lost on the next `docker pull`; for anything you depend on, build a derived image:

```dockerfile
FROM ghcr.io/prism-shadow/penguin-harness:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*
USER penguin
```

Note that the runtime image deliberately has no C/C++ toolchain: it is a stage the build throws away.

## Environment

The full list is in the [Configuration Reference](/configuration); these are the ones a container deployment touches.

| Variable | In this image |
| --- | --- |
| `PENGUIN_HOME` | `/data` — change it only if you also move the volume |
| `HOST` | `0.0.0.0` — the container's own namespace, published by `-p` |
| `PORT` | `7364`; changing it moves the healthcheck with it |
| `PENGUIN_SEED_ADMIN_PASSWORD` | Pins the initial admin password, first boot only (see above) |
| `PENGUIN_TRUST_PROXY` | Set to `1` behind a TLS-terminating reverse proxy, so session cookies are marked `Secure` |
| `PENGUIN_PREVIEW_ORIGIN` | A second hostname routed to the same container, for Workspace HTML previews |
| `PENGUIN_UPDATE_CHECK` | `off` disables the release check — the server's only outbound non-model request |

### Behind a reverse proxy

Publish the container on loopback, terminate TLS in front of it, and set `PENGUIN_TRUST_PROXY=1`. The proxy must set or strip `x-forwarded-proto` itself; the header is caller-supplied, which is exactly why the server ignores it until you say otherwise. Leaving it unset on an HTTPS deployment issues session cookies without the `Secure` flag.

### Workspace previews

Previews of HTML a Task produces are served from a separate origin when there is one. On a non-loopback bind there is no loopback counterpart to derive, so they fall back to a same-origin sandbox where cookies, `localStorage` and third-party embeds do not work. Point `PENGUIN_PREVIEW_ORIGIN` at a second hostname routed to the same container to get the isolated version back — it must differ by hostname, not just port.

## Upgrading

Pull a newer tag and recreate the container. The data root is on the volume and carries over:

```bash
docker compose pull && docker compose up -d
```

Do **not** use the Web App's update button or `penguin update` inside a container. They install a new package into the running container's filesystem, which is thrown away on the next recreate — and the runtime image has no compiler, so the install fails before it gets that far. A new image tag is the upgrade path.

Stopping is graceful: `SIGTERM` interrupts running Tasks, waits for them to wrap up, then closes the database. An idle server stops in well under a second; a busy one can take several, which is why the compose example raises Docker's 10-second grace period.

## Rescue: a forgotten admin password

The data root is the authorization — someone who can run this command already has the database. The server has to be stopped first, because a data root only ever has one writer:

```bash
docker compose stop penguin
docker compose run --rm penguin penguin server reset-admin-password
docker compose start penguin
```

The account returns to the unclaimed state with its sessions revoked, so sign in again through the first-login link in the log, exactly as on a fresh server.

## Next steps

- [Web App Guide](/web-app): use PenguinHarness from the browser.
- [Security Model](/security): who can do what, and on the strength of which proof.
- [Configuration Reference](/configuration): every environment variable and config field.
