# Multimodal tools

Use the Project's models to write text, read an image, search the web, fetch a page, generate an image, a video or speech, and transcribe a recording. An Agent runs them with `penguin tools …` through the plugin's `multimodal-tools` Skill; the Web App uses the same tools for dictation and reading replies aloud.

Each tool runs on the model bound to it in the Project's model settings (image understanding uses the Project's vision model). Run `penguin tools list` to see which tools have a model. Every request is recorded with the Project's usage and priced like a chat request, under the Session that made it.

What a tool generates belongs to its Session: it is saved in the Project directory, and removed once the Session is gone. Local files reach a tool only through `--image` and `--audio`, and generated files are saved into `--out`. The Skill's [command examples](skills/multimodal-tools/SKILL.md) cover following, saving and cancelling a long run.

Installing the plugin on an Agent also brings its server module, which serves the commands and the Web App's routes.

The plugin also carries **Image Studio**, opened from the App Center or the Agent's tabs. Describe an image, choose its aspect ratio and select **Generate image**: each brief opens a Session of the Agent, which runs `penguin tools t2i` in it, and the studio shows and downloads the images that Session's runs generated. Reopen a brief from History to see its images again; a cancelled or failed brief stays in History with its status. With the plugin off in the Project, earlier images stay viewable and new briefs wait until it is on again.
