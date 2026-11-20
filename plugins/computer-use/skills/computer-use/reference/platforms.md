# What differs by operating system

`penguin computer status` names the platform (`data.platform`). Adapted from agent-desktop 1.3.1's platform guides (Apache-2.0); changed for `penguin computer`. For everything else, `penguin computer skills get platform`.

## macOS (13 or later)

- **Permissions.** Accessibility belongs to the app that started agent-desktop: PenguinHarness in the desktop app, or the terminal that started the server. Without it every tree is empty and actions answer `PERM_DENIED`. Screen Recording is needed for screenshots only. Ask the user to grant them; the Computer Use card in Settings → Plugins has **Open System Settings**, which names the app to allow.
- **Apps** are named by their display name as `list-apps` prints it (`"System Settings"`, `"Calculator"`). `launch` also takes a bundle ID (`com.apple.calculator`), never a path or an `.app` name; every other command takes the name only — a bundle ID is refused.
- **Menus.** `--surface menubar` reads an app's File, Edit and View menus; a click on a menu bar item works without `--headed`. While a menu, sheet or alert is open, refs from the window behind it are the wrong target.
- **Refs carry each element's own address**, so identical twins (a `Delete` button per row) each keep a ref.
- **Keys.** The primary modifier is `cmd`. Quit shortcuts (`cmd+q` and similar) are refused; use `close-app`.
- Judge every action by reading again: some apps report success for an action that did nothing.
- Known upstream issues: `list-apps` can time out on busy machines; a locked screen gives misleading errors; apps on other Spaces are invisible.

## Windows (10 1809 or later)

- **The desktop.** agent-desktop needs the signed-in user's interactive desktop. A server running as a service, over SSH, in Session 0, behind the lock screen or the UAC prompt sees no apps.
- **Elevation.** An app running as administrator can be read but not operated from a normal one (`PERM_DENIED`).
- **Headless limits.** `type`, `right-click`, `double-click`, `triple-click` and `focus` are physical input on Windows. Use `set-value` to enter text headless.
- **Apps** are named for `launch` by a program in System32 or the Windows directory (`"calc"`, `"notepad.exe"`) — never a path — and exactly as `list-apps` prints them for `--app`.
- **Twins.** A ref works only when its element is unique in the window; identical controls answer `AMBIGUOUS_TARGET`.
- Quote refs in PowerShell: `'@s8f3k2p9:e1'`.
- The program needs the Visual C++ runtime; without it nothing starts (`agent_desktop_failed`). Smart App Control can block it on a fresh Windows 11.

## Linux (glibc 2.35 or later; X11 or GNOME on Wayland)

- **The session.** agent-desktop needs the desktop session's display, session bus and accessibility bus, and a window manager. `status` reports which is missing.
- **Apps** are named by their process name exactly as `list-apps` prints it, version suffix and all (`gnome-calculator`, `gedit`, `python3.13`; `python3` is refused). `launch` takes an installed desktop entry's id, name or command (`org.gnome.Calculator`, `Calculator`, `gnome-calculator`) from a system applications directory — never a path, and not a program that has no desktop entry.
- An app started before the first `penguin computer` command of a desktop session may be missing from `list-apps` for a moment: toolkits switch their accessibility on when it is first asked for. Wait a second and list again before concluding it is not there.
- **Twins.** A ref works only when its element is unique in the window; identical controls answer `AMBIGUOUS_TARGET`.
- **GTK4** acts once on two clicks of one button less than about 250 ms apart: wait for the effect between clicks (`wait --element <ref> --predicate value --value <v>`).
- A terminal's text area takes no headless `type`: it receives keys only as physical input.
- **Wayland**: no pointer input at all; screenshots ask the user for consent the first time; window commands work only for X11 apps. wlroots compositors (Sway, Hyprland) are not supported.
- **Chromium and Electron apps** expose their tree only when started with accessibility on; if an Electron app shows an empty tree, ask the user to restart it with `--force-renderer-accessibility`.
- Focusing a window on another workspace can switch the user's desktop.
