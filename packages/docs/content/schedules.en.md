---
title: Scheduled tasks
description: Have an agent run a prompt on a schedule in a conversation, and manage those tasks from the conversation's Scheduled tasks panel.
---

A scheduled task sends a prompt to an agent at a set time, once or on a repeating period. A task bound to a conversation sends its prompt into that conversation, so the agent works with everything the conversation already holds. You create and manage these tasks in the conversation's **Scheduled tasks** panel.

> [!NOTE] Tasks that start a new Session
> A scheduled task can instead open a new Session each time it runs. You create those on the agent's settings page, which lists all of that agent's scheduled tasks, including the ones bound to conversations. See [Agents](/agents).

- To see a conversation's tasks, see [Open the Scheduled tasks panel](#open-the-scheduled-tasks-panel).
- To add a task, see [Create a task with AI](#create-a-task-with-ai) or [Create a task manually](#create-a-task-manually).
- To pause, change or remove a task, see [Turn a task on or off](#turn-a-task-on-or-off) and [Edit or delete a task](#edit-or-delete-a-task).

## Open the Scheduled tasks panel

The panel is one of the side panels of the chat page. It is available once the conversation has started: in a draft, it asks you to send the first message first.

1. Open the conversation.
2. In the top-right corner of the chat toolbar, select **Right sidebar** or **Bottom panel**. You can also use the **Shortcuts** launcher on the conversation's right edge.
3. Choose **Scheduled tasks**. If the side panel already shows other panels, select **Add panel** first.

The panel lists the tasks bound to this conversation. The search box matches a task's name and its prompt. The filters are **All**, **Active**, **Paused** and **Completed**; **Completed** covers tasks that are done, expired or missed. Each row shows a state icon, the task name and its schedule in plain words, for example:

- "Every day at 08:00 · Next: tomorrow 08:00"
- "Every 30 minutes"
- "Every Monday at 09:00"
- "One-off · Sep 3, 10:00"

When a task fires while the conversation is still working, its prompt waits and is sent once the conversation is idle. Until then, the row carries a **Queued** badge. A task queues at most one run: further fire times during the wait do not stack up.

A task whose file cannot be used, for example because its conversation was deleted, shows under **All** only. Its row reads **Invalid**, and pointing at the red icon shows the reason.

## Create a task with AI

Any member of the Project can create a task this way. The agent of this conversation creates the task and confirms the time it set.

1. In the panel, under the title, select **Create with AI**.
2. Describe what to schedule and when.
3. Select **Edit in this conversation**. The prompt appears in this conversation's composer.
4. Review the prompt, and send it when you are ready.

Nothing is sent until you press Send, and sending works like any message you type. The prompt goes into this conversation rather than a new one because a task created from inside a conversation is bound to that conversation.

### Start from a suggestion

Below the list, **Suggestions** offers four ready-made requests: **Daily brief**, **Weekly review**, **Follow-up reminder** and **Monitor for updates**. Select one to open the AI dialog with that request filled in, then continue from step 2. The suggestions are hidden while the search box has text.

## Create a task manually

**Before you begin:** only a Project owner can create a task manually.

1. In the panel, under the title, select **Create manually**.
2. Fill in the form. It is the same form as on the agent's settings page, with **Target** set to **This conversation**:
   - **Name** (required): the task's file name. It cannot be changed later.
   - **Period**: `30m`, `12h`, `7d` and so on. Leave it empty for a one-off task.
   - **Start at** (required) and, optionally, **End at**.
   - **Prompt** (required): what to send to the agent.
   - **Enabled**: whether the task is on.
3. Select **Create**.

## Turn a task on or off

**Before you begin:** only a Project owner can turn a task on or off.

In the panel, use the switch on the task's row. The change takes effect at once: a scheduled task fires on the scheduler's clock, independent of any conversation's context.

## Edit or delete a task

**Before you begin:** only a Project owner can edit or delete a task.

1. In the panel, open the **More actions** menu on the task's row.
2. Select **Edit**, or select **Delete** and confirm.

## The alarm clock mark

In the sidebar's conversation list, a conversation shows an alarm clock icon while it has a bound task that still has a next fire time. The mark appears whichever agent the conversation belongs to and however the list is grouped. It shows no count.

A task has no next fire time when it is switched off, when it is past its end time, or when it is a one-off that has already run.

## When the list refreshes

The panel's list refreshes:

- When the panel comes to the front.
- When the window regains focus.
- When a task fires or is queued.
- When a conversation turn finishes.
- Every 30 seconds while the panel is visible.
- After every change.

The alarm clock mark reads the same list and refreshes with it, so the mark and the panel always agree.

## Limits

- A repeating task runs at most once every 5 minutes: the shortest period is 5 minutes. A shorter period makes the task invalid.
- Tasks run only while the PenguinHarness service is running.
- Missed runs are not made up. When a fire time passes while the service is stopped, a repeating task skips it and a one-off task is marked missed.

## How it works

Each task is a TOML file under the agent's `agent_state/schedule/` directory. The file format is described in the [Configuration Reference](/configuration#schedules). The scheduler checks the files every 30 seconds, so a file you edit by hand takes effect at the next check.
