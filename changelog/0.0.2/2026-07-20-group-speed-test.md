# Group speed test on the Models page

Each model group header gains an owner-only speed-test action: after a quota warning it
probes the group's models one at a time, measuring time-to-first-token and output rate, and
writes tone-colored badges (green / yellow / red) onto each card; the model-homepage link
moves from the card corner into the config dialog.

## Details

- Server: the model-test endpoint gains a `speed` flag — the probe's output cap rises from
  16 to 64 tokens so a real streaming window exists, and the response now carries `ttftMs`
  (request start -> first streamed content) and `tps` (output tokens over the streaming
  window, from the completed stream's usage report; thinking-only endings carry TTFT but no
  rate). The plain connectivity test is unchanged.
- Web: a gauge button on each group header (owner-only) opens a confirmation dialog warning
  that one real request per model will consume API quota; on confirm the group is tested
  **strictly sequentially** (concurrent probes trip provider rate limits), each result
  landing on its card as it finishes. Badges: clock icon + ms for TTFT (green < 1s, yellow
  <= 3s, red beyond), zap icon + tok/s for TPS (green >= 40, yellow >= 15, red below);
  failures show a red "test failed" with the reason on hover. Thresholds live in a pure,
  unit-tested helper; results are session-scoped.
- The model-homepage link moves off the card corner into the config dialog next to the
  "get model ids" link (the card stays a single clickable surface; the freed corner hosts
  the speed badges).
- Refinements: the group-header actions (add model / bulk API key / speed test) are all
  icon + text buttons; the speed badges live on the card's meta line in their own
  non-shrinking slot (the numbers never crowd or wrap the title row); the probe prompt
  discourages reasoning and ends with an empty `<think></think>` block so reasoning models
  skip their thinking phase instead of burning the probe budget on it.
