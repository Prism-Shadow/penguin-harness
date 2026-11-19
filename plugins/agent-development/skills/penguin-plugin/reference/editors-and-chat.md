# Document editors and AI conversations

## Opening and saving documents

Open a document app on its recent files. Each entry shows the title once and opens that document in its editor. Put creation beside the list. When AI can create a document, expose its prompt on the start page, including when the list is empty.

In the editor, give the title and save status room to read as text. Keep the action people need while working within reach, such as **Present** for a slide deck. Put occasional commands such as New, Import, Export and Version history in a **File** menu. Name both the action and the format. A deck might offer **Import Bento HTML (.html)**, **Download Bento HTML (.html)** and **Export to PowerPoint (.pptx)**. Show whether the AI pane is open on the control that toggles it.

Route the Save command and Ctrl+S / Cmd+S through one save operation. Keyboard events in a nested editor frame stay in that frame. Handle the shortcut where focus lives, call `preventDefault()` there, and pass the active editor's latest contents to the workbench. If the editor uses a message bridge, associate the reply with the frame and document that requested it. Keep unsaved edits on failure and offer Retry. Mark a revision saved only after the host confirms it. Edits made during that save still count as unsaved.

## Chat inside a workbench

Keep the Session ID with the document or conversation. Reopen the same Session for follow-ups and history. Use the Project's available chat models and the shared `ModelSelect` from `@prismshadow/penguin-ui`, paired with the host's picker when available. Show the current model, starting with the Session's effective default. Carry the pair `{ provider, modelId }` through the selection. Model IDs can repeat across providers. Read choices through the signed-in host and keep credentials on the server.

Apply a choice to this Session. On a running Session, keep the draft and tell the user when switching is available. For an existing Session the page SDK can call `transport.post("/sessions/" + encodeURIComponent(sessionId) + "/switch-model", { provider, modelId })`. A `202` starts the switch. Wait for the Session to become idle and check its actual provider and model before sending the next turn. On refusal or interruption, show the reason and keep the previous selection. A choice in one document leaves another document's Session and the Project default intact.

Put a single activity row directly below the user message that started the turn. Update it as the Agent thinks, reads a file or runs a command. Expanding the row reveals the steps in order, including tool names, descriptions, file paths and results when present. Keep a pending approval or recoverable error actionable there. Preserve the final status and assistant answer when the turn ends. Rebuild that turn from its Session on reopen. The [AMSP example](../SKILL.md#follow-the-agent-live-amsp) covers history, live events and stopping the run.

## Try it in the app

- Try the task you used for comparison with a saved item, then repeat it at phone width. For a presentation app inspired by PowerPoint, preview the slides in a template, create a deck, change a slide and its speaker notes, save and reopen to check both changes. For a reading app, find a book on the shelf, read to a particular paragraph, then reopen it to check the resume position.
- Edit inside the embedded editor, press the platform save shortcut and immediately reopen the file. Check the exact last edit. Interrupt a save and retry. Import a supported file and open each exported format in its intended reader.
- With two documents and two configured chat models, send a first message, switch models in one document and send a follow-up. Verify the provider and model on the actual request. Reopen both documents and check the first conversation's history and the second document's model.
- Switch the app between English and Chinese with a menu or chat pane open. Check labels, errors and save status in both languages. At phone width, open the file menu, use the picker and expand a tool step with a long path. Check that each action remains reachable by touch and keyboard and the active theme keeps text and focus visible.
