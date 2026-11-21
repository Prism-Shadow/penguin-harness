# Image Studio

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [#1599](https://github.com/Prism-Shadow/penguin-harness/pull/1599)

[中文版](2026-11-18-image-studio.zh.md)

The multimodal tools plugin gains **Image Studio**, opened from the App Center or the Agent's tabs. Describe a picture and choose its aspect ratio: each brief opens a Session of the Agent, which runs `penguin tools t2i … --json` in it with the Project's image generation model. The studio shows and downloads the images that Session's runs generated, from the Session's files. Reopen a past brief to see its images again; failed and cancelled briefs stay in the history with their status, and cancelling stops both the Session and its image run.

With the plugin off in the Project, earlier images stay viewable and downloadable, and new briefs wait until it is on again.

The plugin's routes list a Session's runs (`GET …/multimodal-tools/sessions/:sessionId/runs`), which the studio follows. The `multimodal-tools` Skill tells the Agent how Image Studio reads its Session's images.
