"""The solver for grid puzzles (Murdle, logic grids). Two parts that must agree on every generated puzzle:

* `count_solutions`: a search over every assignment of items to persons, pruned by the clues. The proof that a puzzle has exactly one
  solution. `count_solutions_brute` is the plain enumeration, kept as the oracle of the tests.
* `deduce`: a grid of cells (unknown, yes, no) and human-style rules applied one cell at a time, each step recorded. A puzzle is
  deducible when this ends with every cell known and no guessing; the grid must then equal the solution. `deduce_fast` reaches the same
  fixed point without recording steps (the generator uses it while it builds a puzzle).
"""

from .model import (
    EASY_RULES,
    RULES,
    WEIGHTS,
    all_owner_maps,
    category_index,
    clue_items,
    clue_true,
    ordinal_items,
    owners_of,
)

_MAPS_CACHE = {}
_ORDER_TYPES = ("before", "after", "apart")


def _maps(p):
    key = tuple(tuple(c["items"]) for c in p["categories"])
    got = _MAPS_CACHE.get(key)
    if got is None:
        got = all_owner_maps(p)
        _MAPS_CACHE[key] = got
    return got


def count_solutions_brute(p, limit=2, clues=None):
    """The plain enumeration of every assignment (the oracle of the tests; too slow for big puzzles)."""
    use = p["clues"] if clues is None else clues
    ordinal = ordinal_items(p)
    n = 0
    for owner in _maps(p):
        if all(clue_true(c, owner, ordinal) for c in use):
            n += 1
            if n >= limit:
                break
    return n


def _search(p, use, limit, collect=None):
    """Assign the items of every category but the first to persons (each person once per category), checking a clue as soon as all the
    items it needs are placed. Returns the number of solutions found (at most `limit`)."""
    cats = p["categories"]
    people = list(cats[0]["items"])
    ordinal = ordinal_items(p)
    items = [(ci, it) for ci, c in enumerate(cats) if ci > 0 for it in c["items"]]
    at = {it: i for i, (_, it) in enumerate(items)}
    order_needs = list(ordinal) if ordinal else []
    by_last = [[] for _ in items]
    for c in use:
        names = clue_items(c)
        if c["type"] in _ORDER_TYPES:
            names = names + order_needs
        last = max((at[x] for x in names if x in at), default=-1)
        by_last[max(last, 0)].append(c)
    owner = {s: s for s in people}
    used = [set() for _ in cats]
    count = 0

    def dfs(i):
        nonlocal count
        if i == len(items):
            count += 1
            if collect is not None:
                collect.append(dict(owner))
            return count >= limit
        ci, it = items[i]
        for person in people:
            if person in used[ci]:
                continue
            used[ci].add(person)
            owner[it] = person
            if all(clue_true(c, owner, ordinal) for c in by_last[i]) and dfs(i + 1):
                return True
            used[ci].discard(person)
        owner.pop(it, None)
        return False

    if items:
        dfs(0)
    return count


def count_solutions(p, limit=2, clues=None):
    """How many assignments make every clue true (stops counting at `limit`)."""
    return _search(p, p["clues"] if clues is None else clues, limit)


def solutions(p, clues=None, limit=1000):
    """The owner maps (item -> person) that satisfy the clues."""
    out = []
    _search(p, p["clues"] if clues is None else clues, limit, collect=out)
    return out


class _Grid:
    def __init__(self, p, clues):
        self.p = p
        self.clues = clues
        self.idx = category_index(p)
        self.cats = [list(c["items"]) for c in p["categories"]]
        self.ordinal = ordinal_items(p)
        self.state = {}
        for i in range(len(self.cats)):
            for j in range(i + 1, len(self.cats)):
                for a in self.cats[i]:
                    for b in self.cats[j]:
                        self.state[(a, b)] = 0

    def key(self, a, b):
        return (a, b) if self.idx[a] < self.idx[b] else (b, a)

    def get(self, a, b):
        return self.state[self.key(a, b)]

    def known(self):
        return all(v != 0 for v in self.state.values())

    def positions(self, x):
        """The ordinal positions item x may still have: its own for an item of the ordinal category, else those not ruled out."""
        o = self.ordinal
        if x in o:
            return {o.index(x)}
        return {i for i, it in enumerate(o) if self.get(x, it) != -1}


def _clue_rule(g):
    for c in g.clues:
        t = c["type"]
        if t == "is":
            yield g.key(c["a"], c["b"]), 1, {"clue": c["id"]}
        elif t == "not":
            yield g.key(c["a"], c["b"]), -1, {"clue": c["id"]}
        elif t == "neither":
            for b in c["b"]:
                yield g.key(c["a"], b), -1, {"clue": c["id"]}
        elif t == "either":
            cat = g.cats[g.idx[c["b"][0]]]
            for x in cat:
                if x not in c["b"]:
                    yield g.key(c["a"], x), -1, {"clue": c["id"]}
        elif t == "oneof":
            cat = g.cats[g.idx[c["b"][0]]]
            for a in c["a"]:
                for x in cat:
                    if x not in c["b"]:
                        yield g.key(a, x), -1, {"clue": c["id"]}


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
        if c["type"] == "either":
            b1, b2 = c["b"]
            if g.get(c["a"], b1) == -1:
                yield g.key(c["a"], b2), 1, {"clue": c["id"], "from": [list(g.key(c["a"], b1))]}
            if g.get(c["a"], b2) == -1:
                yield g.key(c["a"], b1), 1, {"clue": c["id"], "from": [list(g.key(c["a"], b2))]}
        elif c["type"] == "oneof":
            (a1, a2), (b1, b2) = c["a"], c["b"]
            first = [g.key(a1, b1), g.key(a2, b2)]  # a1~b1 and a2~b2
            second = [g.key(a1, b2), g.key(a2, b1)]  # a1~b2 and a2~b1
            if any(g.state[k] == -1 for k in first):
                for k in second:
                    yield k, 1, {"clue": c["id"], "from": [list(x) for x in first if g.state[x] == -1]}
            if any(g.state[k] == -1 for k in second):
                for k in first:
                    yield k, 1, {"clue": c["id"], "from": [list(x) for x in second if g.state[x] == -1]}


def _order_rule(g):
    """before, after and apart clues: a position that no position of the other item can go with is ruled out."""
    if not g.ordinal:
        return
    o = g.ordinal
    for c in g.clues:
        t = c["type"]
        if t not in _ORDER_TYPES:
            continue
        a, b = c["a"], c["b"]
        pa, pb = g.positions(a), g.positions(b)
        if t == "before":
            ok = lambda i, j: i < j  # noqa: E731
        elif t == "after":
            ok = lambda i, j: i > j  # noqa: E731
        else:
            n = c["n"]
            ok = lambda i, j, n=n: abs(i - j) == n  # noqa: E731
        if a not in o:
            for i in sorted(pa):
                if not any(ok(i, j) for j in pb):
                    yield g.key(a, o[i]), -1, {"clue": c["id"]}
        if b not in o:
            for j in sorted(pb):
                if not any(ok(i, j) for i in pa):
                    yield g.key(b, o[j]), -1, {"clue": c["id"]}


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


_RULE_FUNCS = {"clue": _clue_rule, "elim": _elim_rule, "last": _last_rule, "either": _either_rule, "order": _order_rule, "trans": _trans_rule}


def deduce(p, clues=None, allowed=RULES):
    """Solve by rules, one cell per step. Returns {solved, contradiction, grid, steps, rules, score}.

    `solved` is true only when every cell is known with no guessing and the grid equals the solution. Rules are tried cheapest first,
    so the steps read like a person's. `allowed` limits the rules (easy puzzles use no either, order or trans step).
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


def deduce_fast(p, clues=None, allowed=RULES):
    """True when the rules reach every cell (and the grid equals the solution). The same fixed point as `deduce`, with every cell a pass
    finds applied at once and nothing recorded: the generator calls it many times."""
    use = p["clues"] if clues is None else clues
    g = _Grid(p, use)
    changed = True
    while changed and not g.known():
        changed = False
        for rule in RULES:
            if rule not in allowed:
                continue
            for cell, value, _info in _RULE_FUNCS[rule](g):
                cur = g.state[cell]
                if cur == value:
                    continue
                if cur != 0:
                    return False
                g.state[cell] = value
                changed = True
    if not g.known():
        return False
    owner = owners_of(p)
    return all((owner[a] == owner[b]) == (v == 1) for (a, b), v in g.state.items())


def band_of(p, result=None, clues=None):
    """The band of a solved grid puzzle from the rules its steps used.

    Murdle: easy has no either, order or trans step; hard has at least 3 trans steps and no `is` clue; the rest is medium.
    Logic grids (they have an ordinal category): easy needs no either or trans step and has no either or oneof clue; hard has many trans steps (`hardTrans`); the rest is medium.
    """
    use = p["clues"] if clues is None else clues
    r = result if result is not None else deduce(p, use)
    rules = r["rules"]
    trans = rules.get("trans", 0)
    if p.get("ordinal"):
        if trans >= p.get("hardTrans", 8):
            return "hard"
        return "medium" if trans or rules.get("either", 0) or any(c["type"] in ("either", "oneof") for c in use) else "easy"
    has_is = any(c["type"] == "is" for c in use)
    if trans >= 3 and not has_is:
        return "hard"
    if trans or rules.get("either", 0) or rules.get("order", 0):
        return "medium"
    return "easy"


def allowed_for(band, p=None):
    if band == "easy":
        return EASY_RULES + (("order",) if p and p.get("ordinal") else ())
    return RULES


def difficulty(p, result=None):
    r = result if result is not None else deduce(p)
    return {"steps": len(r["steps"]), "score": r["score"], "rules": r["rules"]}
