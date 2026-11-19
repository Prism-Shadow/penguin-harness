# Patch bundle

The retained patches land here once a round clears every gate.

```
base.txt
patches/
  0001-<slug>.patch
apply.sh
restore.sh
```

`base.txt` pins the vLLM-Ascend commit. Each patch applies to that commit and is reversed by `restore.sh`. Rejected experiments stay in `../rounds/`, not here.
