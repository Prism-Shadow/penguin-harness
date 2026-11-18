# Bento Slides

Make slide decks with [Bento Slides](https://bento.page), a slide editor whose document is JSON. The plugin carries two things:

- **The Slides workbench (AI PPT):** a slide editor in a tab beside the Agent's chat. You edit a deck there while the Agent edits the same deck, and each of you sees the other's changes as they are saved.
- **The `bento-slides` Skill:** how the Agent writes and changes decks, both those in the workbench and standalone `.bento.html` files in a Workspace.

`default_agent` gets the plugin when a Project is created. Any other Agent installs it from the plugin library.

## The Slides workbench

- **Find a presentation.** The workbench opens your saved presentations, ordered by the last edit. Open, rename or delete one there. Use **Save**, **Ctrl+S** or **Cmd+S** to write the open presentation, including the text you are typing.
- **A full slide editor in a tab.** Bento's own editor: slide list, canvas, text, shapes, pictures, tables, charts, morph transitions, presenter mode.
- **Ask in plain words.** The rail beside the editor sends your request to the Agent together with the slide you are on and the elements you selected, so "make this a bar chart of the numbers" means this slide.
- **Both of you edit one deck.** A deck is one file. The editor saves your changes to it and the Agent edits it with its own tools; whichever side saved last is loaded into the other within a second. Asking from the ordinary chat works the same way: the Agent writes the same file.
- **Both sides' edits are kept.** When the Agent saves while you have unsaved changes, your changes are replayed on top of its version, element by element. If you both changed the same property, yours is kept, the workbench says so, and the Agent's version goes to the deck's **History**, from which any version can be restored.
- **Decks you can take away.** **Export as PowerPoint file (.pptx)** downloads an editable .pptx with native text, shapes, tables and supported charts. For the original animations, media and editor, **Download Bento HTML file (.html)** gives a self-contained `.bento.html` that opens in any browser with the editor inside it. **Import Bento HTML file (.html)** opens it again, or a deck's `.json`.

To start, open the **Slides** tab beside the Agent's chat, or the **AI PPT** tile in the App Center. Describe a deck and choose **Create with AI**, choose a blank deck or a three-slide project brief, or open the sample deck. Use **Present** to play the current deck. Then click a slide, type a change in the rail on the right, and keep editing while the Agent works.

## Your data

- Decks live with the Agent, on the server: `agent_state/workbenches/slides/.files/decks/<name>.bento.json`, one JSON file per deck, and under `.files/history/` the last twenty versions that one side replaced.
- The editor runs in a sandboxed frame with no origin of its own and a policy that allows no network connection. It cannot reach the internet, the app's API or your sign-in. Bento's update check, live sharing and remote media are therefore off inside the workbench; pictures are embedded in the deck.
- The workbench sends nothing to any other host. The Agent's own work goes to the model you configured, as in any chat.
- Uninstalling the plugin, or removing the workbench from the Agent, deletes its decks. Export the ones you want to keep first. A plugin update replaces the workbench's code and keeps your decks.

## Known limits

- The workbench and editor use the app’s language. The embedded Bento presentation keeps its own slide colours.
- Printing, PDF and real full screen do not work inside the app's frame. Export the deck and present or print it from a browser tab; Bento's own "fill the tab" presenting works in the workbench.

## Licence and credits

Apache-2.0, like the rest of PenguinHarness. The editor is [Bento Slides](https://bento.page) 1.2.13, MIT, © 2026 The Bento authors, shipped unmodified, and the Skill's format reference is the Bento project's own agent guide; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). This plugin is not affiliated with or endorsed by the Bento project.
