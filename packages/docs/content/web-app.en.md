---
title: Web App
description: Sign in to the Web App, find your way around, manage Projects and members, and run the app in production.
---

PenguinHarness ships with a Web App: multi-user sign-in, streaming chat, agent configuration, and model and usage management all happen in the browser. The desktop app shows the same interface in its own window. This page is the overview; each part of the app has its own guide. For installation and first launch, see the [Quickstart](/quickstart).

- To sign in for the first time, see [Open the Web App and sign in](#open-the-web-app-and-sign-in).
- To find your way around, see [The app layout](#the-app-layout).
- To set up a Project or its members, see [Projects and members](#projects-and-members).
- To let an agent fill in a form for you, see [Create with AI or manually](#create-with-ai-or-manually).
- To run the app for a team, see [Production deployment](#production-deployment).

## Open the Web App and sign in

Start the service from a terminal:

```bash
penguin web
# opens http://localhost:7364
```

`penguin web` starts the service, waits until it is ready, prints the URL, and opens your browser. Add `--no-open` to skip opening the browser. `penguin server` starts the same service without opening a browser. See [penguin server / penguin web](/cli#penguin-server-penguin-web).

> [!NOTE]
> On a local-only server, the app lives at `localhost`. The `127.0.0.1` address is reserved for previews of files the agent writes, and forwards you to `localhost`.

### Sign in for the first time

The initial account is `admin`, and it starts with no password of its own. Until you set one, the server prints a first-login link in a framed notice on every start. Opening the link signs your browser in.

1. Start the server with `penguin web`.
2. Find the framed notice in the server output. It contains the first-login link.
3. Open the link in your browser. You are signed in as `admin`.
4. Set a password: select **Change now** on the banner that appears, or go to **System settings** › **Account**. This first session needs no current password.

> [!NOTE]
> The link can be opened again. It lasts 30 days, or until a password is set. A restart prints a new link and the old one stops working. A link that no longer works lands on the login page with an explanation.

The desktop app does not print the notice. The server also skips it while a password pinned with `PENGUIN_SEED_ADMIN_PASSWORD` still works. For how these mechanisms are secured, see [Security](/security).

### Accounts

The login page asks for a **Username** and a **Password**, and has language and theme switches in its corner.

There is no self-registration. An admin creates accounts on the **Users** page of System settings. Every new user automatically gets an independent initial Project named `<userId>-default_project`.

While the initial password is still in use, a banner prompts the user to change it, with a **Change now** link. Closing the banner hides it for good.

After five failed sign-in attempts, the server makes you wait. The wait starts at one second and doubles, up to a minute.

### Passwords

A forgotten password is reset by the admin on the **Users** page, with **Reset password**.

A forgotten **admin** password is reset offline:

**Before you begin**

- The server is stopped.

1. Run `penguin server reset-admin-password`.
2. Start the server again.
3. Open the first-login link from the framed notice, and set a new password.

The command gives the admin account a new random password that nobody sees, and ends every admin session. The next start prints the first-login link again.

### Sign-in sessions

Logins persist for 30 days with sliding renewal: using the app renews the full 30 days.

An admin password reset invalidates all of that user's login sessions. Changing your own password keeps your current session.

**Sign out** is in the account menu and asks for confirmation first. It ends the session in this browser. Conversations that are running keep going on the server.

> [!NOTE]
> The desktop app signs its own window in by itself as the admin, with no password. That window has no **Sign out**, no initial-password banner, no **Account** page and no user management.

## The app layout

The sidebar on the left holds everything that is not a conversation. The rest of the window shows the page you open. Each part of the app has its own guide.

### The sidebar

From top to bottom, the sidebar holds:

- The **Development** / **Company** switch, only when company mode is available: an admin has enabled it for the server, and you have not turned it off for yourself. Company mode swaps the page entries below for an organization's pages, and the conversation list for its channels. See [Company mode](/company-mode).
- The Project switcher, with the **Collapse sidebar** button beside it. See [Projects and members](#projects-and-members).
- **New chat**, which opens a new conversation draft. See [Chat](/chat).
- The page entries. The chevron under the last one folds them away:

| Entry | What it is for | Guide |
| --- | --- | --- |
| **Agents** | Create agents and edit their prompt, memory, runtime, tools, Skills, hooks, Vault and scheduled tasks | [Agents](/agents) |
| **Plugins** | Browse plugins, install their Skills and hook packages onto agents, and add server plugins to the Project | [Skills](/skills) |
| **Models** | Configure the Project's models, providers and credentials | [Models](/models) |
| **Cost Center** | Token usage, cost and server errors by agent, model and time range | [Cost Center](/usage) |
| **Evaluation Center** | Benchmarks: evaluate agents and optimize them against a Benchmark | [Evaluation Center](/evaluation-center) |

- The conversation list, with search and grouping by Workspace, agent or time. See [Chat](/chat).
- Your user row at the bottom. It opens the account menu:
  - **System settings**. See [Settings](/settings).
  - The update row, which names where an update stands and opens the update dialog. See [Updates](/updates).
  - **Sign out**.

### Notification dots

A dot on a page entry means something is waiting there:

| Entry | What the dot means |
| --- | --- |
| **Agents** | Agents on an outdated kernel |
| **Plugins** | Plugin updates |
| **Models** | Preset models to sync (shown to owners) |
| **Cost Center** | Unexpected errors |

A dot on your avatar means a software update. Pointing at an entry names what is waiting.

### The collapsed rail and narrow windows

**Collapse sidebar** shrinks the sidebar to a narrow rail of icons: **Expand sidebar**, the company mode toggle when available, **Last conversation**, **New chat**, the page entries, and your avatar, which opens the same account menu. Pointing at an icon, or focusing it, shows its name. The choice is remembered in the browser.

On a narrow window, the sidebar hides behind a menu button in a top bar and opens as a drawer.

### Trajectories and Machines

Two parts of the app have no sidebar entry.

**Trajectories** is a side panel of the chat page, not a page of its own. It shows the open conversation's Trace files, with a summary, per-turn statistics, an execution timeline, and the individual events. **Export** downloads a file. See [Chat](/chat).

**Machines** installs this PenguinHarness build on other hosts over ssh, choosing from the server account's `~/.ssh/config`. It is not offered in the sidebar in this release. An admin can reach it at `/machines`.

### Language and theme

The interface language (English / 中文 / System) and the theme (Light / Dark / System) can be switched at any time in [System settings](/settings), and on the login page. Both are saved per browser.

## Projects and members

A Project holds its agents, models, Benchmarks, and conversations. The Project switcher at the top of the sidebar lists the Projects you own or belong to, each with its role (`owner` or `member`), and switches between them. The same menu has **New Project** and **Project settings**.

### Create a Project

Any signed-in user can create a Project and becomes its owner.

1. Open the Project switcher at the top of the sidebar.
2. Select **New Project**.
3. In **Display name**, enter an optional display name. If you leave it empty, the id is shown.
4. In **Project id**, enter an id, or select **Generate with AI** beside the field to derive one from the display name. The current Project's default model writes the proposal, since a Project is not inside a Project.
5. Select **Create**. You are now the Project's owner.

The id is 2–64 characters long. It starts with a lowercase letter and uses only lowercase letters, digits, and underscores. For a user other than the admin, it starts with the username and a hyphen, and only the part after that prefix is typed.

> [!NOTE]
> The Project id cannot be changed later.

### Project settings

**Project settings** has four pages:

| Page | Contents |
| --- | --- |
| **General** | The display name, the **Project ID**, and **Delete Project**, which removes the Project's directory recursively and cannot be undone |
| **Members** | Who belongs to the Project, and with what role. The owner adds an existing user by username (**Add member**) and removes members (**Remove**). Not in the desktop app. |
| **Defaults** | **New chat defaults**: the agent, working directory, approval mode, thinking level and default model that every new chat starts with |
| **Security policy** | Command policy rules. A command matching an enabled rule is refused, whatever the approval mode. See [Command policy](/configuration#command-policy) |

### Roles

Members have two roles: `owner` and `member`. A Project has one owner, its creator. There is no role change and no ownership transfer. Being an admin grants no access to other users' Projects.

The owner alone can:

- Rename or delete the Project, manage its members, and change **Defaults** and **Security policy**. Members see these pages read-only.
- Change models, Vault, and scheduled tasks.
- Create and delete Benchmarks, delete agents, clear Cost Center errors, and set up remote control.
- Import agent snapshots, memory, and Traces.

Members can still create agents and conversations, and delete conversations, Skills, hook packages, and memory files.

> [!NOTE]
> `default_project` is shared with the CLI and cannot be deleted from the Web App. The last Project of an account cannot be deleted.

## Create with AI or manually

Many things the Web App creates from a form can also be described to an agent instead. Those places offer two buttons side by side: **Create with AI**, with the magic wand, and **Create manually**, with the hand.

| What you can create | Where |
| --- | --- |
| An agent | The Agents page |
| A model group | The Models page |
| A Benchmark | The Evaluation Center |
| A vault secret | An agent's Vault tab |
| A scheduled task | An agent's Schedules tab, or a conversation's Scheduled tasks panel |

Some of these are for Project owners only:

- The Models page and the Vault tab: both buttons are for owners only.
- Scheduled tasks: **Create manually** is for owners only.

The prompt box comes with clickable examples that fill the draft. When the page adds fixed instructions to what you type, a folded **Full prompt** preview shows them, with **Copy prompt**.

There is one way out: **Edit in a new conversation**. It opens a new conversation with the Project's `default_agent`, or the first agent when there is none, and prefills the composer with the prompt. Whether to send it is yours to decide.

- The prompt survives a reload of that new-chat page.
- Leave the page without editing or sending it, and the prompt is dropped. It cannot resurface in a later conversation.
- Type into it, and it becomes an ordinary draft, kept like anything else you write.

The Scheduled tasks panel is the exception. Its way out is **Edit in this conversation**, which fills the current conversation's composer. See [Scheduled tasks](/schedules).

## Production deployment

The server hosts the built SPA itself, on the same origin and with SPA fallback. A single `penguin web` or `penguin server` process is all production needs.

The npm package bundles the frontend build. To serve a custom static directory instead, override it with `PENGUIN_WEB_DIST`. See the [Configuration Reference](/configuration).

The server listens on `127.0.0.1` by default, so it answers only on its own machine. Exposing it on a network, with `HOST`, belongs behind a reverse proxy that terminates TLS. See [Security](/security).
