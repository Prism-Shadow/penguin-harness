# Source notes

This toolkit implements SkillWeaver from the paper and its reference implementation, read at revision `f2a63d65d0f6ff46ac30e817cede8797f8f25b97` of [OSU-NLP-Group/SkillWeaver](https://github.com/OSU-NLP-Group/SkillWeaver). It ships none of that code; the role instructions in `roles.md` and the API rules in `api-format.md` adapt the text of the upstream prompt templates, under the MIT license reproduced below.

| Upstream | Here |
| --- | --- |
| `explore.py`: `_run_explore_iteration`, `_should_perform_test` (`test_probability:0.5`), `return_home_every_n_iterations=1`, `max_steps=10` | the Skill's practice loop and its defaults |
| `explore.py`: `_choose_explore_task`, `templates/propose_skill.md` and the live-site `safety_instructions` of `templates/__init__.py` | Proposer |
| `explore.py`: `_choose_test_task` (softmax over `rate_practice_utility` = interaction count − version), `_generate_test_case_arguments`, `templates/generate_practice_args.md` | `skillweaver.mjs pick-test`, Tester |
| `explore.py`: `_successfully_executes_function_without_errors` | a test passes when the Target's call of the API printed `{"ok":true,…}` |
| `knowledge_base/check_success.py`: `check_success_simple` | Judge |
| `knowledge_base/knowledge_base.py`: `update` (verified code plus the functions used in the episode as context), `templates/kb_procedural_update_base.md`, `kb_procedural_update_single.md`, `kb_semantic_update.md` | Synthesiser, Publish |
| `knowledge_base/code_verification.py`: syntax and parameter checks | `skillweaver.mjs check` |
| `attempt_task.py` with the knowledge base and `templates/predict_relevant_functions.md` | the Target reading `INDEX.md` and calling the API scripts |
| Playwright `async def skill(page, …)` starting with `page.goto("/…")` | `apis/<name>.mjs` starting with `browser.open("/…")`, over `penguin browser` |

Left out on purpose: WebArena container orchestration and login helpers, the WebArena and VisualWebArena evaluators, the Browser-Use variant, the information-seeking templates (`propose_information_seeking_*.md`, which no code at this revision loads), and the bundled `skillnet/` libraries, which were learned for specific WebArena sites.

## Upstream license

```text
MIT License

Copyright (c) 2025 OSU Natural Language Processing

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
