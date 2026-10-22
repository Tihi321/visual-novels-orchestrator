"""The solver. Two parts that must agree on every generated puzzle:

* `count_solutions`: brute force over every assignment. The proof that a puzzle has exactly one solution.
* `deduce`: a grid of cells (unknown, yes, no) and human-style rules applied one cell at a time, each step recorded. A puzzle is
  deducible when this ends with every cell known and no guessing; the grid must then equal the solution.
"""

from .model import (
    EASY_RULES,
    RULES,
    WEIGHTS,
    all_owner_maps,
    category_index,
    clue_true,
    owners_of,
)

_MAPS_CACHE = {}


def _maps(p):
    key = tuple(tuple(c["items"]) for c in p["categories"])
    got = _MAPS_CACHE.get(key)
    if got is None:
        got = all_owner_maps(p)
        _MAPS_CACHE[key] = got
    return got


def count_solutions(p, limit=2, clues=None):
    """How many assignments make every clue true (stops counting at `limit`). `clues` overrides the puzzle's own list."""
    use = p["clues"] if clues is None else clues
    n = 0
    for owner in _maps(p):
        if all(clue_true(c, owner) for c in use):
            n += 1
            if n >= limit:
                break
    return n


def solutions(p, clues=None, limit=1000):
    """The owner maps (item -> person) that satisfy the clues."""
    use = p["clues"] if clues is None else clues
    out = []
    for owner in _maps(p):
        if all(clue_true(c, owner) for c in use):
            out.append(owner)
            if len(out) >= limit:
                break
    return out


class _Grid:
    def __init__(self, p, clues):
        self.p = p
        self.clues = clues
        self.idx = category_index(p)
        self.cats = [list(c["items"]) for c in p["categories"]]
        self.state = {}
        self.cells = []
        for i in range(len(self.cats)):
            for j in range(i + 1, len(self.cats)):
                for a in self.cats[i]:
                    for b in self.cats[j]:
                        self.state[(a, b)] = 0
                        self.cells.append((a, b))
        self.contradiction = None

    def key(self, a, b):
        return (a, b) if self.idx[a] < self.idx[b] else (b, a)

    def get(self, a, b):
        return self.state[self.key(a, b)]

    def known(self):
        return all(v != 0 for v in self.state.values())


def _clue_rule(g):
    for c in g.clues:
        if c["type"] == "is":
            yield g.key(c["a"], c["b"]), 1, {"clue": c["id"]}
        elif c["type"] == "not":
            yield g.key(c["a"], c["b"]), -1, {"clue": c["id"]}
        elif c["type"] == "either":
            cat = g.cats[g.idx[c["b"][0]]]
            for x in cat:
                if x not in c["b"]:
                    yield g.key(c["a"], x), -1, {"clue": c["id"]}


def _elim_rule(g):
    for (a, b), v in list(g.state.items()):
        if v != 1:
            continue
        for x in g.cats[g.idx[b]]:
            if x != b:
                yield g.key(a, x), -1, {"from": [[a, b]]}
        for x in g.cats[g.idx[a]]:
            if x != a:
                yield g.key(x, b), -1, {"from": [[a, b]]}


def _last_rule(g):
    for i in range(len(g.cats)):
        for j in range(i + 1, len(g.cats)):
            for a in g.cats[i]:
                row = [(a, b) for b in g.cats[j]]
                unknown = [c for c in row if g.state[c] == 0]
                if len(unknown) == 1 and not any(g.state[c] == 1 for c in row):
                    yield unknown[0], 1, {"from": [list(c) for c in row if c != unknown[0]]}
            for b in g.cats[j]:
                col = [(a, b) for a in g.cats[i]]
                unknown = [c for c in col if g.state[c] == 0]
                if len(unknown) == 1 and not any(g.state[c] == 1 for c in col):
                    yield unknown[0], 1, {"from": [list(c) for c in col if c != unknown[0]]}


def _either_rule(g):
    for c in g.clues:
        if c["type"] != "either":
            continue
        b1, b2 = c["b"]
        if g.get(c["a"], b1) == -1:
            yield g.key(c["a"], b2), 1, {"clue": c["id"], "from": [list(g.key(c["a"], b1))]}
        if g.get(c["a"], b2) == -1:
            yield g.key(c["a"], b1), 1, {"clue": c["id"], "from": [list(g.key(c["a"], b2))]}


def _trans_rule(g):
    # a-b yes and b-c yes: a-c yes. a-b yes and b-c no: a-c no. (b is the middle item, in a third category.)
    for (a, b), v in list(g.state.items()):
        if v != 1:
            continue
        for mid, other in ((a, b), (b, a)):
            for cat_i, cat in enumerate(g.cats):
                if cat_i == g.idx[mid] or cat_i == g.idx[other]:
                    continue
                for x in cat:
                    w = g.get(mid, x)
                    if w == 0:
                        continue
                    yield g.key(other, x), w, {"from": [list(g.key(a, b)), list(g.key(mid, x))]}


_RULE_FUNCS = {"clue": _clue_rule, "elim": _elim_rule, "last": _last_rule, "either": _either_rule, "trans": _trans_rule}


def deduce(p, clues=None, allowed=RULES):
    """Solve by rules, one cell per step. Returns {solved, contradiction, grid, steps, rules, score}.

    `solved` is true only when every cell is known with no guessing and the grid equals the solution. Rules are tried cheapest first,
    so the steps read like a person's. `allowed` limits the rules (easy puzzles use no either or trans step).
    """
    use = p["clues"] if clues is None else clues
    g = _Grid(p, use)
    steps = []
    contradiction = None
    progress = True
    while progress and not g.known():
        progress = False
        for rule in RULES:
            if rule not in allowed:
                continue
            for cell, value, info in _RULE_FUNCS[rule](g):
                cur = g.state[cell]
                if cur == value:
                    continue
                if cur != 0:
                    contradiction = {"rule": rule, "cell": list(cell)}
                    break
                g.state[cell] = value
                step = {"rule": rule, "cell": list(cell), "value": "yes" if value == 1 else "no"}
                step.update(info)
                steps.append(step)
                progress = True
                break
            if progress or contradiction:
                break
        if contradiction:
            break
    grid = {"%s|%s" % c: ("yes" if v == 1 else "no" if v == -1 else "") for c, v in g.state.items()}
    solved = False
    if not contradiction and g.known():
        owner = owners_of(p)
        solved = all((owner[a] == owner[b]) == (v == 1) for (a, b), v in g.state.items())
    rules = {r: 0 for r in RULES}
    for s in steps:
        rules[s["rule"]] += 1
    score = sum(WEIGHTS[r] * n for r, n in rules.items())
    return {"solved": solved, "contradiction": contradiction, "grid": grid, "steps": steps, "rules": {r: n for r, n in rules.items() if n}, "score": score}


def band_of(p, result=None, clues=None):
    """easy: no either or trans step. hard: at least 3 trans steps and no `is` clue. Everything else that needs either or trans: medium."""
    use = p["clues"] if clues is None else clues
    r = result if result is not None else deduce(p, use)
    rules = r["rules"]
    trans = rules.get("trans", 0)
    has_is = any(c["type"] == "is" for c in use)
    if trans >= 3 and not has_is:
        return "hard"
    if trans or rules.get("either", 0):
        return "medium"
    return "easy"


def allowed_for(band):
    return EASY_RULES if band == "easy" else RULES


def difficulty(p, result=None):
    r = result if result is not None else deduce(p)
    return {"steps": len(r["steps"]), "score": r["score"], "rules": r["rules"]}
