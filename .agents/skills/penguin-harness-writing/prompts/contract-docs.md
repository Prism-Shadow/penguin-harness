Output contract (the file is published as-is on the docs site):
- Begin with this frontmatter, nothing before it, values unquoted:
  ---
  title: <the page's name, a short noun phrase>
  description: <one sentence saying what the page lets the reader do>
  ---
- Then an opening paragraph saying what the page covers and who it is for, optionally followed by a short list of links to the page's sections for the common tasks.
- Sections are headed with `## `, subsections with `### ` where a task has parts. Headings name the task or the thing ("Send a message", "Limits"), never a number.{{BUDGET_RULE}}
- Steps are a numbered list, one action per step, each starting with where to act and what to select. UI labels are in bold and spelled exactly as TERMS gives them for this language.
- Links to another docs page are absolute doc paths, e.g. `[Chat](/chat)`; a link to a section of this page uses its heading's anchor, e.g. `[Send a message](#send-a-message)`.
- Notes and warnings are GitHub-style callouts: a line `> [!NOTE]`, `> [!TIP]` or `> [!WARNING]` followed by `> ` lines. No other callout syntax, no HTML, no emoji.
- Code spans, commands, file paths, numbers, defaults and limits are copied from FACTS byte for byte.
- {{MARKER_RULE}}
- Return the Markdown only. No preamble, no commentary, no fence around the document.
