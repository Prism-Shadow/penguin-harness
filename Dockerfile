# The official PenguinHarness server image: `penguin server` on 0.0.0.0:7364, serving the
# Web App, with the data root at /data.
#
#   docker build -t penguin-harness:dev .
#   docker run -d -p 127.0.0.1:7364:7364 -v penguin-data:/data penguin-harness:dev
#
# Published from .github/workflows/docker.yml to Docker Hub as hiyouga/penguinharness.
# The user-facing contract (first sign-in, volumes, upgrades, reverse proxies) is
# documented in packages/docs/content/quickstart-docker.en.md.
#
# The program is built from this repository's source, by the recipe release.yml assembles
# the shipped CLI with: install the workspace, build the packages the server needs,
# `pnpm deploy` a production dependency tree into lib/, and put the built web assets beside
# it in web/. Nothing is installed from npm, so an image can carry an unreleased commit —
# which is what lets every push to main publish one.
#
# Three stages, split by WHERE each one has to run:
# - `build` is pinned to the BUILD platform. TypeScript and Vite emit the same bytes on any
#   machine, so running a whole workspace install and build under QEMU for the arm64 leg
#   would cost many minutes and buy nothing.
# - `native` runs on the TARGET platform, for the one thing that is architecture-specific:
#   node-pty's C++ binding, which is published for darwin and win32 only and therefore
#   compiles on every Linux install. It is the only compiled dependency in the CLI's
#   production tree — the rest is JavaScript, and the database is Node's own node:sqlite.
# - the runtime stage copies the result and never installs a compiler.
#
# Ubuntu rather than the `node:` images: it is what the CI runners are, so an image
# compiles native bindings against the glibc every release artifact was built on, and it
# is the environment the skills library assumes when an agent runs `apt-get`. The cost is
# that the Node runtime is installed here, pinned by hand — keep NODE_VERSION in step with
# `NODE_RUNTIME_VERSION` in .github/workflows/release.yml, which pins the runtime the
# release tarballs bundle. (The per-agent export template in core still renders its own
# `node:24-slim` Dockerfile; the intended convergence is for it to derive FROM this image
# and add only its bundle and entrypoint.)

ARG NODE_VERSION=24.18.0

# --- base: Ubuntu + the official Node runtime, shared by every stage below ---
FROM ubuntu:24.04 AS base

# git and curl are for the agent's own tools (cloning repositories, reaching HTTPS) and
# curl additionally serves the healthcheck; xz-utils unpacks the Node tarball below; tini
# reaps the orphans an agent's shell commands leave behind, which Node as PID 1 would not.
RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      tini \
      xz-utils; \
    rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION

# The official nodejs.org build, verified against the release's own SHASUMS256.txt. The
# checksum file travels the same TLS connection as the tarball, so this catches a
# truncated or corrupted download rather than a compromised nodejs.org; verifying the
# signature on SHASUMS256.txt would mean carrying and rotating the release keys.
#
# The architecture is read out of the container this stage is running IN rather than from
# TARGETARCH, because this stage is instantiated on two different platforms: `build` below
# pins itself to the build platform, and TARGETARCH there still names the platform the image
# is being built FOR — it would have that stage install an arm64 runtime onto an amd64 machine.
#
# The tarball's C++ headers (65 MB of /usr/local/include/node) go: nothing here compiles
# against them — node-gyp downloads its own copy for the version it is building for.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    cd /tmp; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${archive}"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    awk -v want="$archive" '$2 == want' SHASUMS256.txt > node.sha256; \
    test -s node.sha256; \
    sha256sum -c node.sha256; \
    tar -xJf "$archive" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "$archive" SHASUMS256.txt node.sha256; \
    rm -rf /usr/local/include/node; \
    node --version; \
    npm --version

# --- build: the workspace, built once on the build platform ---
FROM --platform=$BUILDPLATFORM base AS build

# pnpm compiles node-pty for the build platform while installing. That copy is thrown away
# with this stage — `native` below compiles the one that ships — but the toolchain still
# has to be here for the install to get through.
RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      g++ \
      make \
      python3; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src

# The context is the working tree minus dependencies, build output and local artifacts;
# .dockerignore says which and why.
COPY . .

# pnpm at the version the repository pins in `packageManager`, read out of that field so
# there is no second copy to keep in step. npm rather than corepack: corepack checks the
# download against signing keys baked into the Node build, which turns a pnpm release newer
# than the runtime into a failure that has nothing to do with this repository.
RUN set -eux; \
    npm install -g "$(node -p 'require("./package.json").packageManager')"; \
    npm cache clean --force; \
    pnpm --version

ARG PENGUIN_COMMIT

# The commit is what tells two builds of the same version apart, and a bundle carries no
# path back to the checkout it came from. This is the stamp release.yml applies before it
# builds; VERSION is deliberately left alone, because a build from main is not a release
# and the image's own version is a label. BRE: the unescaped | in these patterns is literal.
RUN set -eux; \
    if [ -n "$PENGUIN_COMMIT" ]; then \
      grep -q 'export const BUILD_COMMIT: string | null = ' packages/core/src/index.ts; \
      sed -i "s/export const BUILD_COMMIT: string | null = [^;]*/export const BUILD_COMMIT: string | null = \"$PENGUIN_COMMIT\"/" packages/core/src/index.ts; \
      grep -Fq "export const BUILD_COMMIT: string | null = \"$PENGUIN_COMMIT\"" packages/core/src/index.ts; \
    fi

# The desktop package is part of the workspace and its install script would fetch a ~150 MB
# Electron runtime this image never launches.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# `<pkg>...` selects a package together with its workspace dependencies, so the CLI filter
# pulls core, server and the @penguinharness/* plugin packages in topological order; web is
# named separately because nothing depends on it — its dist is what web/ ships. The rest of
# the workspace (desktop, docs, landing) is installed but never built.
#
# --config.verify-deps-before-run goes BEFORE the command: after it, pnpm forwards the flag
# to the script instead of reading it. The check wants a terminal to prompt at, and a Docker
# build has none.
RUN set -eux; \
    pnpm install --frozen-lockfile; \
    pnpm --config.verify-deps-before-run=false \
      --filter "@prismshadow/penguin-cli..." \
      --filter "@prismshadow/penguin-web" \
      build

# The payload layout every release artifact uses, and the one scripts/launchers/penguin
# spells out: lib/ is the CLI with its production dependencies, web/ the built front end.
# Deployed inside the workspace and moved afterwards, which is release.yml's line verbatim.
# The hoisted node-linker is part of that recipe — it keeps paths short enough for Windows,
# and it is the layout `npm rebuild` walks in the next stage.
RUN set -eux; \
    pnpm --config.node-linker=hoisted --filter @prismshadow/penguin-cli --prod deploy "$PWD/out/penguin/lib"; \
    cp -r packages/web/dist out/penguin/web; \
    mkdir -p /opt/penguin; \
    mv out/penguin/lib /opt/penguin/lib; \
    mv out/penguin/web /opt/penguin/web; \
    test -f /opt/penguin/lib/dist/penguin.js; \
    test -f /opt/penguin/web/index.html

# --- native: recompile what depends on the architecture, on the target platform ---
FROM base AS native

RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      g++ \
      make \
      python3; \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/penguin /opt/penguin

# node-pty's install script is `node scripts/prebuild.js || node-gyp rebuild`, and the
# prebuilds it publishes are darwin and win32 only, so on Linux the fallback compiles.
# build/ is removed first so that a rebuild which quietly did nothing cannot pass unnoticed:
# without that, the amd64 leg would still be carrying the binding the build stage produced
# and only the arm64 leg would break — on a push to main, long after the pull request that
# introduced the break went green.
#
# Dropping prebuilds/ saves ~58 MB of macOS and Windows bindings a Linux image can never
# load. It stays conditional on the binding this stage just compiled: a future node-pty that
# DOES publish a linux prebuild would skip the compile, and deleting the directory would
# then leave nothing to load.
#
# The require() is the proof rather than a formality — node-pty loads its binding at import
# time, so one built for the wrong architecture fails here instead of at the first Task.
RUN set -eux; \
    cd /opt/penguin/lib; \
    rm -rf node_modules/node-pty/build; \
    npm rebuild --foreground-scripts node-pty; \
    if [ -f node_modules/node-pty/build/Release/pty.node ]; then \
      rm -rf node_modules/node-pty/prebuilds; \
    fi; \
    node --input-type=commonjs -e 'require("node-pty")'

# --- runtime ---
FROM base

ARG PENGUIN_VERSION=dev
ARG PENGUIN_COMMIT

LABEL org.opencontainers.image.title="PenguinHarness" \
      org.opencontainers.image.description="PenguinHarness server and Web App" \
      org.opencontainers.image.url="https://penguin.ooo" \
      org.opencontainers.image.source="https://github.com/Prism-Shadow/penguin-harness" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${PENGUIN_VERSION}" \
      org.opencontainers.image.revision="${PENGUIN_COMMIT}"

# One directory carries the CLI, the server, the plugin packages, the built web assets and
# the node-pty binding compiled for this architecture.
#
# `penguin` is a symlink straight to the entry script rather than a copy of
# scripts/launchers/penguin, and that is a behaviour rather than a shortcut: the launcher
# would hand node a path ending in .js, and the server reads such a path as a re-runnable
# CLI entry — it would then offer in-container self-update, which installs into a filesystem
# the next `docker pull` throws away. Through the symlink argv[1] is /usr/local/bin/penguin,
# extensionless, so the entry stays unset and the update endpoint answers "unsupported".
# PENGUIN_WEB_DIST below is the other half of what that launcher would have done.
COPY --from=native /opt/penguin /opt/penguin
RUN set -eux; \
    chmod 0755 /opt/penguin/lib/dist/penguin.js; \
    ln -s /opt/penguin/lib/dist/penguin.js /usr/local/bin/penguin; \
    PENGUIN_HOME=/tmp/penguin-smoke penguin --version; \
    rm -rf /tmp/penguin-smoke

# ubuntu:24.04 ships a stock `ubuntu` account already holding uid/gid 1000 — the id a host
# user's bind mount most often carries — so it makes way for `penguin`. groupadd fails
# loudly if the id is still taken, which is what keeps the tolerant userdel above honest.
RUN set -eux; \
    userdel -r ubuntu 2>/dev/null || userdel ubuntu 2>/dev/null || true; \
    groupadd --gid 1000 penguin; \
    useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash penguin

# HOME is set explicitly because the entrypoint drops privileges with setpriv, which
# replaces the process's ids without rewriting its environment: without this the server
# would run as `penguin` while still pointed at root's home.
ENV HOME=/home/penguin \
    PENGUIN_HOME=/data \
    PENGUIN_WEB_DIST=/opt/penguin/web \
    HOST=0.0.0.0 \
    PORT=7364

WORKDIR /home/penguin

RUN set -eux; \
    mkdir -p /data; \
    chown penguin:penguin /data
VOLUME ["/data"]

EXPOSE 7364

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/penguin-entrypoint

# GET /api/install is public and needs no session, which is why it and not a page is the
# probe. It reads one small file per request, so it also fails when the data root is gone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/install" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/penguin-entrypoint"]
CMD ["penguin", "server"]
