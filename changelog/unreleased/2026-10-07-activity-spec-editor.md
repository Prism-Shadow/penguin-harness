# Activity Spec is the specification JSON, as in Loom

- **Date:** 2026-10-07
- **Type:** feat
- **Scope:** `web`, `activities`

The Activity Spec section is now one full-height editor for `activity_spec.json`, as Loom showed it: titled "Activity Spec - *title* - *product* [*ref*]", with JSON syntax colours, folding and search, and **Save Spec**. Save stays off until the text parses as a JSON object, and the editor says why it does not.

**Diff** compares the text with the last save, and carries a dot while there are unsaved changes. Its toolbar matches Loom's: `+added −removed · n regions`, previous and next (also Alt+Up and Alt+Down) with an "*i* / *n*" counter, **Side by side** or **Inline** (remembered in the browser), **Revert all**, and a minimap of the changes beside the inline diff. Each change can also be reverted where it stands.

The read-only scene list that sat above the JSON is gone. Scenes are under Media → Scenes. The media-plan counts and the asset manifest JSON, with **Validate and save media**, moved to Media Library. **Copy candidate into editor** in Generation History now opens Activity Spec.
