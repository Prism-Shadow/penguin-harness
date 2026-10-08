# Module runs check their module in Penguin's player

- **Date:** 2026-10-08
- **Type:** fix
- **Scope:** `server`, `activities`

## Why

A module run had to end by writing `preview/index.html` and `preview/runtime.js`: a static
page that bundled the WAF framework and navbar by hand. No agent could do that faithfully.
They wrote a stand-in runtime instead, and checked the module against it. In one run the
stand-in's input manager had no `Activity.Testing.createInteractableCollection`, so every
tap target failed to register. A Windows `Copy-Item -Recurse` also nested each rebuild at
`preview/module/dist/debug/debug/`, so the page kept loading the first bundle. The run
stopped at `scene-3.presenting` and gave up without a module.

Penguin already plays modules in the real framework: the dev sandbox's player, with an
emulated configuration and assessment backend. It only played runs that had succeeded.

## What changed

- A play link can name a module run (`runId`, signed with the rest of the link). It plays
  that run's workspace while the run is still going, and once it has succeeded. It never
  plays a failed run, a run of another kind, or a run of another activity.
- A module run stages `player-check/`: `acceptance-input.json` with a play link for its own
  module, the viewport, the scene ids, the acceptance criteria and the test browser, plus
  the acceptance harness, its runner and a `package.json` pinning `playwright-core`. The
  agent writes its checks against the same harness the acceptance tests use and runs them.
  Without the test browser nothing is staged. The agent then builds and typechecks, and
  says the module was not checked in the player.
- The module prompt no longer asks for a preview page or for media copies under
  `preview/`, and says the player resolves `{{MEDIA}}`. It says a video or sound that fails
  to play must not leave a state waiting forever. It also warns that the test browser
  cannot decode some video formats.
- `module-result.json` lists only files under `module/`. The collector no longer requires
  `preview/index.html` or `preview/runtime.js`. It no longer checks media copies under
  `preview/`, since the player serves the draft's accepted media itself. The candidate no
  longer carries `previewPath`.
- The book reader's instructions go only to a book's module run. A standard activity's run
  was told about a reader its scaffold does not have.
- With no module anywhere (no assembled run and no checkout folder), the preview status
  is no longer `buildable`. Before, the Preview panel asked for a build and showed the
  refusal as a red error, under a message that already said there was no module. The
  message now ends with "Run Assemble module in Stages to build one."
- Play links are signed by a new `ActivityPlayLinks` component. The test browser signs
  through it instead of the sandbox. That breaks the cycle a module run would otherwise
  create: generation, then the test browser, then the sandbox, then generation again.
