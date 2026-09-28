# Activity studio brought in line with the harness's conventions

- **Date:** 2026-09-23
- **Type:** refactor
- **Scope:** `server`, `web`

A pass over the activity studio's recent additions, against the harness's own design
tokens and architecture.

## Details

- "Run all stages" is now a kernel service, `ActivityPipelines`, implemented by
  `ActivityPipelineService` and registered with the other activity services. It was state
  held inside the activity routes. When the component is disposed on a restart or hot
  replacement, the service stops stepping: the run in flight is left as an ordinary run,
  nothing after it starts, and the sequence ends as stopped rather than succeeded. The
  shapes the App imports moved to `pipeline-types.ts`.
- A proposal waiting on the author is an attention state. The storyboard now draws it as a
  dashed outline with the attention dot, and the script editor's "proposed, not applied"
  takes the attention ink from `tone.ts`. Both had used the brand accent.
- The behavior map's transition labels ("after N ms", "done", "error") come from the strings
  dictionary instead of the model.
- Speech coverage's filters and language switcher use the app's segmented-control styling.
- What the read-only module documents are is explained in an info popover beside their
  title, as the app discloses explanations.
- Generation History moved out of the activity page into its own component, with no change
  in behaviour.
- The page ignores a language table or a stage sequence that does not have the expected
  shape, instead of failing to render.
- A stage's reason for having nothing to do reaches the App as a code (`note`) that the
  App words, instead of server-written English. The server's error messages are
  unchanged.
- The script editor's own labels (search, folding, merge controls) and the waveform trim's
  errors come from the strings dictionary.
- Build readiness is computed by the activity service. The route only reads its input.
