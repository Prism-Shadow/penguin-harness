# An official Docker image, built from source

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `ci`, `tooling`, `docs`
- **PR:** [#609](https://github.com/Prism-Shadow/penguin-harness/pull/609)

[中文版](2026-09-04-official-docker-image.zh.md)

PenguinHarness gained an official container image, Docker Hub `hiyouga/penguinharness`, built from this repository's source for `linux/amd64` and `linux/arm64`. Every push to `main` publishes that commit as `latest`, with `main-<sha7>` as an immutable twin; a release publishes `X.Y.Z`, `X.Y`, and `stable` while the tag is GitHub's current latest Release. It runs `penguin server` on `0.0.0.0:7364` with the data root on a `/data` volume, so a deployment is one container and one volume. The compose file and every documented `docker run` publish the port on the host's loopback (`127.0.0.1:7364:7364`), which leaves a fresh deployment reachable only from the machine running Docker; opening it to a network is an explicit choice, documented alongside the reverse-proxy notes.

## Details

- The image is built by the recipe that assembles the shipped CLI: install the workspace, build the packages the server needs, `pnpm deploy` a production dependency tree into `/opt/penguin/lib`, and put the built web assets beside it in `/opt/penguin/web`. The stages split by where each has to run — the workspace build is pinned to the build platform, because TypeScript and Vite emit the same bytes on any machine, and a second stage on the target platform recompiles `node-pty`, the only compiled dependency in that tree and one that publishes no Linux prebuild. The runtime stage copies the result and never installs a compiler. `PENGUIN_VERSION` and `PENGUIN_COMMIT` build args carry the image labels, and the commit is stamped into the build the way a release stamps it.
- The base is Ubuntu 24.04 plus the official nodejs.org runtime, pinned to the version `release.yml` bundles into the release tarballs and verified against that release's `SHASUMS256.txt`. `git`, `curl` and `ca-certificates` are the only other packages, for the commands an agent runs.
- The container starts as root solely to take ownership of the top level of the data root, then `setpriv` drops to `penguin` (uid/gid 1000): a bind mount needs no preparation on the host, and nothing but the entrypoint runs privileged. `tini` is PID 1, so the orphans an agent's shell commands leave behind are reaped.
- `HEALTHCHECK` probes the public `GET /api/install`.
- `.github/workflows/docker.yml` holds the build and publish steps and owns both tag policies: a push to `main`, which carries no path filter, and a `workflow_call` from `release.yml`'s `docker` job, gated the way `mirror-oss` is and checked out at the tag. Nothing installs from npm any more, so that job no longer waits on `publish-npm`. A pull request touching the `Dockerfile`, `docker/` or that workflow runs the same file as an amd64 smoke build of the pull request's own source, which starts the container and checks readiness, sign-in, the healthcheck, the process user, a graceful stop and a restart onto the same data root.
- `docker/compose.yaml` is the copy-and-run deployment. A new [Docker quickstart](https://penguin.ooo/docs/quickstart-docker) documents the first sign-in through the log, upgrading by pulling a new tag (in-container self-update is not supported), reverse proxies, Workspace previews and the forgotten-password rescue; the README install sections and the Quickstart route tables gained the route in both languages.
