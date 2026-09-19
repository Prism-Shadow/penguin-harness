# A Z.AI Coding Plan group, beside the pay-as-you-go one

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`
- **PR:** [#14](https://github.com/nicolaepocroianu/penguin-harness/pull/14)

The Models page gained a **Z.AI Coding Plan** group next to **Z.AI (GLM)**, so choosing a
billing path for the GLM models is a choice of group, not a hand edit. The subscription's quota
is mounted only on the coding endpoint `https://api.z.ai/api/coding/paas/v4/`, and the group's
five presets — the same `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `glm-5.1` and `glm-5` ids the
pay-as-you-go group sells — inline that endpoint; every other row field (auto-routing, vision
rule, context windows) matches the direct group. The credential is the same `ZAI_API_KEY`: the
endpoint, not the key, picks the billing path.

Every Coding Plan row is priced at zero on all three buckets, because the subscription bills a
quota rather than a meter: the cost center reads it as a genuine $0 tier, not an unknown price.
All five presets were verified live against the coding endpoint on 2026-09-19 — the same key
against the pay-as-you-go endpoint answers `1113 Insufficient balance or no resource package`,
which is the failure that motivated the group.
