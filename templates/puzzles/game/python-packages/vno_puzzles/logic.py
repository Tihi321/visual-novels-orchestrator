"""Logic grids (Puzzle Baron): four categories of equal size, the first of them ordinal (days, ages, months: the items have an order), clues
about who goes with whom and about order ("came before", "exactly two days apart"). The player fills in the grid; there is no accusation.

The grid, the solver, the clue types and the deduction rules are the ones of Murdle (`model.py`, `solver.py`); this module makes the puzzles
and their words. Every puzzle has exactly one solution, is solved by deduction without guessing, is minimal (dropping any clue breaks
that) and is in its band: easy needs no either and no transitive step, hard needs many transitive steps (`hardTrans`).
"""

import random

from .model import BANDS, FORMAT, PuzzleError, clue_true, owners_of, ordinal_items
from .solver import allowed_for, band_of, count_solutions, deduce, deduce_fast, difficulty

#: The built-in scenario: a bakery's deliveries. Each category has `ref` ("how a clue refers to one of its items").
SCENARIO = {
    "intro": "The bakery delivered one order each day. Work out which delivery was which.",
    "categories": [
        {"key": "day", "ref": "the {n} delivery", "names": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "prefix": "d"},
        {"key": "customer", "ref": "the delivery to {n}", "names": ["Ana", "Boris", "Cleo", "Dino", "Eva"], "prefix": "c"},
        {"key": "cake", "ref": "the {n} delivery", "names": ["lemon cake", "poppy roll", "plum tart", "honey bun", "rye loaf"], "prefix": "k"},
        {"key": "town", "ref": "the delivery to {n}", "names": ["Oakville", "Pinebrook", "Riverton", "Stonegate", "Wheatley"], "prefix": "t"},
    ],
    "unit": "days",
}
SIZES = (3, 4, 5)
HARD_TRANS = {3: 3, 4: 6, 5: 10}


def default_names(p):
    have = p.get("names") or {}
    out = {}
    for sc, c in zip(SCENARIO["categories"], p["categories"]):
        for i, it in enumerate(c["items"]):
            out[it] = have.get(it) or (sc["names"][i] if i < len(sc["names"]) else it)
    return out


def intro_text(p):
    return SCENARIO["intro"]


def _skeleton(rng, size):
    cats = []
    for sc in SCENARIO["categories"]:
        cats.append({"key": sc["key"], "items": ["%s%d" % (sc["prefix"], i + 1) for i in range(size)], "ref": sc["ref"]})
    perms = []
    for c in cats[1:]:
        items = list(c["items"])
        rng.shuffle(items)
        perms.append(items)
    solution = {s: {c["key"]: perms[k][i] for k, c in enumerate(cats[1:])} for i, s in enumerate(cats[0]["items"])}
    return cats, solution


def _pos(owner, people, item):
    return people.index(owner[item])


def _pool(rng, cats, owner, band):
    """Every true clue of the solution (of every type allowed in the band), shuffled."""
    people = cats[0]["items"]
    items = [(ci, it) for ci, c in enumerate(cats) for it in c["items"]]
    pool = []
    for x in range(len(items)):
        for y in range(len(items)):
            (ci, a), (cj, b) = items[x], items[y]
            if ci == cj:
                continue
            if x < y:
                if owner[a] == owner[b]:
                    if band != "hard":
                        pool.append({"type": "is", "a": a, "b": b})
                else:
                    pool.append({"type": "not", "a": a, "b": b})
            pa, pb = _pos(owner, people, a), _pos(owner, people, b)
            if pa < pb:
                pool.append({"type": "before", "a": a, "b": b})
            if x < y and pa != pb:
                pool.append({"type": "apart", "a": a, "b": b, "n": abs(pa - pb)})
    if band != "easy":
        for ci, a in items:
            for cj, c in enumerate(cats):
                if cj == ci:
                    continue
                true = [b for b in c["items"] if owner[b] == owner[a]]
                false = [b for b in c["items"] if owner[b] != owner[a]]
                for f in false:
                    pair = [true[0], f]
                    rng.shuffle(pair)
                    pool.append({"type": "either", "a": a, "b": pair})
                if len(false) >= 2:
                    for i in range(len(false)):
                        for j in range(i + 1, len(false)):
                            pool.append({"type": "neither", "a": a, "b": [false[i], false[j]]})
        for ci in range(len(cats)):
            for cj in range(len(cats)):
                if ci == cj:
                    continue
                for i in range(len(cats[ci]["items"])):
                    for j in range(i + 1, len(cats[ci]["items"])):
                        a1, a2 = cats[ci]["items"][i], cats[ci]["items"][j]
                        t1 = next(b for b in cats[cj]["items"] if owner[b] == owner[a1])
                        t2 = next(b for b in cats[cj]["items"] if owner[b] == owner[a2])
                        pair = [t1, t2]
                        rng.shuffle(pair)
                        pool.append({"type": "oneof", "a": [a1, a2], "b": pair})
    else:
        for ci, a in items:
            for cj, c in enumerate(cats):
                if cj == ci:
                    continue
                false = [b for b in c["items"] if owner[b] != owner[a]]
                if len(false) >= 2:
                    for i in range(len(false)):
                        for j in range(i + 1, len(false)):
                            pool.append({"type": "neither", "a": a, "b": [false[i], false[j]]})
    rng.shuffle(pool)
    return pool


def _allowed(band):
    """The rules a band's puzzle must be solved with: easy no either and no transitive step, medium may use either (and the clues that need it)
    but no transitive step, hard all of them (and then needs many transitive steps)."""
    if band == "easy":
        return allowed_for("easy", {"ordinal": True})
    if band == "medium":
        return allowed_for("easy", {"ordinal": True}) + ("either",)
    return allowed_for("hard")


def _numbered(clues):
    return [dict(c, id="c%d" % (i + 1)) for i, c in enumerate(clues)]


def _with_ids(p, clues):
    q = dict(p)
    q["clues"] = _numbered(clues)
    return q


def _minimal(p, clues, allowed, rng):
    keep = list(clues)
    order = list(range(len(keep)))
    rng.shuffle(order)
    gone = set()
    for i in order:
        trial = [c for j, c in enumerate(keep) if j != i and j not in gone]
        if deduce_fast(_with_ids(p, trial), allowed=allowed):
            gone.add(i)
    return [c for j, c in enumerate(keep) if j not in gone]


def generate_logic(size=4, seed=0, band="medium", max_tries=200):
    if size not in SIZES:
        raise PuzzleError("logic grids have %s items per category, not %r" % (" or ".join(str(s) for s in SIZES), size))
    if band not in BANDS:
        raise PuzzleError("unknown band %r (easy, medium or hard)" % (band,))
    rng = random.Random("vno-puzzles:logic:%s:%s:%d" % (seed, band, size))
    for _ in range(max_tries):
        cats, solution = _skeleton(rng, size)
        base = {
            "format": FORMAT, "kind": "logic", "size": size, "seed": seed, "band": band, "categories": cats, "solution": solution,
            "ordinal": {"category": cats[0]["key"], "unit": SCENARIO["unit"]}, "hardTrans": HARD_TRANS[size],
        }
        allowed = _allowed(band)
        owner = owners_of(dict(base, clues=[]))
        pool = _pool(rng, cats, owner, band)
        chosen = []
        for c in pool:
            chosen.append(c)
            # check every few clues: deduce_fast is the cost
            if len(chosen) % 3 == 0 and deduce_fast(_with_ids(base, chosen), allowed=allowed):
                break
        else:
            if not deduce_fast(_with_ids(base, chosen), allowed=allowed):
                continue
        clues = _minimal(base, chosen, allowed, rng)
        rng.shuffle(clues)
        p = _with_ids(base, clues)
        res = deduce(p)
        if not res["solved"] or band_of(p, res) != band or count_solutions(p, 2) != 1:
            continue
        if band == "medium" and not any(c["type"] in ("either", "oneof") for c in clues):
            continue
        p["difficulty"] = difficulty(p, res)
        p["steps"] = res["steps"]
        return fill_logic(p)
    raise PuzzleError("no %s logic grid found for seed %s in %d tries" % (band, seed, max_tries))


def fill_logic(p, names=None):
    from .text import clue_text

    nm = dict(names) if names else default_names(p)
    p["names"] = nm
    p["text"] = {c["id"]: clue_text(p, c, nm) for c in p["clues"]}
    p["text"]["intro"] = intro_text(p)
    return p


def verify_logic(p):
    from .model import validate

    validate(p)
    owner = owners_of(p)
    ordinal = ordinal_items(p)
    for c in p["clues"]:
        if not clue_true(c, owner, ordinal):
            raise PuzzleError("clue %s is false in the solution" % c["id"])
    if count_solutions(p, 2) != 1:
        raise PuzzleError("the puzzle does not have exactly one solution")
    res = deduce(p)
    if not res["solved"]:
        raise PuzzleError("the puzzle cannot be solved by deduction alone")
    return res
