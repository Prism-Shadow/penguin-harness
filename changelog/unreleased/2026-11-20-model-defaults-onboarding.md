# New Projects start with no default model, and a first-run guide asks for one

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `cli`, `docs`
- **PR:** [#1674](https://github.com/Prism-Shadow/penguin-harness/pull/1674)
- **Breaking:** yes — a new Project has no default model, so a Session, schedule or organization created there without naming a model is refused until one is set

[中文版](2026-11-20-model-defaults-onboarding.zh.md)

A new Project, and **Restore defaults**, no longer set DeepSeek V4.1 Flash as the default model: the owner chooses one, and the Web App asks for it the first time the Project is opened. The defaults now live in one **Default models** dialog, and a model's settings set it as the default in one step: **Set as default model** makes a tool model the default for every multimodal job it can do. Existing Projects keep the default they have.

## The Default models dialog

- The Models page header's **Default models** (replacing its way to Project settings › Multimodal models) opens one dialog with three groups: **Chat** (the default chat model); **Multimodal** (text generation, image generation, image understanding — the Project's vision model —, video generation, speech recognition and speech synthesis); and, quieter, **Tools** (web search, reading a web page, and the bindings other plugins declare).
- Each row is a picker over the configured models that can serve it, saved as it is picked. A row nothing can serve says "Connect a provider that offers this kind of model" and links to the Models page. A member sees the same rows, read-only.
- Text generation with nothing bound reads "Follows the default chat model (<model>)"; picking a model binds it, and the picker's **Follow the default chat model** unbinds it again.
- The dialog is `DefaultModelsDialog` in `@prismshadow/penguin-ui`, with a **Models** board in the component gallery beside the guide (`ModelSetupGuide`).
- Project settings › **Multimodal models** lists the same rows as the dialog's Multimodal and Tools groups, in the same order, with the same names, candidates, empty rows and "Follows the default chat model"; both are built by one hook and laid out by one component, `DefaultModelSections`. Dictation polish stays under the rows.

## Set as default model

- A model's settings no longer list each multimodal job with its own **Set default**. Right beside **Test connection** there is one **Set as default model**, and no button, confirmation or toast says "multimodal". On a chat model it sets the default chat model, as before. On a tool model, which cannot chat, it makes the model the default for every multimodal job it can do and does not hold yet, after a confirmation naming them, and a toast names the ones it took; once it holds them all, the button reads **Remove as default model**, which unbinds it from each without asking, and a toast names what was removed. It is not shown for a tool model that can do none of them; it waits while the dialog has unsaved edits. Each job one at a time, a chat model's text generation or image understanding included, is set in **Default models**.
- `PUT /models` takes `visionModel: null`, which clears the vision model (omitted still keeps it).
- A model that is the Project's default for anything (the default chat model, or a multimodal binding) carries one **Default** tag on its card and in its settings, naming on hover what it is the default for ("Default for: Chat, Speech recognition"). The separate multimodal tag and the chip glyph are gone. A model that is only the proxy vision model keeps its **Proxy vision** tag alone. Web search and page reading are tools: they are set in the **Default models** dialog only.

## First-run guide

- When its owner opens a Project with no default chat model, the **Default models** dialog opens by itself if some chat model already has a key (its own, its group's, or one in the server's environment — the model picker's rule). Otherwise a guide asks to connect TokenDance or Penguin Go (each opens the Models page on its connect flow) or to add a key, and turns into the dialog as soon as a key lands, in this window or when the window is shown again.
- The guide and the dialog open by themselves over the chat pages only, once per Project in a browser; closing either is remembered there. A member gets neither.
- After that, a new chat with no model shows an attention notice on the start page, "No default model yet", with **Set default model** for the owner (a member reads "No default model yet — ask an owner"). It takes the place of the version number beside the logo, which is hidden meanwhile, without covering the logo or leaving a gap; it goes once a model is chosen for the chat or a default is set, and the version number shows again. Send waits for a model. A new chat no longer starts on the first chat model listed when the Project has no default.
- Connecting TokenDance or Penguin Go in a Project with no default opens the dialog instead of asking whether to switch the default. The "no API key" guide now covers only a default model without a key.

## Without a default model

- A Session created with no model in a Project with no default is refused with 400 `no_default_model`, whose message names both ways out (name the model, or set the default in **Default models** or with `penguin config model default`).
- Creating or updating a schedule that names no model, and creating an organization that names no model, are refused the same way in such a Project. The schedule form asks for the model there and holds Create until one is chosen.
- `penguin run` and `penguin chat` print "This Project has no default model: pass --provider and --model-id, or set one with `penguin config model default …`" for that refusal, and the `penguin chat` banner names the model as none, with `/switch-model <provider> <model_id>`.
- The `/agent` handoff's toast and the Web App's other surfaces read "This project has no default model yet — set one under Default models on the Models page".
- The docs' **Models** page describes the dialog, the guide and the new Project's missing default.

## Compatibility

Existing `.project_config.toml` files keep their `default_model`; only what a new Project or **Restore defaults** writes changed. A script that creates a Project and then a Session, schedule or organization without naming a model must name one, or set the default first with `PUT /api/projects/:projectId/models/default` or `penguin config model default --provider <group> --model-id <id>`.
