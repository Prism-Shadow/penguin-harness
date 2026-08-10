# Evaluation Center Case details and Score charts

Case details now separate the task materials visible to the Target Agent from the scoring rubric available to project members, while keeping both file roots path-confined. Score charts use a padded dynamic axis without discarding authoritative stored values, and the benchmark Skills use YAML folded scalars for Scoreboard summaries.

## Details

- Case details show task materials and scoring rubrics as separate file groups. Rubrics remain hidden from the Target Agent.
- Score charts pad the observed in-range values, clamp the displayed axis to 0–100, and preserve stored finite values for plotting and tooltips.
- Benchmark design and optimization Skills write summary fields as YAML folded scalars and parse the complete Scoreboard after appending an Evaluation.
