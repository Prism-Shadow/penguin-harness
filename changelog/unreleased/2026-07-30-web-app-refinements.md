# Web App: one name per navigation entry, one update row, one panel width, and a fixed-height example shelf

A pass over the surfaces you touch on every visit. Navigation entries settle on a single name each, the user menu's three update rows collapse into one, the two docked panels stop behaving like two different panels, Project display names become editable, and the draft page's examples become a fixed-height shelf that can keep growing.

## Navigation entries have one name each

The sidebar, the collapsed rail and the page titles had drifted apart — the rail said 智能体 where the pinned nav said 智能体仓库, and English mixed Costs with Trajectory. Each entry now has exactly one name per locale, used everywhere:

| | |
| --- | --- |
| 新建对话 / New chat | 智能体 / Agents |
| 技能库 / Skills | 模型库 / Models |
| 成本中心 / Cost Center | 轨迹观测 / Trajectories |
| 评估中心 / Evaluation Center | |

The rail-only `nav.railAgents` string is gone, since both dictionaries now word the entry the same way as the pinned nav.

## The sidebar's "New chat" stops colliding with the scrolled list

Scrolling the sidebar slid nav entries right up against the pinned "New chat" button, the two labels touching. The gap below the button was padding *inside* the scroll container, so it belonged to the scrollable content and travelled away with it. It now belongs to the pinned block, which keeps it at every scroll offset — the same text-to-text rhythm two adjacent nav rows have.

## One update row instead of three

At worst the user menu stacked a release-notes link, an admin "Update now" row and a "Check for updates" row on top of each other. There is now a single row with two states: it reads "Check for updates" and runs the manual check until a newer release is known, then names that version with a leading accent dot and opens the update dialog. The superscript badge beside the version number is gone — the label already names the new version.

The dialog absorbed what the rows carried: it now shows the release-notes link, and offers the self-update only to admins. Non-admins see the same version and link, read-only, instead of an action the endpoint would refuse.

## The two docked panels behave as one panel

The Workspace files panel and the Agents panel are mutually exclusive — opening one closes the other — so to the eye they are a single right-hand panel that swaps its content. They now behave like one:

- **One width.** Dragging either panel resizes the other immediately and persists as a single layout preference. A width stored under either previous per-panel key is adopted once, taking the wider of the two so the merged panel never comes out narrower than either panel had been.
- **A wider default**, ~40% of the window rather than ~1/3 (the cap is unchanged at half the window, 720px ceiling). One panel now has to hold a subagent transcript as well as a file tree, and the transcript is the demanding tenant — a third of the window renders it as a narrow column of wrapped tool output.
- **One visibility rule.** An open panel survives switching conversations; starting a **new chat** is the single point that closes both, so a Session created from the draft begins with neither open. This retires the Agents panel's task-scoped auto-close, which had been the one deliberate divergence between the two. The panel keeps its auto-open on the current Task's first live subagent spawn; task boundaries now only re-arm that attempt rather than closing anything.

## The Agents panel says what a subagent was sent to do

The call graph named each child's Agent but never its assignment, so a child transcript opened with no account of its own purpose. The spawning `run_subagent` call's model-written `description` now trails the graph's section title, truncated to one line with the full text in the tooltip, and is appended to each node's tooltip. It is absent — rather than blank — for the root, for a child with no spawning card in the stream, and when the model omits it or the tool has `call_description: false`.

## Project display names are editable

The Project settings dialog showed the display name as static text; renaming meant recreating the Project. The owner can now edit it (`PATCH /api/projects/:projectId`, writing `name` into `project_config.toml` and preserving everything else in the file). The id stays immutable — it names the directory, the Workspace paths and every stored reference — and now sits below the field as a muted caption. Members see the name read-only.

## The draft page's examples become a fixed-height shelf

Three example cards took a fixed slice of the page and left nowhere to add a fourth. They are now two bookmark-style folders, **搭建网页应用 / Build web apps** and **搭建和优化智能体 / Build and optimize agents**, with exactly one open at all times: selecting a folder closes the previous one, and the open folder cannot be collapsed. The block is therefore a constant height — two folder rows plus one folder's rows — so nothing below it shifts as you switch folders, and no scrollbar is ever needed inside a six-line showcase.

Each example is a single-line title now, with its one-sentence description moved into the row tooltip and its icon moved onto the folder row, which is what you actually scan to pick a category.

Two additions to the catalogue:

- **A mini-game center built by multiple agents** — ten games with no two sharing a mechanic, each a single-file `games/<slug>/index.html`, built in parallel by subagents behind one index page.
- **The Claude Code docs RAG agent** example now calls out query/corpus language matching. The docs are English while questions are often Chinese, and with a lexical retriever such as BM25 a Chinese query must be bridged to English first — otherwise not a single term matches and retrieval silently degrades to nothing rather than failing. Its self-test now covers one Chinese and one English question.

## Evaluation Center

The case rows and the statement preview both printed "Max 100". The scale is not the UI's to assert — a benchmark's total is defined by its own scoring rubric — so the label is gone along with its string. "View task" also stops rendering in the accent link color: the row itself is the button, so an accent-colored label inside it read as a second, separately clickable target. It now matches the Workspace download link's quiet gray, with hover feedback left to the row.
