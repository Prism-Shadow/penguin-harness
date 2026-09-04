# An official Docker image, published from the release workflow

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `ci`, `tooling`, `docs`
- **PR:** [#609](https://github.com/Prism-Shadow/penguin-harness/pull/609)

[中文版](2026-09-04-official-docker-image.zh.md)

PenguinHarness gained an official container image, `ghcr.io/prism-shadow/penguin-harness`, published for `linux/amd64` and `linux/arm64` by a new `docker` job in the release workflow and tagged `X.Y.Z`, `X.Y`, plus `latest` while the tag is GitHub's current latest Release. It runs `penguin server` on `0.0.0.0:7364` with the data root on a `/data` volume, so a deployment is one container and one volume.

## Details

- The image installs the published npm package: a `PENGUIN_VERSION` build arg picks the version, and the build context carries nothing but the entrypoint script. A builder stage adds `python3 make g++` for `node-pty`, which publishes no Linux prebuild and therefore compiles on every Linux install; the runtime stage copies the compiled tree out and never installs a compiler.
- The base is Ubuntu 24.04 plus the official nodejs.org runtime, pinned to the version `release.yml` bundles into the release tarballs and verified against that release's `SHASUMS256.txt`. `git`, `curl` and `ca-certificates` are the only other packages, for the commands an agent runs.
- The container starts as root solely to take ownership of the top level of the data root, then `setpriv` drops to `penguin` (uid/gid 1000): a bind mount needs no preparation on the host, and nothing but the entrypoint runs privileged. `tini` is PID 1, so the orphans an agent's shell commands leave behind are reaped.
- `HEALTHCHECK` probes the public `GET /api/install`.
- `.github/workflows/docker.yml` holds the build and publish steps. `release.yml` calls it after `publish-npm` under the same gate `mirror-oss` uses, and it polls the npm registry before building, since a returned publish step is not yet a servable version. A pull request touching the `Dockerfile`, `docker/` or that workflow runs the same file as an amd64 smoke build, which starts the container and checks readiness, sign-in, the healthcheck, the process user, a graceful stop and a restart onto the same data root.
- `docker/compose.yaml` is the copy-and-run deployment. A new [Docker quickstart](https://penguin.ooo/docs/quickstart-docker) documents the first sign-in through the log, upgrading by pulling a new tag (in-container self-update is not supported), reverse proxies, Workspace previews and the forgotten-password rescue; the README install sections and the Quickstart route tables gained the route in both languages.
