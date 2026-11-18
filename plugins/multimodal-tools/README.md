# Multimodal tools

Use the Project’s models for web search, fetching a page, generating an image or video, transcribing audio, and reading text aloud. New Projects have **Multimodal tools** enabled. Manage it on the Project’s Plugins page. Select a provider and model for each action you need in the Project’s model settings. Run `penguin tools list --json` to inspect the available actions and bindings.

The plugin also carries Image Studio and the `multimodal-tools` Skill. New default Agents receive it at creation. Add the plugin from the Agent’s plugin library to use its instructions on another Agent. Its [command examples](skills/multimodal-tools/SKILL.md) cover saving a generated file to the workspace, following or cancelling a run, and finding its Session’s outputs.

Turning off the server plugin for a Project removes its six actions there. The Project keeps its selected models, Sessions, previous outputs and usage records for when you turn it back on.

Open **Image Studio** from the App Center or the Agent's tabs. Describe an image, select its aspect ratio and choose **Generate image**. Each brief opens a Session of this Agent. The Agent runs the project's image CLI, and the studio fetches the actual image artifacts registered to that Session. Reopen a brief from History to view or download its images. A cancelled or failed run remains in History with its status.
