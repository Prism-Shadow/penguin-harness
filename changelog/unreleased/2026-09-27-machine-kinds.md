# Machine kinds: ssh, WSL and containers as plugins

- **Date:** 2026-09-27
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#855](https://github.com/Prism-Shadow/penguin-harness/pull/855)

[中文版](2026-09-27-machine-kinds.zh.md)

Machines now come in kinds, and each kind is a plugin: `machine-ssh` (the machines from `~/.ssh/config`, as before), `machine-wsl` (each WSL distro on a Windows server), and `machine-docker` (an existing container, or one created from an image). The server itself keeps only "one machine, one connection": the session, its framing and lifetimes, and the per-machine queue. It no longer starts ssh, wsl.exe or a container CLI by name, and no longer reads `~/.ssh/config`.

## Details

- A machine's id is `<kind>:<name>`: `ssh:<alias>` as before, `wsl:<distro>`, `docker:<name>`. Existing records keep their ids.
- `machine-ssh` is resident: every server loads it whether or not a Project lists it (see the backward-compatibility entry). `machine-wsl` and `machine-docker` are enabled per Project on the Plugins page, like the sandbox backends. All three are in the builtin index under the category `machine`.
- The Machines page draws each kind's own form. The **+** in the picker defines a machine of a kind that takes one: an ssh Host block, or a container. The gear on a card opens it again; a container's definition can also be removed there, which never removes the container. A WSL card has no gear.
- Container machines: the definition names an existing container, or an image with run arguments passed through as argv items (`--rm`, `--name`, `-d` and `--detach` are refused) and a keep-alive command (default `sleep infinity`). **Connect** starts a stopped container and creates an image machine's container (`penguin-<name>`, labelled `penguin.machine=<name>`) when it is missing. The automatic re-connect never starts one. The CLI can be `docker`, `podman`, `nerdctl` or an absolute path.
- WSL machines: the distros from `wsl.exe --list --quiet`, less Docker Desktop's and any named `penguin-*` (the WSL sandbox backend's own distro). Verified only against a stub `wsl.exe` on Linux, not on a real Windows machine yet.
- A container or WSL machine has no port forwarding. Its forwards on the Ports page show as failed, with the reason.
- A machine on record whose kind is not loaded stays listed, marked **kind unavailable**. Install, connect and restart answer 409 `machine_kind_unavailable`, and the automatic re-connect skips it without counting a failure.
- API: `POST /api/projects/:projectId/machines/kinds/:kind/definitions` (`{ name, values }`), and `GET`, `PUT` (`{ values }`) and `DELETE` on `…/definitions/:name`, replace `…/machines/ssh-hosts` and `…/ssh-hosts/:alias`, which are gone. The machines list carries `kinds`, and each machine its `kind` (plus `unavailable` when its kind is not loaded).
- The handed-over machine session is `machineSession.v3`. On the first push of this build every held machine connection is closed and opened again once.
- New table `machine_definitions` (migration 19, safe during a hot push) holds the definitions of container machines.
