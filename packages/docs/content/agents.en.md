---
title: Agents
description: Create agents, and configure their prompts, tools, Skills, hooks, memory, vault, scheduled tasks and API.
---

An agent is a configured assistant in a Project. Each agent has its own instructions, runtime settings, tools, Skills, hook packages, memory, vault variables and scheduled tasks, stored together as its Agent State. You create agents and change their settings on the **Agents** page.

- To see the agents in a Project, see [The Agents page](#the-agents-page).
- To add an agent, see [Create an agent with AI](#create-an-agent-with-ai), [Create an agent manually](#create-an-agent-manually) or [Import an agent](#import-an-agent).
- To change an agent, see [Agent settings](#agent-settings) and the section for each tab.
- To back up, move or reset an agent, see [Overview tab](#overview-tab).
- To delete an agent, see [Delete an agent](#delete-an-agent).

## The Agents page

In the sidebar, select **Agents**. The page lists every agent in the current Project. Use the search box (**Search agents: id / name / description**) to filter the list.

By default the list is grouped by who created each agent: **Created by users**, **Created by agents** and **Created in company mode**, in that order. A group with no agents is not shown, and selecting a group's header collapses or expands it. To see one list instead, choose **No grouping** in the select beside the search box. In that list the employees of the Project's organizations come last, in a **Company employees** section of their own. The browser remembers the grouping you choose and the groups you collapsed.

Every Project starts with the built-in agent `default_agent`. While it is the only agent, a card below it offers to create your first one: "No agent of your own yet".

Each agent card shows:

- the agent's name, its id, its Agent State version (for example `v3`) and its description; an agent whose API is on carries an API icon after its name (**API access on**);
- a row of counts: Sessions, tools, Skills, hook packages, memories, vault variables and scheduled tasks, plus when the agent was last modified. Select a count to open the matching settings tab;
- the agent's Session activity over the last 30 days;
- **New chat**, which starts a conversation with the agent; **Settings**, which opens its settings; an icon that opens its costs in **Cost Center**; **Export agent**, which opens the export dialog (see [Export and import an agent](#export-and-import-an-agent)); and a delete button.

When a newer kernel is available for some agents, their cards show **Kernel update needed**, and a notice at the top of the page offers **Update now** and **Dismiss**. See [Update the kernel](#update-the-kernel).

### Agents on machines

An agent belongs to the server it lives on. When the Project uses machines, each connected machine's own agents sit in the same list as this server's, in the list's order (oldest first), the way the sidebar lists machine workspaces beside local ones. Each machine card carries the machine after the agent's name, as in `[SSH: gpu-box]`. A machine's agent is never merged with one of this server's, even when the ids match: every machine has its own `default_agent`.

Everything on such a card acts on that machine. **Settings** and the counts open the agent's settings there, and every change is saved there. **New chat** starts a conversation in that machine's temporary workspace, and delete removes the agent from that machine. **Cost Center** counts this server's agents only, so the card's costs button is off. While a machine is reconnecting or its server is stopped, the agents it last listed stay in the list, greyed, with an unplugged icon after the machine's name: point at it for the reason. Their buttons are off. Only admins see machines.

You can also reach an agent from the sidebar. When conversations are grouped by agent, each agent's group header has a **New chat** button and an **Agent settings** button, and the sidebar has a **Create agent** button that opens the **Create agent** dialog.

## Create an agent with AI

Describe the agent you want, and an existing agent sets it up for you.

1. On the **Agents** page, select **Create with AI**. The **Create an agent with AI** dialog opens.
2. Describe what the agent does, for whom, and what it produces. To start from an example, select one under **Try an example**: **Jotting agent**, **Financial Copilot**, **Document RAG agent**, **Deep research report agent** or **Report-writing agent**.
3. Optional: expand **Full prompt** to read the instructions that travel with your description, or select **Copy prompt**.
4. Select **Edit in a new conversation**. A new conversation opens with the prompt filled in. Nothing is sent yet.
5. Review the prompt and send it.

The dialog shows which agent does the work: "Done by *agent* in a new conversation". It is the Project's `default_agent`, or the first agent when there is no `default_agent`.

The fixed instructions tell that agent to use the `agent-initialization` Skill and to:

- use the agent id you gave, or pick a short id that describes the agent, and stop instead of overwriting when that agent already exists;
- start from `default_agent`'s configuration, set the name and description, record that an agent created it, and write the agent's role and rules into its `AGENTS.md`;
- copy only the Skills the new agent needs from the plugin library, and leave every other agent untouched;
- report the new agent's id, the Skills it installed, and how to start a conversation with it.

The **Report-writing agent** example creates an agent with the id `report-writer`. The [Evaluation Center](/evaluation-center) has a matching Benchmark example, so you can go on to evaluate and optimize it.

## Create an agent manually

1. On the **Agents** page, select **Create manually**. The **Create agent** dialog opens.
2. Optional: when a machine is connected, in **Location**, select where the agent is created: **This server** or a machine. An agent created on a machine lives there: the plugins on offer come from that machine's library, the directory in step 7 is one on that machine, and the agent's settings open on that machine. Changing the location clears the plugins and the directory picked so far.
3. Optional: in **Name**, enter a name. An empty name uses the agent id.
4. In **Agent id**, enter an id, or select **Generate with AI** beside the field to have the Project's default model derive one from the name, or from the description while the name is empty. An id is 2–64 characters long, starts with a lowercase letter, and uses only lowercase letters, digits and underscores. A proposal replaces what is in the box and stays editable. You cannot change the id later.
5. Optional: fill in **Description**.
6. Optional: in **Plugins**, select plugins from the plugin library to install on the new agent. Their Skills and hook packages are installed when the agent is created.
7. Optional: in **Import Skills from a project directory**, select a directory. PenguinHarness reads the Skills under its `.agents/skills` and `.claude/skills` folders; select the ones to install. If a Skill from the directory has the same name as a Skill from a selected plugin, the directory's Skill is installed.
8. Select **Create**. The new agent's settings open.

Any Project member can create an agent.

To create an agent from an exported file instead, select **Import agent** in the dialog's footer.

## Import an agent

**Import agent**, beside the create buttons on the Agents page, opens a dialog with two ways in.

### Migrate from another framework

Move an agent set up in Claude Code, Codex, DeepSeek Harness, Qoder, Qwen Code or WorkBuddy into a new agent in this Project.

1. In **Source framework**, select the tool, or **Other** for any other tool.
2. Optional: in **Path**, enter where its files are. Empty reads the tool's user directory shown in the box: `~/.claude`, `~/.codex`, `~/.dsh`, `~/.qoder`, `~/.qwen` or `~/.workbuddy-ai`. For **Other**, the field is **Path or description** and is required.
3. Optional: expand **Full prompt** to read the prompt, or copy it.
4. Select **Open a new chat**. A conversation with the Project's `default_agent`, or the first agent when there is none, opens with the prompt filled in. Nothing is sent yet.
5. Review the prompt and send it.

The agent follows the `agent-porting` Skill of the `skill-porting` plugin. It reads the source without changing it and never copies a secret's value. It writes the new agent in the layout of an exported zip, imports it with `penguin agent import`, and reports the new agent's id, what it brought over, what it could not and why, and the vault keys to fill in. When that agent does not have the Skill yet, **Open a new chat** installs the plugin on it first.

### Import a file

1. Under **Import a file**, select **Choose a file** and pick a `.zip` exported from an agent. Until 1.0, an older `.tar.gz` snapshot package works too.
2. Check **Agent id**. It is filled in from the file name without its `-<yyyymmdd>` or `-v<n>` ending.
3. Select **Import**. A message says whether the agent was created or overwritten, and how many conversations were imported and skipped. The new agent appears in the list.

Any Project member can import a new agent. When the id is taken, the dialog says so. Select **Use another id** to change it, or, as the Project owner, **Overwrite the existing agent** and confirm. Overwriting replaces the parts of that agent's Agent State the file carries; its conversations, vault and API keys stay, and a backup snapshot is written first.

## Delete an agent

Only the Project owner can delete an agent. The built-in `default_agent` cannot be deleted, and neither can an employee of an organization: its card names the organization, and an employee can be deleted once it leaves its organization in company mode (see [Employees are agents](/company-mode#employees-are-agents)).

1. On the agent's card, select the delete button (**Delete agent**).
2. Confirm.

> [!WARNING]
> Deleting an agent deletes its directory on the server, including all of its Traces. You cannot recover it.

## Agent settings

To open an agent's settings, select **Settings** on its card, select one of its counts, or select **Agent settings** on its group in the sidebar. The settings are organized into tabs:

| Tab | What you configure |
| --- | --- |
| **Overview** | Name, description and author, export and replace from a file, kernel updates, and restoring the default configuration |
| **System Prompt** | `AGENTS.md` and the system prompt template |
| **Runtime** | Turn limit, output tokens, thinking level, timeout and context compaction |
| **Tools** | Built-in tool settings and MCP servers |
| **Plugins** | The agent's plugins and the Skills, hook packages, MCP servers and workbenches each one brought; your own Skills, hook packages and workbenches; the switches for Skills, hooks and workbenches |
| **Memory** | The agent's memories and the memory prompts |
| **Vault** | Environment variables for the agent's commands |
| **Schedules** | Scheduled tasks |
| **API** | Whether programs may call the agent over the Agent API, the approval mode of their conversations, and the keys |

Each tab has its own address, `/agents/<agentId>?tab=<tab>`, where `<tab>` is `overview`, `prompt`, `runtime`, `tools`, `plugins`, `memory`, `vault`, `schedules` or `api`. The older addresses with `skills`, `hooks` or `workbenches` open **Plugins**.

### Save changes

On the Overview, System Prompt, Runtime and Tools tabs, and in each prompt section, select **Save** and confirm. The confirmation reads "Save these changes? They will be written to the configuration files on the server."

- Most changes apply to new conversations right away, and to running conversations after their next compaction.
- A Runtime change that touches only the context compaction fields takes effect immediately, including in running conversations.
- Switches such as **Enable skills** save as soon as you flip them, without the **Save** button.

For the file format behind these settings, see [Agent config](/configuration#agent-config).

### Who can change what

Any Project member can change most settings. These actions are for the Project owner only:

- deleting the agent, and overwriting or replacing it from a file;
- the switches on the **Plugins** tab (**Enable skills**, **Enable hooks**, **Enable workbenches** and each workbench's own), the **Skills prompt**, and uninstalling a plugin;
- editing vault variables, the **Enable vault** switch and the **Vault prompt**;
- creating, editing, enabling, disabling and deleting scheduled tasks, and editing the **Enable schedules** switch and the **Schedules prompt** (members can still use **Create with AI**);
- importing memories;
- everything on the **API** tab: the switch, the approval mode, keyless access and the keys.

## Overview tab

### Edit the name, description and author

Change **Name**, **Description** or **Author**, then select **Save**. **Author** says who created the agent: **User** (created by a person in the Web App), **Agent** (created by an agent, for example through **Create with AI**) or **Company mode**. It decides which group the agent is in on the **Agents** page and changes nothing else.

### Export and import an agent

The **Agent State** section shows the agent's **Agent State version** and its **State path**, the folder that holds the Agent State on the server. Select the copy button to copy the path.

- **Export…** opens the export dialog, which **Export agent** on the agent's card opens too. Choose what goes in beside the configuration: **Skills**, **Hooks**, **Memory**, **Workbenches**, with **With their data** for each workbench's state, and **Schedules**, off by default. Under **Conversations**, choose **None**, **Latest N** (20 by default, up to 500) or a **Date range**. Select **Export** to save `<agentId>-<yyyymmdd>.zip`.
- **Replace from file…** (Project owner only) opens the [import dialog](#import-an-agent) with only its file section. Pick an exported file, select **Replace** and confirm.

An agent travels as a zip of its directory: `<agentId>/agent_state/…` and, for the Sessions you choose, `<agentId>/traces/…`. There is no manifest; the name, description and version are in `system_config.yaml`. The configuration always travels. Skills, hooks, memory and workbenches, with or without their data, travel unless you leave them out; scheduled tasks only when you take them, since an imported task runs on its schedule. The vault never travels, and a vault value found in a Trace is replaced by `[vault:<KEY>]`. A value written literally into the configuration travels as it is, so reference credentials as `${KEY}`.

- Importing under an id no agent has creates the agent from the package, with its State, name, description and version. Any member can.
- Overwriting an agent is for the Project owner. The current Agent State is first packed into a backup of its own, `snapshots/import-backup-v<version>-<time>-<random>.tar.gz`, then replaced by what the package carries: a part the package leaves out (an export without memory, say) keeps the agent's own, and so does a workbench's data the package left out. The agent's conversations, vault, API keys and employments stay. The workbench version history sits beside the Agent State, so an import leaves it as it is.
- Sessions the package carries land as conversations of the agent, titled from their first message. A Session this server already has, as when you import an export from the same server, is skipped and reported.
- A package whose `system_config.yaml` has no `system_prompt` is laid over the default configuration, and the files it leaves out come from the defaults, so a hand-written package needs only the keys it changes.

A `.tar.gz` snapshot package exported before this format imports the same way until 1.0. For the routes, see [Agent routes](/server-api#agent-routes).

For how versions and snapshots work, see [Self-Improvement](/self-improvement#snapshots-and-versions).

### Update the kernel

An agent's kernel version records which generation of the built-in default settings its configuration is based on. An existing agent never picks up newer defaults on its own. When PenguinHarness ships newer defaults, the **Kernel** section shows the current and the latest kernel version, and the Overview tab shows a red dot.

1. In the **Kernel** section, select **Update kernel**.
2. Confirm.

Tabs you have not customized are updated to the current built-in defaults. A tab you have edited stays unchanged in full and is listed in the result. The name, description, author, Agent State version and MCP servers are not affected. For the details, see [Kernel updates](/configuration#kernel-updates).

> [!TIP]
> To update several agents at once, select **Update now** in the notice at the top of the **Agents** page.

### Restore the default configuration

1. In the **Kernel** section, select **Restore default configuration**.
2. Confirm.

> [!WARNING]
> Restoring the default configuration cannot be undone.

The agent's configuration is overwritten with the current defaults: the custom system prompt, tool list, model and compaction settings, and MCP servers are all replaced. Only the name, the description, the author and the Agent State version are kept. The MCP servers a plugin installed go too; **Manage installs** on the **Plugins** page puts them back.

## System Prompt tab

- **AGENTS.md** holds the agent's role, rules and working instructions.
- **system_prompt template** is the template the system prompt is built from.

Under **Available placeholders (click to insert)**, select a placeholder to insert it at the cursor in the template:

| Placeholder | Inserts |
| --- | --- |
| `{{AGENTS_MD}}` | The `AGENTS.md` content |
| `{{VAULT}}` | The vault section: the **Vault prompt** with the list of vault variable names; empty when **Enable vault** is off |
| `{{SKILLS}}` | The Skills section: the **Skills prompt** with the installed Skills' metadata; empty when **Enable skills** is off |
| `{{MEMORY}}` | The memory section: the main memory prompt, plus the workspace addendum in persistent workspaces; empty when memory is off |
| `{{SCHEDULES}}` | The scheduled tasks section: the **Schedules prompt** with the task names; empty when **Enable schedules** is off |
| `{{PLATFORM}}` | The runtime platform |
| `{{OS_VERSION}}` | The operating system version |
| `{{SHELL}}` | The shell used to run commands |
| `{{DATE}}` | The current date |
| `{{PROJECT_DIR}}` | The PenguinHarness app data root, which holds all agents' data and Project data; not the task's working directory |
| `{{AGENT_ID}}` | The agent's id |
| `{{CWD}}` | The absolute Workspace path |
| `{{PROVIDER}}` | The model's provider group |
| `{{MODEL_ID}}` | The upstream model id |
| `{{SESSION_ID}}` | The Session id |

The switches and prompts for the vault, Skills, memory and scheduled tasks sections are on their own tabs. See also [System prompt placeholders](/configuration#system-prompt-placeholders).

## Runtime tab

| Field | Meaning |
| --- | --- |
| `max_turns` | The most turns one Task may take; `-1` means unlimited |
| `model.max_tokens` | The output token limit per request |
| `model.thinking_level` | `low`, `medium`, `high`, `xhigh` or `max`. A new agent uses `medium`. `xhigh` and `max` behave like the tier below them on some models. An agent that stored the old `none` tier keeps it, but it is no longer offered |
| `model.timeoutMs` | How long to wait between events from the model provider, in milliseconds; not a limit on the whole request |
| `max_context_length` | The context size that triggers compaction |
| `max_session_turns` | The number of turns that triggers compaction |
| `mode` | `summarize` (the default) has the model summarize the old context and continues from the summary in a fresh window; `discard` drops the old context without a summary |
| `prompt` | The prompt used to summarize the context |

`max_turns` and `model.timeoutMs` accept a number greater than 0, or `-1`. For how the thinking level works on each model, see [Thinking levels](/models#thinking-levels). For compaction, see [Compaction](/agent-loop#compaction).

## Tools tab

### Built-in tools

The table lists the built-in tools. For each tool you can set:

| Column | Meaning |
| --- | --- |
| `permission` | **Read-only** (`r`): the tool only reads, and the read-only approval mode approves it automatically. **Read & write** (`rw`): the tool can change things, and the read-only approval mode asks you first |
| `timeoutMs` | The tool's time limit, in milliseconds |
| `maxOutputLength` | The most output the tool may return |
| `call_description` | Whether the model writes a one-sentence description of each call, which is shown to you while the call runs. On by default; only tools that accept a description can be switched |

Leave a field empty to use the default. Select **Save** to save the table. For the approval modes, see [Approval](/tools#approval).

### Add an MCP server

MCP servers add external tools to the agent. Their tools are named `mcp__<name>__<tool>`. Changes in the **MCP Servers** section save immediately.

1. On the **Tools** tab, select **Add MCP Server**.
2. Choose the transport:
   - `http`, the default: Streamable HTTP, the current remote transport.
   - `stdio`: a local process that PenguinHarness starts and talks to over stdin and stdout.
   - `sse`: the legacy HTTP+SSE transport, for servers that have not migrated.
3. In **name**, enter the tool-name prefix. Use letters, digits, `_` and `-`, starting with a letter or digit.
4. Fill in the connection fields:
   - For `stdio`: **command**; **args**, one argument per line; **env**, one `KEY=value` per line; and **cwd**, which defaults to the Session's Workspace. The agent's vault is not passed to MCP server processes as a whole; give a server a secret as a `${KEY}` reference, described below.
   - For `http` and `sse`: **url**, and **headers**, one `Header-Name: value` per line, for example `Authorization: Bearer ${LINEAR_API_KEY}`.
5. Choose **permission**:
   - **Auto (readOnlyHint)**: each tool is read-only if it declares the `readOnlyHint` annotation, and read & write otherwise.
   - **Read-only**: every tool of the server is treated as read-only.
   - **Read & write**: every tool of the server is treated as read & write.
6. Optional: adjust **connectTimeoutMs** (connecting and discovering tools, 10000 by default), **timeoutMs** and **maxOutputLength**, which apply to every tool of the server.
7. Optional: select **Test connection** to try the settings before you save. It reports the number of tools found and how long it took. An entry that reads a value from the vault (`${KEY}`, described below) is tested only as saved: while it is new or changed, the test fills nothing in and says to save it first.
8. Select **Save**.

> [!NOTE]
> The permission level matters only in the read-only approval mode; the other approval modes ignore it. It does not restrict what the server can do: marking a server read-only only skips the confirmation that mode would ask for.

A value written as `${KEY}`, where `KEY` names a variable on the agent's [Vault tab](#vault-tab), is filled in from the vault when the server connects. The configuration keeps only the reference, so the secret never sits in `system_config.yaml`. A reference works in every field except the host of the URL; see [Vault references](/tools#vault-references).

To change a server, select **Edit** on its row. To remove it, select **Remove** and confirm; its tools stop being available from the next Session. For more about MCP servers, see [MCP Servers](/tools#mcp-servers).

Installing a plugin that carries MCP servers adds them to this list too; see [Install a plugin on an agent](/skills#install-a-plugin-on-an-agent). Such a row shows a puzzle icon after the name, and pointing at it tells which plugin installed the server. **Edit** keeps the entry tied to its plugin and notes that reinstalling the plugin replaces it. **Remove** asks first and says that **Manage installs** on the **Plugins** page can put the server back.

A row may also show an icon for a server that cannot connect yet. A conversation skips that server, and its MCP connect row says why:

- A key icon: the server needs setup, because the vault lacks keys its entry references. Point at it for their names. The Project owner adds them on the **Vault** tab, or with **Set up** in the plugin's **Manage installs** dialog.
- A sign-in icon: the server signs in with OAuth, which this version does not support yet.

### Test MCP servers

1. In the **MCP Servers** section, select **Test all** in the table's header.
2. Select **Start test**.

PenguinHarness connects to each server in turn and discovers its tools. Nothing is saved. Each row shows the number of tools and the time taken, or **Connection failed** with the reason. References to the vault are filled in first; a server whose keys the vault lacks fails with their names, without a connection attempt.

## Plugins tab

The **Plugins** tab shows what is installed on the agent, grouped by the plugin it came from. From top to bottom:

- **Import** adds a Skill, a hook package or a workbench, from a zip or by asking the agent in a chat. **Browse plugin library** opens the **Plugins** page, where plugins are installed.
- **Enable skills** decides whether the system prompt lists the installed Skills, using the **Skills prompt** below it. **Enable hooks** decides whether new conversations run hook packages. **Enable workbenches** turns all of the agent's workbenches off or back on at once.
- **Installed plugins** has one row per plugin, with what it brought (for example "3 skills, hooks, 1 workbench") and its status: **Installed**, **Update available**, **Incomplete** when a part is missing, or **Not in library** when an admin removed the plugin from the library. **Update** installs the library's copy again, which also brings back a missing part. **Uninstall** removes all of the plugin's parts at once, after a confirmation that lists them. Select a row to see its parts.
- **Not from a plugin** lists the Skills, hook packages and workbenches you made or imported yourself.

A Skill belongs to a plugin when its name matches a Skill the plugin ships, so a Skill you wrote under such a name is listed under that plugin and goes with it when you uninstall it. A plugin's MCP servers are listed by name with what they still need, such as vault keys; edit them on the **Tools** tab.

If some part cannot be removed, the message names it and the rest are removed anyway. An agent on a machine that runs an older version cannot uninstall a whole plugin; update the machine on the **Machines** page first.

### Skills and hook packages

A Skill's row shows its name, short description and version, with **Export** and **Uninstall**. A hook package's row also shows the hook points it runs at. See [Manage an agent's Skills](/skills#manage-an-agents-skills) and [Hook packages](/skills#hook-packages).

### Workbenches

A workbench's row, including one that failed to load, is led by its App Center icon when it has one. **Open** opens it beside a new chat, and its **More** menu (⋯) can **Reload** it, list its **Version history** to **Restore** an earlier version, **Export** its source as a zip, or **Remove** it. Its two switches say what they are: **Enable** and **App Center**; selecting the word beside a switch flips it too.

- The **Enable** switch turns a workbench off without deleting anything. It leaves the chat page and the App Center, its pages stop opening, and its data and versions stay. **Version history**, **Restore**, **Export** and **Remove** still work. While **Enable workbenches** is off, every workbench is off and its own switch is greyed at the value it returns to. An agent on a machine that runs an older version shows no switches.
- **Version history** lists up to 50 versions, newest first. **Restore** makes the workbench's source exactly that version and reloads it at once; its data (`state.json`) stays.
- **Remove** deletes the workbench and its data. Its earlier versions are no longer listed, even if a workbench with the same id is made again. A folder deleted by hand instead keeps its versions listed for the next workbench with that id. Uninstalling the plugin a workbench came from deletes it the same way; to keep its data, turn it off instead.
- The **App Center** switch puts a shortcut to the workbench in the Project's [App Center](/web-app#the-app-center), or takes it off. It takes effect at once: it sets `penguin.appCenter.show` in the workbench's own `package.json`, leaving the rest of the file as it was, and the reload that follows is recorded as a version (a workbench that is off is not loaded). Agents on connected machines have no App Center switch, since the App Center lists this server's agents only.
- **Export** downloads the source as a zip with one top-level folder named after the workbench id. It never carries `state.json`, hidden files or `node_modules`, and imports back unchanged.
- **Import** › **Workbench** offers two ways. The recommended one: enter a web page, a GitHub repository or directory, a local path, an install command or a description in **Workbench source**, then select **Open a new chat**, or **Copy prompt** to use the prompt elsewhere. The agent reads every file, stops and tells you if anything looks unsafe, then installs the workbench on this agent and reloads it. The other way, under **Upload a workbench zip**, adds a workbench from a zip with `package.json` at its root, or inside exactly one top-level folder whose name is the workbench id. A zip that holds `state.json` at the top of the workbench, hidden files, `node_modules`, links, names git refuses or names Windows cannot use is refused before anything is written. If the agent already has a workbench with that id, you are asked before its source is overwritten; its data stays, versions that loaded can still be restored from **History**, and local edits that never loaded are lost. The workbench loads at once: a load that fails is reported with its error instead of the success message.

The switches, the **Skills prompt** and uninstalling a plugin are for the Project owner; members see the switches' state. Any member can import, update, export and remove parts. A workbench tab beside the chat offers **History** and **Remove** too. See [Workbench plugins](/skills#workbench-plugins).

## Memory tab

Memory lets an agent keep what it learns across Sessions. The agent saves what is worth keeping as it works, and you can ask it to remember something. **User memory** applies to all of the agent's Sessions; Workspace memory is kept separately for each Workspace.

- **Enable memory** turns memory on or off. It saves immediately. Turning it off only stops memory from entering the agent's context and from being prepared for new Sessions; it deletes nothing.
- If the system prompt template has no `{{MEMORY}}` placeholder, the tab says so. Select **Insert the {{MEMORY}} placeholder** to add it. This happens with agents created before memory existed.

The memories are grouped by scope: **User memory** first, then one group per Workspace. Select a group's header to collapse or expand it; the browser remembers the choice for each user, Project and agent.

### View, edit and delete memories

Each memory row has three buttons:

- **View** shows the memory's title, date, description and content in a side panel, or on narrow screens in a sheet from the bottom that opens at half or full height.
- **Edit** opens the **Edit memory** dialog. Describe the change in **What to change** (optional), then select **Open a new chat**. A new conversation with this agent opens with the prompt filled in; for a Workspace memory, it also uses that Workspace. Send the message, and the agent updates the memory file and its `MEMORY.md` index together.
- **Delete** deletes the memory after you confirm, and removes its line from `MEMORY.md`.

Memory content is changed through the agent in a chat, not edited in place.

### Scripts a memory keeps

A memory can keep scripts in a folder of its name. Its row then shows a paperclip with the number of files, and **View** shows them under **Files**, below the memory's content, each with its path, size and date. A file row has two buttons:

- **View** shows the file's folder path and its code, with line numbers, in the same side panel. **Back to** returns to the memory. A file over 512 KB, or one that is not text, is listed but not shown.
- **Delete** deletes the file after you confirm. What the memory's text says about it stays until the agent updates it.

Deleting a memory deletes its folder too; the confirmation says how many files go with it. Files have no **Edit**: ask the agent in a chat to change one. Every later Session of the agent may run its scripts, so look at one before you rely on it. See [Scripts](/configuration#scripts).

A folder with no memory of its name beside it, usually left behind when its memory was deleted, belongs to no memory. Its files are listed at the bottom of the group under **Files without a memory**, with the same two buttons.

### Add a memory

1. On a group's header, select **Add**. The **Add memory** dialog opens.
2. In **Content or source to remember**, paste the content, or a file path or URL.
3. Select **Open a new chat**, then send the message. The agent organizes the content into memories in that group.

### Export and import memories

- **Export** on a group's header downloads the group's folder as a zip: `MEMORY.md`, every memory and the files each keeps, as the files they are on disk. The file name includes the export date and time, so repeated exports do not overwrite each other.
- **Import** on a group's header reads such a zip back into the group. A JSON file exported by an earlier version still imports. Only the Project owner can import.

When you import, choose what happens when the group already has a memory with the same name:

| Option | Result |
| --- | --- |
| **Keep the one that is here** (default) | Adds only what the group does not have. Nothing is lost |
| **Take the file's version** | Replaces same-named memories, their files included. Memories the file does not carry are left alone |
| **Replace the whole group** | Deletes every memory the file does not carry, with its files, and every folder that belongs to no memory |

If the import would overwrite or delete memories, or replace the group's `MEMORY.md`, a **Confirm the import** dialog lists what changes first.

A memory moves with its files: the folder of a memory taken from the file holds exactly the file's files afterwards. A folder that belongs to no memory counts as its memory being in the group already.

A zip exported now cannot be imported into a server from before: that server takes only the JSON file and refuses it.

### Memory prompts

Under **Memory prompt**, edit the text that the `{{MEMORY}}` placeholder expands to:

- **Main prompt** (`memory.prompt`) is injected into every Session.
- **Workspace addendum** (`memory.workspace_prompt`) is injected only into Sessions with a persistent Workspace.

The prompts can use `{{USER_MEMORY_INDEX}}` (the user `MEMORY.md` index), `{{WORKSPACE_MEMORY_INDEX}}` (the Workspace `MEMORY.md` index) and `{{WORKSPACE_MEMORY_DIR}}` (the current Workspace's memory folder). The last two work only in the workspace addendum. Each index is cut at 200 lines and 25,000 characters.

The memory count on the agent's card opens this tab.

## Vault tab

The vault holds environment variables for the agent, such as API keys. PenguinHarness passes them to the agent's shell commands, and gives an MCP server only the ones its entry references as `${KEY}`. The model sees the variable names, never their values. Subagents use their own vaults and do not inherit this one. Changes take effect from the next Task; a Task that is already running is not affected.

Only the Project owner can change the vault. Members see the variable names with masked values.

### Add a variable

1. On the **Vault** tab, select **Create manually**. The **Add variable** dialog opens.
2. In **Name**, enter the variable name, for example `OPENAI_API_KEY`. Use letters, digits and underscores, not starting with a digit.
3. In **Value**, enter the value.
4. Select **Add**. If the variable already exists, confirm to overwrite its value.

To delete a variable, select **Remove** on its row and confirm. The value cannot be recovered.

### Add variables with AI

**Create with AI** opens **Add secrets with AI**. Describe the variables you need, or pick an example: **Find the keys this agent needs**, **Reset an expired token** or **Connect an internal service**. Then select **Edit in a new conversation** and send the prompt. The Project's default agent writes the variables with `penguin config vault set`.

> [!WARNING]
> A secret value you type into this dialog is sent to the model provider, recorded in the conversation's Trace, and shown again in the command the agent runs. The safer way is to let AI create only the variable names and explain what each is for, then fill in the values on the **Vault** tab yourself.

### Vault prompt

- **Enable vault** controls whether the vault section enters the system prompt. With it off, the variables still reach the agent's commands.
- **Vault prompt** is the text that the `{{VAULT}}` placeholder expands to. Its `{{VAULT_KEYS}}` placeholder lists the variable names, one per line.

## Schedules tab

A scheduled task sends a prompt to the agent on a schedule: once, or every period. Changes made on this tab take effect immediately.

> [!NOTE]
> Scheduled tasks fire only while the PenguinHarness service is running.

You can also create and manage scheduled tasks from a conversation; see [Scheduled tasks](/schedules).

### Create a scheduled task

Only the Project owner can create a task manually.

1. On the **Schedules** tab, select **Create manually**. The **New scheduled task** dialog opens.
2. In **Name**, enter the task's file name, without `.toml`. You cannot change it later.
3. In **Period**, enter how often the task runs, such as `30m`, `12h` or `7d`. Leave it empty for a one-off task. The shortest period is 5 minutes.
4. Set **Start at**, and optionally **End at**. A one-off task needs a **Start at** that is still ahead, and **End at** cannot be in the past.
5. Under **Target**, choose where the prompt goes:
   - **New session each time**: every run starts a new Session. Optionally choose a **Model** (the Project default if you choose none) and a **Workspace** (a temporary Workspace if you choose none).
   - **Bound Session**: every run goes to one existing Session. Choose it in **Session**.
6. In **Prompt**, enter what to send.
7. Leave **Enabled** selected to activate the task, then select **Create**.

To create a task by describing it instead, select **Create with AI**, or pick one of the **Suggestions** shown when the list is empty: **Daily brief**, **Weekly review**, **Follow-up reminder** or **Monitor for updates**. Then select **Edit in a new conversation** and send the prompt. The Project's default agent creates the task for this agent. Any member can use **Create with AI**.

### Manage scheduled tasks

The table shows each task's **Name**, **Status**, **Period**, **Target**, **Next / last fired** and **Queue**. The status is **Active**, **Disabled**, **Expired**, **Done**, **Missed** or **Invalid**; point at **Invalid** to see why. Done, missed and expired tasks are archived and soon leave the table; see [Finished tasks are archived](/schedules#finished-tasks-are-archived).

On each row, the owner can select **Disable** or **Enable**, **Edit**, or **Delete**. Files that cannot be parsed are listed under **Files that failed to parse (skipped by the scheduler)**.

### Schedules prompt

- **Enable schedules** controls whether the scheduled tasks section enters the system prompt. With it off, tasks still run.
- **Schedules prompt** is the text that the `{{SCHEDULES}}` placeholder expands to. It teaches the model to manage scheduled tasks with its file tools, and its `{{SCHEDULE_LIST}}` placeholder lists the task names.

## API tab

The **API** tab lets programs outside PenguinHarness talk to the agent over HTTP: **Enable API access**, the **Approval mode for API conversations**, the **Base URL** and **Agent ID** under **Connection**, the **Keys**, **Allow keyless access**, **Examples** of a call, and, for the Project's owner, **Try it**, which runs the agent once through the API and shows the stream a program would receive. There is no **Save** button: the switches and the approval mode apply when you change them, and turning the API off or deleting a key asks first. To set it up and call the agent, see [Agent API](/agent-api).

## How it works

An agent's configuration and data live in its Agent State, the `agent_state/` folder that the Overview tab shows as **State path**. It holds `system_config.yaml`, `AGENTS.md`, the vault, tools, Skills, hook packages, workbenches, scheduled tasks and memories. The agent's Traces are stored next to it, in the agent's own folder; see [Data layout](/sessions-and-traces#data-layout).

- Memories are files under `agent_state/memory/`, with a `MEMORY.md` index for each group. For how memory is stored, see [Memory](/configuration#memory).
- Vault variables are stored in `agent_state/.vault.toml`. For the file format, see [Vault](/configuration#vault).
- Scheduled tasks are stored as TOML files under `agent_state/schedule/`, which you can also edit by hand. For the file format, see [Schedules](/configuration#schedules).
- Workbenches are folders under `agent_state/workbenches/<id>/`. Their versions are commits in `agent_state.git/`, a bare git repository the server keeps beside `agent_state/`. See [Workbench plugins](/skills#workbench-plugins).
