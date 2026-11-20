# Recipes

Worked patterns for `penguin computer`. Every ref comes from the latest snapshot. Adapted from agent-desktop 1.3.1's `workflows` reference (Apache-2.0); changed for `penguin computer`'s policy.

## A dense app: skeleton, drill, act, verify

For Electron apps and anything with more than about 50 interactive elements.

```bash
penguin computer snapshot --app "Slack" --skeleton -i --compact
# group "Channels" @s8f3k2p9:e2 (children_count: 42)
penguin computer snapshot --root @s8f3k2p9:e2 -i --compact
penguin computer click @s8f3k2p9:e18
penguin computer snapshot --root @s8f3k2p9:e2 -i --compact
```

Re-drilling a root replaces the refs inside it; refs elsewhere stay valid. When you know the role or the exact name, skip the map: `find --app "Slack" --role button --name "Send" --exact --first`.

`-i` keeps interactive nodes only, so a row's text label is dropped. To tell which row a button belongs to, drill the row's container with `--root` and leave out `-i`.

## Fill a form

```bash
penguin computer snapshot --app "System Settings" -i --compact
penguin computer set-value @s8f3k2p9:e3 "My MacBook Pro"
penguin computer click @s8f3k2p9:e8
penguin computer snapshot --app "System Settings" -i --compact
```

Prefer `set-value`; use `clear` then `type` when the field needs typed input. `delivered_verified` confirms the field's value only — check that the app took it.

## Menus

```bash
penguin computer find --app "TextEdit" --surface menubar --name "Save As…" --exact --first
penguin computer click @s8f3k2p9:e5
penguin computer wait --window "Save" --app "TextEdit"
penguin computer snapshot --app "TextEdit" --surface sheet -i
```

By hand: click the menu bar item, `wait --menu --app "<App>"`, `snapshot --app "<App>" --surface menu -i`, click the item, `wait --menu-closed --app "<App>"`. A headless `press` never runs a menu item.

## Dialogs, sheets and alerts

```bash
penguin computer wait --window "Save As" --app "TextEdit" --timeout 5000
penguin computer snapshot --app "TextEdit" --surface sheet -i
penguin computer set-value @s8f3k2p9:e2 "notes.txt"
penguin computer click @s8f3k2p9:e5
penguin computer snapshot --app "TextEdit" -i
```

While an overlay is open, snapshot the surface (`sheet`, `alert`, `popover`), not the window, and never with `--skeleton`. When an action's `data.surfaces` is not empty, answer that overlay next.

## Context menus

```bash
penguin computer right-click @s8f3k2p9:e3
penguin computer snapshot --app "Finder" --surface menu -i
penguin computer click @s8f3k2p9:e7
penguin computer wait --menu-closed --app "Finder" --timeout 2000
```

If `right-click` answers `APP_UNRESPONSIVE`, the menu may be open already: look before you act again. On Windows a right-click is physical input.

## Find an item in a long list

`scroll-to <ref>` brings an element into view. For a list whose rows are created as it scrolls, `scroll` the container (physical input on Linux: needs "Allow physical input") and `find` again until the row has a ref.

## Wait for the app

```bash
penguin computer click @s8f3k2p9:e5
penguin computer wait --text "Download complete" --app "App" --timeout 30000
penguin computer wait --element @s8f3k2p9:e10 --predicate actionable --timeout 10000
```

After `launch`, a dialog trigger or a menu click, wait before you snapshot.

## Check before you act

```bash
penguin computer is @s8f3k2p9:e6 --property checked
penguin computer check @s8f3k2p9:e6
```

`check` and `uncheck` are idempotent; prefer them to `toggle`. After a `toggle` that came back `delivered_unverified`, read the state with `is` first.

## Read a value

`penguin computer get @s8f3k2p9:e5 --property value` (or `text`). Prefer this to copying through the clipboard.

## Several windows

```bash
penguin computer list-windows --app "Finder"
penguin computer focus-window --window-id w-5678
penguin computer snapshot --window-id w-5678 -i
```

## Launch, work, close

Ask the user first.

```bash
penguin computer launch "Calculator" --activate     # Windows: "calc.exe"; Linux: "gnome-calculator"
penguin computer list-apps                          # the exact name to use with --app
penguin computer snapshot --app "Calculator" -i --compact
penguin computer close-app "Calculator"
```

If `data.window` is absent from the launch result and you need a window, use `--activate` or `wait --event window-opened --app "<App>"`.

## Mistakes to avoid

1. A full snapshot of a dense app: use `--skeleton` and `--root`, and re-drill only the region that changed.
2. Skipping `status`: a missing permission looks like an empty tree.
3. A window snapshot while a dialog is open: snapshot the surface.
4. Repeating an action whose `retry` was not `safe`.
5. Fixed sleeps: `wait` for the thing you need.
