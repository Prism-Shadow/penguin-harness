# Choose a benchmark to reproduce

Before fetching source data, writing benchmark files or creating task companions,
resolve the source and construction recipe with the user. Selection questions
need no workers. Once selection is complete, follow the task Skill's normal
construction and supervision contracts.

If the request does not identify a benchmark, display Benchmark Reproduction's
recipe directory with identifiers, full paper titles and clickable arXiv/GitHub
links. Ask which to reproduce and wait; accept an identifier, repository URL or
local checkout. Use the user's language and preserve original paper titles.
Leave unavailable citations blank and reuse choices already supplied in this task.

Match the source using the task Skill's rules. A supplied custom construction
prompt takes precedence. If no recipe matches, explain that and ask whether to
use the generic reproduction workflow for the **same requested benchmark**, then
wait. For example: “没有找到这个 benchmark 对应的复现配方。要不要按通用复现流程，复现你提供的 benchmark？”
An explicit request already authorizing generic reproduction counts as the answer.
Declining it leaves the task waiting for another source or a custom prompt.
Never substitute `example-benchmark` or another dataset.

After selection, state the benchmark, chosen recipe and available source links.
Resolve only missing execution inputs. If initialization was requested, carry any
RSI method already chosen by the user into it. Give later Evaluators the benchmark
identity and applicable evaluation reference rather than relying on directory names.

## Record the selected sources

Alongside the task Skill's existing provenance, save `benchmark`, `recipe`
(reference path, `generic` or `custom`), `paper_title`, `arxiv_url`, `github_url`,
`source_revision`, and `references` (paths, installed Skill versions and content
hashes) in `reproduction.yaml`. Record generic-workflow agreement or the custom
prompt. Preserve the actual sources used in both split records; omit unavailable
fields and leave historical records untouched. Include available source links
in the handoff report. Keep private evaluation evidence out of public task files.
