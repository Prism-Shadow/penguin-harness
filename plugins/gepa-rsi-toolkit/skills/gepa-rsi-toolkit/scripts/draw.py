"""Draw one GEPA iteration's parent and minibatch, as gepa-ai/gepa does at revision
8f287de942f41a6d1e0e7e5b2d576247c4bedee9.

The parent follows select_program_candidate_from_pareto_front (gepa_utils.py) and the minibatch
EpochShuffledBatchSampler (strategies/batch_sampler.py), both drawing from one
random.Random(seed), parent first, as SingleMutationSampling orders them. Python standard
library only.

    python3 draw.py <OUT>

reads <OUT>/pool.json (written by the controller) and <OUT>/draw.json (this script's state,
absent before the first draw), rewrites draw.json, appends the draw to <OUT>/draws.jsonl and
prints it as one JSON line: {"iteration", "parent", "minibatch"}. Every call draws the next
iteration; a resumed run reads an iteration's draw back from draws.jsonl instead of drawing again.

pool.json: {"seed": 0, "minibatch_size": 3, "feedback_case_ids": [...], "pareto_case_ids": [...],
"members": [{"index": 0, "average": 50.0, "scores": {"<pareto case id>": 50.0, ...}}, ...]}.
"""

import json
import os
import random
import sys
from collections import Counter


def pareto_parent(members, pareto_case_ids, rng):
    """Algorithm 2: the per-case fronts, dominated members pruned, a frequency-weighted draw.

    Fronts are Python sets built member by member in pool order, as GEPAState updates them, and
    are walked in the sets' own order: the draw depends on that order, so sorting would change it.
    """
    average = {m["index"]: m["average"] for m in members}
    best, fronts = {}, {}
    for m in sorted(members, key=lambda m: m["index"]):
        for case in pareto_case_ids:
            score = m["scores"][case]
            if score > best.get(case, float("-inf")):
                best[case] = score
                fronts[case] = {m["index"]}
            elif score == best[case]:
                fronts[case].add(m["index"])
    covers, left = {}, {}
    for case, front in fronts.items():
        left[case] = len(front)
        for index in front:
            covers.setdefault(index, []).append(case)
    # remove_dominated_programs: lowest average first, dropped while each front it is in keeps
    # another survivor.
    dropped = set()
    for index in sorted(covers, key=lambda i: average[i]):
        if all(left[case] > 1 for case in covers[index]):
            dropped.add(index)
            for case in covers[index]:
                left[case] -= 1
    frequency = {}
    for front in fronts.values():
        for index in {i for i in front if i not in dropped}:
            frequency[index] = frequency.get(index, 0) + 1
    return rng.choice([index for index, n in frequency.items() for _ in range(n)])


def minibatch(state, feedback_case_ids, size, iteration, rng):
    """EpochShuffledBatchSampler.next_minibatch_ids for iteration `iteration` (0-based)."""
    base = iteration * size
    order = state["order"]
    epoch = 0 if state["epoch"] == -1 else base // len(order)
    if not order or epoch > state["epoch"]:
        state["epoch"] = epoch
        order = list(feedback_case_ids)
        rng.shuffle(order)
        used = Counter(order)
        while len(order) % size:
            least = used.most_common()[::-1][0][0]
            order.append(least)
            used[least] += 1
        state["order"] = order
    start = base % len(order)
    return order[start : start + size]


def main():
    out = sys.argv[1]
    with open(os.path.join(out, "pool.json"), encoding="utf-8") as f:
        pool = json.load(f)
    size = pool["minibatch_size"]
    feedback = sorted(pool["feedback_case_ids"])
    if not 0 < size <= len(feedback):
        sys.exit("minibatch_size must be between 1 and the number of feedback cases")
    state_path = os.path.join(out, "draw.json")
    rng = random.Random(pool["seed"])
    state = {"iteration": 0, "epoch": -1, "order": [], "rng": None}
    if os.path.exists(state_path):
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
        version, internal, gauss = state["rng"]
        rng.setstate((version, tuple(internal), gauss))
    iteration = state["iteration"]
    parent = pareto_parent(pool["members"], sorted(pool["pareto_case_ids"]), rng)
    batch = minibatch(state, feedback, size, iteration, rng)
    state["iteration"] = iteration + 1
    state["rng"] = rng.getstate()
    with open(state_path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(state_path + ".tmp", state_path)
    draw = json.dumps({"iteration": iteration, "parent": parent, "minibatch": batch})
    with open(os.path.join(out, "draws.jsonl"), "a", encoding="utf-8") as f:
        f.write(draw + "\n")
    print(draw)


if __name__ == "__main__":
    main()
