---
name: task-manager
description: "See the tree of what runs right now in a Project — the pages, the Sessions each page opened and their Token cost, and each process's CPU and memory — through the server's own /api/me/tasks. Use it when the user asks what is running, what an app costs, or which process is taking memory."
version: 2026.11.23.1
---

# Task Manager

The Task Manager reads one tree: **page → session → processes**. A page is an Agent Workbench page, and a Session is that page's because it records the page's id as its source. Each page carries the Token cost of every Session it opened, and each process carries its CPU and memory as the server last measured them.

The same tree is the app's **App Center › Task Manager** page. This Skill is how you read it from a shell.

## Before you start

If the user only invoked this skill, ask what they want to know: what is running, what one page costs, or which process uses the most memory. Then read the tree once and answer from it.

## Read the tree

The server answers the tree at `/api/me/tasks`, under the person whose credential you carry. Inside an agent session the environment already names the server and the token:

```bash
curl -s "$PENGUIN_API_URL/api/me/tasks" -H "Authorization: Bearer $PENGUIN_API_TOKEN" | jq .
```

`jq` may not be installed; without it, pipe to `python3 -m json.tool` instead.

The answer:

```jsonc
{
  "at": "2026-11-23T15:31:02.114Z",   // when the server assembled it
  "tokens": { "cacheRead": …, "cacheWrite": …, "output": …, "total": …, "requests": …, "cost": 0.42 },
  "pages": [
    {
      "pageId": "page-2026-11-23-15-01-04-9f3c1a2b",  // the id the page's Sessions record
      "workbenchId": "tickets",
      "workbenchName": "Tickets",
      "projectId": "…", "agentId": "…", "agentName": "…",
      "tokens": { … },
      "sessions": [
        {
          "sessionId": "session-…", "title": "…", "status": "running",
          "createdAt": "…", "lastActiveAt": "…",
          "tokens": { … },
          "processes": [
            { "processId": "…", "pid": 4821, "cmd": "npm run dev", "cwd": "…",
              "startedAt": "…", "running": true, "serviceUrl": "http://localhost:5173",
              "cpu": 12.5, "memory": 183500800 }   // percent of ONE core; bytes resident
          ]
        }
      ]
    }
  ]
}
```

## Reading it

- **Only what runs.** A page with no Session yet is not in the tree, and a Session opened by something other than a page (a person's chat, a schedule, the CLI) is in no page — it is not this tree's.
- **Tokens are the page's Sessions'**, summed over every model each ran: `total` is what the provider counted, `cacheRead` and `cacheWrite` the prompt cache, `output` the answer. Tool requests are counted apart by the Cost Center, not here.
- **`cost` is the account's own price** for those Sessions; `null` means a model they ran has no price, so the number would be a lower bound — say so rather than quoting it.
- **`cpu` and `memory` are the moment's**, taken as two samples of `/proc` a fraction of a second apart when the answer was assembled: `cpu` is a share of ONE core, so `100` is one core busy and `null` means the process could not be measured (it exited, or this server is not on Linux). `memory` is the resident set in bytes, `null` for the same reasons.
- **`status`** is the Session's own: `running` and `compacting` mean it is working, `idle` that it is not.

## Answering

Lead with the answer to what was asked. For "what is running", one line per page with its Session count and Tokens; for "what costs most", the pages or Sessions by `tokens.total`; for "what takes memory", the processes by `memory`. Quote the figures as the answer gives them, and say when `cost` or a process's `cpu`/`memory` is `null` and why.

Do not start, stop or kill anything from this Skill: it reads. A process is stopped from the conversation that started it, and a Session from the app.
