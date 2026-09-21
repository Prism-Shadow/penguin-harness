---
title: Chat
description: Start a conversation with an agent, follow its work as it runs, and steer it while a Task is in progress.
---

The chat page is where you work with an agent. You start a conversation, follow the agent's work as it streams in, and steer it while a Task runs. Side panels beside the conversation show its files, its Trace, its scheduled tasks and more.

- New here? Start with [Start a conversation](#start-a-conversation) and [Send a message](#send-a-message).
- While the agent works, see [While a Task runs](#while-a-task-runs).
- To change how a conversation runs, see [Change the thinking level](#change-the-thinking-level), [Switch the model](#switch-the-model), [Hand off to another agent](#hand-off-to-another-agent) and [Fork a conversation](#fork-a-conversation).
- To keep an eye on the agent, see [Follow the agent's work](#follow-the-agents-work), [Check Session stats](#check-session-stats) and [Manage the context](#manage-the-context).
- To find your way around, see [Use side panels](#use-side-panels) and [Organize the conversation list](#organize-the-conversation-list).
- For quick reference, see [Keyboard shortcuts](#keyboard-shortcuts) and [Limits](#limits).

## Start a conversation

A new conversation starts as a draft. The Session is created when you send the first message.

1. In the sidebar, select **New chat**. The draft opens on the agent in the Project's **New chat defaults**, as long as that agent still exists in the Project; otherwise on `default_agent`, and otherwise on the first agent.
2. Above the composer, pick the **Agent**, the **Workspace** (a directory on the server, chosen in a directory browser), the **Approval mode**, the **Model** and the **Thinking level**.
3. Type your message and press Enter.

Once the Session exists, its model and Workspace are locked. To move to another model later, see [Switch the model](#switch-the-model).

Good to know:

- The Project's **New chat defaults** (in **Project settings**, see [Web App](/web-app#projects-and-members)) prefill a new draft's agent, Workspace and approval mode, and the model starts as the Project's default model. The thinking level shows the agent's own level, else the Project default, else medium.
- Switching the thinking level or the model in a draft makes it the new default: the level is written back to the selected agent's `model.thinking_level` immediately, and the model carries over to your next conversation.
- A draft keeps its selections, text and Skills per user and Project. If you select **New chat** while a draft holds typed text, that draft moves to a **Drafts** group in the sidebar.

There are four approval modes. See [Tools and Approvals](/tools).

| In the picker | Mode | Tool calls |
| --- | --- | --- |
| **Approve everything** | `allow-all` | Every call runs without asking |
| **Deny everything** | `deny-all` | Every call is denied |
| **Approve read-only** | `read-only` | Read-only tools run; every other call waits for your approval |
| **Ask every time** | `always-ask` | Every call waits for your approval |

### Start from an example prompt

Below the composer, the draft page files example prompts into folders, with one folder open at a time. Select a row to fill the composer with that prompt. Nothing is sent, so you can read and edit it before you send it. A built-in example also selects the Skills it needs.

### Save your own shortcuts

The last folder, **My shortcuts**, holds up to 3 prompts of your own.

1. Type the prompt into the composer.
2. In **My shortcuts**, select **New shortcut**. The editor opens with the composer's text, and suggests its first line as the **Name**.
3. Save.

A shortcut is a name (at most 40 characters) and a prompt (at most 4000 characters). It pins no Skills. Shortcuts are stored per user on the server, so they follow you to another browser or machine. Each row has edit and delete actions, and deleting asks first. The folder header counts them, such as `2/3`, and the **New shortcut** row disappears once 3 are saved; the cap keeps this folder the same height as a built-in one.

## Send a message

Press Enter to send, and Shift+Enter for a new line. In an empty composer, the up and down arrows recall the messages you typed earlier in this Session.

### Attach images and files

- Paste an image into the composer. Pasting accepts images only.
- In the + menu (**More input options**), select **Upload image** or **Upload file**.

An attachment can be any type. Selected files show as removable chips above the text, in the order you picked them, and a message with attachments and no text can be sent.

Limits apply at two moments:

- When you pick or drop a file: a file over the per-file size (100MB by default) or an image over 20MB is refused before anything is read, and the message names the limit in force. An image is compressed first, so what counts against the 20MB is the picture as it will be uploaded.
- When you send: a message carries at most 20 files and 120MB in total by default. Over that, the send fails with "Too many files attached to one message." or "The request is too large."

An admin can change both sizes under [System settings › Uploads](/settings#uploads). The 20MB cap for images placed inline does not follow them: an inline image enters the conversation and the Trace, where its size is paid again on every history page and every Session resume.

That is also why an image larger than 4MB is resized and re-encoded in the browser before it is uploaded, rather than sent whole — an admin can change the threshold, or turn the compression off, on the same page. Animated and vector images (GIF, SVG) are never touched, and a re-encode that comes out no smaller is discarded.

On send, attached files are written into the Session's scratchpad, which is deleted with the Session. The conversation shows an "Attached files" notice; the file contents never enter the conversation, and the model opens each file by path with its file tools. On a model without image input, images are saved to the scratchpad the same way and passed as file paths, and a hint above the composer says so.

### Drag files onto the chat

Drag files onto the conversation or the composer, on the chat page or the draft page.

- While the drag is over that area, a "Drop files to attach" overlay covers it. Dragging text, or anything that is not a file, is ignored.
- Release to attach the whole batch. Images go the same way as pasted images and everything else becomes an attachment, with the same checks and messages as the + menu.
- Dropping works while a Task runs; the attachments then follow the [mid-run send mode](#steer-or-queue-a-message).
- In goal mode, dropped images are attached and files are refused with a notice.

Only the chat area attaches. Dropping a file on the sidebar, the top bar, another panel or a page without a composer does nothing, and the browser does not navigate away to the file. The Files panel is the other drop target, and it uploads into the Workspace instead; see [Files panel](/files). The Files panel can also add a file, a directory or a selected passage to your message as a chip.

### Use slash commands

Type `/` to open the slash menu. Press Enter or Tab to run the highlighted entry. The menu does not open while a Task runs or compacts.

| Command | What it does |
| --- | --- |
| `/compact` | Compacts the context |
| `/agent` | Hands the conversation to another agent; see [Hand off to another agent](#hand-off-to-another-agent) |
| `/model` | Continues the conversation on another model; see [Switch the model](#switch-the-model) |
| `/goal` | Turns on goal mode; see [Set a goal](#set-a-goal) |
| A Skill's name | Selects or clears an installed Skill; selected Skills are sent with the message |

`/compact`, `/agent` and `/model` appear only in a started conversation: a draft has no context to compact, and it picks its agent and model up front.

### Set a goal

**Goal mode**, in the + menu or through `/goal`, turns your message into an objective. The harness then keeps running Tasks until the goal is complete, blocked or out of its **Token budget**, which you can set on the goal chip.

- The agent needs the `goal` plugin.
- The objective must be text. Images can come along, and file attachments are refused.
- Goal mode cannot be turned on while a Task runs.

See [Goal mode](/goal-mode).

## While a Task runs

While a Task runs, the composer stays live and the toolbar keeps a single action button. With an empty composer it is **Stop**, which ends the Task; it also stops a running compaction.

### Steer or queue a message

When you type while a Task runs, the button sends according to the **Mid-run send mode** at the bottom of the + menu. The choice is remembered in this browser.

- **Steer** (the default): the button reads **Send to the running agent**. Your text, images and files reach the agent with its next turn, and the message shows as **User steering**.
- **Queue**: the button reads **Queue as the next message**. The server holds the message and sends it as an ordinary new message when the run finishes. Until then, a line above the composer shows each queued message ("Follow-up queued — sent when this run finishes: …"). The queue survives a page reload.

Some drafts cannot be steered:

- Selected Skills with no text, image or file go to the queue.
- With a staged `/agent` pick, sending opens the new conversation right away.
- With a staged `/model` pick, sending waits until the turn finishes. The button stays **Stop**, and a line above the composer explains the wait.

### Recall a message

A steering message that has not reached the agent yet ("Steering queued — delivered with the next turn: …") and each queued follow-up end in a **Recall** button, a curved arrow. It puts the message back into the composer, in front of what you have typed, attachments included, so you can edit and send it again.

- A steering message that already reached the agent cannot be recalled, and neither can a follow-up that has started.
- When the run ends before a steering message is delivered, for example because you pressed **Stop** while a tool was running, the message returns to the composer by itself, attachments and all.

### Approve tool calls

When a tool call needs your approval, it shows allow and deny buttons in the conversation, and its step group opens. A subagent's pending approval shows as an amber dot on its row. You can change the approval mode during a Session. See [Tools and Approvals](/tools).

### Send a tool call to the background

When an `exec_command` or `run_subagent` call has been running for 10 seconds, its row offers **Send to background**. The call returns at once with a handle to the work, nothing is stopped, and the turn continues instead of waiting. The result arrives later as a background-task notice. The row then shows **[Background]**, and a moved command appears under [Processes](#processes).

### Retry or give up

When a model request fails and the harness waits at least 2s before retrying, the retry line counts down to the next attempt. Select **Retry now** to skip the wait, or **Give up** to stop the Task.

A request the model provider rejects, for example because of an invalid API key, ends the run with an error line ("[Error]: llm request error: …"). Fix the problem, such as updating the key on the [Models](/models) page, and send again.

## Change the thinking level

The composer's thinking level picker offers low, medium, high, xhigh and max.

In a started conversation, the picker shows the agent's configured level (or "—" when the agent sets none) and follows it until you pick one yourself. Until then, your sends carry no level, so changes to the agent's settings keep taking effect. A level you pick is stored on the Session:

- It survives a page reload.
- It applies to every later run of the conversation, whatever you later change in the agent's settings.
- It is never written back to the agent's settings.

Changing the level mid-conversation lowers the prompt-cache hit rate and raises cost, so a dialog asks first:

- **Compact, then switch** (recommended): compacts the context like `/compact`, then applies the level. If the compaction fails, is aborted or cannot start, the level is still applied, and a notice or error says so.
- **Switch anyway**: applies the level at once.
- **Cancel**: keeps the current level.

A compaction can only start on an idle conversation, so while a Task runs the first choice is disabled with a note, and the other two stay available. The dialog is skipped when the conversation has no messages yet, when you pick the level already shown, and right after a successful compaction.

## Switch the model

A Session's model is locked; selecting the model name says "Type /model to switch models". Switching continues the conversation in a new Session.

1. In the composer, type `/model` and pick a model. It appears as a chip above the text, and nothing is sent yet.
2. Type a message if you want. With an empty composer, "Continue this conversation on the new model" is sent.
3. Press Enter.

The new Session keeps the agent, the Workspace and the approval mode. It opens with a "Switched model (was …) — continued from the earlier conversation" banner that links back, and the model reads the earlier conversation's Trace file when it needs the history.

- The switch waits until the Session is idle, because it continues from the Session's Trace, which a running turn or a compaction is still writing. A line above the composer says so while it waits.
- To cancel, select × on the chip, or press Backspace at the start of the text.
- The chip is saved with the draft, so it survives a reload or a visit to another conversation.

## Hand off to another agent

1. In the composer, type `/agent` and pick an agent. It appears as a chip above the text, and nothing is sent yet.
2. Type the message to carry over.
3. Press Enter.

A new conversation opens with that agent and your text, showing where it was handed off from. With an empty composer, only the handoff itself is sent. As with `/model`, × or Backspace cancels, and the chip is saved with the draft.

## Fork a conversation

Under each finished reply, a stats line shows input and output Tokens, TPS, elapsed time and cost, then the reply time, copy and **Fork**. On a wide window the line appears when you point at the reply; on a phone it is always shown, without TPS. Fork is offered on replies that contain text.

1. Select **Fork** (**Fork chat from here**).
2. Confirm. The conversation up to this reply is copied into a new chat; the original stays unchanged.

The fork is a new Session with the same agent, model, Workspace and approval mode. Its Trace and scratchpad are independent copies, so images and files keep rendering even after the source chat is deleted. Forks of one chat are titled `Source title (1)`, `Source title (2)` and so on, in any interface language, and a number is never reused.

## Follow the agent's work

- **Text** renders as it streams, and thinking blocks can be collapsed.
- **Steps**, meaning thinking and tool calls, are grouped under a **Running** or **Done** header with the step count and time. The group is open while it runs, closes when it is done, and opens again when a call in it needs approval.
- **Tool cards** expand to show arguments and output, with a live timer while running. A card is headed by the description the model wrote or a shortened file path. Built-in tools go by short names (`read_file` reads as "read", with the full name in the tooltip); turn this off with **Tool short names** under [System settings › Appearance](/settings#appearance). Other tools, MCP tools included, always use their own names.
- **Compaction** leaves a row whose title is its status: **Compacting** while it runs and **Compacted** when it ends (**Clearing** and **Cleared** for a context clear), with its time. While it runs, the row opens a thinking section once the request's thinking arrives, and a result section when the summary starts; both are collapsed by default, each with its own time. The row folds back to one line when the compaction ends. A failed compaction keeps the title **Compaction** (or **Clear**) over a one-line reason.
- **MCP connect**, the first connection to the agent's MCP servers, leaves a row with the number of tools found and the names of unavailable servers. It expands into one group per server, with its status, tool count and connect time, and each group opens to its tool list or the error.
- **Subagents** each leave a row with their avatar, name, short Session id, a spinner while running, and an amber dot while one of their tool calls awaits approval. Selecting the row opens the **Agents panel**: a call graph of that Task at the top, with each node's elapsed time, and the selected subagent's live conversation below. Nested tool cards and approvals work as in the main chat, the subagent has a composer of its own, and **Jump to this session** opens it as a full conversation. When the current Task starts a subagent, the Agents panel opens by itself, once per Task.

### Older messages

A conversation opens on its latest 50 turns. Scroll near the top to load 50 more; your reading position stays in place. If loading fails, select "Failed to load earlier messages — click to retry". Once nothing older remains, "Beginning of conversation" marks the start. Turn numbers and header statistics count from the start of the conversation, so they match a full load.

To return to the newest message, select **Jump to latest**. In a longer conversation, ticks in the left margin mark each exchange: point at a tick to preview it, and select it to jump there. Where the margin has no room, such as on a phone, an **Outline** button in the toolbar lists the same exchanges.

## Use side panels

The chat page has two docks for panels: the right sidebar and the bottom panel. The **Right sidebar** and **Bottom panel** buttons at the top right of the chat toolbar show and hide them. An empty dock offers a list of panels to open; **Add panel** adds another, and a panel can move to the other dock. Panels become available once the conversation has started.

| Panel | What it shows |
| --- | --- |
| **Agents panel** | The Task's subagents: the call graph and each subagent's live conversation |
| **Files** | The Workspace's files, with preview, editing and upload; see [Files panel](/files) |
| **Memory** | The agent's memory |
| **Trajectories** | The conversation's Trace files: a summary, per-turn statistics, an execution timeline and each event, with **Export** |
| **Remote control** | Binding the conversation to a messaging app; see [Remote control](/remote-control) |
| **Scheduled tasks** | Tasks that send prompts to this conversation on a schedule; see [Scheduled tasks](/schedules) |
| Terminal | A shell; see [Use a terminal](#use-a-terminal) |

Each conversation remembers its own panel layout in this browser, and switching conversations restores it. Hiding a dock keeps its panels as they were, including unsaved edits. While a subagent waits for approval, an amber dot marks the button of the dock that holds the Agents panel, or the **Right sidebar** button when the panel is closed.

### Open panels with the shortcuts launcher

When the right sidebar is closed on a desktop-width window, or no panel is open on a narrow one, a round **Shortcuts** button floats 32px inside the right edge of the conversation. It is not shown on the draft page or while the conversation's history is loading or failed to load.

1. Select the button, or focus it and press Enter or Space. A fan of round entries opens to its left: **Agents panel**, **Files**, **Memory**, **Trajectories**, **Remote control**, **Scheduled tasks** and **Terminal**, then **Hide launcher**.
2. Point at an entry, or focus it, to see its name under the button.
3. Select the entry. The panel opens in the right sidebar on a desktop-width window, or in the bottom sheet on a narrow one, and the button disappears.

Good to know:

- The entries show icons only, with no tooltips: the name appears under the button. While the button itself is pointed at or focused, its caption says what a click does: **Open** or **Close**.
- Up and down arrows move through the button and its entries, and Home and End jump to either end. Esc, a click elsewhere, scrolling, or tabbing away folds the fan.
- Near the top or bottom of the conversation, the fan shortens to what fits.
- Drag the button up or down along the edge; a short press is still a click. It springs back to the edge, never rests over the toolbar or the composer, and keeps its position in this browser for every conversation.
- While the right sidebar is closed and a subagent awaits approval, the button and its Agents panel entry show the amber dot.
- **Hide launcher** puts the button away for good, and a message says where to turn it back on: the **Shortcuts launcher** switch under [System settings › Appearance](/settings#appearance).

### Use a terminal

Terminals open as tabs in the docks, or on the standalone `/terminal` page.

- Ctrl+` shows or hides the terminal tabs. With no terminal open, it takes over a running shell no conversation holds, or starts a new one.
- Ctrl+W, with a terminal focused, closes that terminal after a confirmation, like the × on its tab. The keystroke never reaches the shell. Browsers reserve Ctrl+W for closing the browser tab and may act on it first; the desktop app passes it to the terminal.

## Check Session stats

The right side of the chat toolbar shows the Session's totals: Tokens, cost and elapsed time. While the conversation has background tasks, an icon with their count sits beside them. On a narrow screen, a single **Session info** icon stands in for all of them. While a Task runs, an hourglass and **Running** show next to the title.

Select the totals to open the details card:

- **Agent**, **Model**, the Session id (with a copy button), the **Workspace** path and when the Session was **Created**.
- **Total Tokens**, including the cache hit rate and subagents' usage.
- **Cost**, shown only for priced models; an asterisk means some usage has no price.
- **Elapsed**, with two parts in parentheses, such as `Elapsed 10.3s (API 5s, tools 5.3s)`. API is the time spent in model requests, minus time waiting for your approval. Tools is the wall time covered by tool calls, so tools running in parallel count once. The two are separate measurements, not a split of the total: a background tool overlaps the model's decoding, and approval waits and harness overhead belong to neither, so they can add up to more or less than the total.

Copy buttons across the app confirm in place: the icon turns into a check mark for a moment. **Copy Session ID** in a conversation's row menu shows a "Copied" message instead.

### Processes

Under **Processes**, the details card lists the background processes the conversation started: commands that ran past their wait time, commands started with `run_in_background`, and commands moved with **Send to background**. Each row shows the command, the start time and the pid. A running row links to the service the process serves, when one is detected (the last local URL its output printed, or a port its process group listens on).

- **Stop** ends the whole process group and removes the row. The conversation is told the process was stopped, not that it failed, so the model knows the server is gone without treating it as a crash to restart.
- An exited row is labeled "exited" and has **Remove**, which deletes the entry from the list.

> [!WARNING]
> Removing a process is immediate and final. Its captured output goes with it, and the model can no longer be asked to read that output. Keep the row until you are done with it.

## Manage the context

The context ring at the right of the toolbar shows how full the context is, measured against the point where compaction starts: the agent's `compaction.max_context_length`, capped by what the model's window allows. It turns amber past 80% and red past 95%. Right after a compaction, the ring is empty until the next request reports the usage.

Select the ring to open the context panel:

- The used and threshold figures.
- A bar as long as the model's full window ("Max context N"), split into **System prompt**, **Tool definitions**, **User messages**, **Model messages**, **Tool requests** and **Tool results**. Select a segment or a legend row to keep it highlighted, and select it again to release it.
- **Top 5 tools** or **Top 5 files**, switched by the **Tools** and **Files** buttons. Files are listed by name, with the full path on hover.

The dashed marker on the bar is the compaction threshold. The hatched stretch past it is room the model has but the Session cannot use yet, because compaction starts first.

### Change the compaction threshold

1. Drag the dashed marker, or focus it and press the left and right arrow keys: each press moves 1,000 Tokens, or 10,000 with Shift.
2. Release, or press Enter. The **Change the compaction threshold** dialog opens, and you can still edit the number. Esc cancels.
3. Confirm. The threshold is saved to the agent and applies to this conversation at once, even mid-run.

A value above the model's window is accepted, with a note that the window's size is what takes effect. When the model's window is already smaller than the agent's threshold, a notice above the composer says so, with **Open agent settings** and **Dismiss**.

## Organize the conversation list

The sidebar lists the Project's conversations. **Search chats** filters the titles of the conversations already loaded.

In **List options** (the sliders icon at the top of the list):

- **Group by**: **Group by workspace** (the default), **Group by agent** or **Group by time** (**Past day**, **Past month** and **Earlier**).
- **Sort by**: **Most recent** or **Manual order**, where you drag rows. Manual order is offered only with a mouse or trackpad.

The button beside it follows the grouping: **New workspace**, **Create agent** or **New chat**. Groups can be pinned, reordered by dragging, and have a + button that starts a new chat in them.

When grouped by Workspace, the directories the system creates for itself fold into one **Temporary workspaces** group: the Workspace a conversation gets when you choose none, and the Test Workspace an evaluation creates for each case and run. Both live directly under the agent's `workspaces/` directory, and every directory there joins this group.

### Row actions

- Point at a row to swap its last-active time for two buttons: **Archive** and **More** (…). Tabbing to either one shows it too.
- Right-click the row, long-press it on a touch screen, press Shift+F10, or select **More** to open its menu: **Pin**, **Rename chat**, **Remote control** (see [Remote control](/remote-control)), **Archive**, **Copy Session ID** and **Delete chat**. Esc, a click elsewhere or scrolling the list closes it.
- **Delete chat** asks for confirmation. Deleting removes the conversation's messages and Trace for good.

The right-click menu replaces the browser's own menu only on conversation rows and in the Files panel. A pinned conversation sorts to the top of its group. Pinning is offered only in the active list, and pins are remembered per Project in the browser.

### Row marks

| Mark | Meaning |
| --- | --- |
| Turning hourglass | The Session is running |
| Squeezing bar | The Session is compacting |
| Green dot | A run finished that you have not looked at yet |
| Small green activity trace | The Session still has background tasks: commands running past their wait time, or background subagents mid-round. The tooltip counts them, such as "2 background tasks" |
| Amber count | Tool calls waiting for approval |
| Pin | The conversation is pinned |
| Remote control icon | A messaging connection is enabled for the conversation |
| Alarm clock | A scheduled task bound to the conversation will still fire; see [Scheduled tasks](/schedules) |

The background-task mark does not depend on the others: an idle conversation whose dev server is still running keeps it, and it disappears as soon as the last task ends, without a refresh.

### Folders

Below each group's active conversations are its folders: **Subagents**, **Scheduled**, **Evaluations** and **Archived**, each loading its rows only when opened. When grouped by time, one set of folders covers the whole Project, and **Load more chats** fetches older conversations.

- **Evaluations** holds the conversations opened by **Use** in the [Evaluation Center](/evaluation-center), and the Test Sessions an evaluation starts for every case and run, so they do not crowd the tested agent's list.
- Opening a subagent, scheduled or evaluation conversation opens its folder.
- A group with nothing but folder rows, such as an agent that has only run evaluations, starts collapsed and sorts after the other groups (pinned groups excepted), with a dimmed header counting the folded rows. Once you open it, it stays open for that Project.

A group's active conversations, and each open folder, show ten conversations at a time. **Show N more chats** reveals ten more; rows already loaded come first, and more are fetched from the server only when they run out. Once more than ten show, **Show less** folds back to the first ten. With more than ten groups, the list shows ten groups per page, with a pager below it.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Enter | Send the message, or run the highlighted slash command |
| Shift+Enter | New line |
| Up / Down | In an empty composer, recall earlier messages of this Session |
| Tab | Run the highlighted slash command |
| Backspace | At the start of the text, remove a staged `/agent` or `/model` chip |
| Shift+F10 | Open the menu of the focused conversation row, or of the Files panel |
| Esc | Close a menu; fold the shortcuts launcher; cancel a pending threshold change |
| Left / Right | Move the focused compaction threshold marker by 1,000 Tokens (10,000 with Shift) |
| Ctrl+` | Show or hide the terminal tabs |
| Ctrl+W | Close the focused terminal, after confirmation |

## Limits

| Item | Limit |
| --- | --- |
| Inline image | 20MB, separate from the attachment limits |
| Attachments per message | 20 files |
| Attachment size | 100MB per file and 120MB per message by default; set by an admin under [Uploads](/settings#uploads) |
| Shortcuts | 3 per user; name up to 40 characters, prompt up to 4000 |
| History | The latest 50 turns on opening, then 50 more per load |
| Conversation list | 10 conversations at a time per group or folder; 10 groups per page |
| Send to background | Offered after a call has run for 10 seconds |
| Retry countdown | Shown for waits of 2s or more |
| Context ring | Amber past 80%, red past 95% |

## How it works

Some of what you do in the chat travels as structured text in the conversation, which you may notice in the Trace:

- A model switch starts the new Session with a `[model_switch_from]` block naming the source Session, its title, its Trace file, its Workspace and the previous provider and model, followed by your message. The new conversation shows the block as the "Switched model" banner.
- A steering message is sent as a `[user_steering]` user message with the agent's next turn.
- Selected Skills travel with the message in a `[use_skills]` block.
- Each attached file adds an `[attached file: <path>]` line to the message.
