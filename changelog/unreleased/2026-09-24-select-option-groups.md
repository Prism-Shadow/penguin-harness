# Dropdowns show grouped options

- **Date:** 2026-09-24
- **Type:** fix
- **Scope:** `web`

The app's dropdown read only the options placed directly inside it, so one that grouped
its options under headings showed nothing and could not be opened to a choice. The
activity editor's **Generation agent** picker, which groups Penguin agents and coding
agents, was empty because of it. Grouped options now appear under their group's heading,
and a group with no options gets no heading.
