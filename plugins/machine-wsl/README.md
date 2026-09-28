# @prismshadow/penguin-plugin-machine-wsl

The WSL machine kind for PenguinHarness, for a server running on Windows. Every WSL distro
installed there is a machine, `wsl:<distro>`, on the Machines page. Enable it for a Project on
the Plugins page. On other platforms it lists nothing.

## What is listed

The output of `wsl.exe --list --quiet`, read in the background and cached for 30 seconds.
Two kinds of distro are left out:

- Docker Desktop's own (`docker-desktop`, `docker-desktop-data`);
- any whose name starts with `penguin-`, such as the `penguin-sandbox` distro the WSL sandbox
  backend creates to confine this server's own Agents.

If you gave the sandbox distro another name in the sandbox settings, it is not recognized and
will be listed. Do not install onto it.

## How a distro is reached

The server holds `wsl.exe -d <distro> --exec sh` (with `WSL_UTF8=1`) as the machine's one
session. A distro has no SOCKS port, so each TCP connection is a short bridge process: the
Node that the installed program carries connects to the distro's own loopback and pipes the
socket through `wsl.exe`. This kind has no port forwarding.

## Not yet verified on Windows

The tests run on Linux against a stub `wsl.exe`. The following have not been checked on a real
Windows machine:

- a distro that WSL stops after it has been idle will probably stop its server too, once the
  connection is dropped;
- listing distros calls `wsl.exe`, which may wake a stopped distro;
- in mirrored networking mode a distro shares the host's loopback, so a server in it on the
  same default port as this one would fail to bind.
