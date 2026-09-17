---
title: Agents
description: Create agents, and configure their prompts, tools, Skills, hooks, memory, vault and scheduled tasks.
---

An agent is a configured assistant in a Project. Each agent has its own instructions, runtime settings, tools, Skills, hook packages, memory, vault variables and scheduled tasks, stored together as its Agent State. You create agents and change their settings on the **Agents** page.

- To see the agents in a Project, see [The Agents page](#the-agents-page).
- To add an agent, see [Create an agent with AI](#create-an-agent-with-ai) or [Create an agent manually](#create-an-agent-manually).
- To change an agent, see [Agent settings](#agent-settings) and the section for each tab.
- To back up, move or reset an agent, see [Overview tab](#overview-tab).
- To delete an agent, see [Delete an agent](#delete-an-agent).

## The Agents page

In the sidebar, select **Agents**. The page lists every agent in the current Project. Use the search box (**Search agents: id / name / description**) to filter the list.

Every Project starts with the built-in agent `default_agent`. While it is the only agent, a card below it offers to create your first one: "No agent of your own yet".

Each agent card shows:

- the agent's name, its id, its Agent State version (for example `v3`) and its description;
- a row of counts: Sessions, tools, Skills, hook packages, memories, vault variables and scheduled tasks, plus when the agent was last modified. Select a count to open the matching settings tab;
- the agent's Session activity over the last 30 days;
- **New chat**, which starts a conversation with the agent; **Settings**, which opens its settings; an icon that opens its costs in **Cost Center**; and a delete button.

When a newer kernel is available for some agents, their cards show **Kernel update needed**, and a notice at the top of the page offers **Update now** and **Dismiss**. See [Update the kernel](#update-the-kernel).

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
- start from `default_agent`'s configuration, set the name and description, and write the agent's role and rules into its `AGENTS.md`;
- copy only the Skills the new agent needs from the plugin library, and leave every other agent untouched;
- report the new agent's id, the Skills it installed, and how to start a conversation with it.

The **Report-writing agent** example creates an agent with the id `report-writer`. The [Evaluation Center](/evaluation-center) has a matching Benchmark example, so you can go on to evaluate and optimize it.

## Create an agent manually

1. On the **Agents** page, select **Create manually**. The **Create agent** dialog opens.
2. Optional: in **Name**, enter a name. An empty name uses the agent id.
3. In **Agent id**, enter an id, or select **Generate with AI** beside the field to have the Project's default model derive one from the name, or from the description while the name is empty. An id is 2–64 characters long, starts with a lowercase letter, and uses only lowercase letters, digits and underscores. A proposal replaces what is in the box and stays editable. You cannot change the id later.
4. Optional: fill in **Description**.
5. Optional: in **Plugins**, select plugins from the plugin library to install on the new agent. Their Skills and hook packages are installed when the agent is created.
6. Optional: in **Import Skills from a project directory**, select a directory. PenguinHarness reads the Skills under its `.agents/skills` and `.claude/skills` folders; select the ones to install. If a Skill from the directory has the same name as a Skill from a selected plugin, the directory's Skill is installed.
7. Select **Create**. The new agent's settings open.

Any Project member can create an agent.

### Start from a snapshot

A snapshot package is an exported Agent State. You can create an agent from one, for example to copy an agent to another Project or another machine.

**Before you begin**

- A snapshot package (`.tar.gz`) of the agent you want to copy. A package can be up to 14 MB. To create one, see [Export and import a snapshot](#export-and-import-a-snapshot).

1. In the **Create agent** dialog, under **Initialize from a snapshot**, select **Choose a snapshot package** and pick the package. If **Agent id** is empty, it is filled in from the file name.
2. Leave **Name** and **Description** empty to keep the values in the package, or fill them in to replace them.
3. Select **Create**.

> [!NOTE]
> A snapshot package carries its own Skills and hooks. While a package is selected, **Plugins** and **Import Skills from a project directory** are hidden.

## Delete an agent

Only the Project owner can delete an agent. The built-in `default_agent` cannot be deleted.

1. On the agent's card, select the delete button (**Delete agent**).
2. Confirm.

> [!WARNING]
> Deleting an agent deletes its directory on the server, including all of its Traces. You cannot recover it.

## Agent settings

To open an agent's settings, select **Settings** on its card, select one of its counts, or select **Agent settings** on its group in the sidebar. The settings are organized into tabs:

| Tab | What you configure |
| --- | --- |
| **Overview** | Name and description, Agent State snapshots, kernel updates, and restoring the default configuration |
| **System Prompt** | `AGENTS.md` and the system prompt template |
| **Runtime** | Turn limit, output tokens, thinking level, timeout and context compaction |
| **Tools** | Built-in tool settings and MCP servers |
| **Skills** | Installed Skills and the Skills prompt |
| **Hooks** | Installed hook packages and the switch for running them |
| **Memory** | The agent's memories and the memory prompts |
| **Vault** | Environment variables for the agent's commands |
| **Schedules** | Scheduled tasks |

Each tab has its own address, `/agents/<agentId>?tab=<tab>`, where `<tab>` is `overview`, `prompt`, `runtime`, `tools`, `skills`, `hooks`, `memory`, `vault` or `schedules`.

### Save changes

On the Overview, System Prompt, Runtime and Tools tabs, and in each prompt section, select **Save** and confirm. The confirmation reads "Save these changes? They will be written to the configuration files on the server."

- Most changes apply to new conversations right away, and to running conversations after their next compaction.
- A Runtime change that touches only the context compaction fields takes effect immediately, including in running conversations.
- Switches such as **Enable skills** save as soon as you flip them, without the **Save** button.

For the file format behind these settings, see [Agent config](/configuration#agent-config).

### Who can change what

Any Project member can change most settings. These actions are for the Project owner only:

- deleting the agent and importing a snapshot;
- turning **Enable hooks** on or off;
- editing vault variables, the **Enable vault** switch and the **Vault prompt**;
- creating, editing, enabling, disabling and deleting scheduled tasks, and editing the **Enable schedules** switch and the **Schedules prompt** (members can still use **Create with AI**);
- importing memories.

## Overview tab

### Edit the name and description

Change **Name** or **Description**, then select **Save**.

### Export and import a snapshot

The **Agent State** section shows the agent's **Agent State version** and its **State path**, the folder that holds the Agent State on the server. Select the copy button to copy the path.

- **Export snapshot** downloads the Agent State as a `.tar.gz` package. The package leaves out the vault, so secrets never travel in a snapshot.
- **Import snapshot** replaces the whole Agent State with a package and adopts the version inside it, but keeps the agent's current vault. A snapshot of the current version is taken first. Only the Project owner can import. If the package's version is not newer than the current one, a **Version conflict** dialog asks you to confirm the overwrite.

For how versions and snapshots work, see [Self-Improvement](/self-improvement#snapshots-and-versions).

### Update the kernel

An agent's kernel version records which generation of the built-in default settings its configuration is based on. An existing agent never picks up newer defaults on its own. When PenguinHarness ships newer defaults, the **Kernel** section shows the current and the latest kernel version, and the Overview tab shows a red dot.

1. In the **Kernel** section, select **Update kernel**.
2. Confirm.

Tabs you have not customized are updated to the current built-in defaults. A tab you have edited stays unchanged in full and is listed in the result. The name, description, Agent State version and MCP servers are not affected. For the details, see [Kernel updates](/configuration#kernel-updates).

> [!TIP]
> To update several agents at once, select **Update now** in the notice at the top of the **Agents** page.

### Restore the default configuration

1. In the **Kernel** section, select **Restore default configuration**.
2. Confirm.

> [!WARNING]
> Restoring the default configuration cannot be undone.

The agent's configuration is overwritten with the current defaults: the custom system prompt, tool list, model and compaction settings, and MCP servers are all replaced. Only the name, the description and the Agent State version are kept.

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
   - For `stdio`: **command**; **args**, one argument per line; **env**, one `KEY=value` per line; and **cwd**, which defaults to the Session's Workspace. The agent's vault variables are not passed to MCP server processes.
   - For `http` and `sse`: **url**, and **headers**, one `Header-Name: value` per line, for example an `Authorization` header.
5. Choose **permission**:
   - **Auto (readOnlyHint)**: each tool is read-only if it declares the `readOnlyHint` annotation, and read & write otherwise.
   - **Read-only**: every tool of the server is treated as read-only.
   - **Read & write**: every tool of the server is treated as read & write.
6. Optional: adjust **connectTimeoutMs** (connecting and discovering tools, 10000 by default), **timeoutMs** and **maxOutputLength**, which apply to every tool of the server.
7. Optional: select **Test connection** to try the settings before you save. It reports the number of tools found and how long it took.
8. Select **Save**.

> [!NOTE]
> The permission level matters only in the read-only approval mode; the other approval modes ignore it. It does not restrict what the server can do: marking a server read-only only skips the confirmation that mode would ask for.

To change a server, select **Edit** on its row. To remove it, select **Remove** and confirm; its tools stop being available from the next Session. For more about MCP servers, see [MCP Servers](/tools#mcp-servers).

### Test MCP servers

1. In the **MCP Servers** section, select **Test connection**.
2. Select **Start test**.

PenguinHarness connects to each server in turn and discovers its tools. Nothing is saved. Each row shows the number of tools and the time taken, or **Connection failed** with the reason.

## Skills tab

The **Skills** tab lists the Skills installed on the agent. You can export or uninstall a Skill, import one with **Import skill**, turn the Skills section of the system prompt on or off with **Enable skills**, and edit the **Skills prompt**. See [Manage an agent's Skills](/skills#manage-an-agents-skills).

## Hooks tab

The **Hooks** tab lists the hook packages installed on the agent. You can export and uninstall hook packages, import one with **Import hook**, and turn hooks on or off for the agent with **Enable hooks**. Installing from the library happens on the **Plugins** page. See [Hook packages](/skills#hook-packages).

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

### Add a memory

1. On a group's header, select **Add**. The **Add memory** dialog opens.
2. In **Content or source to remember**, paste the content, or a file path or URL.
3. Select **Open a new chat**, then send the message. The agent organizes the content into memories in that group.

### Export and import memories

- **Export** on a group's header downloads every memory in the group, with the group's `MEMORY.md`, as one JSON file. The file name includes the export date and time, so repeated exports do not overwrite each other.
- **Import** on a group's header reads such a file back into the group. Only the Project owner can import.

When you import, choose what happens when the group already has a memory with the same name:

| Option | Result |
| --- | --- |
| **Keep the one that is here** (default) | Adds only what the group does not have. Nothing is lost |
| **Take the file's version** | Replaces same-named memories. Memories the file does not carry are left alone |
| **Replace the whole group** | Deletes every memory the file does not carry |

If the import would overwrite or delete memories, or replace the group's `MEMORY.md`, a **Confirm the import** dialog lists what changes first.

### Memory prompts

Under **Memory prompt**, edit the text that the `{{MEMORY}}` placeholder expands to:

- **Main prompt** (`memory.prompt`) is injected into every Session.
- **Workspace addendum** (`memory.workspace_prompt`) is injected only into Sessions with a persistent Workspace.

The prompts can use `{{USER_MEMORY_INDEX}}` (the user `MEMORY.md` index), `{{WORKSPACE_MEMORY_INDEX}}` (the Workspace `MEMORY.md` index) and `{{WORKSPACE_MEMORY_DIR}}` (the current Workspace's memory folder). The last two work only in the workspace addendum. Each index is cut at 200 lines and 25,000 characters.

The memory count on the agent's card opens this tab.

## Vault tab

The vault holds environment variables for the agent, such as API keys. PenguinHarness passes them to the agent's shell commands. The model sees the variable names, never their values. Subagents use their own vaults and do not inherit this one. Changes take effect from the next Task; a Task that is already running is not affected.

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
4. Set **Start at**, and optionally **End at**.
5. Under **Target**, choose where the prompt goes:
   - **New session each time**: every run starts a new Session. Optionally choose a **Model** (the Project default if you choose none) and a **Workspace** (a temporary Workspace if you leave it empty).
   - **Bound Session**: every run goes to one existing Session. Choose it in **Session**.
6. In **Prompt**, enter what to send.
7. Leave **Enabled** selected to activate the task, then select **Create**.

To create a task by describing it instead, select **Create with AI**, or pick one of the **Suggestions** shown when the list is empty: **Daily brief**, **Weekly review**, **Follow-up reminder** or **Monitor for updates**. Then select **Edit in a new conversation** and send the prompt. The Project's default agent creates the task for this agent. Any member can use **Create with AI**.

### Manage scheduled tasks

The table shows each task's **Name**, **Status**, **Period**, **Target**, **Next / last fired** and **Queue**. The status is **Active**, **Disabled**, **Expired**, **Done**, **Missed** or **Invalid**; point at **Invalid** to see why.

On each row, the owner can select **Disable** or **Enable**, **Edit**, or **Delete**. Files that cannot be parsed are listed under **Files that failed to parse (skipped by the scheduler)**.

### Schedules prompt

- **Enable schedules** controls whether the scheduled tasks section enters the system prompt. With it off, tasks still run.
- **Schedules prompt** is the text that the `{{SCHEDULES}}` placeholder expands to. It teaches the model to manage scheduled tasks with its file tools, and its `{{SCHEDULE_LIST}}` placeholder lists the task names.

## How it works

An agent's configuration and data live in its Agent State, the `agent_state/` folder that the Overview tab shows as **State path**. It holds `system_config.yaml`, `AGENTS.md`, the vault, tools, Skills, hook packages, scheduled tasks and memories. The agent's Traces are stored next to it, in the agent's own folder; see [Data layout](/sessions-and-traces#data-layout).

- Memories are files under `agent_state/memory/`, with a `MEMORY.md` index for each group. For how memory is stored, see [Memory](/configuration#memory).
- Vault variables are stored in `agent_state/.vault.toml`. For the file format, see [Vault](/configuration#vault).
- Scheduled tasks are stored as TOML files under `agent_state/schedule/`, which you can also edit by hand. For the file format, see [Schedules](/configuration#schedules).
