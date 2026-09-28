# Behavior map under the activity player

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

The Player panel now draws the module's state machine under the player, as Loom's
preview did, and highlights the phase the playing activity reports.

## Details

- The machine is read from the module's configuration (`stateMachine`, or `activityMachine`
  in older modules) through the sandbox payload, not from the playing page.
- One scene is drawn at a time. Its phases run top to bottom from the scene's first phase,
  forward transitions are solid, and returns such as a retry are dashed. Events, delays,
  `done` and `error` label the lines. Transitions that leave the scene are listed under the
  drawing.
- The map follows the scene the player reports. A scene picker shows any other scene.
- **Behavior map** hides or shows it. A module without a state machine says so, and no
  map is guessed.
