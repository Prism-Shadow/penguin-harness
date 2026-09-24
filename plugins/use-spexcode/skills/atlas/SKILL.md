---
name: atlas
description: Use when the user wants pictures of the spec tree — draw the atlas, 画规格图, give node X a diagram, 给这个仓库画架构图, diagram this subtree. Chooses the nodes worth a picture, draws each one's diagram.json with spex diagram scaffold and check until it passes, and commits them with a report of what was drawn and what was skipped.
---

# atlas

## Before you start

This skill draws with SpexCode's command line and needs nothing installed or configured on this machine.

- Run SpexCode through npx: `npx -y --registry=https://registry.npmjs.org -p spexcode spex <command>` (Node 22 or newer). Wherever a step below says
  `spex …`, run it that way; a `spex` already on the PATH works the same.
- A diagram draws one node of the repository's spec tree, the `.spec/` folder. If the repository has none,
  `spex init --pure --title <the project's name>` plants one and stops there: `.spec/spexcode.json` and a root
  `.spec/<name>/spec.md`, no hooks, no agent configuration, nothing outside `.spec/`. Pass the project's REAL
  name — the checkout directory is often `repo` or `tmp`, and without a title both the root node and the page
  end up called that. Then rewrite that root to describe THIS project and add
  one folder beside it per part worth a box, each with its own `spec.md` — a `title:` and a `code:` line naming
  the file it is about in the frontmatter, a sentence or two below. `spex guide spec` has the full file format.
  Use `--pure`, not a bare `spex init`: a bare one adopts the repository into SpexCode's whole workflow, which is
  not what drawing a picture asks for.
- `spex guide diagram` is the manual for the diagram format and the loop; read it once.
- Write the tree in the LANGUAGE THE PERSON ASKED IN — node titles, `desc`, bodies, diagram labels and the
  report. The atlas is something a human reads, and an English tree handed to someone who asked in another
  language is a translation job you left them.

Draw the spec tree's pictures: one `diagram.json` beside each node's `spec.md` that is worth one.
The format, the rules and the loop for a single diagram live in `spex guide diagram` — read it before drawing.
This skill is the campaign around that loop.

1. **Scope.** The user names one node, a subtree, or the whole tree. `spex graph` lists the tree;
   `spex spec search <topic>` finds a node by what it is about.
2. **Choose what deserves a picture.** A node whose body explains how its children fit together gets an
   architecture diagram of those children. A node whose body is a process, a protocol, a data path or a
   lifecycle gets that kind instead. Skip leaves with nothing to show, and nodes that already carry a
   `diagram.json` unless the user asked for a redraw. Say what you skipped and why.
3. **Draw each node.** Choose the order top-down, but the drawing itself is per-node and independent: one picture
   reads its own node's body and its children's titles, and writes one file, that node's `diagram.json`. Two nodes
   never write the same file, so where your harness can run sub-agents they may be drawn at the same time — one
   node per sub-agent, handed only that node's context: its body, its children's titles and descriptions, and
   these steps. Keep a batch small enough that you still read every result before dispatching the next; a node
   whose check will not pass is that node's problem and must not stall the others, and a node that defeats you is
   reported in step 6 rather than retried forever. A sub-agent draws and checks its one node and stops: it does
   not commit, does not lint the tree, and does not touch a node it was not given. Landing happens once, in
   step 5, by whoever is running the campaign.
   For one node:
   - read its `spec.md` and its children's, and choose the kind from what the body spends its words on;
   - `spex diagram scaffold <node>` (add `--type <kind>` for anything but architecture);
   - draw: place the boxes, connect what the body says is connected and name each edge by what crosses it,
     group with regions, add cards, and write `meta.note` — what was folded, which relation is an inference;
   - `spex diagram check <node>`, and repair from its findings until it passes.
   Put no numbers on a picture that move on their own — node counts, drift, commit or import counts.
4. **Keep the spec honest.** What drawing reveals about the spec — a claim the code does not bear out, a
   relation the body never states — goes into an issue or your report, never into the picture.
5. **Land it.** `spex spec lint`, then commit the diagrams, together with any spec change they belong to.
6. **Report** which nodes got which kind of diagram, which were skipped and why, and anything you filed.

## Hand over the page

`npx -y --registry=https://registry.npmjs.org -p spexcode -p @spexcode/spec-dashboard spex graph --public --html spexcode-atlas.html` writes the whole tree — every body and
every picture — as one self-contained page that opens in any browser, straight from disk. Offer it with the report;
it is a product of the tree, not part of it, so leave it uncommitted.

The page names the project after `dashboard.title` in `.spec/spexcode.json` and falls back to the directory it
was run in, so a scratch checkout called `repo` publishes a page titled that — wrong on the one artifact a person
is meant to read. `--title` at init sets it; on a tree that already exists, add `dashboard.title` to that file.

The page opens on the whole-tree overview, so a node's drawing is one click in. Say which node to open when you
hand it over, or the first thing the reader sees is a map rather than the picture they asked for.
