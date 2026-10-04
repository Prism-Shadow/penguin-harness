# Evaluation matrix controller

Use this reference for a top-level request to evaluate a complete Benchmark
(`test_agent_id`, `benchmark_id`, `runs`) rather than one protocol cell. It
specializes the single-cell Skill: the controller may delegate and write the
scoreboard, and returns a summary instead of cell YAML. It never privately scores
the Target itself. A malformed explicit `protocol_version` request is still an
invalid cell request; do not reinterpret it as a matrix.

1. Resolve the published Benchmark, nonempty case set, positive runs, frozen
   Target version and complete provider/model pair. Use the user's explicit pair
   or the controller's Environment pair; Penguin State supplies thinking, not a
   stored provider/model pair. Record runtime before starting. Do not inspect
   Project secrets or guess a pair from a model display name.
2. As Root, delegate the matrix controller with its companion using a server
   Session, since that role must itself dispatch. An already paired controller
   executes directly. Give every case/run a complete eight-field evaluation
   request and a fresh Evaluator companion pair. Use `run_subagent` when available
   or explicitly registered server Sessions as the companion reference permits.
   The Evaluator creates its own Target pair. Respect capacity and work budgets.
3. Join each raw protocol result with its companion report. Verify Agent, case,
   logical run, version and runtime. Formatting repair uses the existing worker
   result, never a new Target run. The controller owns bounded cheating recovery;
   method training is not part of this measurement request.
4. Append one complete clean evaluation using the existing scoreboard shape in
   `agent-optimization` (read its output contract only, not an optimization recipe).
   Compute run means then case means, acquire `scoreboard.yaml.lock` once, parse
   the latest file, preserve unrelated rows without displaying them, append and
   atomically replace. Verify the written structure, identities and trace links.
5. Keep incomplete matrices, prompted recovery and policy penalties in the
   controller's separate output directory; report their scores/reasons to the user
   without making them baseline-eligible scoreboard entries. Never drop a failed
   case to manufacture a complete average. Do not change Target or Benchmark
   materials; scoreboard append is the only benchmark write.

Finish with case coverage, raw/recovery results, runtime, State version, sessions,
all-role cost coverage, failures and the private audit location. Stop after
measurement. For independent final testing, keep results out of Optimizer context.
