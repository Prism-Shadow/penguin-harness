# Install a server on another machine from the desktop app

The desktop app can put this build's server on a machine reachable over SSH: **Install Server on Remote Host ▸ \<host\>** in the app menu probes that machine, asks, and installs. There is deliberately no CLI counterpart — the capability lives in the app only.

## How it works

- **Targets come from `~/.ssh/config`** and nowhere else. The menu lists the aliases declared there (pattern entries like `Host *` are skipped — they configure other hosts rather than naming one), and `ssh -G <alias>` resolves each one, so `Match`, `Include` and wildcard inheritance are OpenSSH's job, not ours. The file is never written.
- **The machine is asked what it is** before anything is sent, because the runtime that gets pushed depends on it. The probe is the only thing that ever needs the remote's own shell, so there are two forms: a POSIX one, and a cmd.exe one tried when the first is not understood. Both answer the same two things — an identity line and the installed program's manifest — and the parsing happens locally.
- **A matching Node runtime travels with the image — only when it has to.** The probe also reports the machine's own `node -v`; anything from Node 24 up is used as is, so the common case costs no download, no ~30 MB transfer and no second runtime on a machine that already has one. Otherwise the push fetches the official build for that platform and arch from nodejs.org, verifies it against the release's own `SHASUMS256.txt`, and installs it as `lib/runtime`. An unverified download never leaves this machine, and runtimes are cached per shape, so the second host of a kind costs nothing either.
- **The decision** is: nothing installed → install; a different version → replace it (the program is one build — CLI, server and web assets together — so "different" is enough); the same version → nothing to do.
- **The push** copies the image, the job description, a Node installer and the runtime archive into a scratch directory, unpacks the runtime with `tar` (bsdtar reads the Windows zip), and runs the installer on it. Deliberately **not** `install.sh`: that is a POSIX script and the target may be Windows. The installer is plain Node — one script for all three platforms — and does the same staging, smoke test, swap and rollback the local installer does. The scratch directory is removed afterwards either way.
- **What the remote is left with** is what an ordinary install leaves: the program directory (`~/.local/share/penguin`, `%LOCALAPPDATA%\penguin`) with the runtime inside it and, on POSIX, the `~/.local/bin/penguin` symlink. No sudo, no systemd unit, no profile edits, and the data directory is never touched.

## Authentication

Connections run with `BatchMode=yes`: a GUI has no terminal, so an ssh that decided to ask for a password would hang with nothing to type into. Key or agent authentication must already work for the host; when it does not, the app shows OpenSSH's own diagnostic verbatim rather than a reworded version of it.
