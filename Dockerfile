# The official PenguinHarness server image: `penguin server` on 0.0.0.0:7364, serving the
# Web App, with the data root at /data.
#
#   docker build --build-arg PENGUIN_VERSION=0.2.9 -t penguin-harness:dev .
#   docker run -d -p 7364:7364 -v penguin-data:/data penguin-harness:dev
#
# Published from .github/workflows/docker.yml as ghcr.io/prism-shadow/penguin-harness.
# The user-facing contract (first sign-in, volumes, upgrades, reverse proxies) is
# documented in packages/docs/content/quickstart-docker.en.md.
#
# The program comes from the published npm package rather than from this repository's
# source: one version knob, a build context of a single shell script, and the same recipe
# the docs give for an npm install. The consequence is that only a version that
# `publish-npm` has already landed can be built — an image of unreleased code would have
# to duplicate the release job's assemble recipe.
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

# --- base: Ubuntu + the official Node runtime, shared by the builder and the runtime ---
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
ARG TARGETARCH

# The official nodejs.org build, verified against the release's own SHASUMS256.txt. The
# checksum file travels the same TLS connection as the tarball, so this catches a
# truncated or corrupted download rather than a compromised nodejs.org; verifying the
# signature on SHASUMS256.txt would mean carrying and rotating the release keys.
#
# The tarball's C++ headers (65 MB of /usr/local/include/node) go: nothing here compiles
# against them — node-gyp downloads its own copy for the version it is building for.
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
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

# --- build: the toolchain that node-pty needs, and nothing that ships ---
FROM base AS build

# node-pty publishes prebuilt bindings for darwin and win32 only, and its install script is
# `node scripts/prebuild.js || node-gyp rebuild` — so every Linux install of the server
# compiles it, and needs a C++ toolchain plus python3 to do so. That toolchain is a hundred
# megabytes and a standing attack surface, hence this stage: the runtime below copies the
# compiled tree out and never installs a compiler.
RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      g++ \
      make \
      python3; \
    rm -rf /var/lib/apt/lists/*

ARG PENGUIN_VERSION

# The last two lines drop node-pty's ~58 MB of prebuilt macOS and Windows bindings, which a
# Linux image can never load. That is conditional on the Linux binding this stage just
# compiled: a future release that DOES publish a linux prebuild would skip the compile, and
# deleting the directory would then leave nothing to load.
RUN set -eux; \
    if [ -z "${PENGUIN_VERSION:-}" ]; then \
      echo "PENGUIN_VERSION is required, e.g. --build-arg PENGUIN_VERSION=0.2.9" >&2; \
      exit 1; \
    fi; \
    npm install -g "@prismshadow/penguin-cli@${PENGUIN_VERSION}"; \
    npm cache clean --force; \
    pty="/usr/local/lib/node_modules/@prismshadow/penguin-cli/node_modules/node-pty"; \
    if [ -f "$pty/build/Release/pty.node" ]; then rm -rf "$pty/prebuilds"; fi

# --- runtime ---
FROM base

ARG PENGUIN_VERSION

LABEL org.opencontainers.image.title="PenguinHarness" \
      org.opencontainers.image.description="PenguinHarness server and Web App" \
      org.opencontainers.image.url="https://penguin.ooo" \
      org.opencontainers.image.source="https://github.com/Prism-Shadow/penguin-harness" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${PENGUIN_VERSION}"

# Everything npm installed globally sits under one prefix, so one copy carries the CLI, the
# server, the bundled web assets and the node-pty binding compiled above. The `penguin` bin
# is re-linked rather than copied: whether a symlink survives COPY --from is builder
# detail, and one `ln -s` is not.
COPY --from=build /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN set -eux; \
    entry=/usr/local/lib/node_modules/@prismshadow/penguin-cli/dist/penguin.js; \
    chmod 0755 "$entry"; \
    ln -s ../lib/node_modules/@prismshadow/penguin-cli/dist/penguin.js /usr/local/bin/penguin; \
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
