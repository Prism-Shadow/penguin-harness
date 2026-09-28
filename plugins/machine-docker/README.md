# @prismshadow/penguin-plugin-machine-docker

The container machine kind for PenguinHarness. A container is a machine, `docker:<name>`,
that you define on the Machines page. Enable it for a Project on the Plugins page.

## Defining a container machine

Press **+** on the Machines page and choose **Container**. A definition is one of:

- **an existing container**, by name or id; or
- **an image**. The plugin creates `penguin-<name>`, labelled `penguin.machine=<name>`, from
  the image, your run arguments (passed one per line as they are: `-p`, `-v`, `--gpus`,
  `--env`, …) and a keep-alive command (default `sleep infinity`).

`--rm`, `--name`, `-d` and `--detach` are refused in the run arguments. The CLI is `docker`
by default; `podman`, `nerdctl` or an absolute path work the same way.

The image needs `sh`, and the network access the installer needs to download the release.
Distroless images cannot be machines.

## Lifecycle

- **Connect** (a person's action) starts a stopped container, and creates an image
  definition's container when it does not exist.
- The server's automatic re-connect never starts a container. A container you stopped stays
  stopped until someone connects.
- **Forgetting** a definition removes it from the server. The container is never removed.
- A removed image container is created again at the next connect. It is a new filesystem, so
  the machine reads as not installed and gets a new id.

## How a container is reached

The server holds `<cli> exec -i <container> sh` as the machine's one session. Each TCP
connection is a short `exec` bridge using the Node that the installed program carries, so no
port has to be published and the network mode does not matter. This kind has no port
forwarding.
