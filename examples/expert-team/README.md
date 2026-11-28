<!-- English | [简体中文](README.zh.md) -->

# Example: Expert-Team framework (coordinator-only host + auto review loop)

A **multi-expert collaboration framework** distilled from Octop's Expert Teams,
running in production inside a tender-tracking system (106 verification cases green).
The core idea in one line: **a team is not a new entity — it is a special expert
(`kind=team`) who only schedules and never does the work itself.**

The full rationale (Chinese) lives in [README.zh.md](README.zh.md).

## How it works

1. **Expert = one reusable config**: a DB row + a workspace (`SOUL.md` persona +
   `AGENTS.md` rules + `manifest.json`), capabilities assembled from
   prompts / skills / knowledge / model slots — no new classes per expert.
2. **Team = a host expert + ≥2 members**: the roster is a JSON array on the host,
   no membership table. Members stay independent experts and can join many teams.
3. **Two collaboration modes, nothing else** (no DAG engine):
   - sync ask (`@member`, blocking, one model call, no agent session);
   - async dispatch (one Harness session per member, ≤3 concurrent, same member serial).
4. **Host-only scheduling**: the host rewrites user intent into standalone task briefs
   (never forwards verbatim), judges completion, and never re-quotes member output.
5. **Auto review loop** (`backend/expert_autoreview.py`): every new tender document
   auto-opens the standing `bid-review` team; gaps auto-fix missing checklist items
   (deterministic appends only, max 2 rounds); leftovers stay visible, never loop forever.

## Layout

```
examples/expert-team/
  backend/expert_team.py        # experts/teams CRUD, sync ask, parallel dispatch,
                                # nested teams (≤2, cycle/depth guarded), @-assign,
                                # jobs ledger, archive, estimate, presets
  backend/expert_autoreview.py  # auto review-fix loop + on/off switch
  api/expert_team_api.py        # FastAPI routes (/api/expert/*)
  tests/verify_expert_team.py   # 106 checks, temp sqlite + full mocks, no prod touch
  DESIGN.zh.md                  # full design rationale (Chinese)
  PR-NOTE.zh.md                 # review/rollback notes from the production rollout
```

## Porting notes (read before reusing)

The code was extracted as-is from a FastAPI + PostgreSQL app, so it imports
tracker infrastructure. Seams to re-implement per host (each is one small function):

| Import | Role | Replace with |
|---|---|---|
| `database` | sqlite3-style connect + settings KV | your DB layer + a settings KV |
| `tenancy` | company/user attribution (`group_of`, `user_id_of`, `is_super_user`) | your auth context |
| `tasks` | background jobs + `Progress` (`think/log/stage`) | your job runner + progress sink |
| `ph_bridge` | Harness session execution (`run_session`) | your agent-runner call |
| `ai_helper` | multi-channel model pool (`chat_complete_any`) | your model call |
| `responses` / `tender_terms` | checklist + tender-term store (auto-review only) | your domain store |

Pure, dependency-free pieces you can lift verbatim: `filter_by_mentions`,
`rewrite_for_member`, `_clean_attachments`, `collect_gaps`, `_infer_cat`,
`_team_closure` (cycle detection).

## Verify

Inside the original app: `TRACKER_DB=sqlite python3 scripts/verify_expert_team.py`
→ 106/106. In this repo the test is kept for reference; wire the seams above
to run it against your own stack.
