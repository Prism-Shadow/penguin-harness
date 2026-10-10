# Machines work from a source checkout

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`, `tooling`, `docs`
- **PR:** [#1023](https://github.com/Prism-Shadow/penguin-harness/pull/1023)

[中文版](2026-10-10-machines-dev-image.zh.md)

A server running from a source checkout (`pnpm dev`, `pnpm desktop`) builds its own install image when an install or a use asks for one. Before, such a server had no image at all: the Machines page disabled "Add machines…" and "Enable", every install answered `409` `no_install_image`, and the notice promised an image after "the first hot push", which never produced one.

## Details

- The image is built with the hot push's own packer. `scripts/deploy.mjs --out <file>` packs the same version a push sends (web dist, platform and CLI bundles, node-pty, TypeScript, the installers, the builtin plugins and the plugin library) and writes the gzipped upgrade body to a file instead of pushing it. It takes no target and no credential.
- The server lays that body down as an hmr store under `<root>/machines/checkout-image/<id>/hmr`, never in its own `<root>/hmr`, and installs it like the state of a hot-pushed server: the far side downloads the release named by the checkout's `VERSION`, and the store is replicated over ssh. Images are named by their content, and the current one and the one before it are kept.
- The version is `<VERSION>+hmr.<platform sha>`, the form a hot-pushed server reports. An unchanged tree rebuilds to the same image, so a machine already on it is not reinstalled. After a change to the platform, machines on the previous image read as behind it.
- One build serves a whole batch, and a job that starts while a build runs joins it. Nothing is built when the server starts or when the page lists machines. A build stops after 20 minutes.
- `GET /api/projects/:projectId/machines` gained `checkoutImage` (`unbuilt`, `building`, `built`, or `failed` with the build's last lines), present only for a checkout. `imageVersion` names the image the checkout last built, and stays `null` before the first build.
- A build that fails ends its job at the step `build the install image` with the build's last lines, and offers no forced install. The Machines page shows the same lines in a notice until a build succeeds.
- A hand-over through a machine's update channel, at an install or at the sweep a server runs when it starts, sends the build of the plan being installed, so a checkout hands over its image.
- `no_install_image` is now answered only by a server that is neither installed nor a checkout, and its message and the page's notice say so.
- `deploy.mjs` runs `pnpm` through a shell on Windows, where it is a `.cmd` shim.
