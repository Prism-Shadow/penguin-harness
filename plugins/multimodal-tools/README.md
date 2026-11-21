# Multimodal tools

Use the Project's models to write text, read an image, search the web, fetch a page, generate an image, a video or speech, and transcribe a recording. An Agent runs them with `penguin tools …` through the plugin's `multimodal-tools` Skill; the Web App uses the same tools for dictation and reading replies aloud.

Each tool runs on the model bound to it in the Project's model settings (image understanding uses the Project's vision model). Run `penguin tools list` to see which tools have a model. Every request is recorded with the Project's usage and priced like a chat request, under the Session that made it.

What a tool generates belongs to its Session: it is saved in the Project directory, and removed once the Session is gone. Local files reach a tool only through `--image` and `--audio`, and generated files are saved into `--out`. The Skill's [command examples](skills/multimodal-tools/SKILL.md) cover following, saving and cancelling a long run.

The plugin is preinstalled: its server module, which serves the commands and the Web App's routes, runs for every Project, and the models page's **Test connection** sends each tool model a request it takes.
