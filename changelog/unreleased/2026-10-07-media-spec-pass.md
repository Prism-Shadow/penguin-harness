# Scene media is listed from the script's tags, as in Loom

- **Date:** 2026-10-07
- **Type:** fix
- **Scope:** `server`, `web`, `activities`

Scenes no longer lose their media when an agent writes the specification in the wrong shape. Before, an agent could put a scene's videos and narration directly on the scene (`videos`, `tracks`). The media plan never read them, so the storyboard said "This scene asks for no media." even when the script tagged every video and line.

Specification generation now follows Loom's two passes:

- **Generate spec** writes the scenes and keeps each description's `<image>`, `<video>`, `<animation>` and `<audio>` tags word for word. The prompt is Loom's: it fills in the template, or updates the current specification without renaming scene ids or asset keys. A run whose scene count does not match the script's `Scene N:` headings fails and says why.
- **Generate media spec** is a new stage, between Generate spec and Plan media. It lists the media each scene's tags ask for in `scene.media.images`, `scene.media.video`, `scene.media.animations` and `scene.audio.tracks`. The run fails if it adds, drops or renames a scene, if a tag has no asset, or if a key is listed twice.

Both passes save the agent's output the way Loom normalizes it. Every scene comes out as `id`, `description`, `role` (if any), `media` and `audio`, and media written anywhere else is dropped. Assets get readable `<scene>-<kind>-<subject>` keys. A regenerated scene keeps the keys it already had. Music and sound-effect tags the agent missed are added back. When run from the stages, a pass that fails runs once more and is told why the first attempt failed.

For an activity whose media went missing this way, run **Generate media spec** and then **Plan media** from the stages.
