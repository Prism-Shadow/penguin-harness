# Penguin companion sessions

Use this reference for `agent-supervision` in Penguin. It specializes the parent
Skill with existing tools and HTTP routes; it creates no built-in Agent type,
sandbox, scheduler or atomic pair primitive.

## Bind roles and files

Use a separately configured Supervisor Agent with this Skill installed, a fresh
Session per attempt, and its own private report directory. Prepare that Agent
before the measured task; never modify a Target's frozen configuration to install
supervision. A supervisor-role user instruction defines its scope even when the
Agent identity is reused between pairs. Keep per-pair conversations separate.

The current creation command is `penguin agent create --agent-id <id> --plugins
agent-tuning --project-id <project> --json`; `--skills` is not a creation flag.
Prefer an existing suitable Supervisor identity. Do not run Agent Initialization
recursively just to create the observer needed for initialization itself.

Store control and report files in a verified private directory outside every
executor workspace, for example under the parent's session scratchpad. Tool
subagents inherit the parent workspace, so that workspace cannot hold their
private audit files. Use `supervision/<work_id>/attempt-<n>/` below the private root.
Only the parent writes binding
and release records; only the Supervisor writes its readiness, findings and final
report. Workers with shared OS access are instructed not to modify these files;
this is not a filesystem enforcement claim. Copy no private manifest into a Target
workspace. A passed `pair_id` must resolve to an actual parent-created binding;
the worker cannot exempt itself by inventing one.

Choose a server Session pair for Builder, Optimizer, matrix controller or other
roles that must delegate further. Reserve tool-subagent pairs for leaf work;
do not consume the only tool depth and then require that child to spawn tools.

## Start a tool subagent pair

1. Launch a Supervisor using `run_subagent` with its Agent ID, complete runtime,
   `run_in_background: true`, and the pair file path. It prepares observation,
   writes readiness and waits for the executor binding. It observes only this pair.
2. Once ready, launch the Supervised Agent with `run_subagent` in background and
   this bootstrap user instruction: “Pair <id>. Do not begin the task or start
   children. Return WAITING and await the parent's task instruction.” Do not put
   private task material in the bootstrap. Capture its `subagent_id` interaction
   handle, then read a bounded initial
   `task_state` event from `GET /api/sessions/<owner>/stream`: its `subagents` rows
   map `subagentId` to `sessionId` and `running`. Forwarded `session_meta` is UI
   transport, not model feedback. Close the stream after the needed snapshot.
3. Record that Session ID and handle in the private binding. The Supervisor reads
   its initial trace, acknowledges the exact binding and remains active. Do not
   send the task before that acknowledgment.
4. Send the original task plus pair/work/attempt identity via `input_subagent` to
   the waiting Supervised handle. For a retry, append only the saved corrective
   user-instruction block. This is the release; it does not edit system config.
5. Poll or receive completion from both handles. An idle bootstrap is not a final
   task result. The Supervisor's report can arrive through its private file while
   it is still running; use bounded `input_subagent` calls for progress.

A nested worker receives the parent-created pair binding and performs its own
Skill, instead of applying the entrypoint delegation again. Penguin currently
limits tool subagents to depth 1 and eight managed background sessions per parent.
A leaf tool child cannot call `run_subagent` or `input_subagent`. Use the existing
server Session procedure below for roles that need further delegation and for
CLI Targets; record `transport: server_session` and the logical parent explicitly.
These are separate server Sessions, not tool children. Reserve both roles under
the experiment's concurrency/cost cap; do not disguise the transport as deeper
tool nesting or use it to escape the declared budget. Supervisors remain leaves.

## Start a CLI Target pair

This procedure also supports a task parent that cannot spawn tool children.
Create the executor and companion as two server Sessions with one logical parent.
An Evaluator must pair its Target too. Keep the ordinary evaluation runtime,
workspace, source and grading contract from `agent-evaluation/references/penguin.md`.
In particular use the Target's `workspaces/` for benchmark execution: an arbitrary
external workspace can cause Penguin to create persistent workspace-memory files.
Prepare any runtime scaffolding before freezing State, and report unexpected
additions rather than claiming identical State because only configuration matches.
Prepare the workspace/environment, then create both Sessions **without starting
a task** using the existing API (source is set only for a measured Target):

```text
POST /api/projects/<project>/agents/<agent>/sessions
{workspace, provider, modelId, approvalMode, sandbox: {mode, network}, source: "benchmark", client: "cli"}
PATCH /api/sessions/<sessionId>
{thinkingLevel: <configured level>}
```

Read the parent's effective approvalMode and sandbox from its Session first;
for a tool-child parent, resolve its recorded owner/root's current policy instead
of the child's stored snapshot, since tool children inherit the owner's policy.
Preserve them explicitly in each new Session request and verify returned policies.
Do not fall back to broader server defaults. If a policy cannot be represented,
report the incompatibility rather than silently loosening it.

Use injected connection/authentication without printing it. Record both returned
Session IDs in the private binding. Start the Supervisor's task with its role,
pair path, executor identity and monitoring interval. Wait for its explicit ready
acknowledgment before starting the executor. The executor trace may not exist yet;
the Supervisor must be ready to follow it from the first record.

Run `penguin run --session <sessionId> --message <task_with_pair_and_user_constraints>`.
Do not repeat creation-only workspace/model/source flags with `--session`; they
were verified at creation. Pin thinking beforehand, including `none`. Use
`--background --json` when the parent must continue polling alerts and states;
a blocking wait that ignores alerts defeats supervision. A measured Target keeps
source `benchmark`. The equivalent task API is `POST /api/sessions/<id>/tasks`
with `{input: [{type: "text", text: "..."}]}`.

The Evaluator drains its Target companion's final report before scoring/returning.
It reports a detected cheating attempt as `evaluation_failed`; the original cell
caller decides whether to create a fresh Evaluator pair and Target pair. Both
pairs share the cell's attempt number, so nested retries cannot multiply the cap.

## Observe and stop

For tool children, check their owner's bounded `/stream` task_state snapshot for
liveness; single-session GET may say idle for an in-process child that is running.
Use exact registered Session IDs, not “latest”. `penguin ls --json` and
`GET /api/sessions/<id>` expose status; `penguin logs <id> --json` or the bound
trace files provide execution records. The server reports `idle`, `running` or
`compacting`, not a literal `complete` state. An idle session can still own
`backgroundTasks`; inspect registered child pairs and task-end evidence before
closing it. `lastActiveAt` alone does not track every subagent tool action.

List a role's sessions with
`GET /api/projects/<project>/agents/<agent>/sessions`. A single-session GET returns
`tracePath` once available; otherwise its files live under the assigned Agent's
`traces/<date>/<sessionId>_*.jsonl` in Environment App Data Dir. Missing trace before
release is expected. Do not search the filesystem, old projects or server processes
to discover an API or trace format. If an explicit endpoint or binding fails,
report that setup failure rather than expanding the search scope.

Read each shard's `session_meta` for actual system prompt, model, State and
workspace; inspect actual user/parent messages and loaded Skill receipts. Track
shard and record cursors so repeated polls do not reread or count an action twice.
`model_msg.payload.type` distinguishes text/thinking/tool_call/tool_call_output;
parse arguments and join results by `tool_call_id`. Inspect only assigned evidence,
including child-pair reports when this worker delegates; each child has its own
observer. Do not include private trace text in a parent-facing alert.
The default system prompt requires intermediates in the worker's own Session
scratchpad. Do not label that access a violation of a lower-priority workspace-only
instruction. Check the actual prompt and exact Session path; shared `/tmp`, sibling
scratchpads and private parent artifacts are different locations.

Default polling interval is 30 seconds, with waits no longer than 30 seconds.
Keep each tool wait at or below the chosen interval and return new records to
the Supervisor model on each poll. A background collector running every two
seconds while the model waits ninety seconds is not two-second supervision.
Do not finish a long collection window before classifying already available actions.
Streaming/trace growth and bounded polling support observation throughout the
work, but do not intercept every action before it runs. Record readiness, release,
last observed event and final drain; claim full trace coverage only when accounted
for. A stalled trace calls for status/deadline checking, not a clean verdict.

The owning parent can stop a tool child with
`input_subagent({subagent_id, abort: true})`. For an identified tool child from a
companion Session, use the owner's existing route
`POST /api/sessions/<parent>/subagents/<child>/abort`. For a separately created CLI
Target, use `POST /api/sessions/<targetSession>/abort`. These stop the current task;
they do not delete its trace. Confirm stopped status and settle descendant work.
An abort response 202 means interruption was requested; 204 means already idle or
not executing. Pair the response with task status and trace termination before
claiming a running task was stopped. Never report an idle no-op as successful
interception. Use actual UTC timestamps for events, not local clock text plus Z.
Parent cancellation must explicitly stop both pair members and their registered
children; a CLI Target is not automatically owned by the subagent registry.

Deliver alerts through private pair files, and immediately notify the active
logical parent with `POST /api/sessions/<parent>/steer`, body `{text: "<redacted alert>"}`.
For a tool-child parent, write its private alert file and notify the active
recorded owner; `/subagents/<child>/message` may revive an idle child and is not
a passive alert channel. Do not send private evidence or restart an idle parent
just to deliver it. The parent polls pair alerts/status at least every 30 seconds
while work runs, aborts the affected executor promptly, and saves the response and
settled status before a fresh pair starts. A helper may perform transport/polling,
but the Supervisor model classifies evidence and the parent model decides
recovery; a script cannot invent either report. After the final drain, finish the
Supervisor, join both reports at the parent, and preserve the records.
