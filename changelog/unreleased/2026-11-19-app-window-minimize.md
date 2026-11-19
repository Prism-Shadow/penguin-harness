# App Center windows minimize, and the app keeps running

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`

[中文版](2026-11-19-app-window-minimize.zh.md)

An app opened from the App Center can now be minimized, as a window is in Windows or a tab is left open in Chrome: its title bar gained a Minimize button, left of Open full screen and Close. Minimizing returns to the grid while the app keeps running, and a click on its tile brings back the same live window. Close still ends the app.

## Details

- A minimized app's frame stays mounted, out of sight and out of reach, so its page state, timers, sound and connections carry on. Close unmounts it, and opening the app again starts a new frame.
- Browser Back from a window now minimizes it instead of closing it.
- A running app's tile has a short bar under its icon, and its name and hint say "Running". A folder holding running apps has the same bar and says how many. A click on a running app's tile, or Open in its menu, restores its window, even while the app rebuilds.
- Several apps can run at once. They keep running while the viewer is on another page of the app and are still there on return. Switching Project ends the apps of the Project left, an app that leaves the App Center's list ends with it, and leaving the app shell (Open full screen, a reload, signing out) ends them all.
- The windows moved out of the App Center page into a layer over the page area: `WebAppModule.layers` contributions take an optional `area: "page"`, which mounts them inside the main column after the page, so they cover the page and survive its route changes.
- The running set was put in `lib/running-apps.ts` for any surface to read: `useRunningApps()` lists the current Project's running apps (key, Agent, workbench, machine, title, icon, and whether the window is in front), and `useRestoreApp()` brings one back over the main area at its `?app=` address, from which minimize returns to the page it was restored from.
- The UI package gained `AppWindowBar`, an app window's title bar: the app's icon and name, then minimize, full screen and close in that order, each optional except close. The gallery's Layout board shows it with all three controls and with close alone.
