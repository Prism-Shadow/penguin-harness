# New Projects start with no default model, and a first-run guide asks for one

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `cli`, `docs`
- **PR:** [#1674](https://github.com/Prism-Shadow/penguin-harness/pull/1674)
- **Breaking:** yes — a new Project has no default model, so a Session, schedule or organization created there without naming a model is refused until one is set

[中文版](2026-11-20-model-defaults-onboarding.zh.md)

A new Project, and **Restore defaults**, no longer set DeepSeek V4.1 Flash as the default model: the owner chooses one, and the Web App asks for it the first time the Project is opened. The defaults now live in one **Default model settings** dialog, and a model's settings act in one step: **Set as default model** on a chat model, **Use model** on any other. Existing Projects keep the default they have.

## The Default model settings dialog

- The Models page header's **Default model settings** (replacing its way to Project settings › Multimodal models) opens one dialog of that name with three groups: **Chat** (the default chat model); **Multimodal** (text generation, image generation, image understanding — the Project's vision model —, video generation, speech recognition and speech synthesis); and, quieter, **Tools** (web search, reading a web page, and the bindings other plugins declare).
- What the defaults are for, and that each is saved as it is picked, is behind a **?** beside the title (the member's sentence says only an owner can change them); the first-run guide's sentence, which says why the dialog opened, stays over the rows.
- Each row is a picker over the configured models that can serve it, saved as it is picked. A row nothing can serve says "Connect a provider that offers this kind of model" and links to the Models page. A member sees the same rows, read-only.
- Text generation with nothing bound reads "Follows the default chat model (<model>)"; picking a model binds it, and the picker's **Follow the default chat model** unbinds it again.
- The dialog is `DefaultModelsDialog` in `@prismshadow/penguin-ui`, with a **Models** board in the component gallery beside the guide (`ModelSetupGuide`).
- Project settings › **Multimodal models** lists the same rows as the dialog's Multimodal and Tools groups, in the same order, with the same names, candidates, empty rows and "Follows the default chat model"; both are built by one hook and laid out by one component, `DefaultModelSections`. Dictation polish stays under the rows.

## Default and In use

- **Default** marks only the Project's default chat model. **In use** marks a model chosen for a multimodal job or a tool (text generation, image or video generation, speech recognition or synthesis, web search, reading a web page, or any plugin's binding), naming them on hover ("Used for: Text generation, Web search"). A chat model can carry both. The proxy vision model keeps its own **Proxy vision** tag, and image understanding is not counted in **In use**. Both tags show on the card and in the model's settings.
- A model's settings no longer list each multimodal job with its own **Set default**. Right beside **Test connection** there is one button. A chat model's is **Set as default model**, as before. A model that cannot chat gets **Use model**, which chooses it for every job it can do and is not used for yet, after a confirmation naming them, and a toast names the ones it took; once it is used for them all, the button reads **Stop using model**, which takes it off each without asking, and a toast names them. Neither shows for a model that can do none of them, and both wait while the dialog has unsaved edits. Each job one at a time, a chat model's included, is set in **Default model settings**.
- `PUT /models` takes `visionModel: null`, which clears the vision model (omitted still keeps it).

## Group speed test

- A model that cannot chat now shows how long its request took. Speech recognition is sent a short spoken sentence (NASA's public-domain Apollo 11 call, shipped with the multimodal tools plugin) instead of a wordless tone whose empty transcript left the card blank; speech synthesis reads a word, search runs one search, page reading fetches one page, and image generation draws one small picture.
- A video model is left out and its card says **Not tested**, with the reason on hover; so is a model that cannot chat when nothing in the Project uses it.

## First-run guide

- When its owner opens a Project with no default chat model, the **Default model settings** dialog opens by itself if some chat model already has a key (its own, its group's, or one in the server's environment — the model picker's rule). Otherwise a guide asks to connect TokenDance or Penguin Go (each opens the Models page on its connect flow) or to add a key, and turns into the dialog as soon as a key lands, in this window or when the window is shown again.
- The guide and the dialog open by themselves over the chat pages only, once per Project in a browser; closing either is remembered there. A member gets neither.
- After that, a new chat with no model shows "No default model yet" as an attention band across the top of the message box, with **Set default model** for the owner (a member reads "No default model yet — ask an owner"); it goes once a model is chosen for the chat or a default is set. The start page above it is unchanged. Send waits for a model. A new chat no longer starts on the first chat model listed when the Project has no default.
- Connecting TokenDance or Penguin Go in a Project with no default opens the dialog instead of asking whether to switch the default. The "no API key" guide now covers only a default model without a key.

## Without a default model

- A Session created with no model in a Project with no default is refused with 400 `no_default_model`, whose message names both ways out (name the model, or set the default in **Default model settings** or with `penguin config model default`).
- Creating or updating a schedule that names no model, and creating an organization that names no model, are refused the same way in such a Project. The schedule form asks for the model there and holds Create until one is chosen.
- `penguin run` and `penguin chat` print "This Project has no default model: pass --provider and --model-id, or set one with `penguin config model default …`" for that refusal, and the `penguin chat` banner names the model as none, with `/switch-model <provider> <model_id>`.
- The `/agent` handoff's toast and the Web App's other surfaces read "This project has no default model yet — set one under Default model settings on the Models page".
- The docs' **Models** page describes the dialog, the guide and the new Project's missing default.

## Compatibility

Existing `.project_config.toml` files keep their `default_model`; only what a new Project or **Restore defaults** writes changed. A script that creates a Project and then a Session, schedule or organization without naming a model must name one, or set the default first with `PUT /api/projects/:projectId/models/default` or `penguin config model default --provider <group> --model-id <id>`.
