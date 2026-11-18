# Image Studio and project media tools

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `plugins`, `multimodal-tools`
- **PR:** [#1599](https://github.com/Prism-Shadow/penguin-harness/pull/1599)

[中文版](2026-11-18-image-studio.zh.md)

Image Studio opens from the App Center or the Agent's tabs. Describe a picture and choose a format. A dedicated Session generates it through the project's configured image model. Reopen a past brief to preview and download the images returned for that Session. Failed and cancelled generations remain in the history.

If the Project turns off its image generation plugin, the studio keeps earlier images available to view and download. Enable the plugin again to start a new brief.

New default Agents also carry the multimodal-tools skill. It uses the Penguin CLI to search the web, read a page, generate images or videos, transcribe a recording and synthesize speech. Existing Agents can install the plugin from Utilities.
