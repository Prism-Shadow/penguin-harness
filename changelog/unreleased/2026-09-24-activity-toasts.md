# Activities announce saves and finished work as toasts

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `web`

The activity workspace now uses the app's toasts:

- **Saved** appears as a toast instead of a line of text above the workspace, which was
  easy to miss when the rail or a side panel covered it. Errors stay inline, where they
  remain until dealt with.
- A run that finishes while the activity is open announces itself: success, failure,
  cancellation, or a result made against an older draft, naming the asset for media runs
  (for example "Speech · welcome finished."). Opening an activity whose runs already
  finished announces nothing.
- While the stages run, their many runs stay quiet, and the stages announce their own
  outcome once when they finish, stop, or fail.
