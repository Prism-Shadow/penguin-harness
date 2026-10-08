# Scene media edits save themselves

- **Date:** 2026-10-08
- **Type:** fix
- **Scope:** `web`, `activities`

Choosing a provider or voice, editing a speech script or image description, or binding a file in a scene's media editor now saves on its own about a second after the last change, as the Activity Script already does. **Generate speech** and the other generate buttons no longer stay disabled because of an edit nobody saved. The editor's footer says when a save is pending, saving or done.

**Validate and save media** now appears only when it is needed: after a save fails, or for changes made to the manifest JSON in Media Library, which is still saved by hand so half-typed JSON is never saved.
