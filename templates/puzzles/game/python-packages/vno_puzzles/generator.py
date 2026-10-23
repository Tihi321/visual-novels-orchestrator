"""The generator for Murdle: `generate(kind, size, seed, band)` makes a puzzle and proves it.

Every puzzle it returns has exactly one solution (a search over every assignment), can be solved by deduction alone (no guessing), is
minimal for its band (dropping any one clue breaks uniqueness or deduction), and is in the band asked for. Deterministic:
`random.Random(seed)` only. Sizes 3 and 4; `motive` adds a fourth category; `attrs` lets clues point at an item by a trait
("the heavy weapon") instead of its name.
"""

import random

from .model import BANDS, FORMAT, PuzzleError, answer_of, clue_true, owners_of, validate
from .solver import allowed_for, band_of, count_solutions, deduce, deduce_fast, difficulty
from .text import default_descr, fill

KEYS = ["suspect", "weapon", "place"]
PREFIX = {"suspect": "s", "weapon": "w", "place": "p", "motive": "m"}
SIZES = (3, 4)


def _skeleton(rng, size, motive=False):
    keys = KEYS + (["motive"] if motive else [])
    cats = [{"key": k, "items": ["%s%d" % (PREFIX[k], i + 1) for i in range(size)]} for k in keys]
    shuffled = []
    for c in cats[1:]:
        items = list(c["items"])
        rng.shuffle(items)
        shuffled.append(items)
    solution = {}
    for i, s in enumerate(cats[0]["items"]):
        solution[s] = {c["key"]: shuffled[k][i] for k, c in enumerate(cats[1:])}
    return cats, solution


def _pool(rng, cats, owner, band):
    """Every true clue of the solution, shuffled. `is` clues: all for easy, at most one is added later for medium, none for hard."""
    pool = []
    items = [(ci, it) for ci, c in enumerate(cats) for it in c["items"]]
    for x in range(len(items)):
        for y in range(x + 1, len(items)):
            (ci, a), (cj, b) = items[x], items[y]
            if ci == cj:
                continue
            if owner[a] == owner[b]:
                if band != "hard":
                    pool.append({"type": "is", "a": a, "b": b})
            else:
                pool.append({"type": "not", "a": a, "b": b})
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
    rng.shuffle(pool)
    return pool


def _numbered(clues):
    return [dict(c, id="c%d" % (i + 1)) for i, c in enumerate(clues)]


def _with_ids(p, clues):
    q = dict(p)
    q["clues"] = _numbered(clues)
    return q


def _minimal(p, clues, allowed, rng):
    """Drops every clue that is not needed, in random order: still deducible (so still unique) without it, with the band's rules."""
    keep = list(clues)
    order = list(range(len(keep)))
    rng.shuffle(order)
    gone = set()
    for i in order:
        trial = [c for j, c in enumerate(keep) if j != i and j not in gone]
        if deduce_fast(_with_ids(p, trial), allowed=allowed):
            gone.add(i)
    return [c for j, c in enumerate(keep) if j not in gone]


def _point_at_traits(rng, p, clues):
    """Attribute clues: each clue points at some of its suspect, weapon and place items by a trait instead of by name."""
    descr = default_descr(p)
    out = []
    for c in clues:
        items = [c["a"]] + (c["b"] if isinstance(c["b"], list) else [c["b"]])
        pick = [it for it in items if it in descr and rng.random() < 0.5]
        out.append(dict(c, descr=pick) if pick else c)
    return out, descr


def generate(kind="murdle", size=3, seed=0, band="medium", max_tries=200, motive=False, attrs=False):
    """A Murdle puzzle (suspect, weapon, place, and with `motive` a motive). Raises PuzzleError naming the seed and band when none is found in `max_tries`."""
    if size is None:
        size = {"murdle": 3, "logic": 4, "knights": 3, "testimony": 3}.get(kind, 3)
    if kind == "logic":
        from .logic import generate_logic

        return generate_logic(size=size, seed=seed, band=band, max_tries=max_tries)
    if kind == "knights":
        from .knights import generate_knights

        return generate_knights(size=size, seed=seed, band=band, max_tries=max_tries)
    if kind == "testimony":
        from .testimony import generate_testimony

        return generate_testimony(size=size, seed=seed, band=band, max_tries=max_tries)
    if kind != "murdle":
        raise PuzzleError("unknown puzzle kind %r (murdle, logic, knights or testimony)" % (kind,))
    if size not in SIZES:
        raise PuzzleError("murdle makes puzzles of %s items per category, not %r" % (" or ".join(str(s) for s in SIZES), size))
    if band not in BANDS:
        raise PuzzleError("unknown band %r (easy, medium or hard)" % (band,))
    tag = "vno-puzzles:%s:%s:%s" % (kind, seed, band)
    if size != 3 or motive or attrs:
        tag += ":%d%s%s" % (size, "m" if motive else "", "a" if attrs else "")
    rng = random.Random(tag)
    allowed = allowed_for(band)
    for _ in range(max_tries):
        cats, solution = _skeleton(rng, size, motive)
        base = {"format": FORMAT, "kind": kind, "size": size, "seed": seed, "band": band, "categories": cats, "solution": solution}
        owner = owners_of(dict(base, clues=[]))
        pool = _pool(rng, cats, owner, band)
        chosen = []
        got_is = 0
        for c in pool:
            if c["type"] == "is" and band == "medium":
                if got_is:
                    continue
                got_is += 1
            chosen.append(c)
            if deduce_fast(_with_ids(base, chosen), allowed=allowed):
                break
        else:
            continue
        clues = _minimal(base, chosen, allowed, rng)
        p = _with_ids(base, clues)
        res = deduce(p)
        if not res["solved"] or band_of(p, res) != band:
            continue
        rng.shuffle(clues)
        p = _with_ids(base, clues)
        res = deduce(p)
        if not res["solved"] or band_of(p, res) != band or count_solutions(p, 2) != 1:
            continue
        if attrs:
            pointed, descr = _point_at_traits(rng, p, p["clues"])
            p["clues"] = pointed
            p["descr"] = descr
        place = rng.choice(cats[2]["items"])
        p["murder"] = {"place": place}
        p["murder"]["answer"] = answer_of(p)
        p["difficulty"] = difficulty(p, res)
        p["steps"] = res["steps"]
        return fill(p)
    raise PuzzleError("no %s puzzle found for seed %s in %d tries" % (band, seed, max_tries))


def verify(p):
    """The soundness checks of the tests, for one puzzle: raises PuzzleError naming the first thing that fails."""
    kind = p.get("kind", "murdle")
    if kind == "knights":
        from .knights import verify_knights

        return verify_knights(p)
    if kind == "logic":
        from .logic import verify_logic

        return verify_logic(p)
    if kind == "testimony":
        from .testimony import verify_testimony

        return verify_testimony(p)
    validate(p)
    owner = owners_of(p)
    from .model import ordinal_items

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


__all__ = ["generate", "verify"]
