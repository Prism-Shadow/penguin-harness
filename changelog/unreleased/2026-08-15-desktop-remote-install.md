# Install a server on another machine from the desktop app

The desktop app can put this build's server on a machine reachable over SSH: **Install Server on Remote Host ▸ \<host\>** in the app menu probes that machine, asks, and installs. There is deliberately no CLI counterpart — the capability lives in the app only.

## How it works

- **Targets come from `~/.ssh/config`** and nowhere else. The menu lists the aliases declared there (pattern entries like `Host *` are skipped — they configure other hosts rather than naming one), and `ssh -G <alias>` resolves each one, so `Match`, `Include` and wildcard inheritance are OpenSSH's job, not ours. The file is never written.
- **One probe round trip** decides everything, using absolute paths only — `ssh host '…'` gets a non-login shell whose PATH does not include `~/.local/bin`. It reports the installed version, `uname`, the system Node and any server lock, and every line is guarded so a bare machine answers "nothing here" instead of failing the connection.
- **The decision** is: nothing installed → install; a different version → replace it (the program is one build — CLI, server and web assets together — so "different" is enough); the same version → nothing to do. A remote without Node 24+ is refused before anything is copied, since the pushed image carries no runtime.
- **The push** is the install image staged next to the app plus the repository's own `install.sh`, copied into a `mktemp -d` scratch directory and run there with `--universal`. install.sh does the staging, swapping, smoke test and rollback it already does locally; the scratch directory is removed afterwards either way.
- **What the remote is left with** is what an ordinary install leaves: `~/.local/share/penguin` and the `~/.local/bin/penguin` symlink. No sudo, no systemd unit, no profile edits, and the data directory is never touched.

## Authentication

Connections run with `BatchMode=yes`: a GUI has no terminal, so an ssh that decided to ask for a password would hang with nothing to type into. Key or agent authentication must already work for the host; when it does not, the app shows OpenSSH's own diagnostic verbatim rather than a reworded version of it.
