---
title: Update PenguinHarness
description: Check which version you are running, and update the desktop app, a CLI install, or a Docker deployment.
---

Check which version of PenguinHarness you are running, and update it in the way that matches your install.

- **Which version is running?** See [Check the running version](#check-the-running-version).
- **Updating from the browser?** See [Update from the Web App](#update-from-the-web-app).
- **Using the desktop app?** See [Update the desktop app](#update-the-desktop-app).
- **Installed the CLI?** See [Update a CLI install](#update-a-cli-install).
- **Running in Docker?** See [Update a Docker deployment](#update-a-docker-deployment).
- **Don't want update checks?** See [Turn off the update check](#turn-off-the-update-check).

## Check the running version

In the Web App:

- The new-chat page shows the running version on a version line such as `vX.Y.Z · Last updated Jul 26`. The release workflow stamps the date into the build, so it is shown without any network access. Dev builds and releases from before the stamping, v0.1.2 and earlier, show no date.
- In the sidebar user menu, the update row directly under **System settings** shows the running version, muted, on its right.

In a terminal:

- `penguin -v`, the same as `penguin version`, prints the running build's one-line identity, and `penguin version --json` prints the full build info. See [penguin version](/cli#penguin-version).
- `penguin update --check` reports the installed and the latest versions and changes nothing.

## Update from the Web App

Updating works the way an app updater does, from one dialog.

### Open the update dialog

Two entries open the dialog:

- The update row directly under **System settings** in the sidebar user menu. The row says where things stand: **Check for updates**, **Checking…**, **New version vX available**, **Downloading vX 42%** or **Restart to update to vX**. Whatever it says, it opens the dialog.
- The small superscript on the new-chat page's version line. It reads **New version available** when a release is offered, **Downloading update** while a download runs, and **Restart to update** once the download is ready.

### Run the update

1. Open the update dialog. If nothing is known yet, it checks for a new release. The app also checks GitHub once per page load, and a check you start from the dialog skips the cached result.
2. When a newer release is available, the dialog offers it with a **Release notes** link. Nothing is downloaded until you continue.
3. Click **Download and update**. A progress bar follows the download.
4. To keep working, click **Continue in background**. This closes the dialog without cancelling anything: the update row keeps showing the percentage, and once the release is ready, a dot appears on the user button and a toast announces it.
5. Click **Restart and update** to finish.

> [!NOTE]
> Non-admins can read the release notes but cannot run the update.

If the download fails, the dialog shows the update command's own output and offers **Retry**. An install that cannot update itself, such as a source checkout, an unrecognized layout, or Windows, says why in the dialog.

### What happens on a server

- The download is `penguin update` running in the background, and the progress bar reads the installer's own progress. The data directory is not touched.
- The restart is real when the service runs under `penguin web` or `penguin server`, which supervise it: the service comes back on the new release, and the page reloads by itself.
- When the service was started some other way, the dialog tells you to restart it by hand instead.

## Update the desktop app

In the desktop app, the same dialog drives the app's own updater. It does so only in the app's own window, where the server release never appears.

The app checks for releases on its own schedule but never downloads on its own. A release it finds shows up as the dot on the user button and in the update row. To install it:

1. Open the update dialog.
2. Click **Download and update**. The percentage is the updater's real progress.
3. Click **Restart and update**. The app restarts into the downloaded build.

The app's native **Check for Updates…** menu item offers the same download-then-restart steps in native dialogs.

> [!NOTE]
> A browser signed in with a password to the same desktop-mode server gets no update entry at all. It can neither read that machine's updater state nor restart the app's window, and it cannot run the CLI self-update on that server either.

Two forms of the app cannot replace themselves, and the dialog says so: a Linux install owned by the system package manager (`.deb`), which you update through the package manager, and a development run. The [Desktop app](/quickstart-desktop) page covers the installers.

### The bundled `penguin` command

The `penguin` command that the desktop app installs comes from the same build as the app, so updating the app updates the command. Running `penguin update` with that command changes nothing: it explains that the command is replaced when the app updates, and points you to the application menu.

## Update a CLI install

`penguin update` upgrades an install in place, with the mechanism it was installed with:

```bash
penguin update --check     # report versions only
penguin update             # upgrade to the latest release, after confirming
```

| Install type | What `penguin update` does |
| --- | --- |
| Tarball install (`install.sh`) | Re-runs the official installer |
| Global npm/pnpm/yarn/bun install | Runs that package manager's global install |
| Source checkout | Refuses; update it with `git pull` and a rebuild |

`--release <tag>` targets a specific release, and `-y` skips the confirmation. The data root is never touched.

> [!NOTE]
> On Windows, `penguin update` does not upgrade in place and tells you what to run instead. To upgrade an install made with the Windows installer, run the installer again.

Running the install script again also upgrades an install; its files are swapped atomically. See [penguin update](/cli#penguin-update) for every option and the download source rules, and the [Installation reference](/quickstart-cli#installation-reference) for the installers.

## Update a Docker deployment

Pull a newer tag and recreate the container. The data root is on the volume and carries over:

```bash
docker compose pull && docker compose up -d
```

Updating from inside the container is not supported. See [Upgrade the container](/quickstart-docker#upgrade-the-container) for the details.

## Turn off the update check

Set `PENGUIN_UPDATE_CHECK=off` to turn off the automatic release check. That is all it turns off: model requests, an enabled remote-control connection, provider key authorization and the proxy test still reach the network. With the check off, the update dialog says **Update checks are disabled (PENGUIN_UPDATE_CHECK=off)**. See the [Configuration Reference](/configuration#environment-variables).
