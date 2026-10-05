# Choose an RSI method

Use this reference before task execution, including initialization for an RSI
experiment. It specializes the default-method rule in Agent Optimization.

Resolve the method from the user's request or an explicit choice already made
in this task. Accept the identifiers in Agent Optimization's method directory
case-insensitively. An explicit request for the default selects Penguin, including
the existing Web form's request to use Penguin unless another method is named.

If no choice was made, display that directory with method identifiers, full paper
titles, clickable arXiv and GitHub links. Ask which identifier to use and wait.
Use the user's language and preserve original paper titles. Leave unavailable
citations blank. Selection questions create no companions or other task workers,
and do not initialize, evaluate or train. Unknown methods require supplied
instructions or clarification; never silently substitute Penguin.

After selection, state the method and available source links, read its applicable
references, and resolve only missing required inputs such as mode, budget and
baseline requirements. Carry the method, parameters and reference paths to each
relevant child so the same choice is not asked for again.

Initialization uses the matching method reference. An existing Target missing
baseline artifacts needs an explicit initialization scope before changes; never
clear learned State or relabel an old baseline. Ordinary standalone initialization
with no RSI intent keeps its Penguin default. Once selection is complete, follow
the usual companion supervision contract before executing work.

## Record the selected sources

In `OUT/experiment.yaml`, preserve `method`, `paper_title`, `arxiv_url`,
`github_url`, `source_revision`, and `references` (paths, installed Skill versions
and content hashes), alongside the resolved mode and parameters. Keep method
citations separate from the training-data `source` declaration. Initialization
passes its own loaded reference identities to this record.

Use the actual sources read, not a live lookup that changes after a plugin update.
Omit unavailable fields and leave historical records untouched. Each update and
final-result record in OUT identifies this experiment and its measured State
version. Include the method and available source links in the final report.
The existing evaluation and scoreboard formats remain the task Skill's contract.
