# Initialize the skill library

Prepare the Target before H1 is measured: one target-owned Skill holding an empty skill library, and one fixed line in the Target's `AGENTS.md`. Run no practice cell and write no API here. The model settings, tools, hooks, the agent's own `memory/` and every other Skill stay as they are. `STATE`, `LIBRARY`, `APIS`, `TOOL` and `OUT` are the paths of the Skill's "Paths and records".

1. **Learned state.** If `LIBRARY` exists already, stop. It is either an experiment to resume, which needs the matching `OUT/experiment.yaml`, or learning that must not be lost: ask the user, and never empty a learned library.
2. **The browser.** Check that `STATE/skills/browser-automation/SKILL.md` exists: the Target drives the website and every API through `penguin browser`. If it is missing, stop and say so.
3. **Version.** A Target created for this experiment normally initializes in place at `version` 1. Do not make a v1 snapshot of that new agent before initialization. If a snapshot of its initial version already exists, preserve it and assign the initialized State the next version. For an existing agent, make sure the snapshot of its current version exists and matches before changing anything, then assign the initialized State the next version. Replace the single `version` field in `STATE/system_config.yaml` when advancing it.
4. **The Skill.** Write `LIBRARY/SKILL.md`, with today's date version (`YYYY.MM.DD.1`) in place of the placeholder, exactly:

```markdown
---
name: skillweaver-apis
description: A skill library of tested API scripts for one website, learned by practising on it - read its index before your first action on a task on that website.
version: <YYYY.MM.DD.1>
---

# Skill library

`apis/INDEX.md` beside this file lists API scripts that automate tasks on the website it names, each with its parameters, what it returns, how often it was tested and a usage log; `site.md` describes the website's features. Before your first action on a task on that website, read both in full and decide, step by step, which APIs could help with the task. Call an API from the shell as `node <absolute path of this directory>/apis/<name>.mjs --args '<JSON object of its parameters>'`; it drives the agent browser and prints one JSON line. Check its result against what the page shows; when it fails or no API fits, do the task with your ordinary browser tools. An API is a shortcut, not a guarantee: prefer the tested ones, and keep the output the task asks for. Never change this Skill, its files or anything else in your Agent State.
```

5. **The library.** Create `APIS` and run `TOOL init APIS <site_url>`: it writes `library.json` (the site and an empty API record) and copies the runtime `skillweaver-api.mjs` that every API imports. Then run `TOOL index APIS`, which writes an `INDEX.md` saying no API has been learned yet. Write `LIBRARY/site.md` as the single line `# <the website's title from page.txt, or its host>`.
6. **The reader.** Append this line to `STATE/AGENTS.md`, after a blank line when the file is not empty, exactly:

```text
Before your first action on any task on the website named in `skills/skillweaver-apis/apis/INDEX.md` in your Agent State, read that file and `skills/skillweaver-apis/site.md` in full, and follow the `skillweaver-apis` Skill.
```

7. **Verify.** Parse `STATE/system_config.yaml` (the expected `version`, no duplicate key) and the frontmatter of `LIBRARY/SKILL.md` (`name: skillweaver-apis`, matching its directory); check that `APIS/library.json` names `site_url` with no API, that `APIS/skillweaver-api.mjs` equals `SKILL_DIR/scripts/skillweaver-api.mjs` byte for byte, and that the reader line appears exactly once in `STATE/AGENTS.md`. Record the SHA-256 of these files in `OUT/experiment.yaml`. Then create `TARGET/snapshots/v<initialized version>.tar.gz` from the complete initialized State. Compare all regular files in that archive to the live State, excluding `.vault.toml`, and record the match. Do this before any baseline measurement or practice cell; the archive itself must contain the empty library and reader line.

The Skill body, the runtime and the reader line stay unchanged through H1, the practice loop and the final measurement: only the API scripts, `INDEX.md`, `library.json` and `site.md` learn, and only through the Skill's Publish step and the `TOOL` commands it names.
