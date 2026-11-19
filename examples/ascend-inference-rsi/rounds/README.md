# Round records

One directory per round:

```
0001/
  plan.md       # hypothesis, expected metric, files
  patch.diff
  metrics.json  # baseline, candidate, interval, noise floor
  verdict.md    # retained or rejected, with the reason
```

Every round, including a rejected one, also gets one line in `../experience.jsonl`.
